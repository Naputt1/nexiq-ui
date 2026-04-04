import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useGraphProfilerStore } from "../hooks/use-graph-profiler-store";

export const GraphProfilerPluginComponent = () => {
  const runs = useGraphProfilerStore((s) => s.runs);
  const clear = useGraphProfilerStore((s) => s.clear);

  return (
    <div className="h-full flex flex-col text-white p-2 overflow-hidden">
      <div className="flex-1 overflow-auto">
        {" "}
        {/* Header stays its natural height */}
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-semibold text-zinc-400">
            SQLite to Graph Pipeline
          </span>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-auto space-y-3">
          {runs.length === 0 ? (
            <div className="p-4 text-sm text-zinc-500">
              No pipeline runs recorded yet. Reload the project or open a
              project to capture timings.
            </div>
          ) : (
            runs.map((run) => {
              const totalMs = run.stages.reduce(
                (sum, stage) => sum + stage.durationMs,
                0,
              );
              return (
                <Card key={run.id} className="border-zinc-800 bg-zinc-950/70">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {run.projectRoot}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {run.view || "component"} • {run.key}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-xs text-zinc-400">
                        <div>{totalMs.toFixed(1)} ms</div>
                        {run.byteLength ? (
                          <div>{(run.byteLength / 1024).toFixed(1)} KB</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {run.stages.map((stage, index) => (
                        <div
                          key={`${run.id}-${index}-${stage.name}`}
                          className="grid grid-cols-[84px_1fr_auto] items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs"
                        >
                          <span className="font-medium uppercase tracking-wide text-zinc-400">
                            {stage.source}
                          </span>
                          <div className="min-w-0">
                            <div className="text-zinc-100">{stage.name}</div>
                            {stage.detail ? (
                              <div className="mt-1 break-words text-zinc-500">
                                {stage.detail}
                              </div>
                            ) : null}
                          </div>
                          <span className="text-zinc-300">
                            {stage.durationMs.toFixed(1)} ms
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
