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

  // Pre-index symbols and renders by entity_id for O(1) lookup
  const symbolsByEntityId = new Map<
    string,
    typeof sqliteSnapshotData.symbols
  >();
  for (const symbol of sqliteSnapshotData.symbols) {
    if (!symbolsByEntityId.has(symbol.entity_id)) {
      symbolsByEntityId.set(symbol.entity_id, []);
    }
    symbolsByEntityId.get(symbol.entity_id)!.push(symbol);
  }

  const rendersByEntityId = new Map<
    string,
    typeof sqliteSnapshotData.renders
  >();
  for (const render of sqliteSnapshotData.renders) {
    if (!rendersByEntityId.has(render.parent_entity_id)) {
      rendersByEntityId.set(render.parent_entity_id, []);
    }
    rendersByEntityId.get(render.parent_entity_id)!.push(render);
  }

  const scopesById = new Map<string, (typeof sqliteSnapshotData.scopes)[0]>();
  for (const scope of sqliteSnapshotData.scopes) {
    scopesById.set(scope.id, scope);
  }

  const scopesByEntityId = new Map<
    string,
    (typeof sqliteSnapshotData.scopes)[0]
  >();
  for (const scope of sqliteSnapshotData.scopes) {
    if (scope.entity_id) {
      scopesByEntityId.set(scope.entity_id, scope);
    }
  }

  // Process entities in batches
  for (let i = 0; i < sqliteSnapshotData.entities.length; i += BATCH_SIZE) {
    const entityBatch = sqliteSnapshotData.entities.slice(i, i + BATCH_SIZE);

    const symbolBatch: typeof sqliteSnapshotData.symbols = [];
    const renderBatch: typeof sqliteSnapshotData.renders = [];
    const scopeBatchSet = new Set<(typeof sqliteSnapshotData.scopes)[0]>();

    for (const entity of entityBatch) {
      const symbols = symbolsByEntityId.get(entity.id);
      if (symbols) symbolBatch.push(...symbols);

      const renders = rendersByEntityId.get(entity.id);
      if (renders) renderBatch.push(...renders);

      const scopeByEntity = scopesByEntityId.get(entity.id);
      if (scopeByEntity) scopeBatchSet.add(scopeByEntity);

      const scope = scopesById.get(entity.scope_id);
      if (scope) scopeBatchSet.add(scope);
    }

    const symbolIds = new Set(symbolBatch.map((s) => s.id));
    const relationBatch = sqliteSnapshotData.relations.filter(
      (r) => symbolIds.has(r.from_id) || symbolIds.has(r.to_id),
    );

    const batch = {
      entities: entityBatch,
      symbols: symbolBatch,
      renders: renderBatch,
      scopes: Array.from(scopeBatchSet),
      relations: relationBatch,
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
