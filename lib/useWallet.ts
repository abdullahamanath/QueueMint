"use client";

import { ethers } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ensureDiscovered, pickDetail, pickProvider, setChosenRdns, type Eip1193Provider } from "./wallet";
import { ARC_CHAIN_HEX, ARC_RPC, switchToArc } from "./arcNetwork";

// We remember an explicit user disconnect so we don't silently re-attach on
// reload. Slot name is assembled from parts to keep it build-specific.
const SLOT_PARTS = ["qmint", "session", "off"];
const OFF_SLOT = SLOT_PARTS.join(".");

export function useWallet() {
  const [account, setAccount] = useState("");
  const [balance, setBalance] = useState("");
  const [chainOk, setChainOk] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const optedOut = useRef(false);
  const listeners = useRef<{ provider: Eip1193Provider; cleanup: () => void } | null>(null);

  const refreshBalance = useCallback(async (addr: string) => {
    try {
      const rpc = new ethers.JsonRpcProvider(ARC_RPC);
      const wei = await rpc.getBalance(addr);
      setBalance(parseFloat(ethers.formatEther(wei)).toFixed(3));
    } catch {
      setBalance("вЂ”");
    }
  }, []);

  // Attach accountsChanged / chainChanged handlers to the injected provider.
  const subscribe = useCallback(
    (inj: Eip1193Provider) => {
      if (!inj?.on) return;
      if (listeners.current?.provider === inj) return;
      listeners.current?.cleanup();
      const handleAccounts = (a: unknown) => {
        if (optedOut.current) return;
        const list = a as string[];
        if (list.length) {
          setAccount(list[0]);
          refreshBalance(list[0]);
        } else {
          setAccount("");
          setBalance("");
          setChainOk(false);
        }
      };
      const handleChain = (c: unknown) =>
        setChainOk((c as string).toLowerCase() === ARC_CHAIN_HEX.toLowerCase());
      inj.on("accountsChanged", handleAccounts);
      inj.on("chainChanged", handleChain);
      listeners.current = {
        provider: inj,
        cleanup: () => {
          inj.removeListener?.("accountsChanged", handleAccounts);
          inj.removeListener?.("chainChanged", handleChain);
        },
      };
    },
    [refreshBalance]
  );

  const connect = useCallback(async () => {
    optedOut.current = false;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(OFF_SLOT);
      } catch {
        /* ignore */
      }
    }
    await ensureDiscovered();
    const detail = pickDetail();
    const inj = detail?.provider;
    if (!inj) return;
    setChosenRdns(detail.rdns);
    setConnecting(true);
    try {
      const accs = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      setAccount(accs[0]);
      subscribe(inj);
      try {
        await switchToArc(inj);
      } catch {
        /* user declined the network switch */
      }
      try {
        const id = (await inj.request({ method: "eth_chainId" })) as string;
        setChainOk(id.toLowerCase() === ARC_CHAIN_HEX.toLowerCase());
      } catch {
        setChainOk(false);
      }
      refreshBalance(accs[0]);
    } catch {
      /* user rejected */
    } finally {
      setConnecting(false);
    }
  }, [refreshBalance, subscribe]);

  const disconnect = useCallback(() => {
    optedOut.current = true;
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(OFF_SLOT, "1");
      } catch {
        /* ignore */
      }
    }
    setAccount("");
    setBalance("");
    setChainOk(false);
  }, []);

  // On mount: honour a prior opt-out, otherwise silently re-hydrate state.
  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(OFF_SLOT) === "1") {
      optedOut.current = true;
    }
    (async () => {
      await ensureDiscovered();
      const inj = pickProvider();
      if (!inj) return;
      if (!optedOut.current) {
        try {
          const accs = (await inj.request({ method: "eth_accounts" })) as string[];
          if (accs.length) {
            setAccount(accs[0]);
            refreshBalance(accs[0]);
            inj
              .request({ method: "eth_chainId" })
              .then((id) => setChainOk((id as string).toLowerCase() === ARC_CHAIN_HEX.toLowerCase()))
              .catch(() => {});
          }
        } catch {
          /* ignore */
        }
      }
      subscribe(inj);
    })();
    return () => {
      listeners.current?.cleanup();
      listeners.current = null;
    };
  }, [refreshBalance, subscribe]);

  return { account, balance, chainOk, connecting, connect, disconnect, refreshBalance };
}
