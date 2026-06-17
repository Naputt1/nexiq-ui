import { create } from "zustand";
import { GraphData } from "../graph/hook";
import type { TypeDataDeclare, GraphNodeDetail } from "@nexiq/extension-sdk";
import type { FileAnalysisErrorRow, ResolveErrorRow } from "@nexiq/shared";

interface GraphStore {
  graphInstance: GraphData;
  setGraphInstance: (graph: GraphData) => void;
  typeData: Record<string, TypeDataDeclare>;
  setTypeData: (typeData: Record<string, TypeDataDeclare>) => void;
  details: Record<string, GraphNodeDetail>;
  setDetails: (details?: Record<string, GraphNodeDetail>) => void;
  fileErrors: FileAnalysisErrorRow[];
  setFileErrors: (fileErrors: FileAnalysisErrorRow[]) => void;
  resolveErrors: ResolveErrorRow[];
  setResolveErrors: (resolveErrors: ResolveErrorRow[]) => void;
  totalErrorCount: number;
  setTotalErrorCount: (totalErrorCount: number) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  graphInstance: new GraphData([], [], []),
  setGraphInstance: (graph) => {
    graph.locked = useGraphStore.getState().locked;
    set({ graphInstance: graph });
  },
  typeData: {},
  setTypeData: (typeData) => {
    set({ typeData });
  },
  details: {},
  setDetails: (details) => {
    set({ details });
  },
  fileErrors: [],
  setFileErrors: (fileErrors) => {
    set({ fileErrors });
  },
  resolveErrors: [],
  setResolveErrors: (resolveErrors) => {
    set({ resolveErrors });
  },
  totalErrorCount: 0,
  setTotalErrorCount: (totalErrorCount) => {
    set({ totalErrorCount });
  },
  locked: false,
  setLocked: (locked) => {
    set({ locked });
    get().graphInstance.locked = locked;
  },
}));
