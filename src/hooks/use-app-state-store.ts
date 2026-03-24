import { create } from "zustand";
import type { GraphViewType } from "../../electron/types";
import debounce from "lodash.debounce";
import { subscribeWithSelector } from "zustand/middleware";
import type { AppStateData } from "@nexiq/shared";

const DEFAULT = {
  SIDEBAR: {
    RIGHT: {
      WIDTH: 25,
      HEIGHT: 40,
    },
  },
};

const debouncedSave = debounce(
  (projectRoot: string, save: (root: string) => Promise<void>) => {
    save(projectRoot);
  },
  500,
);

interface AppState {
  selectedSubProjects: string[];
  centeredItemId: string | null;
  selectedId: string | null;
  isSidebarOpen: boolean;
  activeTab: "projects" | "git";
  selectedCommit: string | null;
  isLoaded: boolean;
  viewport: { x: number; y: number; zoom: number } | null;
  view: GraphViewType;
  sidebar: {
    right: {
      width: number;
      height: number;
    };
  };

  setSelectedSubProjects: (paths: string[]) => void;
  toggleSubProject: (path: string) => void;
  setCenteredItemId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: "projects" | "git") => void;
  setSelectedCommit: (commit: string | null) => void;
  setViewport: (
    viewport: { x: number; y: number; zoom: number } | null,
  ) => void;
  setView: (view: GraphViewType) => void;
  setRightSidebarWidth: (width: number) => void;
  setRightSidebarHeight: (height: number) => void;

  // Persistence helpers
  loadState: (
    projectRoot: string,
    overrideSubProjects?: string[] | null,
  ) => Promise<void>;
  saveState: (projectRoot: string) => Promise<void>;
  reset: () => void;
}

export const useAppStateStore = create<AppState>()(
  subscribeWithSelector((set, get) => ({
    selectedSubProjects: [],
    centeredItemId: null,
    selectedId: null,
    isSidebarOpen: false,
    activeTab: "projects",
    selectedCommit: null,
    isLoaded: false,
    viewport: null,
    view: "component" as GraphViewType,
    sidebar: {
      right: {
        width: DEFAULT.SIDEBAR.RIGHT.WIDTH,
        height: DEFAULT.SIDEBAR.RIGHT.HEIGHT,
      },
    },

    setSelectedSubProjects: (paths) => set({ selectedSubProjects: paths }),
    toggleSubProject: (path) =>
      set((state) => ({
        selectedSubProjects: state.selectedSubProjects.includes(path)
          ? state.selectedSubProjects.filter((p) => p !== path)
          : [...state.selectedSubProjects, path],
      })),
    setCenteredItemId: (id) => set({ centeredItemId: id }),
    setSelectedId: (id) => set({ selectedId: id }),
    setIsSidebarOpen: (open) => set({ isSidebarOpen: open }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setSelectedCommit: (commit) => set({ selectedCommit: commit }),
    setViewport: (viewport) => set({ viewport }),
    setView: (view) => set({ view }),
    setRightSidebarWidth: (width) =>
      set((state) => ({
        sidebar: {
          ...state.sidebar,
          right: {
            ...state.sidebar.right,
            width,
          },
        },
      })),
    setRightSidebarHeight: (height) =>
      set((state) => ({
        sidebar: {
          ...state.sidebar,
          right: {
            ...state.sidebar.right,
            height,
          },
        },
      })),

    reset: () =>
      set({
        selectedSubProjects: [],
        centeredItemId: null,
        selectedId: null,
        activeTab: "projects",
        selectedCommit: null,
        viewport: null,
        isLoaded: false,
        view: "component",
        sidebar: {
          right: {
            width: DEFAULT.SIDEBAR.RIGHT.WIDTH,
            height: DEFAULT.SIDEBAR.RIGHT.HEIGHT,
          },
        },
      }),

    loadState: async (
      projectRoot: string,
      overrideSubProjects?: string[] | null,
    ) => {
      set({ isLoaded: false });
      try {
        const state = (await window.ipcRenderer.invoke(
          "read-state",
          projectRoot,
        )) as AppStateData | null;

        if (state) {
          set({
            selectedSubProjects: overrideSubProjects ||
              state.selectedSubProjects || [projectRoot],
            centeredItemId: state.centeredItemId || null,
            selectedId: state.selectedId || null,
            isSidebarOpen: state.isSidebarOpen ?? false,
            activeTab: state.activeTab || "projects",
            selectedCommit: state.selectedCommit || null,
            viewport: state.viewport || null,
            view: (state.view as GraphViewType) || "component",
            isLoaded: true,
            sidebar: {
              right: {
                width:
                  state.sidebar?.right?.width || DEFAULT.SIDEBAR.RIGHT.WIDTH,
                height:
                  state.sidebar?.right?.height || DEFAULT.SIDEBAR.RIGHT.HEIGHT,
              },
            },
          });
        } else {
          set({
            selectedSubProjects: overrideSubProjects || [projectRoot],
            isLoaded: true,
          });
        }
      } catch (e) {
        console.error("Failed to load state", e);
        set({
          selectedSubProjects: overrideSubProjects || [projectRoot],
          isLoaded: true,
        });
      }
    },

    saveState: async (projectRoot: string) => {
      const {
        selectedSubProjects,
        centeredItemId,
        selectedId,
        isSidebarOpen,
        activeTab,
        selectedCommit,
        viewport,
        view,
        isLoaded,
        sidebar,
      } = get();
      if (!isLoaded) return; // Don't save until we've loaded

      await window.ipcRenderer.invoke("save-state", projectRoot, {
        selectedSubProjects,
        centeredItemId,
        selectedId,
        isSidebarOpen,
        activeTab,
        selectedCommit,
        viewport,
        view,
        sidebar,
      });
    },
  })),
);

export const setupAutoSave = (projectRoot: string) => {
  const store = useAppStateStore;

  return store.subscribe(
    (state) => ({
      // 👇 pick ONLY what should trigger saves
      selectedSubProjects: state.selectedSubProjects,
      centeredItemId: state.centeredItemId,
      selectedId: state.selectedId,
      isSidebarOpen: state.isSidebarOpen,
      activeTab: state.activeTab,
      selectedCommit: state.selectedCommit,
      viewport: state.viewport,
      view: state.view,
      sidebar: state.sidebar,
      isLoaded: state.isLoaded,
    }),
    (state) => {
      if (state.isLoaded) {
        debouncedSave(projectRoot, store.getState().saveState);
      }
    },
    {
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  );
};
