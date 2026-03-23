import { create } from "zustand";

export interface WorkerRegistryState {
  registry: Record<string, { id: string; priority: number }[]>;
  rendererRegistry: Record<string, { id: string; priority: number }[]>;
  lastUpdated: number;
}

interface WorkerState {
  isBackendAvailable: boolean;
  registryState: WorkerRegistryState | null;
  setBackendAvailable: (available: boolean) => void;
  setRegistryState: (state: WorkerRegistryState) => void;
  refreshRegistry: () => Promise<void>;
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  isBackendAvailable: false,
  registryState: null,
  setBackendAvailable: (isBackendAvailable) => set({ isBackendAvailable }),
  setRegistryState: (registryState) => set({ registryState }),
  refreshRegistry: async () => {
    const { isBackendAvailable } = get();
    if (!isBackendAvailable) {
      return;
    }

    const registry = await window.ipcRenderer.invoke("debug-get-view-registry");
    set({
      registryState: {
        registry: registry.registry,
        rendererRegistry: registry.registry,
        lastUpdated: Date.now(),
      },
    });
  },
}));
