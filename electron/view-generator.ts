import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import * as flatbuffers from "flatbuffers";
import tmp from "tmp";
import {
  type Extension,
  initOutputTables,
  type OutEdge,
  type OutCombo,
  type OutDetail,
} from "@nexiq/extension-sdk";
import { type OutNode } from "@nexiq/extension-sdk";
import { FlatBuffers as FB } from "@nexiq/shared";
import { type GraphViewType, type WorkspacePackageRow } from "@nexiq/shared";

import {
  getTasksForView,
  registerTask,
  serializeRegistry,
} from "../src/views/registry";
import type { GraphSnapshotData } from "../src/graph-snapshot/types";
import type {
  GenerateGraphViewResult,
  GenerateViewRequest,
  GraphViewTask,
  SerializedViewRegistry,
  TaskContext,
  ViewGenerationStage,
} from "../src/views/types";

/**
 * Standard analysis schema tables to be aggregated in memory.
 * Includes all columns to ensure compatibility with native tasks.
 */
function initDataTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT,
      path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      package_id TEXT,
      hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      default_export TEXT,
      star_exports_json TEXT
    );
    CREATE TABLE IF NOT EXISTS scopes (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL,
      parent_id TEXT,
      kind TEXT NOT NULL,
      entity_id TEXT,
      data_json TEXT
    );
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      type TEXT,
      line INTEGER,
      column INTEGER,
      end_line INTEGER,
      end_column INTEGER,
      declaration_kind TEXT,
      data_json TEXT
    );
    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT,
      is_alias BOOLEAN DEFAULT 0,
      has_default BOOLEAN DEFAULT 0,
      data_json TEXT
    );
    CREATE TABLE IF NOT EXISTS renders (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL,
      parent_entity_id TEXT NOT NULL,
      parent_render_id TEXT,
      render_index INTEGER NOT NULL,
      tag TEXT NOT NULL,
      symbol_id TEXT,
      line INTEGER,
      column INTEGER,
      kind TEXT NOT NULL,
      data_json TEXT
    );
    CREATE TABLE IF NOT EXISTS exports (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      symbol_id TEXT,
      entity_id TEXT,
      name TEXT,
      is_default BOOLEAN DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS relations (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER,
      column INTEGER,
      data_json TEXT,
      PRIMARY KEY (from_id, to_id, kind, line, column)
    );
  `);
}

/**
 * Aggregates distributed package SQLite data into the shared in-memory database
 * for monorepo projects. Prefixes IDs to avoid collisions.
 */
async function aggregateMonorepoData(
  db: Database.Database,
  projectRoot: string,
  analysisPaths?: string[],
) {
  const tableExists = (name: string) => {
    const row = db
      .prepare(
        "SELECT 1 FROM source.sqlite_master WHERE type='table' AND name=?",
      )
      .get(name);
    return !!row;
  };

  if (!tableExists("workspace_packages")) return;

  initDataTables(db);

  const workspacePackages = db
    .prepare<[], WorkspacePackageRow>("SELECT * FROM source.workspace_packages")
    .all();
  const filteredPackages =
    analysisPaths && analysisPaths.length > 0
      ? workspacePackages.filter((p) => analysisPaths.includes(p.path))
      : workspacePackages;

  for (let i = 0; i < filteredPackages.length; i++) {
    const pkg = filteredPackages[i];
    const offset = (i + 1) * 1000000;
    const pkgId = pkg.package_id;
    const prefix = `workspace:${pkgId}:`;

    const pkgDbPath = path.isAbsolute(pkg.db_path)
      ? pkg.db_path
      : path.resolve(projectRoot, pkg.db_path);

    if (!fs.existsSync(pkgDbPath)) {
      console.warn(`Package database not found at ${pkgDbPath}`);
      continue;
    }

    db.prepare(`ATTACH DATABASE ? AS pkg_${i}`).run(pkgDbPath);

    const pkgRelPath = pkg.path.replace(/^\/+/, "").replace(/\/+$/, "");

    try {
      // Merge tables with offset remapping and ID prefixing
      db.exec(`
        INSERT OR IGNORE INTO main.packages (id, name, version, path)
        SELECT '${pkgId}', name, version, path FROM pkg_${i}.packages;

        INSERT OR IGNORE INTO main.files (id, path, package_id, hash, fingerprint, default_export, star_exports_json)
        SELECT id + ${offset}, 
               '/${pkgRelPath}' || CASE WHEN path LIKE '/%' THEN path ELSE '/' || path END, 
               '${pkgId}', hash, fingerprint, default_export, star_exports_json FROM pkg_${i}.files;

        INSERT OR IGNORE INTO main.scopes (id, file_id, parent_id, kind, entity_id, data_json)
        SELECT '${prefix}' || id, file_id + ${offset}, 
               CASE WHEN parent_id IS NOT NULL THEN '${prefix}' || parent_id ELSE NULL END, 
               kind, 
               CASE WHEN entity_id IS NOT NULL THEN '${prefix}' || entity_id ELSE NULL END, 
               data_json FROM pkg_${i}.scopes;

        INSERT OR IGNORE INTO main.entities (id, scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json)
        SELECT '${prefix}' || id, '${prefix}' || scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json FROM pkg_${i}.entities;

        INSERT OR IGNORE INTO main.symbols (id, entity_id, scope_id, name, path, is_alias, has_default, data_json)
        SELECT '${prefix}' || id, '${prefix}' || entity_id, '${prefix}' || scope_id, name, path, is_alias, has_default, data_json FROM pkg_${i}.symbols;

        INSERT OR IGNORE INTO main.renders (id, file_id, parent_entity_id, parent_render_id, tag, symbol_id, line, column, kind, data_json)
        SELECT '${prefix}' || id, file_id + ${offset}, '${prefix}' || parent_entity_id, 
               CASE WHEN parent_render_id IS NOT NULL THEN '${prefix}' || parent_render_id ELSE NULL END, 
               tag, 
               CASE WHEN symbol_id IS NOT NULL THEN '${prefix}' || symbol_id ELSE NULL END, 
               line, column, kind, data_json FROM pkg_${i}.renders;

        INSERT OR IGNORE INTO main.exports (id, scope_id, symbol_id, entity_id, name, is_default)
        SELECT '${prefix}' || id, '${prefix}' || scope_id, 
               CASE WHEN symbol_id IS NOT NULL THEN '${prefix}' || symbol_id ELSE NULL END, 
               CASE WHEN entity_id IS NOT NULL THEN '${prefix}' || entity_id ELSE NULL END, 
               name, is_default FROM pkg_${i}.exports;

        INSERT OR IGNORE INTO main.relations (from_id, to_id, kind, line, column, data_json)
        SELECT CASE WHEN from_id LIKE 'symbol:%' OR from_id LIKE 'entity:%' OR from_id LIKE 'scope:%' THEN '${prefix}' || from_id ELSE from_id END,
               CASE WHEN to_id LIKE 'symbol:%' OR to_id LIKE 'entity:%' OR to_id LIKE 'scope:%' THEN '${prefix}' || to_id ELSE to_id END,
               kind, line, column, data_json FROM pkg_${i}.relations;
      `);
    } catch (err) {
      console.error(`Failed to merge package ${pkgId}:`, err);
    } finally {
      db.prepare(`DETACH DATABASE pkg_${i}`).run();
    }
  }
}

interface GenerateGraphViewOptions extends GenerateViewRequest {
  sqlitePath?: string;
  snapshotData?: GraphSnapshotData;
}

interface PreparedViewDatabase {
  db: Database.Database;
  effectiveCacheDbPath: string;
  cleanup: () => void;
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

const loadedExtensionState = new Map<
  string,
  {
    configMtimeMs: number;
    extensionNames: string[];
  }
>();

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
    for (const node of outNodes) {
      insNode.run(
        node.id,
        node.name,
        node.type ?? null,
        node.combo_id ?? null,
        node.color ?? null,
        node.radius ?? null,
        node.display_name ?? null,
        node.git_status ?? null,
        node.meta_json ?? null,
      );
    }

    // Edges
    const outEdges = rustDb
      .prepare<[], OutEdge>("SELECT * FROM out_edges")
      .all();
    const insEdge = db.prepare(
      "INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    for (const edge of outEdges) {
      insEdge.run(
        edge.id,
        edge.source,
        edge.target,
        edge.name ?? null,
        edge.kind ?? null,
        edge.category ?? null,
        edge.meta_json ?? null,
      );
    }

    // Combos
    const outCombos = rustDb
      .prepare<[], OutCombo>("SELECT * FROM out_combos")
      .all();
    const insCombo = db.prepare(
      "INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const combo of outCombos) {
      insCombo.run(
        combo.id,
        combo.name,
        combo.type ?? null,
        combo.parent_id ?? null,
        combo.color ?? null,
        combo.radius ?? null,
        combo.collapsed ? 1 : 0,
        combo.display_name ?? null,
        combo.git_status ?? null,
        combo.meta_json ?? null,
      );
    }

    // Details
    const outDetails = rustDb
      .prepare<[], OutDetail>("SELECT * FROM out_details")
      .all();
    const insDetail = db.prepare(
      'INSERT OR REPLACE INTO out_details (id, file_name, project_path, line, "column", data_json) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const detail of outDetails) {
      insDetail.run(
        detail.id,
        detail.file_name ?? null,
        detail.project_path ?? null,
        detail.line ?? null,
        detail.column ?? null,
        detail.data_json ?? null,
      );
    }

    rustDb.close();
  }
}

async function prepareViewDatabase(
  sqlitePath: string,
  projectRoot: string,
  analysisPaths?: string[],
): Promise<PreparedViewDatabase> {
  const db = new Database(":memory:");
  let aggregatedDbPath: string | undefined;

  try {
    const nodePath = await import("node:path");
    const absolutePath = nodePath.isAbsolute(sqlitePath)
      ? sqlitePath
      : nodePath.resolve(process.cwd(), sqlitePath);

    db.prepare(`ATTACH DATABASE ? AS source`).run(absolutePath);

    const schemaTables = db
      .prepare(
        "SELECT name FROM source.sqlite_master WHERE type IN ('table', 'view')",
      )
      .all() as { name: string }[];

    const workspacePackagesExist = schemaTables.some(
      (t) => t.name === "workspace_packages",
    );
    const aggregatedTables = [
      "packages",
      "files",
      "entities",
      "scopes",
      "symbols",
      "renders",
      "exports",
      "relations",
    ];

    for (const row of schemaTables) {
      if (!row.name.startsWith("sqlite_") && !row.name.startsWith("out_")) {
        if (workspacePackagesExist && aggregatedTables.includes(row.name)) {
          continue;
        }
        db.exec(
          `CREATE TEMP VIEW "${row.name}" AS SELECT * FROM source."${row.name}"`,
        );
      }
    }

    initOutputTables(db);

    if (workspacePackagesExist) {
      await aggregateMonorepoData(db, projectRoot, analysisPaths);

      try {
        const tmpFile = tmp.fileSync({ postfix: ".sqlite" });
        aggregatedDbPath = tmpFile.name;
        const buffer = db.serialize();
        fs.writeFileSync(aggregatedDbPath, buffer);
      } catch (err) {
        console.error("Failed to create temporary aggregated database:", err);
      }
    }

    const cleanup = () => {
      db.close();
      if (aggregatedDbPath && fs.existsSync(aggregatedDbPath)) {
        try {
          fs.unlinkSync(aggregatedDbPath);
        } catch (err) {
          console.error(
            "Failed to clean up temporary aggregated database:",
            err,
          );
        }
      }
    };

    return {
      db,
      effectiveCacheDbPath: aggregatedDbPath || absolutePath,
      cleanup,
    };
  } catch (err) {
    db.close();
    if (aggregatedDbPath && fs.existsSync(aggregatedDbPath)) {
      fs.unlinkSync(aggregatedDbPath);
    }
    throw err;
  }
}

function fingerprintRow(row: Record<string, unknown>, ignoredKeys: string[]) {
  const normalized = Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !ignoredKeys.includes(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(normalized);
}

function applyGitComparisonFromViewResults(
  primaryDb: Database.Database,
  baselineDb: Database.Database,
) {
  const primaryNodes = primaryDb
    .prepare<[], OutNode>("SELECT * FROM out_nodes")
    .all();
  const baselineNodes = new Map(
    baselineDb
      .prepare<[], OutNode>("SELECT * FROM out_nodes")
      .all()
      .map((row) => [row.id, row]),
  );
  const primaryCombos = primaryDb
    .prepare<[], OutCombo>("SELECT * FROM out_combos")
    .all();
  const baselineCombos = new Map(
    baselineDb
      .prepare<[], OutCombo>("SELECT * FROM out_combos")
      .all()
      .map((row) => [row.id, row]),
  );

  const updateNode = primaryDb.prepare(
    "UPDATE out_nodes SET git_status = ? WHERE id = ?",
  );
  const updateCombo = primaryDb.prepare(
    "UPDATE out_combos SET git_status = ? WHERE id = ?",
  );

  for (const row of primaryNodes) {
    const baseline = baselineNodes.get(row.id);
    if (!baseline) {
      updateNode.run("added", row.id);
      continue;
    }

    if (
      fingerprintRow(row as unknown as Record<string, unknown>, ["git_status"]) !==
      fingerprintRow(
        baseline as unknown as Record<string, unknown>,
        ["git_status"],
      )
    ) {
      updateNode.run("modified", row.id);
    }
  }

  for (const row of primaryCombos) {
    const baseline = baselineCombos.get(row.id);
    if (!baseline) {
      updateCombo.run("added", row.id);
      continue;
    }

    if (
      fingerprintRow(row as unknown as Record<string, unknown>, ["git_status"]) !==
      fingerprintRow(
        baseline as unknown as Record<string, unknown>,
        ["git_status"],
      )
    ) {
      updateCombo.run("modified", row.id);
    }
  }
}

/**
 * Convert output tables from SQLite to a packed FlatBuffer structure.
 */
function convertSqliteToFlatBuffers(db: Database.Database): {
  nodeDataBuffer: SharedArrayBuffer;
  detailBuffer: SharedArrayBuffer;
  bytesWritten: number;
} {
  const builder = new flatbuffers.Builder(1024 * 1024);

  // 1. Fetch data from SQLite output tables
  const nodes = db.prepare<[], OutNode>("SELECT * FROM out_nodes").all();
  const edges = db.prepare<[], OutEdge>("SELECT * FROM out_edges").all();
  const combos = db.prepare<[], OutCombo>("SELECT * FROM out_combos").all();
  const details = db.prepare<[], OutDetail>("SELECT * FROM out_details").all();

  // 2. Serialize to FlatBuffers
  const nodeOffsets: number[] = [];
  for (const node of nodes) {
    const idOffset = builder.createString(node.id);
    const nameOffset = builder.createString(node.name || "");
    const comboOffset = node.combo_id ? builder.createString(node.combo_id) : 0;
    const colorOffset = node.color ? builder.createString(node.color) : 0;
    const displayNameOffset = node.display_name
      ? builder.createString(node.display_name)
      : 0;
    const gitStatusOffset = node.git_status
      ? builder.createString(node.git_status)
      : 0;

    FB.GraphNode.startGraphNode(builder);
    FB.GraphNode.addId(builder, idOffset);
    FB.GraphNode.addName(builder, nameOffset);
    FB.GraphNode.addType(builder, mapToFBItemType(node.type));
    if (comboOffset) FB.GraphNode.addComboId(builder, comboOffset);
    if (colorOffset) FB.GraphNode.addColor(builder, colorOffset);
    if (node.radius) FB.GraphNode.addRadius(builder, node.radius);
    if (displayNameOffset)
      FB.GraphNode.addDisplayName(builder, displayNameOffset);
    if (gitStatusOffset) FB.GraphNode.addGitStatus(builder, gitStatusOffset);

    nodeOffsets.push(FB.GraphNode.endGraphNode(builder));
  }

  const edgeOffsets: number[] = [];
  for (const edge of edges) {
    const idOffset = builder.createString(edge.id);
    const sourceOffset = builder.createString(edge.source);
    const targetOffset = builder.createString(edge.target);
    const nameOffset = edge.name ? builder.createString(edge.name) : 0;
    const kindOffset = edge.kind ? builder.createString(edge.kind) : 0;
    const categoryOffset = edge.category
      ? builder.createString(edge.category)
      : 0;

    FB.GraphEdge.startGraphEdge(builder);
    FB.GraphEdge.addId(builder, idOffset);
    FB.GraphEdge.addSource(builder, sourceOffset);
    FB.GraphEdge.addTarget(builder, targetOffset);
    if (nameOffset) FB.GraphEdge.addName(builder, nameOffset);
    if (kindOffset) FB.GraphEdge.addKind(builder, kindOffset);
    if (categoryOffset) FB.GraphEdge.addCategory(builder, categoryOffset);
    edgeOffsets.push(FB.GraphEdge.endGraphEdge(builder));
  }

  const comboOffsets: number[] = [];
  for (const combo of combos) {
    const idOffset = builder.createString(combo.id);
    const nameOffset = builder.createString(combo.name || "");
    const parentOffset = combo.parent_id
      ? builder.createString(combo.parent_id)
      : 0;
    const colorOffset = combo.color ? builder.createString(combo.color) : 0;
    const displayNameOffset = combo.display_name
      ? builder.createString(combo.display_name)
      : 0;
    const gitStatusOffset = combo.git_status
      ? builder.createString(combo.git_status)
      : 0;

    FB.GraphCombo.startGraphCombo(builder);
    FB.GraphCombo.addId(builder, idOffset);
    FB.GraphCombo.addName(builder, nameOffset);
    FB.GraphCombo.addType(builder, mapToFBItemType(combo.type));
    if (parentOffset) FB.GraphCombo.addParentId(builder, parentOffset);
    if (colorOffset) FB.GraphCombo.addColor(builder, colorOffset);
    if (combo.radius) FB.GraphCombo.addRadius(builder, combo.radius);
    FB.GraphCombo.addCollapsed(builder, !!combo.collapsed);
    if (displayNameOffset)
      FB.GraphCombo.addDisplayName(builder, displayNameOffset);
    if (gitStatusOffset) FB.GraphCombo.addGitStatus(builder, gitStatusOffset);

    comboOffsets.push(FB.GraphCombo.endGraphCombo(builder));
  }

  const detailOffsets: number[] = [];
  for (const detail of details) {
    const idOffset = builder.createString(detail.id);
    const fileNameOffset = detail.file_name
      ? builder.createString(detail.file_name)
      : 0;
    const projectPathOffset = detail.project_path
      ? builder.createString(detail.project_path)
      : 0;
    const dataJsonOffset = detail.data_json
      ? builder.createString(detail.data_json)
      : 0;

    let locOffset = 0;
    if (detail.line != null || detail.column != null) {
      FB.Loc.startLoc(builder);
      FB.Loc.addLine(builder, detail.line || 0);
      FB.Loc.addColumn(builder, detail.column || 0);
      locOffset = FB.Loc.endLoc(builder);
    }

    FB.GraphNodeDetail.startGraphNodeDetail(builder);
    FB.GraphNodeDetail.addId(builder, idOffset);
    if (fileNameOffset) FB.GraphNodeDetail.addFileName(builder, fileNameOffset);
    if (projectPathOffset)
      FB.GraphNodeDetail.addProjectPath(builder, projectPathOffset);
    if (locOffset) FB.GraphNodeDetail.addLoc(builder, locOffset);
    if (dataJsonOffset) FB.GraphNodeDetail.addDataJson(builder, dataJsonOffset);
    detailOffsets.push(FB.GraphNodeDetail.endGraphNodeDetail(builder));
  }

  const nodesVec = FB.GraphView.createNodesVector(builder, nodeOffsets);
  const edgesVec = FB.GraphView.createEdgesVector(builder, edgeOffsets);
  const combosVec = FB.GraphView.createCombosVector(builder, comboOffsets);
  const detailsVec = FB.GraphView.createDetailsVector(builder, detailOffsets);

  FB.GraphView.startGraphView(builder);
  FB.GraphView.addNodes(builder, nodesVec);
  FB.GraphView.addEdges(builder, edgesVec);
  FB.GraphView.addCombos(builder, combosVec);
  FB.GraphView.addDetails(builder, detailsVec);
  const graphOffset = FB.GraphView.endGraphView(builder);
  builder.finish(graphOffset, "NXGV");

  const flatBufferData = builder.asUint8Array();
  const nodeDataBuffer = new SharedArrayBuffer(flatBufferData.length);
  new Uint8Array(nodeDataBuffer).set(flatBufferData);

  return {
    nodeDataBuffer,
    detailBuffer: new SharedArrayBuffer(0),
    bytesWritten: flatBufferData.length,
  };
}

function mapToFBItemType(type: string | undefined): FB.ItemType {
  if (!type) return FB.ItemType.Scope;
  const t = type
    .toLowerCase()
    .replace(/-/g, "")
    .replace(/group$/, "group");
  switch (t) {
    case "package":
      return FB.ItemType.Package;
    case "scope":
      return FB.ItemType.Scope;
    case "component":
      return FB.ItemType.Component;
    case "hook":
      return FB.ItemType.Hook;
    case "state":
      return FB.ItemType.State;
    case "memo":
      return FB.ItemType.Memo;
    case "callback":
      return FB.ItemType.Callback;
    case "ref":
      return FB.ItemType.Ref;
    case "effect":
      return FB.ItemType.Effect;
    case "prop":
      return FB.ItemType.Prop;
    case "render":
      return FB.ItemType.Render;
    case "rendergroup":
      return FB.ItemType.RenderGroup;
    case "sourcegroup":
      return FB.ItemType.SourceGroup;
    case "pathgroup":
      return FB.ItemType.PathGroup;
    case "variable":
      return FB.ItemType.Variable;
    default:
      return FB.ItemType.Scope;
  }
}

export async function generateGraphView(
  options: GenerateGraphViewOptions,
): Promise<GenerateGraphViewResult> {
  const {
    sqlitePath,
    view: viewType,
    projectRoot,
    analysisPaths,
    compareSqlitePath,
    gitComparisonEnabled,
  } = options;

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
  const primary = await prepareViewDatabase(sqlitePath, projectRoot, analysisPaths);
  let baseline: PreparedViewDatabase | undefined;

  try {
    let cursorMs = extensionLoad.endMs;

    for (const task of tasks) {
      const taskStartedAt = performance.now();
      try {
        if (task.runSqlite) {
          // Run in-process: all tasks share the same mutable in-memory db.
          // No worker round-trip or buffer serialisation between tasks.
          await runTaskInProcess(
            task,
            primary.db,
            projectRoot,
            analysisPaths,
            viewType,
            primary.effectiveCacheDbPath,
          );
        } else if (task.run) {
          // Legacy run() path — pass the live db via context.
          const legacyResult = task.run(
            { nodes: [], edges: [], combos: [], typeData: {} },
            { db: primary.db, projectRoot, analysisPaths, viewType },
          );
          // Persist legacy task results into shared output tables so they are
          // picked up by convertSqliteToFlatBuffers (same as the runSqlite path).
          const insNode = primary.db.prepare(
            "INSERT OR REPLACE INTO out_nodes (id, name, type, combo_id, color, radius, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          for (const node of legacyResult.nodes) {
            insNode.run(
              node.id,
              typeof node.name === "string"
                ? node.name
                : JSON.stringify(node.name),
              node.type ?? null,
              node.combo ?? null,
              node.color ?? null,
              node.radius ?? null,
              node.displayName ?? null,
              node.gitStatus ?? null,
              null,
            );
          }
          const insEdge = primary.db.prepare(
            "INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          );
          for (const edge of legacyResult.edges) {
            insEdge.run(
              edge.id,
              edge.source,
              edge.target,
              edge.name ?? null,
              edge.edgeKind ?? null,
              edge.category ?? null,
              null,
            );
          }
          const insCombo = primary.db.prepare(
            "INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          for (const combo of legacyResult.combos) {
            insCombo.run(
              combo.id,
              typeof combo.name === "string"
                ? combo.name
                : JSON.stringify(combo.name),
              combo.type ?? null,
              combo.combo ?? null,
              combo.color ?? null,
              combo.radius ?? null,
              combo.collapsed ? 1 : 0,
              combo.displayName ?? null,
              combo.gitStatus ?? null,
              null,
            );
          }
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

    if (gitComparisonEnabled && compareSqlitePath) {
      const compareStartedAt = performance.now();
      baseline = await prepareViewDatabase(
        compareSqlitePath,
        projectRoot,
        analysisPaths,
      );

      for (const task of tasks) {
        if (task.runSqlite) {
          await runTaskInProcess(
            task,
            baseline.db,
            projectRoot,
            analysisPaths,
            viewType,
            baseline.effectiveCacheDbPath,
          );
          continue;
        }

        if (task.run) {
          const legacyResult = task.run(
            { nodes: [], edges: [], combos: [], typeData: {} },
            { db: baseline.db, projectRoot, analysisPaths, viewType },
          );
          const insNode = baseline.db.prepare(
            "INSERT OR REPLACE INTO out_nodes (id, name, type, combo_id, color, radius, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          for (const node of legacyResult.nodes) {
            insNode.run(
              node.id,
              typeof node.name === "string"
                ? node.name
                : JSON.stringify(node.name),
              node.type ?? null,
              node.combo ?? null,
              node.color ?? null,
              node.radius ?? null,
              node.displayName ?? null,
              node.gitStatus ?? null,
              null,
            );
          }
          const insEdge = baseline.db.prepare(
            "INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          );
          for (const edge of legacyResult.edges) {
            insEdge.run(
              edge.id,
              edge.source,
              edge.target,
              edge.name ?? null,
              edge.edgeKind ?? null,
              edge.category ?? null,
              null,
            );
          }
          const insCombo = baseline.db.prepare(
            "INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          for (const combo of legacyResult.combos) {
            insCombo.run(
              combo.id,
              typeof combo.name === "string"
                ? combo.name
                : JSON.stringify(combo.name),
              combo.type ?? null,
              combo.combo ?? null,
              combo.color ?? null,
              combo.radius ?? null,
              combo.collapsed ? 1 : 0,
              combo.displayName ?? null,
              combo.gitStatus ?? null,
              null,
            );
          }
        }
      }

      applyGitComparisonFromViewResults(primary.db, baseline.db);
      const durationMs = performance.now() - compareStartedAt;
      stages.push({
        id: "view:compare-results",
        name: "Compare view results",
        startMs: cursorMs,
        endMs: cursorMs + durationMs,
        parentId: "worker:view-compute",
      });
      cursorMs += durationMs;
    }

    const convStartedAt = performance.now();
    // The shared in-memory db already has all task output — convert it directly.
    const { nodeDataBuffer, detailBuffer, bytesWritten } =
      convertSqliteToFlatBuffers(primary.db);
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
    baseline?.cleanup();
    primary.cleanup();
  }
}

export function getSerializedViewRegistry(): SerializedViewRegistry {
  return serializeRegistry();
}
