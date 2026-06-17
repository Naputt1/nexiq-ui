import {
  FolderOpen,
  Lock,
  PanelBottomOpen,
  PanelLeft,
  PanelRight,
  RefreshCw,
  Search,
  Settings,
  Unlock,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import { Kbd } from "../ui/kbd";
import { GraphCombo } from "@/graph/hook";
import { useEffect, useRef, useState, useMemo } from "react";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import type { PixiRenderer } from "@/graph/pixiRenderer";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useGraphStore } from "@/hooks/use-graph-store";

type GraphCommandProps = {
  setSize: (size: { width: number; height: number }) => void;
  handleReloadProject: () => void;
  rendererRef: React.RefObject<PixiRenderer | null>;
  children: React.ReactNode;
};

const GraphCommand: React.FC<GraphCommandProps> = ({
  setSize,
  handleReloadProject,
  rendererRef,
  children,
}) => {
  const selectedId = useAppStateStore((s) => s.selectedId);
  const isSidebarOpen = useAppStateStore((s) => s.isSidebarOpen);
  const setIsSidebarOpen = useAppStateStore((s) => s.setIsSidebarOpen);
  const selectedEdgeId = useAppStateStore((s) => s.selectedEdgeId);
  const isRightSidebarOpen = useAppStateStore((s) => s.sidebar.right.isOpen);
  const setRightSidebarOpen = useAppStateStore((s) => s.setRightSidebarOpen);
  const isBottomPanelOpen = useAppStateStore((s) => s.sidebar.bottom.isOpen);
  const setBottomPanelOpen = useAppStateStore((s) => s.setBottomPanelOpen);
  const gitComparisonEnabled = useAppStateStore((s) => s.gitComparisonEnabled);
  const setGitComparisonEnabled = useAppStateStore(
    (s) => s.setGitComparisonEnabled,
  );
  const locked = useAppStateStore((s) => s.locked);
  const setLocked = useAppStateStore((s) => s.setLocked);
  const setIsSearchOpen = useAppStateStore((s) => s.setIsSearchOpen);

  const setSettingsModalOpen = useAppStateStore((s) => s.setSettingsModalOpen);
  const setProjectModalOpen = useAppStateStore((s) => s.setProjectModalOpen);

  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const graph = useGraphStore((s) => s.graphInstance);

  // Resize observer for container
  const containerRef = useRef<HTMLDivElement>(null);

  useHotkey("Control+K", () => {
    setIsCommandPaletteOpen(true);
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
        console.log("Resizing renderer to", width, height);
        rendererRef.current?.resize(width, height);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [rendererRef, setSize]);

  // Force re-calculation of size when sidebar toggles or right sidebar width changes
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, [isSidebarOpen, selectedId, selectedEdgeId, isBottomPanelOpen, setSize]);

  const modLabel = useMemo(() => {
    const isMac =
      typeof window !== "undefined" &&
      navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    return isMac ? "⌘" : "Ctrl";
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden relative min-w-0"
    >
      {children}

      <CommandDialog
        open={isCommandPaletteOpen}
        onOpenChange={setIsCommandPaletteOpen}
      >
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                handleReloadProject();
                setIsCommandPaletteOpen(false);
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Reload Project
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setSettingsModalOpen(true);
                setIsCommandPaletteOpen(false);
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  ,
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                const focusedId = graph.getFocusedId();
                let targetId: string | undefined = undefined;
                if (focusedId) {
                  targetId = focusedId;
                } else if (selectedId) {
                  targetId = selectedId;
                }

                if (targetId) {
                  const item = graph.getPointByID(targetId);
                  if (item instanceof GraphCombo) {
                    graph.layout(true, targetId);
                  } else if (item?.parent) {
                    graph.layout(true, item.parent.id);
                  } else {
                    graph.layout(true);
                  }
                } else {
                  graph.layout(true);
                }
                setIsCommandPaletteOpen(false);
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Recalculate Layout
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  L
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                if (selectedId) {
                  graph.focusItem(selectedId);
                }
                setIsCommandPaletteOpen(false);
              }}
              disabled={!selectedId}
            >
              <Search className="mr-2 h-4 w-4" />
              Focus Selected Item
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  Enter
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            {graph.getFocusedId() && (
              <CommandItem
                onSelect={() => {
                  graph.focusItem(null);
                  setIsCommandPaletteOpen(false);
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reset Focus
                <CommandShortcut>
                  <Kbd className="bg-transparent border-0 p-0 text-inherit">
                    {modLabel}
                  </Kbd>
                  <Kbd className="bg-transparent border-0 p-0 text-inherit">
                    ⇧
                  </Kbd>
                  <Kbd className="bg-transparent border-0 p-0 text-inherit">
                    Enter
                  </Kbd>
                </CommandShortcut>
              </CommandItem>
            )}
          </CommandGroup>
          <CommandGroup heading="View">
            <CommandItem
              onSelect={() => {
                setIsSidebarOpen(!isSidebarOpen);
                setIsCommandPaletteOpen(false);
              }}
            >
              <PanelLeft className="mr-2 h-4 w-4" />
              Toggle Left Sidebar
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  B
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setRightSidebarOpen(!isRightSidebarOpen);
                setIsCommandPaletteOpen(false);
              }}
            >
              <PanelRight className="mr-2 h-4 w-4" />
              Toggle Right Sidebar
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  \
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setBottomPanelOpen(!isBottomPanelOpen);
                setIsCommandPaletteOpen(false);
              }}
            >
              <PanelBottomOpen className="mr-2 h-4 w-4" />
              Toggle Bottom Panel
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  J
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setGitComparisonEnabled(!gitComparisonEnabled);
                setIsCommandPaletteOpen(false);
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {gitComparisonEnabled
                ? "Turn Off Git Compare"
                : "Turn On Git Compare"}
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  ⇧
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  G
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                const next = !locked;
                setLocked(next);
                useGraphStore.getState().graphInstance.locked = next;
                setIsCommandPaletteOpen(false);
              }}
            >
              {locked ? <Unlock className="mr-2 h-4 w-4" /> : <Lock className="mr-2 h-4 w-4" />}
              {locked ? "Unlock Nodes" : "Lock Nodes"}
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  ⇧
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  L
                </Kbd>
              </CommandShortcut>
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setProjectModalOpen(true);
                setIsCommandPaletteOpen(false);
              }}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              Select Project
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  P
                </Kbd>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Navigation">
            <CommandItem
              onSelect={() => {
                setIsSearchOpen(true);
                setIsCommandPaletteOpen(false);
              }}
            >
              <Search className="mr-2 h-4 w-4" />
              Search...
              <CommandShortcut>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  {modLabel}
                </Kbd>
                <Kbd className="bg-transparent border-0 p-0 text-inherit">
                  F
                </Kbd>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  );
};

export default GraphCommand;
