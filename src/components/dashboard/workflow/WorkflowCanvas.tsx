import { useEffect, useRef, useState } from "react";
import { WORKFLOW_BANDS, CROSS_BAND_EDGES, type WorkflowEdge } from "@/config/workflow";
import { useConnectorGeometry } from "./useConnectorGeometry";
import WorkflowBandRow from "./WorkflowBandRow";

const ALL_EDGES: WorkflowEdge[] = [
  ...WORKFLOW_BANDS.flatMap((band) => band.edges),
  ...CROSS_BAND_EDGES,
];

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
    <div ref={containerRef} className="relative min-w-0 flex-1">
      {!hideConnectors && (
        <svg
          className="pointer-events-none absolute inset-0 z-0"
          viewBox={viewBox}
          preserveAspectRatio="none"
        >
          <defs>
            <marker
              id="wf-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="6"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="hsl(var(--muted-foreground))" fillOpacity={0.7} />
            </marker>
          </defs>
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              stroke="hsl(var(--muted-foreground))"
              strokeOpacity={0.7}
              strokeWidth={1.5}
              fill="none"
              markerEnd="url(#wf-arrow)"
            />
          ))}
        </svg>
      )}
      <div className="relative z-10 space-y-16">
        {WORKFLOW_BANDS.map((band) => (
          <WorkflowBandRow key={band.id} band={band} registerRef={registerRef} />
        ))}
      </div>
    </div>
  );
}
