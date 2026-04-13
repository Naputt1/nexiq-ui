import { Button } from "@/components/ui/button";
import type { GraphData, GraphNodeData } from "@/graph/hook";
import { getDisplayName } from "@nexiq/shared";

interface UsagesSectionProps {
  selectedId: string;
  item: GraphNodeData;
  graph: unknown;
  onSelect?: (id: string) => void;
}

export function UsagesSection({
  selectedId,
  graph: graphData,
  onSelect,
}: UsagesSectionProps) {
  const graph = graphData as GraphData;
  const usageEdges = graph
    .getAllEdges()
    .filter((edge) => String(edge.category || "").startsWith("usage-"));
  const inbound = usageEdges.filter((edge) => edge.target === selectedId);
  const outbound = usageEdges.filter((edge) => edge.source === selectedId);

  const renderEdgeButton = (
    edgeId: string,
    targetId: string,
    label: string,
  ) => {
    const point = graph.getPointByID(targetId);
    return (
      <Button
        key={edgeId}
        variant="ghost"
        className="w-full justify-start px-0 text-left"
        onClick={() => onSelect?.(targetId)}
      >
        {label}: {point ? getDisplayName(point.name) : targetId}
      </Button>
    );
  };

  if (inbound.length === 0 && outbound.length === 0) {
    return <div className="text-sm text-muted-foreground">No usage edges.</div>;
  }

  return (
    <div className="space-y-3">
      {inbound.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Inbound
          </div>
          {inbound.map((edge) =>
            renderEdgeButton(edge.id, edge.source, edge.edgeKind || "usage"),
          )}
        </div>
      )}
      {outbound.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Outbound
          </div>
          {outbound.map((edge) =>
            renderEdgeButton(edge.id, edge.target, edge.edgeKind || "usage"),
          )}
        </div>
      )}
    </div>
  );
}
