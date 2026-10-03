// Remembers the last balance-simulator inputs (a query string) in localStorage. Every access is guarded: storage can be
// blocked or full. useSyncExternalStore keeps it hydration-safe (server snapshot = nothing stored).
import { useSyncExternalStore } from "react";

const KEY = "edge-journal.balance-inputs";
const EVENT = "edge-journal:balance-inputs";

export function readStoredBalance(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeBalance(query: string): void {
  try {
    window.localStorage.setItem(KEY, query);
  } catch {
    /* blocked or full: the URL still carries the inputs */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function clearBalance(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* blocked: nothing to clear */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useStoredBalance(): string {
  return useSyncExternalStore(subscribe, readStoredBalance, () => "");
}
