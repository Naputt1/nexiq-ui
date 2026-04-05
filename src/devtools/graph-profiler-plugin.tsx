import { useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  type GraphProfilerRun,
  type GraphProfilerStage,
  useGraphProfilerStore,
} from "../hooks/use-graph-profiler-store";

type StageLayout = GraphProfilerStage & {
  depth: number;
  durationMs: number;
  exclusiveMs: number;
  children: GraphProfilerStage[];
};

function getRunBounds(run: GraphProfilerRun) {
  const startMs =
    run.stages.length > 0
      ? Math.min(...run.stages.map((stage) => stage.startMs))
      : 0;
  const endMs =
    run.stages.length > 0
      ? Math.max(...run.stages.map((stage) => stage.endMs))
      : 0;
  return {
    startMs,
    endMs,
    totalMs: Math.max(endMs - startMs, 0.1),
  };
}

function getCoveredDuration(
  children: GraphProfilerStage[],
  startMs: number,
  endMs: number,
) {
  if (children.length === 0) return 0;
  const ranges = children
    .map((child) => ({
      startMs: Math.max(startMs, child.startMs),
      endMs: Math.min(endMs, child.endMs),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  let covered = 0;
  let cursor = ranges[0]?.startMs ?? 0;
  let currentEnd = ranges[0]?.endMs ?? 0;

  for (let index = 1; index < ranges.length; index += 1) {
    const range = ranges[index]!;
    if (range.startMs > currentEnd) {
      covered += currentEnd - cursor;
      cursor = range.startMs;
      currentEnd = range.endMs;
    } else {
      currentEnd = Math.max(currentEnd, range.endMs);
    }
  }

  if (ranges.length > 0) {
    covered += currentEnd - cursor;
  }
  return covered;
}

function buildStageLayout(run: GraphProfilerRun) {
  const byId = new Map(run.stages.map((stage) => [stage.id, stage]));
  const childMap = new Map<string, GraphProfilerStage[]>();

  for (const stage of run.stages) {
    if (!stage.parentId) continue;
    const siblings = childMap.get(stage.parentId) ?? [];
    siblings.push(stage);
    childMap.set(stage.parentId, siblings);
  }

  return run.stages
    .map((stage) => {
      let depth = 0;
      let currentParentId = stage.parentId;
      while (currentParentId) {
        depth += 1;
        currentParentId = byId.get(currentParentId)?.parentId;
      }
      const children = childMap.get(stage.id) ?? [];
      const durationMs = Math.max(stage.endMs - stage.startMs, 0);
      const exclusiveMs = Math.max(
        durationMs - getCoveredDuration(children, stage.startMs, stage.endMs),
        0,
      );
      return {
        ...stage,
        depth,
        durationMs,
        exclusiveMs,
        children,
      } satisfies StageLayout;
    })
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return b.endMs - a.endMs;
    });
}

function getStageTone(stage: GraphProfilerStage) {
  if (stage.source === "renderer") {
    return "bg-sky-500/70 border-sky-400/40";
  }
  if (stage.name.startsWith("Compute") || stage.name.startsWith("Task:")) {
    return "bg-emerald-500/70 border-emerald-400/40";
  }
  if (stage.name.startsWith("Request") || stage.name.startsWith("Resolve")) {
    return "bg-amber-500/70 border-amber-400/40";
  }
  return "bg-zinc-500/70 border-zinc-400/40";
}

function StageDetails({ stage }: { stage: StageLayout | null }) {
  if (!stage) {
    return (
      <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
        Select a bar to inspect inclusive time, exclusive gap, and stage
        metadata.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground">{stage.name}</span>
        <Badge variant="secondary">{stage.source}</Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-muted-foreground">
        <div>Start: {stage.startMs.toFixed(1)} ms</div>
        <div>End: {stage.endMs.toFixed(1)} ms</div>
        <div>Inclusive: {stage.durationMs.toFixed(1)} ms</div>
        <div>Exclusive gap: {stage.exclusiveMs.toFixed(1)} ms</div>
      </div>
      {stage.detail ? (
        <div className="mt-2 break-words text-muted-foreground">
          {stage.detail}
        </div>
      ) : null}
    </div>
  );
}

function FramegraphRun({ run }: { run: GraphProfilerRun }) {
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const bounds = useMemo(() => getRunBounds(run), [run]);
  const stages = useMemo(() => buildStageLayout(run), [run]);
  const selectedStage =
    stages.find((stage) => stage.id === selectedStageId) ?? null;
  const maxDepth = stages.reduce((max, stage) => Math.max(max, stage.depth), 0);

  return (
    <Card className="border-border/60 bg-card/80">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {run.projectRoot}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{run.view || "component"}</span>
              <span>{run.key}</span>
              {run.handleVersion != null ? (
                <Badge variant="outline">handle v{run.handleVersion}</Badge>
              ) : null}
              {run.status !== "completed" ? (
                <Badge variant="secondary">{run.status}</Badge>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <div>{bounds.totalMs.toFixed(1)} ms</div>
            {run.byteLength ? (
              <div>{(run.byteLength / 1024).toFixed(1)} KB</div>
            ) : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Inclusive parent bars with nested children</span>
            <span>Exclusive gap = parent time not covered by children</span>
          </div>
          <div
            className="relative overflow-hidden rounded-md border border-border/60 bg-muted/20"
            style={{ height: `${Math.max(maxDepth + 1, 1) * 30 + 12}px` }}
          >
            {stages.map((stage) => {
              const leftPct =
                ((stage.startMs - bounds.startMs) / bounds.totalMs) * 100;
              const widthPct = Math.max(
                ((stage.endMs - stage.startMs) / bounds.totalMs) * 100,
                0.8,
              );
              const topPx = 6 + stage.depth * 30;
              return (
                <button
                  key={stage.id}
                  type="button"
                  title={`${stage.name} • ${stage.durationMs.toFixed(1)} ms`}
                  onClick={() => setSelectedStageId(stage.id)}
                  className={`absolute h-6 overflow-hidden rounded border text-left text-[11px] text-white transition hover:brightness-110 ${getStageTone(stage)} ${
                    selectedStageId === stage.id ? "ring-2 ring-primary/70" : ""
                  }`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: `${topPx}px`,
                    backgroundImage:
                      stage.children.length > 0 && stage.exclusiveMs > 0.5
                        ? "repeating-linear-gradient(135deg, transparent 0px, transparent 6px, rgba(255,255,255,0.14) 6px, rgba(255,255,255,0.14) 12px)"
                        : undefined,
                  }}
                >
                  <div className="truncate px-2">
                    {stage.name} ({stage.durationMs.toFixed(0)} ms)
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <StageDetails stage={selectedStage} />
      </CardContent>
    </Card>
  );
}

export const GraphProfilerPluginComponent = () => {
  const runs = useGraphProfilerStore((s) => s.runs);
  const clear = useGraphProfilerStore((s) => s.clear);
  const visibleRuns = useMemo(
    () =>
      runs.filter(
        (run) => run.status !== "superseded" || run.stages.length === 0,
      ),
    [runs],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden p-2 text-foreground">
      <div className="flex flex-col overflow-auto">
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-xs font-semibold text-muted-foreground">
            SQLite to Graph Pipeline
          </span>
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </div>
        <div className="flex-1 overflow-auto space-y-3">
          {visibleRuns.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
              No pipeline runs recorded yet. Reload or open a project to capture
              a trace.
            </div>
          ) : (
            visibleRuns.map((run) => <FramegraphRun key={run.id} run={run} />)
          )}
        </div>
      </div>
    </div>
  );
};
