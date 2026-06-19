import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { ARC_RPC, ARC_CHAIN_ID } from "@/lib/arcNetwork";
import { CONTRACT_ADDRESS, QUEUEMINT_ABI } from "@/lib/queuemint";

export const runtime = "nodejs";

// ── QueueMint x402 — programmatic priority access ──
// An AI/booking/scraper agent pays a micro-fee over the real x402 (HTTP-402) standard to mint a
// skip-pass without a wallet UI, then presents it to jump a queue. Honest scope: Arc's USDC is the
// NATIVE coin (no ERC-20, no EIP-3009 gasless), so this is PAY-THEN-PROVE: the agent calls the
// contract's mint() (paying native USDC, which forwards to the venue owner), then proves it with the
// tx hash in X-PAYMENT; we verify the Minted event on-chain. Genuine 402/X-PAYMENT/X-PAYMENT-RESPONSE
// wire format, self-verified on Arc, no facilitator. Replay-bounded by a freshness window.

const FRESH = 180;
const seen = new Set<string>();

function challenge(req: NextRequest, venueId: string, price: bigint, error: string) {
  return NextResponse.json({
    x402Version: 1,
    error,
    accepts: [{
      scheme: "exact",
      network: `eip155:${ARC_CHAIN_ID}`,
      maxAmountRequired: price.toString(),
      resource: `${req.nextUrl.origin}/api/x402/skip/${venueId}`,
      description: `QueueMint skip-pass for venue ${venueId} — mint() on the QueueMint contract (native USDC, 18 dec), pay-then-prove, self-verified, no facilitator.`,
      mimeType: "application/json",
      payTo: CONTRACT_ADDRESS,
      asset: "0x0000000000000000000000000000000000000000",
      extra: { name: "USDC", decimals: 18, native: true, method: "mint", venueId: Number(venueId) },
    }],
  }, { status: 402 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = await params;
  if (!/^\d+$/.test(venueId)) return NextResponse.json({ error: "bad venue id" }, { status: 400 });
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS)) return NextResponse.json({ error: "contract not configured" }, { status: 503 });

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const c = new ethers.Contract(CONTRACT_ADDRESS, QUEUEMINT_ABI, provider);
  let price = 0n;
  try { const ed = await c.todayEdition(venueId); if (!ed.open || ed.minted >= ed.cap) return NextResponse.json({ error: "no edition open / sold out today" }, { status: 409 }); price = ed.price; }
  catch { return NextResponse.json({ error: "venue not found" }, { status: 404 }); }

  const hdr = req.headers.get("x-payment");
  if (!hdr) return challenge(req, venueId, price, "X-PAYMENT header required");

  let txHash: string;
  try { const p = JSON.parse(Buffer.from(hdr, "base64").toString("utf8")); txHash = p?.txHash || p?.payload?.txHash; if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("bad txHash"); }
  catch { return challenge(req, venueId, price, "malformed X-PAYMENT"); }
  if (seen.has(txHash)) return challenge(req, venueId, price, "payment already used");

  try {
    const rc = await provider.getTransactionReceipt(txHash);
    if (!rc || rc.status !== 1 || rc.to?.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) return challenge(req, venueId, price, "invalid or unconfirmed payment");
    const blk = await provider.getBlock(rc.blockNumber);
    if (!blk || Math.floor(Date.now() / 1000) - Number(blk.timestamp) > FRESH) return challenge(req, venueId, price, "payment too old — pay again");

    // find the Minted event for this venue
    const iface = new ethers.Interface(QUEUEMINT_ABI);
    let pass: { passId: number; serial: number; to: string } | null = null;
    for (const log of rc.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "Minted" && Number(parsed.args.venueId) === Number(venueId)) {
          pass = { passId: Number(parsed.args.passId), serial: Number(parsed.args.serial), to: parsed.args.to };
          break;
        }
      } catch { /* not ours */ }
    }
    if (!pass) return challenge(req, venueId, price, "no skip-pass minted for this venue in that tx");
    seen.add(txHash);

    const signal = { venueId: Number(venueId), passId: pass.passId, serial: pass.serial, holder: pass.to, valid: true, network: `eip155:${ARC_CHAIN_ID}`, note: "skip-pass acquired — present passId at the queue; doorman burns via redeem()" };
    const settlement = { success: true, transaction: txHash, network: `eip155:${ARC_CHAIN_ID}`, payer: pass.to, tokenId: pass.passId };
    return NextResponse.json(signal, { status: 200, headers: { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(settlement)).toString("base64") } });
  } catch { return NextResponse.json({ error: "verification error" }, { status: 502 }); }
}
