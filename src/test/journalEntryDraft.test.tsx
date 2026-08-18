import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJournalEntryDraft, type JournalDraftValue } from "@/hooks/useJournalEntryDraft";
import { clearAllFintheraDrafts, STICKY_DRAFT_PREFIX } from "@/hooks/useDraftPersistence";

interface Line { account_id: string; debit: number; credit: number; memo: string }

const blank = (): JournalDraftValue<Line> => ({
  entryDate: "2026-08-18",
  reference: "",
  chequeNumber: "",
  lines: [
    { account_id: "", debit: 0, credit: 0, memo: "" },
    { account_id: "", debit: 0, credit: 0, memo: "" },
  ],
});

const typed = (): JournalDraftValue<Line> => ({
  entryDate: "2026-08-18",
  reference: "JV-00042",
  chequeNumber: "004512",
  lines: [
    { account_id: "acc-cash", debit: 1000, credit: 0, memo: "Cash received" },
    { account_id: "acc-sales", debit: 0, credit: 1000, memo: "Sales" },
  ],
});

const SCOPE = "tenant-1:user-1";

/** The create dialog's rule: a line the user actually typed. */
const hasContent = (v: JournalDraftValue<Line>) =>
  v.lines.some((l) => l.account_id || l.debit > 0 || l.credit > 0 || l.memo.trim());

function mount(value: JournalDraftValue<Line>, opts: { entry?: string; ready?: boolean } = {}) {
  const restored: JournalDraftValue<Line>[] = [];
  const view = renderHook(
    (props: { value: JournalDraftValue<Line>; ready: boolean }) =>
      useJournalEntryDraft<Line>({
        entry: opts.entry ?? "new",
        scope: SCOPE,
        value: props.value,
        baseline: blank(),
        hasContent: hasContent(props.value),
        ready: props.ready,
        onRestore: (d) => restored.push(d),
      }),
    { initialProps: { value, ready: opts.ready ?? true } },
  );
  return { ...view, restored };
}

function storedKeys() {
  return Object.keys(localStorage).filter((k) => k.startsWith(STICKY_DRAFT_PREFIX));
}

describe("useJournalEntryDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an entry that was typed but never posted", () => {
    const { rerender } = mount(blank());
    act(() => { rerender({ value: typed(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });

    expect(storedKeys()).toHaveLength(1);
    const stored = JSON.parse(localStorage.getItem(storedKeys()[0])!);
    expect(stored.reference).toBe("JV-00042");
    expect(stored.lines[0].debit).toBe(1000);
    expect(stored.savedAt).toBeTypeOf("number");
  });

  it("does not store a form holding only the auto-filled reference", () => {
    const { rerender } = mount(blank());
    act(() => { rerender({ value: { ...blank(), reference: "JV-00043" }, ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(storedKeys()).toHaveLength(0);
  });

  it("does not store an untouched form", () => {
    const { rerender } = mount(blank());
    act(() => { rerender({ value: blank(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(storedKeys()).toHaveLength(0);
  });

  it("restores what was stored, and reports when", () => {
    const { rerender, unmount } = mount(blank());
    act(() => { rerender({ value: typed(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });
    unmount();

    const second = mount(blank());
    expect(second.restored).toHaveLength(1);
    expect(second.restored[0].reference).toBe("JV-00042");
    expect(second.restored[0].lines).toHaveLength(2);
    expect(second.result.current.restoredAt).toBeTypeOf("number");
  });

  it("flushes the last keystroke when the tab goes away", () => {
    const { rerender } = mount(blank());
    // No timer advance: pagehide must not wait for the debounce.
    act(() => { rerender({ value: typed(), ready: true }); });
    act(() => { window.dispatchEvent(new Event("pagehide")); });
    expect(storedKeys()).toHaveLength(1);
  });

  it("drops the draft only when the entry posts", () => {
    const { rerender, result } = mount(blank());
    act(() => { rerender({ value: typed(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });
    expect(storedKeys()).toHaveLength(1);

    act(() => result.current.clearDraft());
    expect(storedKeys()).toHaveLength(0);
    expect(result.current.restoredAt).toBeNull();
  });

  it("keeps one entry's draft out of another's", () => {
    const first = mount(typed(), { entry: "entry-a" });
    act(() => { first.rerender({ value: typed(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });

    const second = mount(blank(), { entry: "entry-b" });
    expect(second.restored).toHaveLength(0);
  });

  it("survives an automatic sign-out but not a deliberate one", () => {
    const { rerender } = mount(blank());
    act(() => { rerender({ value: typed(), ready: true }); });
    act(() => { vi.advanceTimersByTime(600); });

    // Idle timeout / browser close: the entry must still be there.
    clearAllFintheraDrafts();
    expect(storedKeys()).toHaveLength(1);

    // "Sign out": leave the machine clean.
    clearAllFintheraDrafts({ includeSticky: true });
    expect(storedKeys()).toHaveLength(0);
  });
});
