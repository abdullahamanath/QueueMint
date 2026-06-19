"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import { useWallet } from "@/lib/useWallet";
import { ARCSCAN, switchToArc } from "@/lib/arcNetwork";
import { pickProvider } from "@/lib/wallet";
import {
  CONTRACT_ADDRESS, QUEUEMINT_ABI, hasContract, readContract,
  fetchStats, fetchVenues, fetchVenue, fetchOwnedPasses,
  fmtUsdc, shortAddr, utcDay, untilReset, clock,
  type Venue, type Pass, type Stats, EMPTY_STATS,
} from "@/lib/queuemint";

const PRICE_CHIPS = ["0.10", "0.20", "0.30"];

export default function Home() {
  const { account, balance, chainOk, connecting, connect, disconnect, refreshBalance } = useWallet();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [tab, setTab] = useState<"gallery" | "passes" | "agents">("gallery");
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);

  // create venue
  const [open, setOpen] = useState(false);
  const [vName, setVName] = useState("");
  const [vUri, setVUri] = useState("");
  const [vCap, setVCap] = useState("50");
  const [vAgent, setVAgent] = useState("");
  // open-edition (owner)
  const [edFor, setEdFor] = useState<number | null>(null);
  const [edPrice, setEdPrice] = useState("0.20");
  const [edCap, setEdCap] = useState("30");

  const epoch = useRef(0);
  const accountRef = useRef(account);
  const inFlight = useRef(false);
  useEffect(() => { accountRef.current = account; }, [account]);
  useEffect(() => { setNow(Math.floor(Date.now() / 1000)); const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    if (!hasContract()) return;
    const e = ++epoch.current;
    try {
      const c = readContract();
      const [s, v] = await Promise.all([fetchStats(c), fetchVenues(40, c)]);
      if (e !== epoch.current) return;
      setStats(s); setVenues(v);
      if (account) { const p = await fetchOwnedPasses(account, v, c); if (e === epoch.current) setPasses(p); } else setPasses([]);
    } catch { /* keep */ }
  }, [account]);
  useEffect(() => { load(); }, [load]);

  async function writeC() {
    const inj = pickProvider(); if (!inj) throw new Error("No wallet found");
    await switchToArc(inj);
    const signer = await new ethers.BrowserProvider(inj).getSigner(account);
    return new ethers.Contract(CONTRACT_ADDRESS, QUEUEMINT_ABI, signer);
  }
  function reason(e: unknown): string {
    const err = e as { code?: string | number; reason?: string; shortMessage?: string; message?: string };
    if (err?.code === "ACTION_REJECTED" || err?.code === 4001) return "Cancelled";
    return (err?.reason || err?.shortMessage || err?.message || "Failed").slice(0, 90);
  }
  function flash(t: string) { setToast(t); setTimeout(() => setToast(""), 3600); }
  async function run(key: string, fn: (c: ethers.Contract) => Promise<ethers.ContractTransactionResponse>, done: string): Promise<boolean> {
    if (!account) { if (!pickProvider()) { flash("✗ no wallet — install Rabby or MetaMask"); return false; } connect(); return false; }
    if (inFlight.current) return false;
    inFlight.current = true; const cap = account; setBusy(key); flash("confirm in your wallet…");
    let ok = false;
    try { const c = await writeC(); const tx = await fn(c); flash("settling on ARC…"); await tx.wait(); if (accountRef.current !== cap) return false; flash(done); await load(); await refreshBalance(cap); ok = true; }
    catch (e) { flash("✗ " + reason(e)); } finally { inFlight.current = false; setBusy(null); }
    return ok;
  }

  const doMint = (v: Venue) => run("mint" + v.id, (c) => c.mint(v.id, { value: v.edition.price }), `✓ skip-pass acquired · ${v.name}`);
  const doRedeem = (p: Pass) => run("rd" + p.id, (c) => c.redeem(p.id), "✓ deaccessioned — pass burned at the door");
  async function doCreate() {
    const n = vName.trim(); if (!n) return flash("✗ name the venue");
    const cap = Number(vCap); if (!Number.isInteger(cap) || cap < 1 || cap > 10000) return flash("✗ daily cap 1–10000");
    const agent = vAgent.trim() ? (ethers.isAddress(vAgent.trim()) ? vAgent.trim() : null) : ethers.ZeroAddress;
    if (agent === null) return flash("✗ agent must be an address (or blank)");
    const ok = await run("create", (c) => c.createVenue(n, vUri.trim(), agent, cap), "✓ venue hung in the gallery");
    if (ok) { setOpen(false); setVName(""); setVUri(""); setVAgent(""); }
  }
  async function doOpenEdition(v: Venue) {
    const price = ethers.parseEther(edPrice); const cap = Number(edCap);
    if (!Number.isInteger(cap) || cap < 1 || cap > v.maxDailyCap) return flash(`✗ cap 1–${v.maxDailyCap}`);
    const ok = await run("ed" + v.id, (c) => c.openEdition(v.id, price, cap), "✓ today's edition is open");
    if (ok) setEdFor(null);
  }

  const live = passes.filter((p) => !p.redeemed);
  const isOwner = (v: Venue) => !!account && v.owner.toLowerCase() === account.toLowerCase();
  const editionLive = (v: Venue) => v.active && v.edition.open && v.edition.day === utcDay(now);

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 80 }}>
      <div className="wrap">
        <div className="topbar">
          <div style={{ display: "flex", gap: "clamp(12px,2vw,26px)", alignItems: "center" }}>
            <button onClick={() => setTab("gallery")} className="nav-link" data-on={tab === "gallery"} style={{ background: "none", border: "none" }}>Venues</button>
            <button onClick={() => setTab("passes")} className="nav-link" data-on={tab === "passes"} style={{ background: "none", border: "none" }}>My Passes {live.length ? `· ${live.length}` : ""}</button>
            <button onClick={() => setTab("agents")} className="nav-link" data-on={tab === "agents"} style={{ background: "none", border: "none" }}>Agents</button>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="serif" style={{ fontSize: "clamp(24px,3vw,34px)" }}>QueueMint<sup className="mono ox" style={{ fontSize: 11, top: "-1em" }}>·402</sup></div>
            <div className="lbl" style={{ fontSize: 8.5, marginTop: 2 }}>skip-pass gallery · arc</div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "flex-end" }}>
            <span className="lbl" style={{ display: "inline" }}>LISBON · {clock(now)} · resets {untilReset(now)}</span>
            {account ? (
              <div style={{ position: "relative" }}>
                <button onClick={() => setWalletOpen((o) => !o)} className="btn btn--ghost btn--sm"><span style={{ width: 6, height: 6, borderRadius: 99, background: chainOk ? "var(--sage)" : "var(--oxblood)" }} /> №{shortAddr(account, 4, 4)}</button>
                {walletOpen && (<>
                  <div onClick={() => setWalletOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
                  <div className="frame" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 61, minWidth: 230, padding: 0 }}>
                    <div style={{ padding: "13px 15px" }}><div className="lbl">member no.</div><div className="mono" style={{ fontSize: 13, marginTop: 5 }}>{shortAddr(account, 9, 6)}</div><div className="mono gilt-t" style={{ fontSize: 12, marginTop: 5 }}>{balance || "0"} USDC</div></div>
                    {!chainOk && <button className="menu-item ox" onClick={() => switchToArc().catch(() => {})}>switch to ARC</button>}
                    <a className="menu-item" href={`${ARCSCAN}/address/${account}`} target="_blank" rel="noopener noreferrer">arcscan ↗</a>
                    <button className="menu-item" onClick={() => { setWalletOpen(false); disconnect(); }}>disconnect</button>
                  </div>
                </>)}
              </div>
            ) : <button onClick={connect} disabled={connecting} className="btn btn--ink btn--sm">{connecting ? "…" : "request access"}</button>}
          </div>
        </div>
      </div>

      {/* ── gallery ── */}
      {tab === "gallery" && (
        <section className="wrap" style={{ marginTop: "clamp(24px,4vw,48px)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
            <h1 className="serif" style={{ fontSize: "clamp(34px,6vw,72px)", lineHeight: 0.95, maxWidth: 760 }}>Skip the line.<br /><span className="it">Minted by the cent.</span></h1>
            <button onClick={() => setOpen(true)} className="btn btn--ghost">+ hang a venue</button>
          </div>
          <div className="lbl" style={{ marginBottom: 18 }}>scroll to navigate the queue → · {stats.venues} venues · {stats.minted} passes minted · {stats.redeemed} redeemed</div>
          {!hasContract() ? (
            <div className="frame" style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>contract not deployed — deploy at <a href="/deploy" style={{ textDecoration: "underline" }}>/deploy</a></div>
          ) : venues.length === 0 ? (
            <div className="frame" style={{ padding: 50, textAlign: "center", color: "var(--muted)" }}>the gallery is empty — hang the first venue.</div>
          ) : (
            <div className="rail">
              {venues.map((v) => {
                const room = String(v.id).padStart(2, "0");
                const isLive = editionLive(v);
                const soldout = isLive && v.remaining === 0;
                return (
                  <div key={v.id} className={`frame${soldout ? " frame--soldout" : ""}${v.agent !== ethers.ZeroAddress ? " frame--agent" : ""}`}>
                    <div className="frame__plate">
                      <span className="room-tag lbl" style={{ fontSize: 8.5 }}>Room {room}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {v.uri ? <img src={v.uri} alt={v.name} /> : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted)" }} className="serif it">{v.name}</div>}
                    </div>
                    <div className="plaque">
                      <div className="serif it" style={{ fontSize: 24, marginBottom: 4 }}>{v.name}</div>
                      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", margin: "10px 0 12px" }}>
                        <span className="num-big" style={{ fontSize: 46 }}>{isLive ? String(v.remaining).padStart(2, "0") : "—"}</span>
                        <span className="lbl" style={{ textAlign: "right" }}>{isLive ? "skips left today" : v.active ? "no edition today" : "closed"}</span>
                      </div>
                      <div className="spec"><span className="k">today&apos;s edition</span><span>{isLive ? `${v.edition.minted} / ${v.edition.cap}` : "—"}</span></div>
                      <div className="spec"><span className="k">price</span><span className="gilt-t usdc">{isLive ? fmtUsdc(v.edition.price) : "—"} USDC</span></div>
                      <div className="spec"><span className="k">daily ceiling</span><span>{v.maxDailyCap}{v.agent !== ethers.ZeroAddress ? " · curator-agent" : ""}</span></div>
                      {isLive && !soldout && <button onClick={() => doMint(v)} disabled={!!busy} className="btn btn--ox btn--block" style={{ marginTop: 14 }}>{busy === "mint" + v.id ? "acquiring…" : `acquire skip-pass · ${fmtUsdc(v.edition.price)} USDC`}</button>}
                      {soldout && <div className="lbl" style={{ marginTop: 14, textAlign: "center", padding: "10px", background: "var(--soldout)" }}>acquired in full — returns 00:00 UTC</div>}
                      {isOwner(v) && !v.edition.open && (
                        edFor === v.id ? (
                          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                            <div style={{ display: "flex", gap: 6 }}>{PRICE_CHIPS.map((c) => <button key={c} className="chip" data-on={edPrice === c} onClick={() => setEdPrice(c)}>ø{c}</button>)}<input value={edCap} onChange={(e) => setEdCap(e.target.value)} className="input" style={{ width: 64, padding: "8px 10px" }} placeholder="cap" /></div>
                            <button onClick={() => doOpenEdition(v)} disabled={!!busy} className="btn btn--ink btn--block">{busy === "ed" + v.id ? "opening…" : "open today's edition"}</button>
                          </div>
                        ) : <button onClick={() => { setEdFor(v.id); setEdCap(String(Math.min(30, v.maxDailyCap))); }} className="btn btn--ghost btn--block btn--sm" style={{ marginTop: 14 }}>you own this — open an edition</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── my passes ── */}
      {tab === "passes" && (
        <section className="wrap" style={{ marginTop: "clamp(24px,4vw,48px)" }}>
          <h1 className="serif it" style={{ fontSize: "clamp(30px,5vw,52px)", marginBottom: 22 }}>My Passes</h1>
          {!account ? <div className="frame" style={{ padding: 50, textAlign: "center", color: "var(--muted)" }}>request access to see your admission cards.</div>
            : passes.length === 0 ? <div className="frame" style={{ padding: 50, textAlign: "center", color: "var(--muted)" }}>no passes yet — acquire one in the gallery.</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 16 }}>
                {passes.map((p) => {
                  const valid = !p.redeemed && p.day === utcDay(now);
                  return (
                    <div key={p.id} className={`ticket${p.redeemed ? " ticket--burned" : ""}`}>
                      {p.redeemed && <div className="stamp"><span>DEACCESSIONED · BURNED</span></div>}
                      <div className="lbl">{p.venueName || `venue #${p.venueId}`}</div>
                      <div className="serif" style={{ fontSize: 30, margin: "8px 0", color: "var(--oxblood)" }}>№{String(p.serial).padStart(3, "0")}</div>
                      <div className="spec"><span className="k">status</span><span className={valid ? "sage-t" : ""}>{p.redeemed ? "burned" : p.day === utcDay(now) ? "valid today" : "expired"}</span></div>
                      <div className="spec"><span className="k">pass id</span><span className="mono">#{p.id}</span></div>
                      {valid && <button onClick={() => doRedeem(p)} disabled={!!busy} className="btn btn--ox btn--block" style={{ marginTop: 12 }}>{busy === "rd" + p.id ? "redeeming…" : "redeem & burn at the door"}</button>}
                    </div>
                  );
                })}
              </div>
            )}
        </section>
      )}

      {/* ── agents ── */}
      {tab === "agents" && (
        <section className="wrap" style={{ marginTop: "clamp(24px,4vw,48px)", maxWidth: 820 }}>
          <h1 className="serif it" style={{ fontSize: "clamp(30px,5vw,52px)", marginBottom: 22 }}>The Curators</h1>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div className="frame" style={{ padding: 22 }}>
              <div className="lbl gilt-t">⟡ curator agent</div>
              <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>An autonomous Arc wallet authors each venue&apos;s <b>daily edition</b> — it opens the limited run and surge/decay-prices it (0.10→0.30 USDC) by live demand, on-chain. It can <b>never</b> move a cent, mint a pass, or exceed the venue&apos;s immutable daily ceiling — pure pricing authority, zero money authority. The scarcity you see is authored by software.</p>
            </div>
            <div className="frame" style={{ padding: 22 }}>
              <div className="lbl ox">▣ doorman · x402</div>
              <p style={{ fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>A pass is verified (<span className="mono">isValidToday</span>) and burned at the front of the line. And an AI agent can skip a queue <b>programmatically</b>: it pays a ~15¢ micropayment over the real <b>x402</b> (HTTP-402) standard at <span className="mono">/api/x402/skip/[venueId]</span> — pay-then-prove in native USDC on Arc (eip155:5042002, self-verified, no facilitator). Priority access as a paid API: the next payer is software, not a person.</p>
            </div>
            <p className="lbl" style={{ lineHeight: 1.8 }}>only on arc · native USDC is gas + money · 10–30¢ mints net positive · agents settle cents on-chain · a line-skip market that doesn&apos;t pencil out anywhere gas isn&apos;t the dollar
              {hasContract() && <> · <a href={`${ARCSCAN}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline" }}>contract ↗</a></>}</p>
          </div>
        </section>
      )}

      {/* create venue modal */}
      {open && (
        <div className="scrim" onClick={() => setOpen(false)}>
          <div className="modal rise" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 className="serif it" style={{ fontSize: 32 }}>Hang a venue</h2>
              <button onClick={() => setOpen(false)} className="btn btn--ghost btn--sm">✕</button>
            </div>
            <div className="lbl" style={{ marginBottom: 7 }}>venue name (the queue)</div>
            <input value={vName} onChange={(e) => setVName(e.target.value)} maxLength={120} className="input" placeholder="The Vanishing Line — gate A" />
            <div className="lbl" style={{ margin: "16px 0 7px" }}>image URL (the plate)</div>
            <input value={vUri} onChange={(e) => setVUri(e.target.value)} className="input" placeholder="https://… (optional)" />
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <div style={{ width: 150 }}><div className="lbl" style={{ marginBottom: 7 }}>daily ceiling</div><input value={vCap} onChange={(e) => setVCap(e.target.value)} inputMode="numeric" className="input" placeholder="50" /></div>
              <div style={{ flex: 1, minWidth: 180 }}><div className="lbl" style={{ marginBottom: 7 }}>curator agent (optional)</div><input value={vAgent} onChange={(e) => setVAgent(e.target.value)} className="input" placeholder="0x… agent wallet" /></div>
            </div>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 14, lineHeight: 1.5 }}>You receive 100% of every mint. The daily ceiling is an immutable cap the agent can never exceed. Leave the agent blank to price editions yourself; set it to let the curator agent author the daily drop + price.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button onClick={() => setOpen(false)} className="btn btn--ghost">cancel</button>
              <button onClick={doCreate} disabled={busy === "create"} className="btn btn--ink">{busy === "create" ? "hanging…" : "hang it"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast rise" style={{ color: toast.startsWith("✓") ? undefined : toast.startsWith("✗") ? "#ff9b8a" : undefined }}>{toast}</div>}
    </div>
  );
}
