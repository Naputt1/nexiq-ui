import BottomPanel from "./bottomPanel";
import { RightSidebar } from "./RightSidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../ui/resizable";
import {
  useDefaultLayout,
  type GroupImperativeHandle,
} from "react-resizable-panels";
import { useMemo, useRef } from "react";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import type { GraphNodeData } from "@/graph/items";
import { useGraphStore } from "@/hooks/use-graph-store";
import { useHotkey } from "@tanstack/react-hotkeys";

type GraphPanelProps = {
  onSelect: (id: string, center?: boolean, highlight?: boolean) => void;
  children: React.ReactNode;
};

const GraphPanel: React.FC<GraphPanelProps> = ({ onSelect, children }) => {
  const selectedId = useAppStateStore((s) => s.selectedId);
  const selectedEdgeId = useAppStateStore((s) => s.selectedEdgeId);
  const selectedItemType = useAppStateStore((s) => s.selectedItemType);

  const bottomPanelHeight = useAppStateStore((s) => s.sidebar.bottom.height);
  const isBottomPanelOpen = useAppStateStore((s) => s.sidebar.bottom.isOpen);
  const setBottomPanelHeight = useAppStateStore((s) => s.setBottomPanelHeight);

  const isRightSidebarOpen = useAppStateStore((s) => s.sidebar.right.isOpen);
  const setRightSidebarOpen = useAppStateStore((s) => s.setRightSidebarOpen);

  const sidebarWidth = useAppStateStore((s) => s.sidebar.right.width);
  const setRightSidebarWidthRatio = useAppStateStore(
    (s) => s.setRightSidebarWidth,
  );

  const graph = useGraphStore((s) => s.graphInstance);

  const graphPanelGroupRef = useRef<GroupImperativeHandle | null>(null);

  useHotkey("Control+\\", () => {
    setRightSidebarOpen(!isRightSidebarOpen);
  });

  // Persistence bridge for useDefaultLayout
  const storage = useMemo(
    () => ({
      getItem: () => {
        return JSON.stringify({
          main: 100 - sidebarWidth,
          sidebar: sidebarWidth,
        });
      },
      setItem: (_: string, value: string) => {
        const layout = JSON.parse(value);
        if (layout.sidebar !== undefined) {
          setRightSidebarWidthRatio(layout.sidebar);
        }
      },
    }),
    [sidebarWidth, setRightSidebarWidthRatio],
  );

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "main-horizontal",
    panelIds: ["main", "sidebar"],
    storage,
  });

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return undefined;
    return graph.getEdge(selectedEdgeId);
  }, [selectedEdgeId, graph]);

  const selectedItem = useMemo(() => {
    if (!selectedId) return undefined;
    return graph.getPointByID(selectedId);
  }, [selectedId, graph]);

  const renderNodes = useMemo(() => {
    if (!selectedId || selectedItem?.type !== "component") return [];
    const renderComboId = selectedId + "-render";
    const renderCombo = graph.getCombo(renderComboId);
    if (!renderCombo || !renderCombo.child) return [];
    return Object.values(renderCombo.child.nodes) as GraphNodeData[];
  }, [selectedId, selectedItem, graph]);

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="h-full w-full overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel id="main" minSize="30%">
        <ResizablePanelGroup
          orientation="vertical"
          className="h-full"
          groupRef={graphPanelGroupRef}
          onLayoutChanged={(layout) => {
            const nextHeight = layout["graph-bottom-panel"];
            if (typeof nextHeight === "number" && nextHeight > 0) {
              setBottomPanelHeight(nextHeight);
            }
          }}
        >
          <ResizablePanel
            id="graph-canvas"
            defaultSize={isBottomPanelOpen ? 100 - bottomPanelHeight : 100}
            minSize={35}
          >
            {children}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <BottomPanel
            graphPanelGroupRef={graphPanelGroupRef}
            handleSelectNode={onSelect}
          />
        </ResizablePanelGroup>
      </ResizablePanel>
      {(selectedId || selectedEdgeId) && isRightSidebarOpen && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="sidebar" minSize="15%" maxSize="50%">
            <RightSidebar
              selectedId={selectedId}
              selectedItemType={selectedItemType}
              selectedEdge={selectedEdge}
              onSelect={(id: string) => {
                onSelect(id, true, true);
              }}
              renderNodes={renderNodes}
            />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
};

export default GraphPanel;
