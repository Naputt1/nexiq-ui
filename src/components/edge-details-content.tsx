import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { GraphArrow, GraphData } from "@/graph/hook";
import { getDisplayName } from "@nexiq/shared";

interface EdgeDetailsContentProps {
  edge: GraphArrow;
  graph: GraphData;
  onSelect: (id: string) => void;
}

export function EdgeDetailsContent({
  edge,
  graph,
  onSelect,
}: EdgeDetailsContentProps) {
  const source = graph.getPointByID(edge.source);
  const target = graph.getPointByID(edge.target);

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {edge.category || edge.edgeKind || "edge"}
        </div>
        <div className="mt-1 text-lg font-semibold text-foreground">
          {source ? getDisplayName(source.name) : edge.source} to{" "}
          {target ? getDisplayName(target.name) : edge.target}
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          {edge.usageCount || edge.usages.length || 0} occurrence
          {(edge.usageCount || edge.usages.length || 0) === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const targetLoc = edge.opensTo || edge.usages[0];
            if (!targetLoc) return;
            window.ipcRenderer.invoke(
              "open-vscode",
              "fileName" in targetLoc ? targetLoc.fileName : targetLoc.filePath,
              graph.projectPath,
              targetLoc.line,
              targetLoc.column,
            );
          }}
        >
          Open First Usage
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSelect(edge.source)}>
          Jump To Source
        </Button>
        <Button variant="outline" size="sm" onClick={() => onSelect(edge.target)}>
          Jump To Target
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        {edge.usages.length > 0 ? (
          edge.usages.map((usage) => (
            <button
              key={usage.usageId}
              type="button"
              className="w-full rounded-md border border-border bg-card p-3 text-left hover:bg-accent/30"
              onClick={() =>
                window.ipcRenderer.invoke(
                  "open-vscode",
                  usage.filePath,
                  graph.projectPath,
                  usage.line,
                  usage.column,
                )
              }
            >
              <div className="text-sm font-medium text-foreground">
                {usage.displayLabel || usage.filePath}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {usage.filePath}:{usage.line}:{usage.column}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                Owner: {usage.ownerKind} {usage.ownerId}
              </div>
            </button>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">
            No concrete usage occurrences were attached to this edge.
          </div>
        )}
      </div>
    </div>
  );
}
