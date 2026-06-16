import { useEffect } from "react";

// Native browser prompt before refresh / tab-close / external nav when there are unsaved changes.
// Browsers show a generic message (custom text is ignored) — that's expected.
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean) {
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required for Chrome/Edge to trigger the prompt
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);
}
