import { ethers } from "ethers";
import { ARC_RPC } from "./arcNetwork";

// ─────────────────────────────────────────────────────────────
// QueueMint — on-chain skip-the-line passes on ARC.
// ─────────────────────────────────────────────────────────────
export const CONTRACT_ADDRESS = "0x96C81dE4a39463541d5300a500e48e5992A5B17F";

export const QUEUEMINT_ABI = [
  "function createVenue(string name, string uri, address agent, uint32 maxDailyCap) returns (uint256)",
  "function setAgent(uint256 venueId, address agent)",
  "function openEdition(uint256 venueId, uint256 price, uint32 cap)",
  "function setPrice(uint256 venueId, uint256 price, uint32 cap)",
  "function mint(uint256 venueId) payable returns (uint256)",
  "function redeem(uint256 passId)",
  "function today() view returns (uint64)",
  "function venueCount() view returns (uint256)",
  "function mintVolume() view returns (uint256)",
  "function passesMinted() view returns (uint256)",
  "function passesRedeemed() view returns (uint256)",
  "function getVenue(uint256) view returns (tuple(uint256 id, address owner, address agent, string name, string uri, uint32 maxDailyCap, uint64 createdAt, bool active))",
  "function todayEdition(uint256) view returns (tuple(uint64 day, uint256 price, uint32 cap, uint32 minted, uint32 redeemed, bool open))",
  "function getPass(uint256) view returns (tuple(uint256 id, uint256 venueId, uint64 day, uint32 serial, address owner, bool redeemed))",
  "function ownedPasses(address) view returns (uint256[])",
  "function remainingToday(uint256) view returns (uint32)",
  "function isValidToday(uint256) view returns (bool)",
  "event VenueCreated(uint256 indexed id, address indexed owner, address agent, string name, uint32 maxDailyCap)",
  "event EditionOpened(uint256 indexed id, uint64 day, uint256 price, uint32 cap)",
  "event PriceSet(uint256 indexed id, uint64 day, uint256 price, uint32 cap)",
  "event Minted(uint256 indexed passId, uint256 indexed venueId, address indexed to, uint32 serial, uint256 paid)",
  "event Redeemed(uint256 indexed passId, uint256 indexed venueId, address indexed who)",
];

export const MAX = 60;

export interface Edition { day: number; price: bigint; cap: number; minted: number; redeemed: number; open: boolean; }
export interface Venue {
  id: number; owner: string; agent: string; name: string; uri: string;
  maxDailyCap: number; createdAt: number; active: boolean;
  edition: Edition; remaining: number;
}
export interface Pass { id: number; venueId: number; day: number; serial: number; owner: string; redeemed: boolean; venueName?: string; }

export interface Stats { venues: number; minted: number; redeemed: number; volume: bigint; }
export const EMPTY_STATS: Stats = { venues: 0, minted: 0, redeemed: 0, volume: 0n };

export function readProvider() { return new ethers.JsonRpcProvider(ARC_RPC); }
export function readContract(p?: ethers.Provider) { return new ethers.Contract(CONTRACT_ADDRESS, QUEUEMINT_ABI, p ?? readProvider()); }
export function hasContract(): boolean { return /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS); }

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const s = await Promise.allSettled(items.slice(i, i + limit).map(fn));
    s.forEach((r) => { if (r.status === "fulfilled") out.push(r.value); });
  }
  return out;
}

export async function fetchVenue(id: number, contract?: ethers.Contract): Promise<Venue | null> {
  const c = contract ?? readContract();
  try {
    const v = await c.getVenue(id);
    if (v.owner === ethers.ZeroAddress) return null;
    const [ed, rem] = await Promise.all([c.todayEdition(id), c.remainingToday(id)]);
    return {
      id: Number(v.id), owner: v.owner, agent: v.agent, name: v.name, uri: v.uri,
      maxDailyCap: Number(v.maxDailyCap), createdAt: Number(v.createdAt), active: v.active,
      edition: { day: Number(ed.day), price: ed.price, cap: Number(ed.cap), minted: Number(ed.minted), redeemed: Number(ed.redeemed), open: ed.open },
      remaining: Number(rem),
    };
  } catch { return null; }
}

export async function fetchStats(contract?: ethers.Contract): Promise<Stats> {
  const c = contract ?? readContract();
  const [venues, minted, redeemed, volume] = await Promise.all([c.venueCount(), c.passesMinted(), c.passesRedeemed(), c.mintVolume()]);
  return { venues: Number(venues), minted: Number(minted), redeemed: Number(redeemed), volume };
}

export async function fetchVenues(count: number, contract?: ethers.Contract): Promise<Venue[]> {
  const c = contract ?? readContract();
  const total = Number(await c.venueCount());
  if (total === 0) return [];
  const ids = Array.from({ length: total }, (_, i) => i + 1).slice(-count);
  const out = await mapLimit(ids, 6, (id) => fetchVenue(id, c));
  return out.filter((x): x is Venue => !!x).sort((a, b) => a.id - b.id);
}

export async function fetchOwnedPasses(addr: string, venues: Venue[], contract?: ethers.Contract): Promise<Pass[]> {
  const c = contract ?? readContract();
  const ids: bigint[] = await c.ownedPasses(addr);
  const names = new Map(venues.map((v) => [v.id, v.name]));
  const out = await mapLimit(ids.slice(-MAX).map(Number), 8, async (pid) => {
    const p = await c.getPass(pid);
    return { id: Number(p.id), venueId: Number(p.venueId), day: Number(p.day), serial: Number(p.serial), owner: p.owner, redeemed: p.redeemed, venueName: names.get(Number(p.venueId)) };
  });
  return out.sort((a, b) => b.id - a.id);
}

// ── helpers ──────────────────────────────────────────────────
export function shortAddr(a: string, lead = 6, tail = 4): string { return a ? `${a.slice(0, lead)}…${a.slice(-tail)}` : ""; }
export function fmtUsdc(wei: bigint, dp = 2): string {
  const n = parseFloat(ethers.formatEther(wei));
  if (n === 0) return "0.00";
  if (n < 0.01) { const s = n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); return s === "0" ? "<0.01" : s; }
  return n.toFixed(dp);
}
export function utcDay(now: number): number { return Math.floor(now / 86400); }
/** Seconds to the next 00:00 UTC reset, formatted. */
export function untilReset(now: number): string {
  if (now <= 0) return "…";
  const next = (Math.floor(now / 86400) + 1) * 86400;
  let diff = next - now;
  const h = Math.floor(diff / 3600); diff -= h * 3600;
  const m = Math.floor(diff / 60); const s = diff - m * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
export function clock(now: number): string {
  if (now <= 0) return "--:--";
  const d = new Date(now * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
