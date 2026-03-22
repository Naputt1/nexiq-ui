import fs from "fs";
declare const __non_webpack_require__: typeof require;
import path from "path";
import Database from "better-sqlite3";
import { UISqliteDB } from "./ui-sqlite-db";
import { type GraphViewResult, type Extension } from "@nexiq/extension-sdk";
import { type GraphViewType } from "@nexiq/shared";
import { getTasksForView, registerTask } from "../src/views/registry";

export async function generateGraphView(
  sqlitePath: string,
  viewType: "component" | "file" | "router",
  projectRoot: string,
): Promise<GraphViewResult> {
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

  let db: Database.Database | null = null;
  try {
    db = new Database(sqlitePath);
    const uiDb = new UISqliteDB(db);
    const data = uiDb.getAllData();

    let result: GraphViewResult = {
      nodes: [],
      edges: [],
      combos: [],
      typeData: {},
    };

    const tasks = getTasksForView(viewType);
    const BATCH_SIZE = 100;

    // Process entities in batches
    for (let i = 0; i < data.entities.length; i += BATCH_SIZE) {
      const entityBatch = data.entities.slice(i, i + BATCH_SIZE);
      const symbolBatch = data.symbols.filter((s) =>
        entityBatch.some((e) => e.id === s.entity_id)
      );
      const renderBatch = data.renders.filter((r) =>
        entityBatch.some((e) => e.id === r.parent_entity_id)
      );

      const batch = {
        entities: entityBatch,
        symbols: symbolBatch,
        renders: renderBatch,
        scopes: data.scopes.filter(
          (s) =>
            entityBatch.some((e) => e.scope_id === s.id) ||
            entityBatch.some((e) => e.id === s.entity_id)
        ),
        relations: data.relations.filter((r) =>
          symbolBatch.some((s) => s.id === r.from_id || s.id === r.to_id)
        ),
      };

      for (const task of tasks) {
        try {
          result = task.run(data, result, batch);
        } catch (err) {
          console.error(`Task "${task.id}" failed:`, err);
        }
      }
    }

    // Apply stored UI state (positions, etc.)
    const uiState = uiDb.getUIState();

    result.nodes = result.nodes.map((n) => {
      const state = uiState[n.id];
      if (state) {
        return { ...n, ...state, ui: { ...(n.ui || {}), ...state } };
      }
      return n;
    });

    result.combos = result.combos.map((c) => {
      const state = uiState[c.id];
      if (state) {
        return { ...c, ...state, ui: { ...(c.ui || {}), ...state } };
      }
      return c;
    });

    return result;
  } finally {
    if (db) db.close();
  }
}
