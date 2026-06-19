<h1 align="center">QueueMint</h1>

<p align="center"><em>Skip the line. Minted by the cent.</em></p>

<p align="center">
  <a href="https://queuemint-arc.vercel.app">Live app</a> ·
  <a href="https://testnet.arcscan.app/address/0x96C81dE4a39463541d5300a500e48e5992A5B17F">Contract on ArcScan</a> ·
  Native USDC on ARC testnet
</p>

---

## What it is

Queues waste the most valuable thing people — and agents — have: time. Every existing fix is broken. Paper/app fast-passes are opaque (you never see how many were sold) and oversold until the "fast" lane is also a line; premium tiers are coarse (you can't pay 20¢ for the one skip you need once); and none of them can be bought by a software agent.

QueueMint is a skip-the-line pass that fixes all four. A venue — any queue: an airport gate, a ramen counter, a support desk, a rate-limited API — opens a **limited daily edition** of skip-passes. Anyone mints one for **10–30¢ in native USDC**; it's an NFT bound to you and to the day, **burned when you reach the front** — provably one-time, no resale-after-use. The daily edition is a public on-chain cap nobody can secretly inflate, the fee is a real cent-scale payment, and an agent can buy and redeem a pass entirely programmatically.

It's wrapped in a warm-cream art museum: each venue hangs as a framed piece with a brass plaque showing today's edition, price, and a big numeral of **skips left**; minted passes are admission cards that get struck through with an oxblood **DEACCESSIONED · BURNED** cancellation stamp when redeemed.

## Why it can only work on Arc

The 10–30¢ price is **only coherent where USDC is native gas and finality is sub-second**: a mint costs roughly its face value plus a sub-cent fee, with no second gas token, no ERC-20 approval, no fee volatility. On any other chain a 15¢ on-chain sale is eaten alive by gas and approve-flows — and a cent-scale *agent* economy is simply impossible. QueueMint leans into Arc's agentic thesis: an autonomous **curator agent** authors each day's edition and surge/decay-prices it on-chain, and the **x402** endpoint turns priority access into a paid HTTP-402 API. Take away native-USDC nanopayments and cheap on-chain agents and the whole thing collapses into a human-only ticketing toy.

## The agents

- **Curator** ([`agent/curator.mjs`](agent/curator.mjs)) — a per-venue role (set via `setAgent`) that opens the daily edition and surge/decay-prices it (0.10→0.30 USDC) by live demand. It has **zero money authority**: it can never move a cent, mint a pass, or exceed the venue's immutable daily ceiling. The scarcity you see is authored by software.
- **x402 skip** ([`app/api/x402/skip/[venueId]/route.ts`](app/api/x402/skip/%5BvenueId%5D/route.ts)) — an AI agent pays a micro-fee over the real **x402** (HTTP-402) standard to acquire a skip-pass with no wallet UI. Honest scope: Arc's USDC is the native coin (no ERC-20, no EIP-3009 gasless), so this is **pay-then-prove** — the agent mints via the contract (native USDC, forwarded to the venue owner) and proves it with the tx hash in `X-PAYMENT`; the server verifies the `Minted` event on-chain. Genuine `402`/`X-PAYMENT`/`X-PAYMENT-RESPONSE` wire format, self-verified, no facilitator. Demo client: [`agent/skip-demo.mjs`](agent/skip-demo.mjs).

## The contract

[`QueueMint.sol`](contracts/QueueMint.sol) — a self-contained ERC-721-lite (no OpenZeppelin), no owner/admin/fee/upgrade. Passes are **non-transferable** (a skip-pass is bound to buyer + day; resale would defeat daily scarcity). Every mint forwards 100% of the payment straight to the venue owner, so the contract **never holds a balance**. CEI throughout; the burn is triple-guarded (owner-zeroed, redeemed-flag, day check). Two independent adversarial money-safety audits before deploy found **zero issues**.

| | |
|---|---|
| **Network** | ARC testnet (chain `5042002`) |
| **Address** | [`0x96C81dE4a39463541d5300a500e48e5992A5B17F`](https://testnet.arcscan.app/address/0x96C81dE4a39463541d5300a500e48e5992A5B17F) |
| **Compiler** | 0.8.35, optimizer 200 — verified on ArcScan |

## Run it locally

```bash
npm install
npm run dev            # http://localhost:3000
```

To run the curator agent, set it as a venue's agent and run `agent/curator.mjs` from a wallet with a little USDC for gas; otherwise the venue owner opens editions manually in the UI.

## Built with

Next.js 16 · React 19 · ethers v6 · Solidity 0.8.35 · Tailwind v4 — on ARC.

---

<p align="center"><sub>A line-skip market that only pencils out where gas is the dollar.</sub></p>
