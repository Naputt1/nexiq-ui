import { createDevToolsStore } from "@sucoza/zustand-devtools-plugin";
import { create } from "zustand";

export interface GraphProfilerStage {
  name: string;
  durationMs: number;
  source: "backend" | "renderer";
  detail?: string;
}

export interface GraphProfilerRun {
  id: string;
  key: string;
  projectRoot: string;
  view?: string;
  startedAt: number;
  byteLength?: number;
  stages: GraphProfilerStage[];
}

interface GraphProfilerState {
  runs: GraphProfilerRun[];
  upsertRun: (run: Omit<GraphProfilerRun, "stages">) => void;
  addStage: (
    runId: string,
    stage: GraphProfilerStage,
    options?: { prepend?: boolean },
  ) => void;
  setByteLength: (runId: string, byteLength: number) => void;
  clear: () => void;
}

export const useGraphProfilerStore = createDevToolsStore(
  "GraphProfilerStore",
  () =>
    create<GraphProfilerState>((set) => ({
      runs: [],
      upsertRun: (run) =>
        set((state) => {
          const existingIndex = state.runs.findIndex(
            (entry) => entry.id === run.id,
          );
          if (existingIndex === -1) {
            return {
              runs: [{ ...run, stages: [] }, ...state.runs].slice(0, 25),
            };
          }
          const nextRuns = [...state.runs];
          nextRuns[existingIndex] = { ...nextRuns[existingIndex], ...run };
          return { runs: nextRuns };
        }),
      addStage: (runId, stage, options) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId
              ? {
                  ...run,
                  stages: options?.prepend
                    ? [stage, ...run.stages]
                    : [...run.stages, stage],
                }
              : run,
          ),
        })),
      setByteLength: (runId, byteLength) =>
        set((state) => ({
          runs: state.runs.map((run) =>
            run.id === runId ? { ...run, byteLength } : run,
          ),
        })),
      clear: () => set({ runs: [] }),
    })),
);
