import { create } from "zustand";

export interface GraphProfilerStage {
  id: string;
  name: string;
  source: "backend" | "renderer";
  startMs: number;
  endMs: number;
  parentId?: string;
  detail?: string;
}

export interface GraphProfilerRun {
  id: string;
  logicalKey: string;
  key: string;
  projectRoot: string;
  view?: string;
  startedAt: number;
  byteLength?: number;
  handleVersion?: number;
  status: "in_progress" | "completed" | "superseded" | "failed";
  stages: GraphProfilerStage[];
}

type RunMeta = Omit<GraphProfilerRun, "stages">;

interface GraphProfilerState {
  runs: GraphProfilerRun[];
  startRun: (run: RunMeta) => void;
  mergeStages: (runId: string, stages: GraphProfilerStage[]) => void;
  updateRun: (runId: string, patch: Partial<RunMeta>) => void;
  completeRun: (
    runId: string,
    patch?: Partial<RunMeta> & { status?: GraphProfilerRun["status"] },
  ) => void;
  supersedeLogicalKey: (logicalKey: string, activeRunId: string) => void;
  clear: () => void;
}

function sortStages(stages: GraphProfilerStage[]) {
  return [...stages].sort((a, b) => {
    if (a.startMs !== b.startMs) {
      return a.startMs - b.startMs;
    }
    return a.endMs - b.endMs;
  });
}

export const useGraphProfilerStore = create<GraphProfilerState>((set) => ({
  runs: [],
  startRun: (run) =>
    set((state) => {
      const runs = state.runs.map((entry) =>
        entry.logicalKey === run.logicalKey &&
        entry.id !== run.id &&
        entry.status === "in_progress"
          ? { ...entry, status: "superseded" as const }
          : entry,
      );
      const existingIndex = runs.findIndex((entry) => entry.id === run.id);
      if (existingIndex === -1) {
        return {
          runs: [{ ...run, stages: [] }, ...runs].slice(0, 25),
        };
      }
      const nextRuns = [...runs];
      nextRuns[existingIndex] = { ...nextRuns[existingIndex], ...run };
      return { runs: nextRuns };
    }),
  mergeStages: (runId, stages) =>
    set((state) => ({
      runs: state.runs.map((run) => {
        if (run.id !== runId || stages.length === 0) {
          return run;
        }
        const byId = new Map(run.stages.map((stage) => [stage.id, stage]));
        for (const stage of stages) {
          byId.set(stage.id, stage);
        }
        return {
          ...run,
          stages: sortStages(Array.from(byId.values())),
        };
      }),
    })),
  updateRun: (runId, patch) =>
    set((state) => ({
      runs: state.runs.map((run) =>
        run.id === runId ? { ...run, ...patch } : run,
      ),
    })),
  completeRun: (runId, patch) =>
    set((state) => ({
      runs: state.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              ...patch,
              status:
                patch?.status ??
                (run.status === "superseded" ? "superseded" : "completed"),
            }
          : run,
      ),
    })),
  supersedeLogicalKey: (logicalKey, activeRunId) =>
    set((state) => ({
      runs: state.runs.map((run) =>
        run.logicalKey === logicalKey &&
        run.id !== activeRunId &&
        run.status === "in_progress"
          ? { ...run, status: "superseded" }
          : run,
      ),
    })),
  clear: () => set({ runs: [] }),
}));
