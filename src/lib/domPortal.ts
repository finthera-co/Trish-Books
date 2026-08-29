import { useLayoutEffect } from "react";

/**
 * Creates a bare, undecorated DOM node to portal a window's content into.
 * Created exactly once per window and never swapped — see useMovePortalNode.
 */
export function createPortalNode(): HTMLDivElement {
  const node = document.createElement("div");
  node.style.display = "contents";
  return node;
}

/**
 * Imperatively re-parents `node` into `target` on the raw DOM, outside React's
 * reconciliation entirely. This is what makes moving a window between the
 * main content area and the hidden dock holder invisible to React: the
 * `createPortal(children, node)` call site always targets the SAME `node`
 * reference, so React never sees a portal-container change and never
 * unmounts anything inside — only the physical DOM parent moves.
 *
 * A `useLayoutEffect` (not `useEffect`) so the move is flushed before paint —
 * an `useEffect` would risk a one-frame flash of the node in its old parent.
 */
export function useMovePortalNode(node: HTMLDivElement | null, target: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!node || !target) return;
    if (node.parentElement !== target) {
      target.appendChild(node);
    }
  });
}
