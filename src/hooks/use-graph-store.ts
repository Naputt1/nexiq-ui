import { create } from "zustand";
import type { GraphData } from "../graph/hook";
import type { GraphNodeDetail } from "@nexiq/extension-sdk";

interface GraphStore {
  graphInstance: GraphData | null;
  setGraphInstance: (graph: GraphData | null) => void;
  details: Record<string, GraphNodeDetail>;
  setDetails: (details: Record<string, GraphNodeDetail>) => void;
}

export const useGraphStore = create<GraphStore>((set) => ({
  graphInstance: null,
  setGraphInstance: (graph) => {
    set({ graphInstance: graph, details: {} });
  },
  details: {},
  setDetails: (details) => {
    set({ details });
  },
}));
