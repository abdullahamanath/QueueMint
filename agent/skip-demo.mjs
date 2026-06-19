// QueueMint x402 skip-demo — an agent buys priority access programmatically.
// Speaks the real x402 wire format (402 challenge → X-PAYMENT → X-PAYMENT-RESPONSE). Pay-then-prove:
// the agent mints a skip-pass via the contract (native USDC), then proves it with the tx hash.
//   BUYER_PK=0x.. CONTRACT=0x.. API_BASE=https://queuemint-arc.vercel.app node agent/skip-demo.mjs <venueId>
import { JsonRpcProvider, Wallet, Contract } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CONTRACT = process.env.CONTRACT;
const API = process.env.API_BASE || "http://localhost:3000";
const id = process.argv[2] || "1";
const wallet = new Wallet(process.env.BUYER_PK, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(CONTRACT, ["function mint(uint256 venueId) payable returns (uint256)"], wallet);

// 1) ask the x402 endpoint — get the 402 challenge with today's price
const ch = await fetch(`${API}/api/x402/skip/${id}`, { method: "POST" });
if (ch.status !== 402) { console.error("expected 402, got", ch.status, await ch.text()); process.exit(1); }
const req = (await ch.json()).accepts[0];
console.log(`402 → mint() on ${req.payTo}, pay ${req.maxAmountRequired} wei (native USDC) on ${req.network}`);

// 2) pay by minting the skip-pass (atomic: the mint IS the payment, forwarded to the venue owner)
const tx = await c.mint(id, { value: BigInt(req.maxAmountRequired) });
const rc = await tx.wait(1);
console.log("minted + paid:", rc.hash);

// 3) prove it — present the tx hash in X-PAYMENT
const xpay = Buffer.from(JSON.stringify({ txHash: rc.hash, payer: wallet.address })).toString("base64");
const res = await fetch(`${API}/api/x402/skip/${id}`, { method: "POST", headers: { "X-PAYMENT": xpay } });
if (!res.ok) { console.error("denied:", res.status, await res.text()); process.exit(1); }
const settle = res.headers.get("X-PAYMENT-RESPONSE");
console.log("X-PAYMENT-RESPONSE:", JSON.parse(Buffer.from(settle, "base64").toString()));
console.log("SKIP-PASS:", JSON.stringify(await res.json(), null, 2));
console.log("\n→ the agent now holds a skip-pass; it presents passId at the queue, doorman burns it via redeem().");
