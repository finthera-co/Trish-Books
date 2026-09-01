import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useWindowsStore } from "@/stores/useWindowsStore";

/**
 * Lets a page name itself in the breadcrumb and the minimize dock.
 *
 * Without it every detail route falls back to the label of the list it came
 * from, so three open journal entries dock as three identical "Journal
 * Entries" chips. Pass a falsy value while the record is still loading —
 * the nav-derived label stands in until the real one arrives.
 */
export function usePageTitle(title: string | null | undefined) {
  const location = useLocation();
  const setPageTitle = useWindowsStore((s) => s.setPageTitle);
  const id = location.pathname + location.search;

  useEffect(() => {
    setPageTitle(id, title || null);
    return () => setPageTitle(id, null);
  }, [id, title, setPageTitle]);
}
