import { create } from "zustand";
import type { GraphViewType } from "../../electron/types";
import debounce from "lodash.debounce";
import { subscribeWithSelector } from "zustand/middleware";
import type { AppStateData } from "@nexiq/shared";

type PersistedAppStateData = AppStateData;

const DEFAULT = {
  SIDEBAR: {
    RIGHT: {
      WIDTH: 25,
      HEIGHT: 40,
    },
    BOTTOM: {
      HEIGHT: 28,
      IS_OPEN: true,
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
  selectedEdgeId: string | null;
  selectedItemType: "node" | "edge" | null;
  selected: AppStateData["selected"];
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
    bottom: {
      isOpen: boolean;
      height: number;
      activeTab: "source" | "errors";
    };
  };

  setSelectedSubProjects: (paths: string[]) => void;
  toggleSubProject: (path: string) => void;
  setCenteredItemId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedItemType: (type: "node" | "edge" | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  setActiveTab: (tab: "projects" | "git") => void;
  setSelectedCommit: (commit: string | null) => void;
  setViewport: (
    viewport: { x: number; y: number; zoom: number } | null,
  ) => void;
  setView: (view: GraphViewType) => void;
  setRightSidebarWidth: (width: number) => void;
  setRightSidebarHeight: (height: number) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelHeight: (height: number) => void;
  setBottomPanelTab: (tab: "source" | "errors") => void;

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
    selectedEdgeId: null,
    selectedItemType: null,
    selected: null,
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
      bottom: {
        isOpen: DEFAULT.SIDEBAR.BOTTOM.IS_OPEN,
        height: DEFAULT.SIDEBAR.BOTTOM.HEIGHT,
        activeTab: "source",
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
    setSelectedId: (id) =>
      set({
        selectedId: id,
        selectedEdgeId: null,
        selectedItemType: id ? "node" : null,
        selected: id ? { type: "node", id } : null,
      }),
    setSelectedEdgeId: (id) =>
      set({
        selectedEdgeId: id,
        selectedItemType: id ? "edge" : null,
        selected: id ? { type: "edge", id } : null,
      }),
    setSelectedItemType: (type) =>
      set((state) => ({
        selectedItemType: type,
        selected:
          type === "node" && state.selectedId
            ? { type: "node", id: state.selectedId }
            : type === "edge" && state.selectedEdgeId
              ? { type: "edge", id: state.selectedEdgeId }
              : null,
      })),
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
    setBottomPanelOpen: (open) =>
      set((state) => ({
        sidebar: {
          ...state.sidebar,
          bottom: {
            ...state.sidebar.bottom,
            isOpen: open,
          },
        },
      })),
    setBottomPanelHeight: (height) =>
      set((state) => ({
        sidebar: {
          ...state.sidebar,
          bottom: {
            ...state.sidebar.bottom,
            height,
          },
        },
      })),
    setBottomPanelTab: (tab) =>
      set((state) => ({
        sidebar: {
          ...state.sidebar,
          bottom: {
            ...state.sidebar.bottom,
            activeTab: tab,
          },
        },
      })),

    reset: () =>
      set({
        selectedSubProjects: [],
        centeredItemId: null,
        selectedId: null,
        selectedEdgeId: null,
        selectedItemType: null,
        selected: null,
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
          bottom: {
            isOpen: DEFAULT.SIDEBAR.BOTTOM.IS_OPEN,
            height: DEFAULT.SIDEBAR.BOTTOM.HEIGHT,
            activeTab: "source",
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
        )) as PersistedAppStateData | null;

        if (state) {
          const persistedSidebar = state.sidebar as
            | {
                right?: { width?: number; height?: number };
                bottom?: {
                  isOpen?: boolean;
                  height?: number;
                  activeTab?: "source" | "errors";
                };
              }
            | undefined;
          const selected =
            state.selected ||
            (state.selectedItemType === "edge" && state.selectedEdgeId
              ? { type: "edge" as const, id: state.selectedEdgeId }
              : state.selectedId
                ? { type: "node" as const, id: state.selectedId }
                : null);

          set({
            selectedSubProjects: overrideSubProjects ||
              state.selectedSubProjects || [projectRoot],
            centeredItemId: state.centeredItemId || null,
            selectedId:
              selected?.type === "node"
                ? selected.id
                : (state.selectedId ?? null),
            selectedEdgeId:
              selected?.type === "edge"
                ? selected.id
                : (state.selectedEdgeId ?? null),
            selectedItemType: selected?.type || state.selectedItemType || null,
            selected,
            isSidebarOpen: state.isSidebarOpen ?? false,
            activeTab: state.activeTab || "projects",
            selectedCommit: state.selectedCommit || null,
            viewport: state.viewport || null,
            view: (state.view as GraphViewType) || "component",
            isLoaded: true,
            sidebar: {
              right: {
                width:
                  persistedSidebar?.right?.width || DEFAULT.SIDEBAR.RIGHT.WIDTH,
                height:
                  persistedSidebar?.right?.height ||
                  DEFAULT.SIDEBAR.RIGHT.HEIGHT,
              },
              bottom: {
                isOpen:
                  persistedSidebar?.bottom?.isOpen ??
                  DEFAULT.SIDEBAR.BOTTOM.IS_OPEN,
                height:
                  persistedSidebar?.bottom?.height ||
                  DEFAULT.SIDEBAR.BOTTOM.HEIGHT,
                activeTab:
                  persistedSidebar?.bottom &&
                  "activeTab" in persistedSidebar.bottom &&
                  (persistedSidebar.bottom.activeTab === "errors" ||
                    persistedSidebar.bottom.activeTab === "source")
                    ? persistedSidebar.bottom.activeTab
                    : "source",
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
        selectedEdgeId,
        selectedItemType,
        selected,
        isSidebarOpen,
        activeTab,
        selectedCommit,
        viewport,
        view,
        isLoaded,
        sidebar,
      } = get();
      if (!isLoaded) return; // Don't save until we've loaded

      await (window.ipcRenderer.invoke as (...args: unknown[]) => Promise<void>)(
        "save-state",
        projectRoot,
        {
          selectedSubProjects,
          centeredItemId,
          selectedId,
          selectedEdgeId,
          selectedItemType,
          selected,
          isSidebarOpen,
          activeTab,
          selectedCommit,
          viewport,
          view,
          sidebar,
        },
      );
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
      selectedEdgeId: state.selectedEdgeId,
      selectedItemType: state.selectedItemType,
      selected: state.selected,
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
