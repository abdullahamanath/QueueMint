// QueueMint CURATOR agent — authors each venue's daily edition + surge/decay price on-chain.
// Runs from the agent wallet (set as venue.agent). ZERO money authority: it can only open today's
// edition and tune price/size within the venue's immutable daily ceiling — it can never move USDC,
// mint, or exceed the cap. Run: AGENT_PRIVATE_KEY=0x.. CONTRACT=0x.. node agent/curator.mjs
import { JsonRpcProvider, Wallet, Contract, parseEther, formatEther } from "ethers";

const RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const CONTRACT = process.env.CONTRACT, PK = process.env.AGENT_PRIVATE_KEY;
const POLL = Number(process.env.POLL_MS || 60000);
if (!CONTRACT || !PK) { console.error("set CONTRACT and AGENT_PRIVATE_KEY"); process.exit(1); }

const ABI = [
  "function venueCount() view returns (uint256)",
  "function getVenue(uint256) view returns (tuple(uint256 id,address owner,address agent,string name,string uri,uint32 maxDailyCap,uint64 createdAt,bool active))",
  "function todayEdition(uint256) view returns (tuple(uint64 day,uint256 price,uint32 cap,uint32 minted,uint32 redeemed,bool open))",
  "function openEdition(uint256 venueId, uint256 price, uint32 cap)",
  "function setPrice(uint256 venueId, uint256 price, uint32 cap)",
];
const wallet = new Wallet(PK, new JsonRpcProvider(RPC, 5042002));
const c = new Contract(CONTRACT, ABI, wallet);
const FLOOR = parseEther("0.10"), CEIL = parseEther("0.30");
const clamp = (x) => (x < FLOOR ? FLOOR : x > CEIL ? CEIL : x);
console.log(`QueueMint curator · ${wallet.address} · ${CONTRACT}`);

async function tick() {
  try {
    const n = Number(await c.venueCount());
    for (let id = 1; id <= n; id++) {
      const v = await c.getVenue(id);
      if (!v.active || v.agent.toLowerCase() !== wallet.address.toLowerCase()) continue;
      const ed = await c.todayEdition(id);
      if (!ed.open) {
        const cap = Math.min(30, Number(v.maxDailyCap));
        process.stdout.write(`venue ${id} "${v.name}" → opening edition ø0.15 × ${cap}… `);
        try { await (await c.openEdition(id, parseEther("0.15"), cap)).wait(); console.log("✓"); } catch (e) { console.log("skip:", e.shortMessage || e.message); }
        continue;
      }
      // surge/decay: sold ratio drives price
      const ratio = Number(ed.cap) ? Number(ed.minted) / Number(ed.cap) : 0;
      let price = ed.price;
      if (ratio > 0.7) price = (ed.price * 115n) / 100n;      // hot → surge +15%
      else if (ratio < 0.25) price = (ed.price * 92n) / 100n; // quiet → decay -8%
      price = clamp(price);
      if (price !== ed.price) {
        process.stdout.write(`venue ${id} "${v.name}" ${Math.round(ratio * 100)}% sold → price ø${(+formatEther(ed.price)).toFixed(2)}→ø${(+formatEther(price)).toFixed(2)}… `);
        try { await (await c.setPrice(id, price, ed.cap)).wait(); console.log("✓"); } catch (e) { console.log("skip:", e.shortMessage || e.message); }
      }
    }
  } catch (e) { console.error("tick error:", e.message); }
}
await tick();
setInterval(tick, POLL);
