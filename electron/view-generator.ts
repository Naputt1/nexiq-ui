import fs from "fs";
declare const __non_webpack_require__: typeof require;
import path from "path";
import { type GraphViewResult, type Extension } from "@nexiq/extension-sdk";
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
} from "../src/views/types";

interface GenerateGraphViewOptions extends GenerateViewRequest {
  sqlitePath?: string;
  snapshotData?: GraphSnapshotData;
}

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
      return { ...node, ...state, ui: { ...(node.ui || {}), ...state } };
    }),
    combos: result.combos.map((combo) => {
      const state = uiState[combo.id];
      if (!state) return combo;
      return { ...combo, ...state, ui: { ...(combo.ui || {}), ...state } };
    }),
  };
}

async function loadProjectExtensions(projectRoot: string) {
  // Try to dynamically load extensions
  try {
    const configPath = path.join(projectRoot, ".nexiq/config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const extensionNames = config.extensions || [];
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
          const extension: Extension = await import(resolvedPath).then(
            (m) => m.default || m,
          );
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
    }
  } catch (err) {
    console.error("Failed to parse extensions config:", err);
  }
}

export async function generateGraphView(
  options: GenerateGraphViewOptions,
): Promise<GraphViewResult> {
  const {
    sqlitePath,
    snapshotData,
    view: viewType,
    projectRoot,
    analysisPaths,
  } = options;

  await loadProjectExtensions(projectRoot);

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
    const context: TaskContext = {
      db: db,
      projectRoot,
      analysisPaths,
      viewType,
      snapshotData,
    };

    for (const task of tasks) {
      try {
        result = task.run(result, context);
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
      }
    }

    const uiState =
      (snapshotData?.uiState && typeof snapshotData.uiState === "object"
        ? (snapshotData.uiState as UIStateMap)
        : undefined) || (db ? readUIState(db) : {});

    return applyUiState(uiState, result);
  } finally {
    if (db) db.close();
  }
}

export function getSerializedViewRegistry(): SerializedViewRegistry {
  return serializeRegistry();
}
