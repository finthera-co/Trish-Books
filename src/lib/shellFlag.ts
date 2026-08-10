import { useSyncExternalStore } from "react";

/**
 * Opt-in flag for the shell v2 navigation (rail + module panel).
 *
 * Lets the new shell be tried on the real app, on real data, and switched off
 * instantly. When it ships this file and its call sites go away.
 */
const KEY = "shell-v2";
const EVENT = "shell-v2-change";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setShellV2(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode — flag simply doesn't persist */
  }
  emit();
}

export function useShellV2(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
