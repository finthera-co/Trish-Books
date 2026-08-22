import { useEffect, useRef, useState } from "react";
import { WORKFLOW_BANDS, CROSS_BAND_EDGES, RAIL_EDGES, type WorkflowEdge } from "@/config/workflow";
import { useConnectorGeometry } from "./useConnectorGeometry";
import { WorkflowHoverProvider, useWorkflowHover } from "./WorkflowHoverContext";
import WorkflowBandRow from "./WorkflowBandRow";
import WorkflowRail from "./WorkflowRail";

const ALL_EDGES: WorkflowEdge[] = [
  ...WORKFLOW_BANDS.flatMap((band) => band.edges),
  ...CROSS_BAND_EDGES,
  ...RAIL_EDGES,
];

const EDGE_BY_KEY = new Map(ALL_EDGES.map((e) => [`${e.from}->${e.to}`, e]));

export default function WorkflowCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hideConnectors, setHideConnectors] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setHideConnectors(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const { paths, viewBox, registerRef } = useConnectorGeometry(containerRef, hideConnectors ? [] : ALL_EDGES);

  return (
    <WorkflowHoverProvider edges={ALL_EDGES}>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        {!hideConnectors && <ConnectorLayer paths={paths} viewBox={viewBox} />}
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 space-y-16">
            {WORKFLOW_BANDS.map((band) => (
              <WorkflowBandRow key={band.id} band={band} registerRef={registerRef} />
            ))}
          </div>
          <WorkflowRail registerRef={registerRef} />
        </div>
      </div>
    </WorkflowHoverProvider>
  );
}

function ConnectorLayer({ paths, viewBox }: { paths: { key: string; d: string }[]; viewBox: string }) {
  const { activeEdgeKeys } = useWorkflowHover();

  return (
    <svg className="pointer-events-none absolute inset-0 z-0" viewBox={viewBox} preserveAspectRatio="none">
      <defs>
        <marker id="wf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--muted-foreground))" fillOpacity={0.7} />
        </marker>
        <marker id="wf-arrow-trunk" markerWidth="9" markerHeight="9" refX="6.5" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L9,4.5 L0,9 Z" fill="hsl(var(--primary))" />
        </marker>
      </defs>
      {paths.map((p) => {
        const edge = EDGE_BY_KEY.get(p.key);
        const weight = edge?.weight ?? "branch";
        const isActive = activeEdgeKeys?.has(p.key) ?? false;
        const hoverEngaged = activeEdgeKeys !== null;

        if (weight === "reveal") {
          // Hidden unless the hovered node is one of this edge's endpoints.
          if (!isActive) return null;
          return (
            <path
              key={p.key}
              d={p.d}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.9}
              strokeWidth={2}
              strokeDasharray="4 3"
              fill="none"
              markerEnd="url(#wf-arrow-trunk)"
            />
          );
        }

        const isTrunk = weight === "trunk";
        const stroke = isActive || (!hoverEngaged && isTrunk) ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))";
        const strokeWidth = isActive ? 2.5 : isTrunk ? 2.5 : 1.5;
        const strokeOpacity = hoverEngaged ? (isActive ? 0.95 : 0.08) : isTrunk ? 0.85 : 0.7;
        const marker = isActive || (!hoverEngaged && isTrunk) ? "url(#wf-arrow-trunk)" : "url(#wf-arrow)";

        return (
          <path
            key={p.key}
            d={p.d}
            stroke={stroke}
            strokeOpacity={strokeOpacity}
            strokeWidth={strokeWidth}
            fill="none"
            markerEnd={marker}
            style={{ transition: "stroke-opacity 200ms ease, stroke-width 200ms ease" }}
          />
        );
      })}
    </svg>
  );
}
