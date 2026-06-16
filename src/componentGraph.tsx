import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import useGraph, { GraphCombo } from "./graph/hook";
import { PixiRenderer } from "./graph/pixiRenderer";
import { ProjectSidebar } from "./components/Sidebar";
import { debounce } from "@/lib/utils";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";

import { setupAutoSave, useAppStateStore } from "./hooks/use-app-state-store";
import { useGraphStore } from "./hooks/use-graph-store";
import { useGitStore } from "./hooks/useGitStore";
import { useConfigStore } from "./hooks/use-config-store";
import { useWorkerStore } from "./hooks/use-worker-store";
import { useViewportUiStore } from "./hooks/use-viewport-ui-store";
import { useGraphProfilerStore } from "./hooks/use-graph-profiler-store";
import { extractUIState } from "./graph/utils/ui-state";
import type { GenerateViewRequest } from "./views/types";
import {
  getGraphSnapshotKey,
  getLargeDataHandle,
  openViewResultSnapshot,
  readViewResultData,
  refreshGraphSnapshot,
  refreshLargeData,
  subscribeGraphSnapshot,
} from "./graph-snapshot/client";
import type { GraphViewBufferView } from "./view-snapshot/codec";

import {
  GraphContextMenu,
  type GraphContextMenuHandle,
} from "./components/GraphContextMenu";
import GraphOverlay from "./components/graph-overlay";
import { useHotkey } from "@tanstack/react-hotkeys";
import GraphPanel from "./components/panel";

interface ComponentGraphProps {
  projectPath: string;
  subProject?: string;
}

const ComponentGraph = ({ projectPath, subProject }: ComponentGraphProps) => {
  const selectedSubProjects = useAppStateStore((s) => s.selectedSubProjects);
  const selectedId = useAppStateStore((s) => s.selectedId);
  const setSelectedId = useAppStateStore((s) => s.setSelectedId);
  const setSelectedEdgeId = useAppStateStore((s) => s.setSelectedEdgeId);
  const centeredItemId = useAppStateStore((s) => s.centeredItemId);
  const setCenteredItemId = useAppStateStore((s) => s.setCenteredItemId);
  const isSidebarOpen = useAppStateStore((s) => s.isSidebarOpen);
  const setIsSidebarOpen = useAppStateStore((s) => s.setIsSidebarOpen);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);
  const gitComparisonEnabled = useAppStateStore((s) => s.gitComparisonEnabled);
  const setGitComparisonEnabled = useAppStateStore(
    (s) => s.setGitComparisonEnabled,
  );
  const loadState = useAppStateStore((s) => s.loadState);
  const resetState = useAppStateStore((s) => s.reset);
  const isLoaded = useAppStateStore((s) => s.isLoaded);
  const view = useAppStateStore((s) => s.view);

  const setViewport = useAppStateStore((s) => s.setViewport);

  const searchIsOpen = useAppStateStore((s) => s.search.isOpen);

  const details = useGraphStore((s) => s.details);
  const setfileErrors = useGraphStore((s) => s.setFileErrors);
  const setResolveErrors = useGraphStore((s) => s.setResolveErrors);
  const setTotalErrorCount = useGraphStore((s) => s.setTotalErrorCount);

  const clearAnalyzedDiffCache = useGitStore((s) => s.clearAnalyzedDiffCache);

  const setBackendAvailable = useWorkerStore((s) => s.setBackendAvailable);

  const [isGeneratingView, setIsGeneratingView] = useState(false);
  const [isPending, startTransition] = useTransition();

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

  const graphContextMenuRef = useRef<GraphContextMenuHandle>(null);
  const rendererRef = useRef<PixiRenderer | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [activeProfileRunId, setActiveProfileRunId] = useState<string | null>(
    null,
  );

  const graphContainerRef = useRef<HTMLDivElement>(null);
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
        setfileErrors(result.fileErrors);
        setResolveErrors(result.resolveErrors);
        setTotalErrorCount(
          result.fileErrors.length + result.resolveErrors.length,
        );
      })
      .catch((error) => {
        console.error("Failed to load analysis errors", error);
      });
  }, [
    projectPath,
    selectedSubProjects,
    isAnalyzing,
    graphViewBuffer,
    setfileErrors,
    setResolveErrors,
    setTotalErrorCount,
  ]);

  // Use useEffect to update renderer theme when customColors or theme changes
  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setCustomColors(customColors || {});
      rendererRef.current.setTheme(theme);
    }
  }, [customColors, theme]);

  useEffect(() => {
    const unsubscribe = setupAutoSave(projectPath);
    return () => unsubscribe();
  }, [projectPath]);

  const snapshotKeyRef = useRef<string | null>(null);
  const viewRequestIdRef = useRef(0);
  const activeProfileRunIdRef = useRef<string | null>(null);

  const graph = useGraph({
    viewBuffer: graphViewBuffer,
    projectPath,
    targetPath: selectedSubProjects[0] || projectPath,
  });

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
        gitComparisonEnabled,
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
        const resolvedAnalysisPath =
          targetPath === projectPath ? undefined : targetPath;
        const snapshotKey = getGraphSnapshotKey(
          projectPath,
          resolvedAnalysisPath,
          selectedSubProjects,
        );
        snapshotKeyRef.current = snapshotKey;

        const request: GenerateViewRequest = {
          view,
          projectRoot: projectPath,
          analysisPath: selectedCommit ? undefined : resolvedAnalysisPath,
          analysisPaths: selectedCommit ? undefined : selectedSubProjects,
          selectedCommit: selectedCommit ?? null,
          subProject: subPath,
          subPath,
          refreshHandle: options?.refreshHandle,
          profilerRunId,
          profilerLogicalKey: logicalKey,
          gitComparisonEnabled,
        };
        const resultHandle = options?.refreshHandle
          ? await (async () => {
              await refreshLargeData("view-result", request);
              return window.largeData.getHandle("view-result", request);
            })()
          : await openViewResultSnapshot(request);
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

        setGraphViewBuffer(result);

        // Fetch and apply UI state after graph buffer is set
        window.ipcRenderer
          .invoke("get-graph-position", projectPath, view)
          .then((uiState) => {
            if (uiState && Object.keys(uiState).length > 0) {
              graph.applyUIState(uiState);
            }
          });

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
      gitComparisonEnabled,
      subPath,
      view,
      graph,
    ],
  );

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

  useEffect(() => {
    window.nexiqGraph = graph;
  }, [graph]);

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
    if (!searchIsOpen) {
      resetHighlights();
    }
  }, [searchIsOpen, resetHighlights]);

  useEffect(() => {
    const savePositions = debounce(() => {
      const positions = extractUIState(graph);

      if (Object.keys(positions).length > 0) {
        window.ipcRenderer.invoke(
          "update-graph-position",
          projectPath,
          view,
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
  }, [graph, projectPath, selectedSubProjects, view]);

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
        (id, x, y) => {
          graphContextMenuRef.current?.open(id, x, y);
        },
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
        theme,
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
    theme,
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
    if (!isLoaded) return;
    startTransition(() => {
      loadData();
    });
  }, [selectedSubProjects, selectedCommit, isLoaded, loadData]);

  useEffect(() => {
    const unsubscribe = subscribeGraphSnapshot((payload) => {
      if (selectedCommit) return;

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
  }, [loadData, projectPath, selectedCommit, selectedSubProjects]);

  useHotkey("Control+L", () => {
    const focusedId = graph.getFocusedId();
    if (focusedId) {
      const item = graph.getPointByID(focusedId);
      if (item instanceof GraphCombo) {
        graph.layout(true, focusedId);
      } else if (item?.parent) {
        graph.layout(true, item.parent.id);
      } else {
        graph.layout(true);
      }
    } else if (selectedId) {
      const item = graph.getPointByID(selectedId);
      if (item instanceof GraphCombo) {
        graph.layout(true, selectedId);
      } else if (item?.parent) {
        graph.layout(true, item.parent.id);
      } else {
        graph.layout(true);
      }
    } else {
      graph.layout(true);
    }
  });

  useHotkey("Control+B", () => {
    setIsSidebarOpen(!isSidebarOpen);
  });

  useHotkey("Control+Shift+G", () => {
    setGitComparisonEnabled(!gitComparisonEnabled);
  });

  const isMac =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const modLabel = isMac ? "⌘" : "Ctrl";

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
      // Ensure handle is open before refresh to avoid "No snapshot worker" error
      await getLargeDataHandle("graph", {
        projectRoot: projectPath,
        analysisPath: targetPath === projectPath ? undefined : targetPath,
      });
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

  const handleLocateFile = useCallback(
    (filePath: string) => {
      const nodes = graph.getAllNodes();
      const combos = graph.getAllCombos();

      const match =
        combos.find(
          (c) => (details[c.id]?.fileName || c.pureFileName) === filePath,
        ) ||
        nodes.find((n) =>
          (details[n.id]?.fileName || n.fileName)?.startsWith(filePath),
        );

      if (match) {
        onSelect(match.id);
      }
    },
    [graph, onSelect, details],
  );

  return (
    <div className="w-screen h-screen relative bg-background overflow-hidden">
      <SidebarProvider open={isSidebarOpen} onOpenChange={setIsSidebarOpen}>
        <MemoizedProjectSidebar
          currentPath={selectedSubProjects[0] || projectPath}
          projectRoot={projectPath}
          onLocateFile={handleLocateFile}
          onSelectNode={(id: string) => {
            onSelect(id, true, true);
          }}
          isLoading={isAnalyzing}
          graphViewBuffer={graphViewBuffer}
        />
        <SidebarInset className="min-w-0">
          <GraphPanel onSelect={onSelect}>
            <GraphOverlay
              setSize={setSize}
              handleReloadProject={handleReloadProject}
              rendererRef={rendererRef}
              isPending={isPending}
            >
              <GraphContextMenu
                ref={graphContextMenuRef}
                rendererRef={rendererRef}
                modLabel={modLabel}
              >
                <div className="absolute inset-0" ref={graphContainerRef} />
              </GraphContextMenu>
            </GraphOverlay>
          </GraphPanel>
        </SidebarInset>
      </SidebarProvider>
    </div>
  );
};

const MemoizedProjectSidebar = React.memo(ProjectSidebar);

export default ComponentGraph;
