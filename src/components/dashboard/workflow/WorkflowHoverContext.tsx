import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { WorkflowEdge } from "@/config/workflow";

interface WorkflowHoverValue {
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  /** True when nothing is hovered, or when `id` is the hovered node or one of its immediate neighbours. */
  isNodeActive: (id: string) => boolean;
  /** Edge keys ("from->to") touching the hovered node — null when nothing is hovered. */
  activeEdgeKeys: Set<string> | null;
}

const WorkflowHoverContext = createContext<WorkflowHoverValue | null>(null);

interface ProviderProps {
  edges: WorkflowEdge[];
  children: ReactNode;
}

/**
 * Drives the "highlight this node's immediate connections on hover" effect.
 * Deliberately scoped to direct neighbours only (1 hop), not the full
 * transitive chain — the canvas is one fully connected graph end-to-end, so a
 * transitive highlight would light up almost every node on any hover and
 * defeat the point of dimming the rest.
 */
export function WorkflowHoverProvider({ edges, children }: ProviderProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { connectedIds, activeEdgeKeys } = useMemo(() => {
    if (!hoveredId) return { connectedIds: null as Set<string> | null, activeEdgeKeys: null as Set<string> | null };
    const ids = new Set<string>([hoveredId]);
    const keys = new Set<string>();
    for (const edge of edges) {
      if (edge.from === hoveredId) {
        ids.add(edge.to);
        keys.add(`${edge.from}->${edge.to}`);
      } else if (edge.to === hoveredId) {
        ids.add(edge.from);
        keys.add(`${edge.from}->${edge.to}`);
      }
    }
    return { connectedIds: ids, activeEdgeKeys: keys };
  }, [hoveredId, edges]);

  const value = useMemo<WorkflowHoverValue>(
    () => ({
      hoveredId,
      setHoveredId,
      isNodeActive: (id: string) => !connectedIds || connectedIds.has(id),
      activeEdgeKeys,
    }),
    [hoveredId, connectedIds, activeEdgeKeys],
  );

  return <WorkflowHoverContext.Provider value={value}>{children}</WorkflowHoverContext.Provider>;
}

export function useWorkflowHover(): WorkflowHoverValue {
  const ctx = useContext(WorkflowHoverContext);
  if (!ctx) throw new Error("useWorkflowHover must be used within a WorkflowHoverProvider");
  return ctx;
}
