import { create } from "zustand";
import type { GraphData } from "../graph/hook";
import type { GraphNodeDetail } from "@nexiq/extension-sdk";

interface GraphStore {
  graphInstance: GraphData | null;
  setGraphInstance: (graph: GraphData | null) => void;
  detailCache: Map<string, GraphNodeDetail>;
  fetchNodeDetail: (projectRoot: string, nodeId: string) => Promise<GraphNodeDetail | null>;
  clearDetailCache: () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  graphInstance: null,
  setGraphInstance: (graph) => {
    set({ graphInstance: graph });
    get().clearDetailCache();
  },
  detailCache: new Map<string, GraphNodeDetail>(),
  fetchNodeDetail: async (projectRoot, nodeId) => {
    const { detailCache } = get();
    if (detailCache.has(nodeId)) {
      return detailCache.get(nodeId)!;
    }

    try {
      const detail = await window.ipcRenderer.invoke("get-node-detail", {
        projectRoot,
        nodeId,
      });
      if (detail) {
        set((state) => {
          const newCache = new Map(state.detailCache);
          newCache.set(nodeId, detail);
          return { detailCache: newCache };
        });
      }
      return detail;
    } catch (error) {
      console.error("Failed to fetch node detail:", error);
      return null;
    }
  },
  clearDetailCache: () => {
    set({ detailCache: new Map() });
  },
}));
