import fs from "fs";
declare const __non_webpack_require__: typeof require;
import path from "path";
import { performance } from "node:perf_hooks";
import { type GraphViewResult, type Extension } from "@nexiq/extension-sdk";
import { getTaskData } from "@nexiq/extension-sdk";
import { type GraphViewType, type UIStateMap } from "@nexiq/shared";

import {
  getTasksForView,
  registerTask,
  serializeRegistry,
} from "../src/views/registry";
import { openUnifiedDatabase, readUIState } from "./graph-snapshot-db";
import type { GraphSnapshotData } from "../src/graph-snapshot/types";
import type {
  GenerateViewRequest,
  SerializedViewRegistry,
  TaskContext,
  ViewGenerationStage,
} from "../src/views/types";

interface GenerateGraphViewOptions extends GenerateViewRequest {
  sqlitePath?: string;
  snapshotData?: GraphSnapshotData;
}

export interface GenerateGraphViewResult {
  result: GraphViewResult;
  stages: ViewGenerationStage[];
  nodeDataBuffer?: SharedArrayBuffer;
  detailBuffer?: SharedArrayBuffer;
  bufferBytesWritten?: number;
}

const loadedExtensionState = new Map<
  string,
  {
    configMtimeMs: number;
    extensionNames: string[];
  }
>();

function applyUiState(
  uiState: UIStateMap,
  result: GraphViewResult,
): GraphViewResult {
  // Optimization: Return original if no UI state
  if (!uiState || Object.keys(uiState).length === 0) {
    return result;
  }

  return {
    ...result,
    nodes: result.nodes.map((node) => {
      const state = uiState[node.id];
      if (!state) return node;

      // For nodes, we prioritize appearanceOverride, then semantic radius,
      // and we generally want to ignore saved UI radius to avoid "stale oversized" issues
      // unless we explicitly want to support manual resizing in the future.
      const appliedState = { ...state };
      if (node.appearanceOverride) {
        // If we have an override, we definitely don't want the saved radius
        delete appliedState.radius;
      }

      // Special case: ALWAYS ignore saved radius for nodes to ensure semantic sizing wins
      // unless it's an explicit override (which is handled above).
      delete appliedState.radius;

      return {
        ...node,
        ...appliedState,
        ui: { ...(node.ui || {}), ...state },
      };
    }),
    combos: result.combos.map((combo) => {
      const state = uiState[combo.id];
      if (!state) return combo;

      // For combos, appearanceOverride wins over saved state
      const finalAppliedState = { ...state };
      const override = combo.appearanceOverride;

      if (override) {
        if (override.radius != null || override.collapsedRadius != null)
          delete finalAppliedState.radius;
        if (override.collapsedRadius != null)
          delete finalAppliedState.collapsedRadius;
        if (override.expandedRadius != null)
          delete finalAppliedState.expandedRadius;
      }

      return {
        ...combo,
        ...finalAppliedState,
        ui: { ...(combo.ui || {}), ...state },
      };
    }),
  };
}

async function loadProjectExtensions(projectRoot: string) {
  const startedAt = performance.now();
  // Try to dynamically load extensions
  try {
    const configPath = path.join(projectRoot, ".nexiq/config.json");
    if (fs.existsSync(configPath)) {
      const configStat = fs.statSync(configPath);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const extensionNames = Array.isArray(config.extensions)
        ? [...config.extensions].sort()
        : [];
      const cacheKey = projectRoot;
      const cached = loadedExtensionState.get(cacheKey);
      if (
        cached &&
        cached.configMtimeMs === configStat.mtimeMs &&
        cached.extensionNames.length === extensionNames.length &&
        cached.extensionNames.every(
          (name, index) => name === extensionNames[index],
        )
      ) {
        return {
          startMs: 0,
          endMs: performance.now() - startedAt,
          detail: `${extensionNames.length} cached`,
        };
      }
      for (const name of extensionNames) {
        try {
          let resolvedPath = name;
          if (name.startsWith(".")) {
            resolvedPath = path.resolve(projectRoot, name);
          } else {
            try {
              resolvedPath =
                typeof __non_webpack_require__ !== "undefined"
                  ? __non_webpack_require__.resolve(name, {
                      paths: [projectRoot],
                    })
                  : require.resolve(name, { paths: [projectRoot] });
            } catch {
              resolvedPath = name;
            }
          }
          const extension: Extension = name.endsWith(".node")
            ? typeof __non_webpack_require__ !== "undefined"
              ? __non_webpack_require__(resolvedPath)
              : // eslint-disable-next-line @typescript-eslint/no-require-imports
                require(resolvedPath)
            : await import(resolvedPath).then((m) => m.default || m);

          if (extension?.viewTasks) {
            for (const [vType, tasks] of Object.entries(extension.viewTasks)) {
              for (const task of tasks) {
                registerTask(vType as GraphViewType, task);
              }
            }
          }
        } catch (err) {
          console.error(`Failed to load extension ${name}:`, err);
        }
      }
      loadedExtensionState.set(cacheKey, {
        configMtimeMs: configStat.mtimeMs,
        extensionNames,
      });
      return {
        startMs: 0,
        endMs: performance.now() - startedAt,
        detail: `${extensionNames.length} loaded`,
      };
    }
  } catch (err) {
    console.error("Failed to parse extensions config:", err);
  }
  return {
    startMs: 0,
    endMs: performance.now() - startedAt,
    detail: "0 configured",
  };
}

export async function generateGraphView(
  options: GenerateGraphViewOptions,
): Promise<GenerateGraphViewResult> {
  const {
    sqlitePath,
    snapshotData,
    view: viewType,
    projectRoot,
    analysisPaths,
  } = options;

  const stages: ViewGenerationStage[] = [];
  const extensionLoad = await loadProjectExtensions(projectRoot);
  stages.push({
    id: "view:extensions",
    name: "Load project extensions",
    startMs: extensionLoad.startMs,
    endMs: extensionLoad.endMs,
    parentId: "worker:view-compute",
    detail: extensionLoad.detail,
  });

  let result: GraphViewResult = {
    nodes: [],
    edges: [],
    combos: [],
    typeData: {},
  };

  const tasks = getTasksForView(viewType);

  const db = sqlitePath
    ? openUnifiedDatabase(sqlitePath, analysisPaths)
    : undefined;

  try {
    const detailBuffer = new SharedArrayBuffer(10 * 1024 * 1024); // 10MB for details
    const nodeDataBuffer = new SharedArrayBuffer(10 * 1024 * 1024); // 10MB for nodes/edges

    const context: TaskContext = {
      db: db,
      projectRoot,
      analysisPaths,
      viewType,
      snapshotData,
      detailBuffer,
      nodeDataBuffer,
    };
    (
      context as TaskContext & { taskDataCache?: GraphSnapshotData | undefined }
    ).taskDataCache = snapshotData;

    let cursorMs = extensionLoad.endMs;
    if (db && !snapshotData) {
      const aggregateStartedAt = performance.now();
      const taskData = getTaskData(context);
      const durationMs = performance.now() - aggregateStartedAt;
      stages.push({
        id: "view:aggregate-task-data",
        name: "Aggregate task data",
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
        parentId: "worker:view-compute",
        detail: `${taskData.files.length} files, ${taskData.symbols.length} symbols`,
      });
      cursorMs += durationMs;
    }

    for (const task of tasks) {
      const taskStartedAt = performance.now();
      try {
        let bufferBytesWritten: number | void;
        if (task.runBuffer) {
          bufferBytesWritten = task.runBuffer(nodeDataBuffer, detailBuffer, context);
          if (typeof bufferBytesWritten === "number" && bufferBytesWritten > 0) {
            (result as any).bufferBytesWritten = ((result as any).bufferBytesWritten || 0) + bufferBytesWritten;
          }
        } else if (task.run) {
          result = task.run(result, context);
        }

        const durationMs = performance.now() - taskStartedAt;
        stages.push({
          id: `view:task:${task.id}`,
          name: `Task: ${task.id}`,
          startMs: cursorMs,
          endMs: cursorMs + durationMs,
          parentId: "worker:view-compute",
        });
        cursorMs += durationMs;
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
        const durationMs = performance.now() - taskStartedAt;
        stages.push({
          id: `view:task:${task.id}`,
          name: `Task: ${task.id}`,
          startMs: cursorMs,
          endMs: cursorMs + durationMs,
          parentId: "worker:view-compute",
          detail: "failed",
        });
        cursorMs += durationMs;
      }
    }

    const uiStateStartedAt = performance.now();
    const uiState =
      (snapshotData?.uiState && typeof snapshotData.uiState === "object"
        ? (snapshotData.uiState as UIStateMap)
        : undefined) || (db ? readUIState(db) : {});

    const finalResult = applyUiState(uiState, result);
    const uiStateDurationMs = performance.now() - uiStateStartedAt;
    stages.push({
      id: "view:apply-ui-state",
      name: "Apply UI state",
      startMs: cursorMs,
      endMs: cursorMs + uiStateDurationMs,
      parentId: "worker:view-compute",
      detail: `${Object.keys(uiState || {}).length} entries`,
    });

    return {
      result: finalResult,
      stages,
      nodeDataBuffer,
      detailBuffer,
      bufferBytesWritten: (result as any).bufferBytesWritten,
    };
  } finally {
    if (db) db.close();
  }
}

export function getSerializedViewRegistry(): SerializedViewRegistry {
  return serializeRegistry();
}
