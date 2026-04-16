import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import * as flatbuffers from "flatbuffers";
import {
  type GraphViewResult,
  type Extension,
  initOutputTables,
  type OutEdge,
  type OutCombo,
  type OutDetail,
} from "@nexiq/extension-sdk";
import { type OutNode } from "@nexiq/extension-sdk";
import { FlatBuffers as FB } from "@nexiq/shared";
import { type GraphViewType } from "@nexiq/shared";

import {
  getTasksForView,
  registerTask,
  serializeRegistry,
} from "../src/views/registry";
import type { GraphSnapshotData } from "../src/graph-snapshot/types";
import type {
  GenerateViewRequest,
  GraphViewTask,
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
                registerTask(vType as GraphViewType, task, resolvedPath);
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

/**
 * Run a task's runSqlite function directly against the shared in-memory database.
 * This avoids spawning a worker and eliminates serialize/deserialize round-trips
 * between tasks, so all tasks share the same mutable Database instance.
 */
async function runTaskInProcess(
  task: GraphViewTask,
  db: Database.Database,
  projectRoot: string,
  analysisPaths: string[] | undefined,
  viewType: GraphViewType,
  cacheDbPath?: string,
): Promise<void> {
  if (!task.runSqlite) {
    throw new Error(`Task ${task.id} does not implement runSqlite`);
  }
  const context: TaskContext = {
    db,
    projectRoot,
    analysisPaths,
    viewType,
    cacheDbPath,
  };
  const resultBuf = await task.runSqlite(context);

  if (resultBuf && resultBuf instanceof Uint8Array) {
    // If a task (e.g. native Rust) returns a Buffer containing its outputs,
    // we must merge its output tables into the shared js database instance.
    const rustDb = new Database(Buffer.from(resultBuf));

    // Nodes
    const outNodes = rustDb
      .prepare<[], OutNode>("SELECT * FROM out_nodes")
      .all();
    const insNode = db.prepare(
      "INSERT OR REPLACE INTO out_nodes (id, name, type, combo_id, color, radius, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const d of outNodes)
      insNode.run(
        d.id,
        d.name,
        d.type,
        d.combo_id,
        d.color,
        d.radius,
        d.display_name,
        d.git_status,
        d.meta_json,
      );

    // Edges
    const outEdges = rustDb
      .prepare<[], OutEdge>("SELECT * FROM out_edges")
      .all();
    const insEdge = db.prepare(
      "INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const d of outEdges)
      insEdge.run(
        d.id,
        d.source,
        d.target,
        d.name,
        d.kind,
        d.category,
        d.meta_json,
      );

    // Combos
    const outCombos = rustDb
      .prepare<[], OutCombo>("SELECT * FROM out_combos")
      .all();
    const insCombo = db.prepare(
      "INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const d of outCombos)
      insCombo.run(
        d.id,
        d.name,
        d.type,
        d.parent_id,
        d.color,
        d.radius,
        d.collapsed,
        d.display_name,
        d.git_status,
        d.meta_json,
      );

    // Details
    const outDetails = rustDb
      .prepare<[], OutDetail>("SELECT * FROM out_details")
      .all();
    const insDetail = db.prepare(
      'INSERT OR REPLACE INTO out_details (id, file_name, project_path, line, "column", data_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const d of outDetails)
      insDetail.run(
        d.id,
        d.file_name,
        d.project_path,
        d.line,
        d.column,
        d.data_json,
      );
  }
}

function mapItemTypeToEnum(type: string | undefined): number {
  switch (type?.toLowerCase()) {
    case "package":
      return 0;
    case "scope":
      return 1;
    case "component":
    case "function":
    case "class":
      return 2;
    case "hook":
      return 3;
    case "state":
      return 4;
    case "memo":
      return 5;
    case "callback":
      return 6;
    case "ref":
      return 7;
    case "effect":
      return 8;
    case "prop":
      return 9;
    case "render":
      return 10;
    case "render-group":
      return 11;
    case "source-group":
      return 12;
    case "path-group":
      return 13;
    case undefined:
    default:
      return 1; // Default to scope for unknown
  }
}

function convertSqliteToFlatBuffers(db: Database.Database): {
  nodeDataBuffer: SharedArrayBuffer;
  detailBuffer: SharedArrayBuffer;
  bytesWritten: number;
} {
  const nodes = db.prepare<[], OutNode>("SELECT * FROM out_nodes").all();
  const edges = db.prepare<[], OutEdge>("SELECT * FROM out_edges").all();
  const combos = db.prepare<[], OutCombo>("SELECT * FROM out_combos").all();
  const details = db.prepare<[], OutDetail>("SELECT * FROM out_details").all();

  const builder = new flatbuffers.Builder(10 * 1024 * 1024);

  const nodeOffsets = nodes.map((n) => {
    const id = builder.createString(n.id);
    const name = builder.createString(n.name);
    const type = mapItemTypeToEnum(n.type);
    const comboId = n.combo_id ? builder.createString(n.combo_id) : 0;
    const color = n.color ? builder.createString(n.color) : 0;
    const displayName = n.display_name
      ? builder.createString(n.display_name)
      : 0;
    const gitStatus = n.git_status ? builder.createString(n.git_status) : 0;

    FB.GraphNode.startGraphNode(builder);
    FB.GraphNode.addId(builder, id);
    FB.GraphNode.addName(builder, name);
    FB.GraphNode.addType(builder, type);
    FB.GraphNode.addComboId(builder, comboId);
    FB.GraphNode.addColor(builder, color);
    FB.GraphNode.addRadius(builder, n.radius || 0);
    FB.GraphNode.addDisplayName(builder, displayName);
    FB.GraphNode.addGitStatus(builder, gitStatus);
    return FB.GraphNode.endGraphNode(builder);
  });

  const edgeOffsets = edges.map((e) => {
    const id = builder.createString(e.id);
    const source = builder.createString(e.source);
    const target = builder.createString(e.target);
    const name = builder.createString(e.name);
    const kind = builder.createString(e.kind);
    const category = builder.createString(e.category);

    FB.GraphEdge.startGraphEdge(builder);
    FB.GraphEdge.addId(builder, id);
    FB.GraphEdge.addSource(builder, source);
    FB.GraphEdge.addTarget(builder, target);
    FB.GraphEdge.addName(builder, name);
    FB.GraphEdge.addKind(builder, kind);
    FB.GraphEdge.addCategory(builder, category);
    return FB.GraphEdge.endGraphEdge(builder);
  });

  const comboOffsets = combos.map((c) => {
    const id = builder.createString(c.id);
    const name = builder.createString(c.name);
    const type = mapItemTypeToEnum(c.type);
    const parentId = c.parent_id ? builder.createString(c.parent_id) : 0;
    const color = c.color ? builder.createString(c.color) : 0;
    const displayName = c.display_name
      ? builder.createString(c.display_name)
      : 0;
    const gitStatus = c.git_status ? builder.createString(c.git_status) : 0;

    FB.GraphCombo.startGraphCombo(builder);
    FB.GraphCombo.addId(builder, id);
    FB.GraphCombo.addName(builder, name);
    FB.GraphCombo.addType(builder, type);
    FB.GraphCombo.addParentId(builder, parentId);
    FB.GraphCombo.addColor(builder, color);
    FB.GraphCombo.addRadius(builder, c.radius || 0);
    FB.GraphCombo.addCollapsed(builder, !!c.collapsed);
    FB.GraphCombo.addDisplayName(builder, displayName);
    FB.GraphCombo.addGitStatus(builder, gitStatus);
    return FB.GraphCombo.endGraphCombo(builder);
  });

  const detailOffsets = details.map((d) => {
    const id = builder.createString(d.id);
    const fileName = d.file_name ? builder.createString(d.file_name) : 0;
    const projectPath = d.project_path
      ? builder.createString(d.project_path)
      : 0;
    const dataJson = d.data_json ? builder.createString(d.data_json) : 0;

    FB.Loc.startLoc(builder);
    FB.Loc.addLine(builder, d.line || 0);
    FB.Loc.addColumn(builder, d.column || 0);
    const loc = FB.Loc.endLoc(builder);

    FB.GraphNodeDetail.startGraphNodeDetail(builder);
    FB.GraphNodeDetail.addId(builder, id);
    FB.GraphNodeDetail.addFileName(builder, fileName);
    FB.GraphNodeDetail.addProjectPath(builder, projectPath);
    FB.GraphNodeDetail.addLoc(builder, loc);
    FB.GraphNodeDetail.addDataJson(builder, dataJson);
    return FB.GraphNodeDetail.endGraphNodeDetail(builder);
  });

  const nodesVec = FB.GraphView.createNodesVector(builder, nodeOffsets);
  const edgesVec = FB.GraphView.createEdgesVector(builder, edgeOffsets);
  const combosVec = FB.GraphView.createCombosVector(builder, comboOffsets);
  const detailsVec = FB.GraphView.createDetailsVector(builder, detailOffsets);

  FB.GraphView.startGraphView(builder);
  FB.GraphView.addNodes(builder, nodesVec);
  FB.GraphView.addEdges(builder, edgesVec);
  FB.GraphView.addCombos(builder, combosVec);
  FB.GraphView.addDetails(builder, detailsVec);
  const root = FB.GraphView.endGraphView(builder);
  FB.GraphView.finishGraphViewBuffer(builder, root);

  const flatBufferData = builder.asUint8Array();
  const nodeDataBuffer = new SharedArrayBuffer(flatBufferData.length);
  new Uint8Array(nodeDataBuffer).set(flatBufferData);

  return {
    nodeDataBuffer,
    detailBuffer: new SharedArrayBuffer(0), // Details are included in GraphView now
    bytesWritten: flatBufferData.length,
  };
}

export async function generateGraphView(
  options: GenerateGraphViewOptions,
): Promise<GenerateGraphViewResult> {
  const { sqlitePath, view: viewType, projectRoot, analysisPaths } = options;

  const stages: ViewGenerationStage[] = [];
  const extensionLoad = await loadProjectExtensions(projectRoot);
  stages.push({
    id: "view:extensions",
    name: "Load project extensions",
    startMs: 0,
    endMs: extensionLoad.endMs,
    parentId: "worker:view-compute",
    detail: extensionLoad.detail,
  });

  const tasks = getTasksForView(viewType);

  if (!sqlitePath) {
    throw new Error("SQLite database is required for graph view generation");
  }

  // 1. Create a pristine in-memory destination database for output.
  const db = new Database(":memory:");

  // 2. Attach the source database read-only to avoid memory buffering.
  // Using runtime import to ensure we have the node module even if bundled
  const nodePath = await import("node:path");
  const absolutePath = nodePath.isAbsolute(sqlitePath)
    ? sqlitePath
    : nodePath.resolve(process.cwd(), sqlitePath);

  db.prepare(`ATTACH DATABASE ? AS source`).run(absolutePath);

  // 3. Create TEMP views for all usable tables in `source` to alias them into the default namespace!
  // This allows legacy extensions which SELECT directly from a table name to work seamlessly.
  const schemaTables = db
    .prepare(
      "SELECT name FROM source.sqlite_master WHERE type IN ('table', 'view')",
    )
    .all() as { name: string }[];
  for (const row of schemaTables) {
    if (!row.name.startsWith("sqlite_") && !row.name.startsWith("out_")) {
      // Must quote names in case they have reserved words
      db.exec(
        `CREATE TEMP VIEW "${row.name}" AS SELECT * FROM source."${row.name}"`,
      );
    }
  }

  try {
    // Initialise the output tables once — all tasks write into this shared db.
    initOutputTables(db);

    let cursorMs = extensionLoad.endMs;

    for (const task of tasks) {
      const taskStartedAt = performance.now();
      try {
        if (task.runSqlite) {
          // Run in-process: all tasks share the same mutable in-memory db.
          // No worker round-trip or buffer serialisation between tasks.
          await runTaskInProcess(
            task,
            db,
            projectRoot,
            analysisPaths,
            viewType,
            absolutePath,
          );
        } else if (task.run) {
          // Legacy run() path — pass the live db via context.
          task.run(
            { nodes: [], edges: [], combos: [], typeData: {} },
            { db, projectRoot, analysisPaths, viewType },
          );
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
      }
    }

    const convStartedAt = performance.now();
    // The shared in-memory db already has all task output — convert it directly.
    const { nodeDataBuffer, detailBuffer, bytesWritten } =
      convertSqliteToFlatBuffers(db);
    const convDurationMs = performance.now() - convStartedAt;

    stages.push({
      id: "view:convert-to-flatbuffers",
      name: "Convert to FlatBuffers",
      startMs: cursorMs,
      endMs: cursorMs + convDurationMs,
      parentId: "worker:view-compute",
    });

    return {
      result: { nodes: [], edges: [], combos: [], typeData: {} }, // Mock result object as data is in buffers
      stages,
      nodeDataBuffer,
      detailBuffer,
      bufferBytesWritten: bytesWritten,
    };
  } finally {
    if (db) db.close();
  }
}

export function getSerializedViewRegistry(): SerializedViewRegistry {
  return serializeRegistry();
}
