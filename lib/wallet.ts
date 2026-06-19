/*
 * Wallet discovery via EIP-6963.
 * Providers announce themselves; we keep a deduped registry keyed by rdns.
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  isRabby?: boolean;
  isMetaMask?: boolean;
}

interface ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

// Wallet rdns we favour, highest priority first.
const PREFERENCE = ["io.rabby", "io.metamask"];

// localStorage slot for the user's last chosen wallet. Built from a
// namespace + field pair so it doesn't collide with sibling builds.
const STORE_NS = "qmint";
const STORE_FIELD = "rdns";
const CHOSEN_SLOT = `${STORE_NS}:${STORE_FIELD}`;

// In-memory registry of everything that has announced so far.
const registry: ProviderDetail[] = [];

function upsert(detail?: ProviderDetail) {
  if (!detail?.info?.rdns || !detail.provider) return;
  const at = registry.findIndex((d) => d.info.rdns === detail.info.rdns);
  if (at === -1) registry.push(detail);
  else registry[at] = detail;
}

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    upsert((e as CustomEvent<ProviderDetail>).detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function refreshWallets() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("eip6963:requestProvider"));
}

// Resolve discovery: returns once at least one provider is known, or after a grace period.
export function ensureDiscovered(timeoutMs = 250): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (registry.length) {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve();
    };
    const onAnnounce = () => finish();
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(finish, timeoutMs);
  });
}

export function getChosenRdns(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(CHOSEN_SLOT) || "";
  } catch {
    return "";
  }
}

export function setChosenRdns(rdns: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHOSEN_SLOT, rdns);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function listWallets() {
  refreshWallets();
  return registry.map((d) => ({ name: d.info.name, rdns: d.info.rdns, icon: d.info.icon }));
}

export function pickDetail(rdns?: string): { provider: Eip1193Provider; rdns: string } | undefined {
  refreshWallets();
  // 1) honour an explicit/remembered choice when it's actually present
  const want = rdns ?? getChosenRdns();
  if (want) {
    const hit = registry.find((d) => d.info.rdns === want);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  // 2) fall back to our preference order
  for (const r of PREFERENCE) {
    const hit = registry.find((d) => d.info.rdns === r);
    if (hit) return { provider: hit.provider, rdns: hit.info.rdns };
  }
  // 3) last resort: whatever announced first
  if (registry[0]) return { provider: registry[0].provider, rdns: registry[0].info.rdns };
  return undefined;
}

export function pickProvider(rdns?: string): Eip1193Provider | undefined {
  const d = pickDetail(rdns);
  if (d) return d.provider;
  return typeof window !== "undefined" ? (window.ethereum as Eip1193Provider | undefined) : undefined;
}
