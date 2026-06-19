> **ACCESSION 0x96C8…B17F** — *QueueMint*, a standing collection of skip-the-line passes.
> Native USDC on Arc testnet (chain 5042002). On view at **[queuemint-arc.vercel.app](https://queuemint-arc.vercel.app)**.
> Catalogued at **[testnet.arcscan.app/address/0x96C81dE4a39463541d5300a500e48e5992A5B17F](https://testnet.arcscan.app/address/0x96C81dE4a39463541d5300a500e48e5992A5B17F)**.

---

## The object

A *skip-pass* is a single right to step out of one queue, one time, on one day. In this collection each
pass is held as a small on-chain artefact: a serial number, a venue, a UTC day, and a holder. It is
produced in a numbered run that the venue opens fresh every morning, sold to whoever takes it next, and
**defaced — burned — at the instant it is used.** A used pass is not resold, not regifted, not archived
intact. Its terminal condition is destruction. That is the whole point of the piece.

A "venue" here is loosely framed on purpose. The wall text on the contract names a few: *an airport gate,
a ramen counter, a support desk, a rate-limited API.* Anything with a line and a front of that line can
hang one.

## Provenance

The work is a single contract, `contracts/QueueMint.sol`, with no curator-above-the-curator — no owner
role over the collection, no administrator who can pause it, no fee skimmed in transit, no upgrade hatch.
Each piece traces cleanly:

- A venue is hung with `createVenue(name, uri, agent, maxDailyCap)`. The `maxDailyCap` (1–10000) is fixed
  at hanging and can never be raised afterward — a permanent ceiling on how many passes can ever exist in
  a single day.
- The venue owner receives **100% of every sale.** `mint()` forwards the full payment straight to
  `venue.owner` in the same call, so the contract itself never holds a balance. There is no vault to drain
  because there is no vault.
- Passes are **bound to the buyer and the day.** There is no `transfer`. A pass cannot change hands; it can
  only be redeemed by the address that minted it, and only while the day matches.

## Acquisition

Each morning a venue's *curator* opens that day's edition with
`openEdition(venueId, price, cap)` — a price between roughly **0.10 and 0.30 USDC** and a run no larger than
the venue's permanent ceiling. While it is open:

```
mint(venueId)  payable, value == today's price
       │
       ├─ serial assigned (1 … cap), pass struck and recorded to the buyer
       ├─ full payment forwarded to the venue owner
       └─ emits Minted(passId, venueId, to, serial, paid)
```

The gallery shows the live numeral — `remainingToday(venueId)` — counting down as serials are claimed. When
`minted == cap` the edition reads *acquired in full* and returns at 00:00 UTC, when the day rolls and a new
run can be opened.

A curator may also breathe the price during the day with `setPrice(venueId, price, cap)`: raising it as a
run sells through, easing it when the hall is quiet. The cap can be retuned but never below what is already
sold, never above the venue's ceiling.

## Redemption

```
Condition on acquisition .... pristine · valid for the current UTC day · held by the buyer
Condition on use ............ BURNED
```

`redeem(passId)` is the act of using the pass at the front of the line. It checks three things — you are the
holder, it has not already been spent, it is still today's pass — then sets the holder to the zero address,
marks it redeemed, and emits `Redeemed`. The artefact is gone. `isValidToday(passId)` is the doorman's
one-line check before that happens: un-burned, and dated today.

This irreversibility is the feature, not a limitation. A paper fast-pass can be photocopied, scalped, and
oversold until the fast lane is just another line. A burned-on-use pass with a hard daily ceiling cannot be:
the scarcity is enforced by the object itself, in the open, on a number anyone can read.

## For machines (x402)

The argument for putting this on **Arc** specifically begins with a buyer who has no hands.

A booking bot, a scraper, an autonomous purchasing agent — none of them can wave a season pass at a turnstile
or tap a human "priority" tier. But all of them hit rate-limited queues: a checkout, an API, a reservation
window. QueueMint lets such an agent **pay about fifteen cents to jump that line, in code, with no wallet UI.**

`app/api/x402/skip/[venueId]/route.ts` is a live server endpoint speaking the genuine **x402** wire format —
the `402` challenge, the `X-PAYMENT` header, the `X-PAYMENT-RESPONSE` receipt. Because Arc's USDC is the
*native* coin rather than an ERC-20, this is honestly a **pay-then-prove** flow, not the gasless EIP-3009
variant: the agent calls `mint()` itself (the mint *is* the payment), then presents the transaction hash. The
route independently verifies the on-chain `Minted` event for that venue, rejects anything older than a
180-second freshness window, and refuses a hash it has already seen. No facilitator sits in the middle.
`agent/skip-demo.mjs` is a runnable client that walks the full handshake.

This is the part that does not pencil out elsewhere. A fifteen-cent purchase only makes sense when the cost
of settling it is a rounding error and the unit of account *is* the thing being charged — so a venue nets
its sale instead of watching a separate volatile fee eat it, and software can pay its own way at cent scale
all day. On a chain where the toll is a different, swinging token, a programmatic micro-skip is not a market;
it is a fee-collection scheme for the validators. Arc is what makes the agent a customer rather than a loss.

## The autonomous curator

`agent/curator.mjs` is a real standing process, not a button in the UI. Pointed at a venue whose `agent`
field is set to its wallet, it polls every 60 seconds and:

- opens the day's edition if none is open (default 0.15 USDC × up to 30 passes);
- **surges** the price +15% once a run passes 70% sold;
- **decays** it −8% when fewer than 25% have gone;
- clamps every move to the 0.10–0.30 band.

Its authority is deliberately narrow. The contract's `_isCurator` check lets the agent open and price
editions and *nothing else*: it can never move a cent, never mint a pass, never breach the venue's permanent
ceiling. It is a pricing hand with no purse. The scarcity and the price you see on the wall can be authored
entirely by software, while the money stays out of its reach.

## Visiting hours

```bash
npm install
npm run dev      # opens at http://localhost:3000
```

Hang a venue, open its edition, acquire a pass, and redeem one to watch the burn fall. To let the autonomous
curator run a room, set that venue's agent and start `agent/curator.mjs` from a wallet holding a little USDC
for gas. To watch a machine buy its way past the rope, run `agent/skip-demo.mjs` against an open venue.

---

*Catalogued by Abdullah Al Amanath. The collection settles in native USDC on Arc; all condition reports are
the chain's own.*
