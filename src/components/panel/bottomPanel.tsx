import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceEditorPanel } from "../source-editor-panel";
import { ResizablePanel } from "../ui/resizable";
import type {
  GroupImperativeHandle,
  PanelImperativeHandle,
} from "react-resizable-panels";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { useGraphStore } from "@/hooks/use-graph-store";
import { useHotkey } from "@tanstack/react-hotkeys";

type BottomPanelProps = {
  handleSelectNode: (id: string) => void;
  graphPanelGroupRef: React.RefObject<GroupImperativeHandle | null>;
};

const BottomPanel: React.FC<BottomPanelProps> = ({
  graphPanelGroupRef,
  handleSelectNode,
}) => {
  const selectedId = useAppStateStore((s) => s.selectedId);

  const bottomPanelHeight = useAppStateStore((s) => s.sidebar.bottom.height);
  const isBottomPanelOpen = useAppStateStore((s) => s.sidebar.bottom.isOpen);
  const setBottomPanelOpen = useAppStateStore((s) => s.setBottomPanelOpen);

  const graph = useGraphStore((s) => s.graphInstance);
  const details = useGraphStore((s) => s.details);

  const [sourceFilePath, setSourceFilePath] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState("");

  const sourcePanelRef = useRef<PanelImperativeHandle | null>(null);
  const sourceContentCacheRef = useRef(new Map<string, string>());

  useHotkey("Control+J", () => {
    setBottomPanelOpen(!isBottomPanelOpen);
  });

  const handleOpenCurrentFile = useCallback(() => {
    if (!sourceFilePath) return;
    void window.ipcRenderer.invoke(
      "open-vscode",
      sourceFilePath,
      graph.projectPath,
    );
  }, [graph.projectPath, sourceFilePath]);

  useEffect(() => {
    const group = graphPanelGroupRef.current;
    const sourcePanel = sourcePanelRef.current;
    if (!group || !sourcePanel) return;

    if (isBottomPanelOpen) {
      sourcePanel.expand();
      sourcePanel.resize(`${bottomPanelHeight}%`);
      group.setLayout({
        "graph-canvas": 100 - bottomPanelHeight,
        "graph-bottom-panel": bottomPanelHeight,
      });
    } else {
      sourcePanel.collapse();
      group.setLayout({
        "graph-canvas": 100,
        "graph-bottom-panel": 0,
      });
    }
  }, [bottomPanelHeight, graphPanelGroupRef, isBottomPanelOpen]);

  const selectedItem = useMemo(() => {
    if (!selectedId) return undefined;
    return graph.getPointByID(selectedId);
  }, [selectedId, graph]);

  const sourceMarkers = useMemo(() => {
    if (!sourceFilePath) return [];
    const normalizedPath = sourceFilePath.replace(/\\/g, "/");

    const markers = graph
      .getAllNodes()
      .filter((node) => {
        const fileName = (
          details[node.id]?.fileName ||
          node.fileName ||
          ""
        ).replace(/\\/g, "/");
        return fileName === normalizedPath;
      })
      .map((node) => ({
        id: node.id,
        label: String(node.displayName || node.name || node.id),
        line: details[node.id]?.loc?.line || node.loc?.line || 1,
      }));

    // Add props and effects from components in this file
    for (const node of graph.getAllNodes()) {
      const detail = details[node.id];
      const fileName = (detail?.fileName || node.fileName || "").replace(
        /\\/g,
        "/",
      );
      if (fileName !== normalizedPath) continue;

      if (detail?.raw && typeof detail.raw === "object") {
        const raw = detail.raw as any;

        // Add Props
        if (Array.isArray(raw.props)) {
          for (const prop of raw.props) {
            const loc = prop.loc;
            markers.push({
              id: prop.id,
              label: prop.name,
              line: loc?.line || 1,
            });
          }
        }

        // Add Effects
        if (raw.effects && typeof raw.effects === "object") {
          for (const effect of Object.values(raw.effects) as any[]) {
            const loc = effect.loc;
            markers.push({
              id: effect.id,
              label: effect.name || "useEffect",
              line: loc?.line || 1,
            });
          }
        }
      }
    }

    return markers.sort((a, b) => a.line - b.line);
  }, [graph, sourceFilePath, details]);

  useEffect(() => {
    const item = selectedItem || graph.getCombo(selectedId || "");
    const filePath =
      item?.fileName ||
      (selectedId ? details[selectedId]?.fileName : undefined);
    if (!filePath) return;
    const normalizedPath = filePath.replace(/\\/g, "/");

    if (sourceFilePath === normalizedPath) {
      return;
    }

    let cancelled = false;
    const cachedContent = sourceContentCacheRef.current.get(normalizedPath);
    if (cachedContent !== undefined) {
      setSourceFilePath(normalizedPath);
      setSourceContent(cachedContent);
    } else {
      window.ipcRenderer
        .invoke("read-source-file", graph.projectPath, filePath)
        .then((result) => {
          if (cancelled) return;
          const nextPath = result.path.replace(/\\/g, "/");
          sourceContentCacheRef.current.set(nextPath, result.content);
          setSourceFilePath(nextPath);
          setSourceContent(result.content);
        })
        .catch((error) => {
          console.error("Failed to read source file", error);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedItem, graph, sourceFilePath, details]);

  return (
    <ResizablePanel
      id="graph-bottom-panel"
      panelRef={sourcePanelRef}
      defaultSize={bottomPanelHeight}
      minSize={16}
      collapsible
      collapsedSize={0}
    >
      <SourceEditorPanel
        filePath={sourceFilePath}
        content={sourceContent}
        selectedNodeId={selectedId}
        markers={sourceMarkers}
        isOpen={isBottomPanelOpen}
        onSelectNode={handleSelectNode}
        onOpenFile={handleOpenCurrentFile}
        onClose={() => setBottomPanelOpen(false)}
      />
    </ResizablePanel>
  );
};

export default BottomPanel;
