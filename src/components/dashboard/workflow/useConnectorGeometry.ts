import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { WorkflowEdge } from "@/config/workflow";

// Connectors are measured from live DOM node positions (getBoundingClientRect)
// rather than computed from hardcoded pixel coordinates. Tile sizes shift
// with font-size, zoom level, and label length (i18n), and the number of
// tiles per band can change independent of layout code — a static coordinate
// table would silently go stale the first time any of that happened. This
// hook re-measures whenever the container or a tracked node resizes, so the
// lines always match what's actually on screen.

interface ConnectorPath {
  key: string;
  d: string;
}

interface Point {
  x: number;
  y: number;
}

const CORNER_RADIUS = 8;

function anchorPoint(rect: DOMRect, containerRect: DOMRect, side: WorkflowEdge["fromSide"] | WorkflowEdge["toSide"]): Point {
  switch (side) {
    case "right":
      return { x: rect.right - containerRect.left, y: rect.top + rect.height / 2 - containerRect.top };
    case "left":
      return { x: rect.left - containerRect.left, y: rect.top + rect.height / 2 - containerRect.top };
    case "bottom":
      return { x: rect.left + rect.width / 2 - containerRect.left, y: rect.bottom - containerRect.top };
    case "top":
      return { x: rect.left + rect.width / 2 - containerRect.left, y: rect.top - containerRect.top };
  }
}

/**
 * Rounding a Z-shaped elbow (out - across - in) with two quarter-circles only
 * looks right when there's enough room for both: the construction inherently
 * overshoots the target's perpendicular coordinate by the corner radius, then
 * curves back to it. With a full 8px radius that overshoot is invisible next
 * to a normal elbow's travel distance, but when two nodes land only a few
 * pixels apart on the axis perpendicular to travel (e.g. a band node and a
 * rail item on nearly the same row), the overshoot is a large fraction of the
 * whole gap and reads as a stray loop/S-curve. Below that threshold, corners
 * go sharp (radius 0) instead of shrinking proportionally — a half-sized
 * rounded corner still overshoots by half the gap, so there's no smooth
 * middle ground; it's either a full radius or none.
 */
function buildPath(from: Point, to: Point, fromSide: WorkflowEdge["fromSide"], toSide: WorkflowEdge["toSide"]): string {
  if (fromSide === "right" && toSide === "left") {
    const perpGap = Math.abs(from.y - to.y);
    if (perpGap <= 2) {
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    const midX = from.x + (to.x - from.x) / 2;
    const r = perpGap >= CORNER_RADIUS * 2 ? CORNER_RADIUS : 0;
    const dir1 = to.y > from.y ? 1 : -1;
    const dir2 = to.y > from.y ? -1 : 1;
    return [
      `M ${from.x} ${from.y}`,
      `H ${midX - r}`,
      `Q ${midX} ${from.y} ${midX} ${from.y + r * dir1}`,
      `V ${to.y - r * dir2}`,
      `Q ${midX} ${to.y} ${midX + r} ${to.y}`,
      `H ${to.x}`,
    ].join(" ");
  }

  if (fromSide === "bottom" && toSide === "top") {
    const perpGap = Math.abs(from.x - to.x);
    if (perpGap <= 2) {
      return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    const midY = from.y + (to.y - from.y) / 2;
    const r = perpGap >= CORNER_RADIUS * 2 ? CORNER_RADIUS : 0;
    const dir1 = to.x > from.x ? 1 : -1;
    const dir2 = to.x > from.x ? -1 : 1;
    return [
      `M ${from.x} ${from.y}`,
      `V ${midY - r}`,
      `Q ${from.x} ${midY} ${from.x + r * dir1} ${midY}`,
      `H ${to.x - r * dir2}`,
      `Q ${to.x} ${midY} ${to.x} ${midY + r}`,
      `V ${to.y}`,
    ].join(" ");
  }

  // Fallback for any other side combination — straight line, still correct,
  // just not elbowed.
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

export function useConnectorGeometry(
  containerRef: React.RefObject<HTMLElement>,
  edges: WorkflowEdge[],
): { paths: ConnectorPath[]; viewBox: string; registerRef: (id: string, el: HTMLElement | null) => void } {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [paths, setPaths] = useState<ConnectorPath[]>([]);
  const [viewBox, setViewBox] = useState("0 0 0 0");
  const rafRef = useRef<number | null>(null);
  const nodeObserverRef = useRef<ResizeObserver | null>(null);
  // Holds the latest scheduler so registerRef (stable, empty-deps callback
  // per node-tile identity) can always trigger a fresh recompute without
  // itself depending on `edges`/`containerRef`.
  const scheduleRecomputeRef = useRef<() => void>(() => {});

  const registerRef = useCallback((id: string, el: HTMLElement | null) => {
    const prev = nodesRef.current.get(id);
    if (prev && prev !== el) nodeObserverRef.current?.unobserve(prev);

    if (el) {
      nodesRef.current.set(id, el);
      nodeObserverRef.current?.observe(el);
    } else {
      nodesRef.current.delete(id);
    }
    scheduleRecomputeRef.current();
  }, []);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    setViewBox(`0 0 ${containerRect.width} ${containerRect.height}`);

    const next: ConnectorPath[] = [];
    for (const edge of edges) {
      const fromEl = nodesRef.current.get(edge.from);
      const toEl = nodesRef.current.get(edge.to);
      if (!fromEl || !toEl) continue; // node hidden by permission gating, etc.

      const fromPoint = anchorPoint(fromEl.getBoundingClientRect(), containerRect, edge.fromSide);
      const toPoint = anchorPoint(toEl.getBoundingClientRect(), containerRect, edge.toSide);
      next.push({
        key: `${edge.from}->${edge.to}`,
        d: buildPath(fromPoint, toPoint, edge.fromSide, edge.toSide),
      });
    }
    setPaths(next);
  }, [containerRef, edges]);

  const scheduleRecompute = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  useLayoutEffect(() => {
    scheduleRecomputeRef.current = scheduleRecompute;
  }, [scheduleRecompute]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => scheduleRecomputeRef.current());
    nodeObserverRef.current = ro;
    ro.observe(container);
    for (const el of nodesRef.current.values()) ro.observe(el);

    scheduleRecompute();

    const onWindowResize = () => scheduleRecomputeRef.current();
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro.disconnect();
      nodeObserverRef.current = null;
      window.removeEventListener("resize", onWindowResize);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // containerRef is a ref object (stable identity); scheduleRecompute is
    // intentionally omitted so the observer isn't torn down and recreated on
    // every edges-array identity change — the ref above already carries the
    // latest closure for both the ResizeObserver and window resize handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // Re-measure whenever the edge list itself changes identity (e.g. gating
  // toggles which edges are relevant).
  useLayoutEffect(() => {
    scheduleRecompute();
  }, [scheduleRecompute]);

  return { paths, viewBox, registerRef };
}
