import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { type AnalyzedDiff, type TypeDataDeclare } from "@nexiq/shared";
import useGraph, {
  GraphCombo,
  GraphNode,
  type GraphNodeData,
} from "./graph/hook";
import { PixiRenderer } from "./graph/pixiRenderer";
import { ProjectSidebar } from "./components/Sidebar";
import { RightSidebar } from "./components/RightSidebar";
import { ZoomSlider } from "./components/ZoomSlider";
import { AlertTriangle, Loader2, RefreshCw, Search } from "lucide-react";
import { cn, debounce } from "@/lib/utils";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import {
  useDefaultLayout,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from "react-resizable-panels";

import { setupAutoSave, useAppStateStore } from "./hooks/use-app-state-store";
import { useGitStore } from "./hooks/useGitStore";
import { useConfigStore } from "./hooks/use-config-store";
import { useWorkerStore } from "./hooks/use-worker-store";
import { useViewportUiStore } from "./hooks/use-viewport-ui-store";
import { useGraphProfilerStore } from "./hooks/use-graph-profiler-store";
import { extractUIState } from "./graph/utils/ui-state";
import type { GenerateViewRequest } from "./views/types";
import {
  getGraphSnapshotKey,
  openDiffAnalysisSnapshot,
  openViewResultSnapshot,
  readLargeData,
  readViewResultData,
  refreshGraphSnapshot,
  refreshLargeData,
  subscribeGraphSnapshot,
} from "./graph-snapshot/client";
import { Button } from "./components/ui/button";
import { SourceEditorPanel } from "./components/source-editor-panel";
import type { FileAnalysisErrorRow, ResolveErrorRow } from "../electron/types";
import { Card } from "./components/ui/card";
import { ViewSwitcher } from "./components/ViewSwitcher";
import type { GraphViewBufferView } from "./view-snapshot/codec";

interface ComponentGraphProps {
  projectPath: string;
  subProject?: string;
}

const ComponentGraph = ({ projectPath, subProject }: ComponentGraphProps) => {
  const selectedSubProjects = useAppStateStore((s) => s.selectedSubProjects);
  const selectedId = useAppStateStore((s) => s.selectedId);
  const setSelectedId = useAppStateStore((s) => s.setSelectedId);
  const selectedEdgeId = useAppStateStore((s) => s.selectedEdgeId);
  const setSelectedEdgeId = useAppStateStore((s) => s.setSelectedEdgeId);
  const selectedItemType = useAppStateStore((s) => s.selectedItemType);
  const centeredItemId = useAppStateStore((s) => s.centeredItemId);
  const setCenteredItemId = useAppStateStore((s) => s.setCenteredItemId);
  const isSidebarOpen = useAppStateStore((s) => s.isSidebarOpen);
  const setIsSidebarOpen = useAppStateStore((s) => s.setIsSidebarOpen);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);
  const activeTab = useAppStateStore((s) => s.activeTab);
  const loadState = useAppStateStore((s) => s.loadState);
  const resetState = useAppStateStore((s) => s.reset);
  const isLoaded = useAppStateStore((s) => s.isLoaded);
  const view = useAppStateStore((s) => s.view);
  const setRightSidebarWidthRatio = useAppStateStore(
    (s) => s.setRightSidebarWidth,
  );
  const bottomPanelHeight = useAppStateStore((s) => s.sidebar.bottom.height);
  const isBottomPanelOpen = useAppStateStore((s) => s.sidebar.bottom.isOpen);
  const setBottomPanelHeight = useAppStateStore((s) => s.setBottomPanelHeight);
  const setBottomPanelOpen = useAppStateStore((s) => s.setBottomPanelOpen);
  const setBottomPanelTab = useAppStateStore((s) => s.setBottomPanelTab);
  const sidebarWidth = useAppStateStore((s) => s.sidebar.right.width);
  const setViewport = useAppStateStore((s) => s.setViewport);

  const status = useGitStore((s) => s.status);
  const clearAnalyzedDiffCache = useGitStore((s) => s.clearAnalyzedDiffCache);

  const setBackendAvailable = useWorkerStore((s) => s.setBackendAvailable);

  const [isGeneratingView, setIsGeneratingView] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  const subPath = useMemo(() => {
    const selectedSubProject = selectedSubProjects[0];
    return selectedSubProject &&
      selectedSubProject !== projectPath &&
      selectedSubProject.startsWith(projectPath)
      ? selectedSubProject.replace(projectPath, "").replace(/^[/\\]/, "")
      : undefined;
  }, [selectedSubProjects, projectPath]);

  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const [graphViewBuffer, setGraphViewBuffer] =
    useState<GraphViewBufferView | null>(null);

  const rendererRef = useRef<PixiRenderer | null>(null);

  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [typeData, settypeData] = useState<{ [key: string]: TypeDataDeclare }>(
    {},
  );
  const [sourceFilePath, setSourceFilePath] = useState<string | null>(null);
  const [sourceContent, setSourceContent] = useState("");
  const [fileErrors, setFileErrors] = useState<FileAnalysisErrorRow[]>([]);
  const [resolveErrors, setResolveErrors] = useState<ResolveErrorRow[]>([]);
  const [activeProfileRunId, setActiveProfileRunId] = useState<string | null>(
    null,
  );
  const sourceContentCacheRef = useRef(new Map<string, string>());

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const graphPanelGroupRef = useRef<GroupImperativeHandle | null>(null);
  const sourcePanelRef = useRef<PanelImperativeHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const hasRestoredViewport = useRef(false);
  const { theme, customColors, fetchConfig } = useConfigStore();

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    const analysisTarget = selectedSubProjects[0] || projectPath;
    window.ipcRenderer
      .invoke("get-analysis-errors", projectPath, analysisTarget)
      .then((result) => {
        setFileErrors(result.fileErrors);
        setResolveErrors(result.resolveErrors);
      })
      .catch((error) => {
        console.error("Failed to load analysis errors", error);
      });
  }, [projectPath, selectedSubProjects, isAnalyzing, graphViewBuffer]);

  // Use useEffect to update renderer theme when customColors or theme changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCustomColors(customColors || {});
      const resolvedTheme = document.documentElement.classList.contains("dark")
        ? "dark"
        : "light";
      rendererRef.current.setTheme(resolvedTheme);
    }
  }, [customColors, theme]);

  useEffect(() => {
    const unsubscribe = setupAutoSave(projectPath);
    return () => unsubscribe();
  }, [projectPath]);

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
  }, [bottomPanelHeight, isBottomPanelOpen]);

  const rawDiffRef = useRef<AnalyzedDiff | null>(null);
  const snapshotKeyRef = useRef<string | null>(null);
  const viewRequestIdRef = useRef(0);
  const activeProfileRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    setBackendAvailable(true);

    return () => {
      setBackendAvailable(false);
    };
  }, [setBackendAvailable]);

  const loadData = useCallback(
    async (
      analysisPath?: string,
      options?: {
        refreshHandle?: boolean;
      },
    ) => {
      const targetPath = analysisPath || selectedSubProjects[0] || projectPath;
      if (!targetPath) return;

      const requestId = ++viewRequestIdRef.current;
      const logicalKey = JSON.stringify({
        projectRoot: projectPath,
        targetPath,
        selectedCommit: selectedCommit ?? null,
        activeTab,
        subPath: subPath ?? null,
        view,
      });
      const profilerRunId = `${logicalKey}::${requestId}`;
      activeProfileRunIdRef.current = profilerRunId;
      setActiveProfileRunId(profilerRunId);
      useGraphProfilerStore.getState().startRun({
        id: profilerRunId,
        logicalKey,
        key: targetPath,
        projectRoot: projectPath,
        view,
        startedAt: Date.now(),
        status: "in_progress",
      });
      setIsGeneratingView(true);
      const requestStartedAt = performance.now();

      try {
        let request: GenerateViewRequest;
        let resultHandle;

        if (selectedCommit || activeTab === "git") {
          const diffArgs = {
            projectRoot: projectPath,
            selectedCommit: selectedCommit ?? null,
            subPath,
            refreshHandle: options?.refreshHandle,
            profilerRunId,
            profilerLogicalKey: logicalKey,
          };
          if (options?.refreshHandle) {
            await refreshLargeData("diff-analysis", diffArgs);
          }
          const diffHandle = options?.refreshHandle
            ? await window.largeData.getHandle("diff-analysis", diffArgs)
            : await openDiffAnalysisSnapshot(
                projectPath,
                selectedCommit ?? null,
                subPath,
                {
                  profilerRunId,
                  profilerLogicalKey: logicalKey,
                },
              );
          const diffData = readLargeData(diffHandle);
          rawDiffRef.current = diffData.diff ?? null;
          request = {
            view,
            projectRoot: projectPath,
            selectedCommit: selectedCommit ?? null,
            subPath,
            refreshHandle: options?.refreshHandle,
            profilerRunId,
            profilerLogicalKey: logicalKey,
          };
          if (options?.refreshHandle) {
            await refreshLargeData("view-result", request);
            resultHandle = await window.largeData.getHandle(
              "view-result",
              request,
            );
          } else {
            resultHandle = await openViewResultSnapshot(request);
          }
        } else {
          const resolvedAnalysisPath =
            targetPath === projectPath ? undefined : targetPath;
          const snapshotKey = getGraphSnapshotKey(
            projectPath,
            resolvedAnalysisPath,
            selectedSubProjects,
          );
          snapshotKeyRef.current = snapshotKey;
          rawDiffRef.current = null;
          request = {
            view,
            projectRoot: projectPath,
            analysisPath: resolvedAnalysisPath,
            analysisPaths: selectedSubProjects,
            refreshHandle: options?.refreshHandle,
            profilerRunId,
            profilerLogicalKey: logicalKey,
          };
          if (options?.refreshHandle) {
            await refreshLargeData("view-result", request);
            resultHandle = await window.largeData.getHandle(
              "view-result",
              request,
            );
          } else {
            resultHandle = await openViewResultSnapshot(request);
          }
        }
        const byteLength = new Int32Array(resultHandle.metaBuffer)[2] ?? 0;
        useGraphProfilerStore.getState().updateRun(profilerRunId, {
          key: resultHandle.key,
          byteLength,
          handleVersion: resultHandle.version,
        });
        useGraphProfilerStore.getState().mergeStages(profilerRunId, [
          {
            id: "renderer:handle-wait",
            name: "Renderer handle wait",
            startMs: 0,
            endMs: performance.now() - requestStartedAt,
            source: "renderer",
            detail: `${(byteLength / 1024).toFixed(1)} KB`,
          },
        ]);
        const decodeStartedAt = performance.now();
        const result = readViewResultData(resultHandle);
        const decodeEndMs = performance.now() - requestStartedAt;
        useGraphProfilerStore.getState().mergeStages(profilerRunId, [
          {
            id: "renderer:decode-view-buffer",
            name: "Decode view buffer",
            startMs: decodeStartedAt - requestStartedAt,
            endMs: decodeEndMs,
            source: "renderer",
            parentId: "renderer:handle-wait",
            detail: `${result.nodeCount} nodes, ${result.edgeCount} edges, ${result.comboCount} combos`,
          },
        ]);
        if (requestId !== viewRequestIdRef.current) {
          useGraphProfilerStore.getState().completeRun(profilerRunId, {
            status: "superseded",
          });
          return;
        }

        settypeData(result.getTypeData());
        setGraphViewBuffer(result);
        const attachEndMs = performance.now() - requestStartedAt;
        useGraphProfilerStore.getState().mergeStages(profilerRunId, [
          {
            id: "renderer:attach-graph-buffer",
            name: "Attach graph buffer",
            startMs: decodeEndMs,
            endMs: attachEndMs,
            source: "renderer",
            parentId: "renderer:handle-wait",
          },
        ]);
        useGraphProfilerStore.getState().completeRun(profilerRunId, {
          status: "completed",
        });
      } catch (err) {
        console.error(err);
        useGraphProfilerStore.getState().completeRun(profilerRunId, {
          status: "failed",
        });
      } finally {
        if (requestId === viewRequestIdRef.current) {
          setIsGeneratingView(false);
        }
      }
    },
    [
      projectPath,
      selectedSubProjects,
      selectedCommit,
      activeTab,
      subPath,
      view,
    ],
  );

  const graph = useGraph({
    viewBuffer: graphViewBuffer,
    projectPath,
    targetPath: selectedSubProjects[0] || projectPath,
  });

  useEffect(() => {
    graph.setProfileRunId(activeProfileRunId);
  }, [graph, activeProfileRunId]);

  const debouncedRender = useMemo(
    () =>
      debounce(() => {
        if (graph) {
          const time = performance.now();
          graph.render();
          console.log("layout (debounced)", performance.now() - time);
        }
      }, 100),
    [graph],
  );

  const highlightGitChanges = useCallback(
    async (isGitTab: boolean) => {
      if (!graph) return;

      try {
        const combos = graph.getAllCombos();
        const nodes = graph.getAllNodes();

        const {
          added = [],
          modified = [],
          deleted = [],
        } = rawDiffRef.current || {};

        graph.batch(() => {
          const applyStatus = (item: GraphCombo | GraphNode) => {
            if (isGitTab) {
              if (added.includes(item.id)) {
                item.gitStatus = "added";
              } else if (modified.includes(item.id)) {
                item.gitStatus = "modified";
              } else if (deleted.includes(item.id)) {
                item.gitStatus = "deleted";
              } else {
                item.gitStatus = undefined;
              }
            } else {
              item.gitStatus = undefined;
            }

            // Everything in the current graph should be visible
            item.visible = true;

            if ("expandedRadius" in item) graph.updateCombo(item as GraphCombo);
            else graph.updateNode(item as GraphNode);
          };

          combos.forEach(applyStatus);
          nodes.forEach(applyStatus);
        });
      } catch (e) {
        console.error("Failed to highlight git changes", e);
      }
    },
    [graph],
  );

  const goToNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const nextIndex = (currentMatchIndex + 1) % matches.length;
    setCurrentMatchIndex(nextIndex);
    graph.expandAncestors(matches[nextIndex]);
    rendererRef.current?.focusItem(matches[nextIndex], 1.5);
    setSelectedId(matches[nextIndex]);
  }, [matches, currentMatchIndex, graph, setSelectedId]);

  const goToPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prevIndex = (currentMatchIndex - 1 + matches.length) % matches.length;
    setCurrentMatchIndex(prevIndex);
    graph.expandAncestors(matches[prevIndex]);
    rendererRef.current?.focusItem(matches[prevIndex], 1.5);
    setSelectedId(matches[prevIndex]);
  }, [matches, currentMatchIndex, graph, setSelectedId]);

  const resetHighlights = useCallback(() => {
    const combos = graph.getAllCombos();
    for (const combo of Object.values(combos)) {
      if (combo.highlighted) {
        combo.highlighted = false;
        graph.updateCombo(combo);
      }
    }
    const nodes = graph.getAllNodes();
    for (const node of Object.values(nodes)) {
      if (node.highlighted) {
        node.highlighted = false;
        graph.updateNode(node);
      }
    }
    const edges = graph.getAllEdges();
    for (const edge of Object.values(edges)) {
      if (edge.highlighted || edge.dimmed || edge.flowRole) {
        edge.highlighted = false;
        edge.dimmed = false;
        edge.flowRole = null;
      }
    }
    graph.refresh(true);
  }, [graph]);

  const applyFlowHighlights = useCallback(
    (rootNodeId?: string, rootEdgeId?: string) => {
      const usageEdges = graph
        .getAllEdges()
        .filter((edge) => String(edge.category || "").startsWith("usage-"));

      if (!rootNodeId && !rootEdgeId) {
        resetHighlights();
        return;
      }

      const highlightedEdgeIds = new Set<string>();
      const highlightedNodeIds = new Set<string>();
      const queue: string[] = [];
      const adjacency = new Map<string, typeof usageEdges>();
      const rootNodeIds = new Set<string>();

      for (const edge of usageEdges) {
        const sourceEdges = adjacency.get(edge.source) || [];
        sourceEdges.push(edge);
        adjacency.set(edge.source, sourceEdges);
        const targetEdges = adjacency.get(edge.target) || [];
        targetEdges.push(edge);
        adjacency.set(edge.target, targetEdges);
      }

      if (rootNodeId) {
        highlightedNodeIds.add(rootNodeId);
        queue.push(rootNodeId);
        rootNodeIds.add(rootNodeId);
      }

      if (rootEdgeId) {
        const rootEdge = graph.getEdge(rootEdgeId);
        if (rootEdge) {
          highlightedEdgeIds.add(rootEdge.id);
          highlightedNodeIds.add(rootEdge.source);
          highlightedNodeIds.add(rootEdge.target);
          queue.push(rootEdge.source, rootEdge.target);
          rootNodeIds.add(rootEdge.source);
          rootNodeIds.add(rootEdge.target);
        }
      }

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        for (const edge of adjacency.get(nodeId) || []) {
          if (!highlightedEdgeIds.has(edge.id)) {
            highlightedEdgeIds.add(edge.id);
          }
          if (!highlightedNodeIds.has(edge.source)) {
            highlightedNodeIds.add(edge.source);
            queue.push(edge.source);
          }
          if (!highlightedNodeIds.has(edge.target)) {
            highlightedNodeIds.add(edge.target);
            queue.push(edge.target);
          }
        }
      }

      const directEdgeIds = new Set<string>();
      const writeCandidateNodeIds = new Set<string>();
      for (const edge of usageEdges) {
        if (edge.edgeKind === "usage-write") {
          writeCandidateNodeIds.add(edge.source);
          writeCandidateNodeIds.add(edge.target);
        }
      }

      for (const nodeId of highlightedNodeIds) {
        const point = graph.getPointByID(nodeId);
        if (point?.type === "state") {
          writeCandidateNodeIds.add(nodeId);
        }
      }

      const visited = new Set<string>(rootNodeIds);
      const parentEdge = new Map<string, string>();
      const parentNode = new Map<string, string>();
      const pathQueue = Array.from(rootNodeIds);
      let nearestTargetId: string | null = null;

      while (pathQueue.length > 0 && !nearestTargetId) {
        const nodeId = pathQueue.shift()!;
        if (writeCandidateNodeIds.has(nodeId) && !rootNodeIds.has(nodeId)) {
          nearestTargetId = nodeId;
          break;
        }

        for (const edge of adjacency.get(nodeId) || []) {
          const nextNode = edge.source === nodeId ? edge.target : edge.source;
          if (visited.has(nextNode)) continue;
          visited.add(nextNode);
          parentNode.set(nextNode, nodeId);
          parentEdge.set(nextNode, edge.id);
          pathQueue.push(nextNode);
        }
      }

      if (nearestTargetId) {
        let current = nearestTargetId;
        while (parentEdge.has(current)) {
          directEdgeIds.add(parentEdge.get(current)!);
          current = parentNode.get(current)!;
        }
      } else {
        for (const rootId of rootNodeIds) {
          for (const edge of adjacency.get(rootId) || []) {
            if (edge.edgeKind === "usage-write") {
              directEdgeIds.add(edge.id);
            }
          }
        }
      }

      if (rootEdgeId && highlightedEdgeIds.has(rootEdgeId)) {
        directEdgeIds.add(rootEdgeId);
      }

      graph.batch(() => {
        for (const combo of graph.getAllCombos()) {
          const nextHighlighted = highlightedNodeIds.has(combo.id);
          if (combo.highlighted !== nextHighlighted) {
            combo.highlighted = nextHighlighted;
            graph.updateCombo(combo);
          }
        }
        for (const node of graph.getAllNodes()) {
          const nextHighlighted = highlightedNodeIds.has(node.id);
          if (node.highlighted !== nextHighlighted) {
            node.highlighted = nextHighlighted;
            graph.updateNode(node);
          }
        }
        for (const edge of graph.getAllEdges()) {
          const nextHighlighted = highlightedEdgeIds.has(edge.id);
          const nextDimmed =
            highlightedEdgeIds.size > 0
              ? !highlightedEdgeIds.has(edge.id)
              : false;
          const nextFlowRole = directEdgeIds.has(edge.id)
            ? "direct"
            : nextHighlighted
              ? "side-effect"
              : null;
          if (
            edge.highlighted !== nextHighlighted ||
            edge.dimmed !== nextDimmed ||
            edge.flowRole !== nextFlowRole
          ) {
            edge.highlighted = nextHighlighted;
            edge.dimmed = nextDimmed;
            edge.flowRole = nextFlowRole;
          }
        }
      });
      graph.refresh(true);
    },
    [graph, resetHighlights],
  );

  const performSearch = useCallback(
    (value: string) => {
      let firstMatchId: string | null = null;
      const newMatches: string[] = [];

      graph.batch(() => {
        if (value === "") {
          setMatches([]);
          setCurrentMatchIndex(-1);
          resetHighlights();
          return;
        }

        const lowerValue = value.toLowerCase();

        const combos = graph.getAllCombos();
        for (const combo of combos) {
          if (combo.id.endsWith("-render")) continue;

          const isMatch = combo.label?.text.toLowerCase().includes(lowerValue);
          if (isMatch) {
            if (!combo.highlighted) {
              combo.highlighted = true;
              graph.updateCombo(combo);
            }
            newMatches.push(combo.id);
          } else if (combo.highlighted) {
            combo.highlighted = false;
            graph.updateCombo(combo);
          }
        }

        const nodes = graph.getAllNodes();
        for (const node of nodes) {
          const isMatch = node.label?.text.toLowerCase().includes(lowerValue);
          if (isMatch) {
            if (!node.highlighted) {
              node.highlighted = true;
              graph.updateNode(node);
            }
            newMatches.push(node.id);
          } else if (node.highlighted) {
            node.highlighted = false;
            graph.updateNode(node);
          }
        }

        if (newMatches.length > 0) {
          firstMatchId = newMatches[0];
        }
      });

      setMatches(newMatches);
      if (newMatches.length > 0) {
        setCurrentMatchIndex(0);
        setSelectedId(firstMatchId);
        // Small timeout to allow the batch render to complete before starting expansion animations
        setTimeout(() => {
          if (firstMatchId) {
            graph.expandAncestors(firstMatchId);
            rendererRef.current?.focusItem(firstMatchId, 1.5);
          }
        }, 50);
      } else {
        setCurrentMatchIndex(-1);
      }
    },
    [graph, resetHighlights, setSelectedId],
  );

  useEffect(() => {
    highlightGitChanges(activeTab === "git");
  }, [highlightGitChanges, status, selectedCommit, activeTab]);

  useEffect(() => {
    window.nexiqGraph = graph;
    window.nexiqSearch = performSearch;
  }, [graph, performSearch]);

  const onSelect = useCallback(
    (id: string, center = true, highlight = false) => {
      setSelectedId(id);
      setCenteredItemId(id);

      if (highlight) {
        resetHighlights();
        const combo = graph.getCombo(id);
        if (combo) {
          combo.highlighted = true;
          graph.updateCombo(combo);
        } else {
          const node = graph.getNode(id);
          if (node) {
            node.highlighted = true;
            graph.updateNode(node);
          }
        }
      }

      applyFlowHighlights(id, undefined);

      // Expand all ancestors to make sure the node is visible
      graph.expandAncestors(id);

      // Focus the viewport on the selected item
      // Small timeout to allow potential layout/expansion to finish or at least start
      if (center) {
        setTimeout(() => {
          rendererRef.current?.focusItem(id, 1.5);
        }, 50);
      }
    },
    [
      setSelectedId,
      setCenteredItemId,
      graph,
      resetHighlights,
      applyFlowHighlights,
    ],
  );

  const onSelectEdge = useCallback(
    (id: string, center = false) => {
      setSelectedEdgeId(id);
      applyFlowHighlights(undefined, id);
      if (center) {
        const edge = graph.getEdge(id);
        if (edge) {
          graph.expandAncestors(edge.source);
          graph.expandAncestors(edge.target);
        }
      }
    },
    [setSelectedEdgeId, applyFlowHighlights, graph],
  );

  // Clear search and highlights when search bar is closed
  useEffect(() => {
    if (!isSearchOpen) {
      setSearch("");
      setDebouncedSearch("");
      setMatches([]);
      setCurrentMatchIndex(-1);
      resetHighlights();
    }
  }, [isSearchOpen, resetHighlights]);

  useEffect(() => {
    const savePositions = debounce(() => {
      const positions = extractUIState(graph);

      const targetPath =
        selectedSubProjects.length === 1
          ? selectedSubProjects[0] || projectPath
          : projectPath;
      if (Object.keys(positions).length > 0) {
        window.ipcRenderer.invoke(
          "update-graph-position",
          projectPath,
          targetPath,
          positions,
        );
      }
    }, 1000);

    const unbind = graph.bind((data) => {
      if (
        data.type === "combo-drag-move" ||
        data.type === "node-drag-move" ||
        data.type === "combo-drag-end" ||
        data.type === "node-drag-end" ||
        data.type === "layout-change" ||
        data.type === "child-moved" ||
        data.type === "combo-collapsed"
      ) {
        savePositions();
      }
    });

    return () => {
      graph.unbind(unbind);
    };
  }, [graph, projectPath, selectedSubProjects]);

  // Initialize/Update Renderer
  useEffect(() => {
    if (!graphContainerRef.current) return;
    if (size.width === 0 || size.height === 0) return;

    if (!rendererRef.current) {
      rendererRef.current = new PixiRenderer(
        graphContainerRef.current,
        graph,
        size.width,
        size.height,
        onSelect,
        onSelectEdge,
        (zoom) => {
          useViewportUiStore.getState().setZoom(zoom);
        },
        (range) => {
          useViewportUiStore.getState().setZoomRange(range);
        },
        (vp) => {
          if (!rendererRef.current?.viewportChangeInProgress) {
            setViewport(vp);
          }
        },
        (durationMs) => {
          const runId = activeProfileRunIdRef.current;
          if (!runId) return;
          const store = useGraphProfilerStore.getState();
          const run = store.runs.find((entry) => entry.id === runId);
          const baseStartMs =
            run?.stages.reduce((max, stage) => Math.max(max, stage.endMs), 0) ??
            0;
          store.mergeStages(runId, [
            {
              id: "renderer:pixi-render",
              name: "Pixi render",
              startMs: baseStartMs,
              endMs: baseStartMs + durationMs,
              source: "renderer",
            },
          ]);
        },
        document.documentElement.classList.contains("dark") ? "dark" : "light",
        customColors,
      );
    } else {
      rendererRef.current.resize(size.width, size.height);
      rendererRef.current.onSelect = onSelect;
      rendererRef.current.onSelectEdge = onSelectEdge;
    }

    if (rendererRef.current && !hasRestoredViewport.current && isLoaded) {
      const savedViewport = useAppStateStore.getState().viewport;
      if (savedViewport) {
        useViewportUiStore.getState().setZoom(savedViewport.zoom);
        rendererRef.current.setViewport(
          savedViewport.x,
          savedViewport.y,
          savedViewport.zoom,
        );
      } else {
        useViewportUiStore.getState().setZoom(1);
      }
      hasRestoredViewport.current = true;
    }
  }, [
    graph,
    size.width,
    size.height,
    onSelect,
    onSelectEdge,
    isLoaded,
    setViewport,
    customColors,
  ]);

  // Clean up
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !graphViewBuffer ||
      graphViewBuffer.edgeCount === 0 ||
      graphViewBuffer.comboCount === 0 ||
      graphViewBuffer.nodeCount === 0
    )
      return;

    // Only trigger a full layout/render if not already generating a view
    // or if it's the final update.
    // For incremental updates, we let useGraph's setData handle it (without full layout).
    if (!isGeneratingView) {
      debouncedRender();
    }
  }, [graphViewBuffer, graph, isGeneratingView, debouncedRender]);

  useEffect(() => {
    // After render, center on saved item if it exists AND we haven't restored a viewport
    if (centeredItemId && !hasRestoredViewport.current) {
      setTimeout(() => {
        graph.expandAncestors(centeredItemId);
        rendererRef.current?.focusItem(centeredItemId, 1.5);
        hasRestoredViewport.current = true; // Mark as done so we don't jump again
      }, 100);
    }
  }, [centeredItemId, graph]);

  // Initial load state
  useEffect(() => {
    hasRestoredViewport.current = false; // Reset flag when project changes
    resetState();
    loadState(projectPath, subProject ? [subProject] : undefined);

    // Initial analysis to ensure sqlitePath is populated in main process
    const triggerInitialAnalysis = async () => {
      const targetPath = subProject || projectPath;
      if (!targetPath) return;

      setIsAnalyzing(true);
      try {
        await window.ipcRenderer.invoke(
          "analyze-project",
          selectedSubProjects.length > 0 ? selectedSubProjects : targetPath,
          projectPath,
        );
        // Data will be reloaded by the other useEffect watching status/graph
      } catch (e) {
        console.error("Failed initial analysis", e);
      } finally {
        setIsAnalyzing(false);
      }
    };

    triggerInitialAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, subProject, loadState, resetState]);

  // load data whenever sub-project selection or selected commit changes
  useEffect(() => {
    startTransition(() => {
      loadData();
    });
  }, [selectedSubProjects, selectedCommit, loadData]);

  useEffect(() => {
    const unsubscribe = subscribeGraphSnapshot((payload) => {
      if (selectedCommit || activeTab === "git") return;

      const expectedKey = snapshotKeyRef.current;
      if (!expectedKey || payload.key !== expectedKey) return;

      const rerenderFromHandle = async () => {
        await loadData(undefined, {
          refreshHandle: payload.handleChanged,
        });
      };

      if (payload.status !== 1) {
        console.error("Graph snapshot update failed", payload.error || payload);
        return;
      }

      void rerenderFromHandle();
    });
    return () => unsubscribe();
  }, [activeTab, loadData, projectPath, selectedCommit, selectedSubProjects]);

  // Resize observer for container
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSize({ width, height });
        rendererRef.current?.resize(width, height);
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Force re-calculation of size when sidebar toggles or right sidebar width changes
  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setSize({ width, height });
    }
  }, [isSidebarOpen, selectedId, selectedEdgeId, isBottomPanelOpen]);

  // handle global shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        if (isSearchOpen) {
          searchInputRef.current?.select();
        } else {
          setIsSearchOpen(true);
        }
      }
      if (e.key === "Escape") {
        setIsSearchOpen(false);
      }
      if (isSearchOpen && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          goToPrevMatch();
        } else {
          goToNextMatch();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSearchOpen, matches, currentMatchIndex, goToNextMatch, goToPrevMatch]);

  // Focus and select search input when opened
  useEffect(() => {
    if (isSearchOpen) {
      // Small delay to ensure the input is rendered and focused
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 10);
    }
  }, [isSearchOpen]);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);
    return () => clearTimeout(handler);
  }, [search]);

  // Trigger search when debounced value changes
  useEffect(() => {
    performSearch(debouncedSearch);
  }, [debouncedSearch, performSearch]);

  const onSearch = (value: string) => {
    setSearch(value);
  };

  const handleReloadProject = useCallback(async () => {
    const targetPath = selectedSubProjects[0] || projectPath;
    if (!targetPath) return;

    setIsAnalyzing(true);
    try {
      await window.ipcRenderer.invoke(
        "analyze-project",
        targetPath,
        projectPath,
      );
      await refreshGraphSnapshot(
        projectPath,
        targetPath === projectPath ? undefined : targetPath,
      );
      clearAnalyzedDiffCache();
      await loadData(undefined, { refreshHandle: true });
    } catch (e) {
      console.error("Failed to reload project", e);
    } finally {
      setIsAnalyzing(false);
    }
  }, [selectedSubProjects, projectPath, loadData, clearAnalyzedDiffCache]);

  useEffect(() => {
    const unsubscribe = window.ipcRenderer.on("reload-project", () => {
      handleReloadProject();
    });
    return () => {
      unsubscribe();
    };
  }, [handleReloadProject]);

  const selectedItem = useMemo(() => {
    if (!selectedId) return undefined;
    return graph.getPointByID(selectedId);
  }, [selectedId, graph]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return undefined;
    return graph.getEdge(selectedEdgeId);
  }, [selectedEdgeId, graph]);

  const renderNodes = useMemo(() => {
    if (!selectedId || selectedItem?.type !== "component") return [];
    const renderComboId = selectedId + "-render";
    const renderCombo = graph.getCombo(renderComboId);
    if (!renderCombo || !renderCombo.child) return [];
    return Object.values(renderCombo.child.nodes) as GraphNodeData[];
  }, [selectedId, selectedItem, graph]);

  const handleClose = useCallback(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    resetHighlights();
  }, [setSelectedId, setSelectedEdgeId, resetHighlights]);

  const handleZoomChange = useCallback((zoom: number) => {
    rendererRef.current?.setZoom(zoom);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelTab("source");
    setBottomPanelOpen(!isBottomPanelOpen);
  }, [isBottomPanelOpen, setBottomPanelOpen, setBottomPanelTab]);

  const handleOpenErrors = useCallback(() => {
    setBottomPanelTab("errors");
    setBottomPanelOpen(true);
  }, [setBottomPanelOpen, setBottomPanelTab]);

  const handleSelectNode = useCallback(
    (id: string) => {
      onSelect(id, true, true);
    },
    [onSelect],
  );

  const handleLocateFile = useCallback(
    (filePath: string) => {
      const nodes = graph.getAllNodes();
      const combos = graph.getAllCombos();

      const match =
        combos.find((c) => c.pureFileName === filePath) ||
        nodes.find((n) => n.fileName?.startsWith(filePath));

      if (match) {
        onSelect(match.id);
      }
    },
    [graph, onSelect],
  );

  const sourceMarkers = useMemo(() => {
    if (!sourceFilePath) return [];
    const normalizedPath = sourceFilePath.replace(/\\/g, "/");

    return graph
      .getAllNodes()
      .filter((node) => {
        const fileName = (node.fileName || "").replace(/\\/g, "/");
        return fileName === normalizedPath;
      })
      .map((node) => ({
        id: node.id,
        label: String(node.displayName || node.name || node.id),
        line: node.loc?.line || 1,
      }))
      .sort((a, b) => a.line - b.line);
  }, [graph, sourceFilePath]);

  const totalErrorCount = fileErrors.length + resolveErrors.length;

  useEffect(() => {
    const item = selectedItem || graph.getCombo(selectedId || "");
    const filePath = item?.fileName;
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
        .invoke("read-source-file", filePath, projectPath)
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
  }, [projectPath, selectedId, selectedItem, graph, sourceFilePath]);

  const handleOpenCurrentFile = useCallback(() => {
    if (!sourceFilePath) return;
    void window.ipcRenderer.invoke("open-vscode", sourceFilePath, projectPath);
  }, [sourceFilePath, projectPath]);

  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <MemoizedProjectSidebar
          currentPath={selectedSubProjects[0] || projectPath}
          projectRoot={projectPath}
          onLocateFile={handleLocateFile}
          onSelectNode={handleSelectNode}
          isLoading={isAnalyzing}
        />
        <SidebarInset className="min-w-0">
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
                  defaultSize={
                    isBottomPanelOpen ? 100 - bottomPanelHeight : 100
                  }
                  minSize={35}
                >
                  <div className="flex-1 relative min-w-0 h-full">
                    <SidebarTrigger
                      className={cn("absolute top-4 left-4 z-[120]")}
                    />
                    <Card className="absolute bottom-4 right-4 z-[110] flex flex-row items-center gap-2 p-2 shadow-lg">
                      <ViewSwitcher compact />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsSearchOpen(true)}
                      >
                        <Search className="h-4 w-4" />
                        Search
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleBottomPanel}
                      >
                        Source
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReloadProject}
                      >
                        <RefreshCw className="h-4 w-4" />
                        Reload
                      </Button>
                      {totalErrorCount > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={handleOpenErrors}
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {totalErrorCount} issues
                        </Button>
                      )}
                    </Card>
                    {isSearchOpen && (
                      <div className="absolute bottom-17.5 right-4 z-[110] flex items-center rounded border border-border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center gap-1">
                          <div className="relative flex items-center">
                            <input
                              ref={searchInputRef}
                              autoFocus
                              type="text"
                              value={search}
                              placeholder="Find"
                              onChange={(e) => onSearch(e.target.value)}
                              className="bg-muted text-foreground pl-2 pr-16 py-1 outline-none text-sm w-64 border border-transparent focus:border-primary rounded-sm placeholder:text-muted-foreground"
                            />
                            <div className="absolute right-2 text-[11px] text-muted-foreground pointer-events-none">
                              {matches.length > 0 ? (
                                <span className="text-foreground">
                                  {currentMatchIndex + 1} of {matches.length}
                                </span>
                              ) : search !== "" ? (
                                <span className="text-destructive">
                                  No results
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center border-l border-border pl-1 gap-1">
                            <button
                              onClick={goToPrevMatch}
                              className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
                              title="Previous Match (Shift+Enter)"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <path d="M7.707 5.293a1 1 0 0 1 1.414 0l4 4a1 1 0 0 1-1.414 1.414L8 7.414l-3.707 3.707a1 1 0 0 1-1.414-1.414l4-4z" />
                              </svg>
                            </button>
                            <button
                              onClick={goToNextMatch}
                              className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors"
                              title="Next Match (Enter)"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <path d="M7.707 10.707a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L8 8.586l-3.707-3.707a1 1 0 0 0-1.414 1.414l4 4z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setIsSearchOpen(false)}
                              className="p-1 hover:bg-accent hover:text-accent-foreground rounded-sm text-muted-foreground transition-colors ml-1"
                              title="Close (Esc)"
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                              >
                                <path d="M1.293 1.293a1 1 0 0 1 1.414 0L8 6.586l5.293-5.293a1 1 0 1 1 1.414 1.414L9.414 8l5.293 5.293a1 1 0 0 1-1.414 1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L8 9.414l-5.293 5.293a1 1 0 0 1-1.414-1.414L6.586 8 1.293 2.707a1 1 0 0 1 0-1.414z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div
                      ref={containerRef}
                      className="w-full h-full overflow-hidden relative min-w-0"
                    >
                      <div
                        className="absolute inset-0"
                        ref={graphContainerRef}
                      />
                      {(isGeneratingView || isPending) && (
                        <div className="absolute inset-0 z-[100] bg-background/50 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                          <Loader2 className="h-10 w-10 animate-spin text-primary" />
                          <span className="text-sm font-medium text-muted-foreground animate-pulse">
                            Generating graph view...
                          </span>
                        </div>
                      )}
                      {/* Zoom Slider */}
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-[110]">
                        <MemoizedViewportZoomSlider
                          onChange={handleZoomChange}
                        />
                      </div>
                    </div>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
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
                    projectPath={projectPath}
                    content={sourceContent}
                    selectedNodeId={selectedId}
                    markers={sourceMarkers}
                    fileErrors={fileErrors}
                    resolveErrors={resolveErrors}
                    isOpen={isBottomPanelOpen}
                    onSelectNode={handleSelectNode}
                    onOpenFile={handleOpenCurrentFile}
                    onClose={() => setBottomPanelOpen(false)}
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
            {(selectedId || selectedEdgeId) && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel id="sidebar" minSize="15%" maxSize="50%">
                  <RightSidebar
                    selectedId={selectedId}
                    selectedItemType={selectedItemType}
                    selectedEdge={selectedEdge}
                    graph={graph}
                    typeData={typeData}
                    projectPath={projectPath}
                    onClose={handleClose}
                    onSelect={handleSelectNode}
                    renderNodes={renderNodes}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

const MemoizedProjectSidebar = React.memo(ProjectSidebar);
const MemoizedViewportZoomSlider = React.memo(function ViewportZoomSlider({
  onChange,
}: {
  onChange: (zoom: number) => void;
}) {
  const zoom = useViewportUiStore((s) => s.zoom);
  const zoomRange = useViewportUiStore((s) => s.zoomRange);

  return (
    <ZoomSlider
      value={zoom}
      min={zoomRange.min}
      max={zoomRange.max}
      onChange={onChange}
    />
  );
});

export default ComponentGraph;
