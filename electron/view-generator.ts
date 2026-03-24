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
import { readGraphSnapshotFromSqlite } from "./graph-snapshot-db";
import type { GraphSnapshotData } from "../src/graph-snapshot/types";
import type {
  GenerateViewRequest,
  SerializedViewRegistry,
} from "../src/views/types";

interface GenerateGraphViewOptions extends GenerateViewRequest {
  sqlitePath?: string;
  snapshotData?: GraphSnapshotData;
}

function applyUiState(
  uiState: UIStateMap,
  result: GraphViewResult,
): GraphViewResult {
  return {
    ...result,
    nodes: result.nodes.map((node) => {
      const state = uiState[node.id];
      return state
        ? { ...node, ...state, ui: { ...(node.ui || {}), ...state } }
        : node;
    }),
    combos: result.combos.map((combo) => {
      const state = uiState[combo.id];
      return state
        ? { ...combo, ...state, ui: { ...(combo.ui || {}), ...state } }
        : combo;
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
  const { sqlitePath, snapshotData, view: viewType, projectRoot } = options;

  await loadProjectExtensions(projectRoot);

  if (snapshotData) {
    let result: GraphViewResult = {
      nodes: [],
      edges: [],
      combos: [],
      typeData: {},
    };

    const tasks = getTasksForView(viewType);
    for (const task of tasks) {
      try {
        result = task.run(snapshotData, result);
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
      }
    }

    const uiState =
      snapshotData.uiState && typeof snapshotData.uiState === "object"
        ? (snapshotData.uiState as UIStateMap)
        : {};

    return applyUiState(uiState, result);
  }

  if (!sqlitePath) {
    throw new Error("sqlitePath is required when snapshotData is not provided");
  }

  const sqliteSnapshotData = readGraphSnapshotFromSqlite(sqlitePath);

  let result: GraphViewResult = {
    nodes: [],
    edges: [],
    combos: [],
    typeData: {},
  };

  const tasks = getTasksForView(viewType);
  const BATCH_SIZE = 100;

  if (sqliteSnapshotData.entities.length === 0) {
    for (const task of tasks) {
      try {
        result = task.run(sqliteSnapshotData, result);
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
      }
    }
    return applyUiState(sqliteSnapshotData.uiState || {}, result);
  }

  // Process entities in batches
  for (let i = 0; i < sqliteSnapshotData.entities.length; i += BATCH_SIZE) {
    const entityBatch = sqliteSnapshotData.entities.slice(i, i + BATCH_SIZE);
    const symbolBatch = sqliteSnapshotData.symbols.filter((s) =>
      entityBatch.some((e) => e.id === s.entity_id),
    );
    const renderBatch = sqliteSnapshotData.renders.filter((r) =>
      entityBatch.some((e) => e.id === r.parent_entity_id),
    );

    const batch = {
      entities: entityBatch,
      symbols: symbolBatch,
      renders: renderBatch,
      scopes: sqliteSnapshotData.scopes.filter(
        (s) =>
          entityBatch.some((e) => e.scope_id === s.id) ||
          entityBatch.some((e) => e.id === s.entity_id),
      ),
      relations: sqliteSnapshotData.relations.filter((r) =>
        symbolBatch.some((s) => s.id === r.from_id || s.id === r.to_id),
      ),
    };

    for (const task of tasks) {
      try {
        result = task.run(sqliteSnapshotData, result, batch);
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
      }
    }
  }

  return applyUiState(sqliteSnapshotData.uiState || {}, result);
}

export function getSerializedViewRegistry(): SerializedViewRegistry {
  return serializeRegistry();
}
