import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_KEY = "sb-nvelymrdytmoxfokxnka-auth-token";

let dispose: (() => void) | null = null;

/** The guard runs once per module instance, so each case needs a fresh import. */
async function boot() {
  vi.resetModules();
  const mod = await import("../browserSession");
  dispose = mod.initBrowserSessionGuard();
  return mod;
}

function seed(state: { tabs?: number; heartbeatAgeMs?: number; closedAgoMs?: number }) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: "x" }));
  if (state.tabs != null) localStorage.setItem("finthera:open-tabs", String(state.tabs));
  if (state.heartbeatAgeMs != null) {
    localStorage.setItem("finthera:session-heartbeat", String(Date.now() - state.heartbeatAgeMs));
  }
  if (state.closedAgoMs != null) {
    localStorage.setItem("finthera:last-tab-closed-at", String(Date.now() - state.closedAgoMs));
  }
}

const sessionSurvived = () => localStorage.getItem(AUTH_KEY) !== null;

describe("browser session guard", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Every boot shares one jsdom window, so a leftover guard would keep counting
  // tabs into the next case.
  afterEach(() => {
    dispose?.();
    dispose = null;
  });

  it("drops a session left behind by a previous browser session", async () => {
    seed({}); // nothing else in storage: first launch after a clean close
    await boot();
    expect(sessionSurvived()).toBe(false);
  });

  it("drops the session when the browser was closed a while ago", async () => {
    seed({ tabs: 0, heartbeatAgeMs: 60_000, closedAgoMs: 60_000 });
    await boot();
    expect(sessionSurvived()).toBe(false);
  });

  it("keeps the session while another tab is still open", async () => {
    seed({ tabs: 1, heartbeatAgeMs: 5_000 });
    await boot();
    expect(sessionSurvived()).toBe(true);
    expect(localStorage.getItem("finthera:open-tabs")).toBe("2");
  });

  it("keeps the session across a reload of the last tab", async () => {
    seed({ tabs: 0, heartbeatAgeMs: 1_000, closedAgoMs: 200 });
    await boot();
    expect(sessionSurvived()).toBe(true);
  });

  it("drops the session when a stuck tab counter has gone stale", async () => {
    // Force-quit: pagehide never fired, so the counter still claims live tabs.
    seed({ tabs: 3, heartbeatAgeMs: 11 * 60 * 1000 });
    await boot();
    expect(sessionSurvived()).toBe(false);
    expect(localStorage.getItem("finthera:open-tabs")).toBe("1");
  });

  it("clears drafts along with the session", async () => {
    localStorage.setItem("finthera:draft:v1:journal-entry", "{}");
    seed({});
    await boot();
    expect(localStorage.getItem("finthera:draft:v1:journal-entry")).toBeNull();
  });

  it("gives up its slot when the tab goes away", async () => {
    seed({ tabs: 1, heartbeatAgeMs: 5_000 });
    await boot();
    expect(localStorage.getItem("finthera:open-tabs")).toBe("2");

    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    expect(localStorage.getItem("finthera:open-tabs")).toBe("1");
    expect(Number(localStorage.getItem("finthera:last-tab-closed-at"))).toBeGreaterThan(0);
  });
});
