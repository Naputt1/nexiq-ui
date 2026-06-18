import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import * as flatbuffers from "flatbuffers";
import tmp from "tmp";
import {
  type Extension,
  initOutputTables,
  registerNodeType,
  type NodeAppearance,
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
      star_exports_json TEXT,
      entry_point TEXT
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

/**
 * Resolve the list of built-in extension names/paths.
 * Includes monorepo packages and any standalone extensions discovered
 * in well-known sibling directories.
 */
function getBuiltInExtensionNames(): string[] {
  const names: string[] = [
    "@nexiq/component-extension",
    "@nexiq/file-extension",
  ];

  // Auto-discover standalone extensions in sibling directories
  // (e.g. ../tanstack-query-nexiq-extension)
  const appRoot = process.env.APP_ROOT;
  if (appRoot) {
    const parentDir = path.resolve(appRoot, "..");
    try {
      for (const entry of fs.readdirSync(parentDir)) {
        const fullPath = path.join(parentDir, entry);
        if (entry.endsWith("-nexiq-extension") && fs.statSync(fullPath).isDirectory()) {
          const pkgJsonPath = path.join(fullPath, "package.json");
          if (fs.existsSync(pkgJsonPath)) {
            names.push(fullPath);
          }
        }
      }
    } catch {
      // ignore read errors on parent directory
    }
  }

  return names;
}

/**
 * Collect extension names from all discovery sources:
 *  1. Built-in defaults (fallback when no project config)
 *  2. Project `.nexiq/config.json`
 *  3. Global `~/.nexiq/config.json`
 *  4. Global `~/.nexiq/extensions/` directory
 */
function collectExtensionNames(projectRoot: string): string[] {
  const names = new Set<string>();

  // 1. Project config
  try {
    const configPath = path.join(projectRoot, ".nexiq/config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (Array.isArray(config.extensions)) {
        for (const name of config.extensions) {
          names.add(name);
        }
      }
    }
  } catch (err) {
    console.error("Failed to read project extension config:", err);
  }

  // 2. If nothing configured in project, use built-in defaults
  if (names.size === 0) {
    for (const name of getBuiltInExtensionNames()) {
      names.add(name);
    }
  }

  // 3. Global config $HOME/.nexiq/config.json
  try {
    const globalConfigPath = path.join(os.homedir(), ".nexiq", "config.json");
    if (fs.existsSync(globalConfigPath)) {
      const config = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));
      if (Array.isArray(config.extensions)) {
        for (const name of config.extensions) {
          names.add(name);
        }
      }
    }
  } catch (err) {
    console.error("Failed to read global extension config:", err);
  }

  // 4. Global extensions directory $HOME/.nexiq/extensions/
  try {
    const globalExtDir = path.join(os.homedir(), ".nexiq", "extensions");
    if (fs.existsSync(globalExtDir)) {
      for (const entry of fs.readdirSync(globalExtDir)) {
        const fullPath = path.join(globalExtDir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() || stat.isFile()) {
          names.add(fullPath);
        }
      }
    }
  } catch (err) {
    console.error("Failed to scan global extensions directory:", err);
  }

  return [...names].sort();
}

/**
 * Resolve a bare package name to its directory by searching each resolve path's
 * node_modules. Avoids require.resolve so it works regardless of the target
 * package's exports map configuration.
 */
function resolvePackageDir(
  name: string,
  resolvePaths: string[],
): string | null {
  for (const rp of resolvePaths) {
    const candidate = path.join(rp, "node_modules", name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // symlink or permission issue — skip
    }
  }
  return null;
}

/**
 * Build a list of module resolution paths to search when loading extensions.
 * Includes the project root, the app's own directory, and global npm/pnpm roots.
 */
function getExtensionResolvePaths(projectRoot: string): string[] {
  const paths: string[] = [projectRoot];

  // App's own node_modules (for built-in extensions shipped with the UI)
  const appRoot = process.env.APP_ROOT;
  if (appRoot) {
    paths.push(appRoot);
  }

  // Global npm root
  try {
    const isWindows = process.platform === "win32";
    const globalRoot = execSync(isWindows ? "npm root -g" : "npm root -g", {
      encoding: "utf8",
      timeout: 2000,
      shell: isWindows ? "cmd.exe" : "/bin/sh",
    }).trim();
    if (globalRoot && fs.existsSync(globalRoot)) {
      paths.push(globalRoot);
    }
  } catch {
    // npm not available — continue
  }

  // Global pnpm root
  try {
    const pnpmRoot = execSync("pnpm root -g", {
      encoding: "utf8",
      timeout: 2000,
      shell: "/bin/sh",
    }).trim();
    if (pnpmRoot && fs.existsSync(pnpmRoot)) {
      paths.push(pnpmRoot);
    }
  } catch {
    // pnpm not available — continue
  }

  // Common global paths as fallback
  const home = os.homedir();
  const commonGlobalPaths = [
    "/usr/local/lib/node_modules",
    "/opt/homebrew/lib/node_modules",
    path.join(home, ".npm", "lib", "node_modules"),
    path.join(home, ".config", "yarn", "global", "node_modules"),
    path.join(home, "Library", "pnpm", "global", "node_modules"),
  ];
  for (const p of commonGlobalPaths) {
    if (fs.existsSync(p)) {
      paths.push(p);
    }
  }

  return paths;
}

/**
 * Load a single extension module by name, trying all given resolve paths.
 */
async function loadExtensionModule(
  name: string,
  projectRoot: string,
  resolvePaths: string[],
): Promise<Extension | null> {
  let resolvedPath = name;

  if (name.startsWith(".")) {
    // Relative path — resolve against project root
    resolvedPath = path.resolve(projectRoot, name);
  } else if (!name.startsWith("/")) {
    // Bare package name — search manually through each resolve path's
    // node_modules. Avoids require.resolve which fails when the target
    // package's exports map lacks a "default" condition.
    const pkgDir = resolvePackageDir(name, resolvePaths);
    if (!pkgDir) {
      console.warn(
        `Extension ${name} not found — tried paths: [${resolvePaths.join(", ")}]`,
      );
      return null;
    }
    resolvedPath = pkgDir;
  }

  // If resolvedPath is a directory, resolve to its entry point via package.json
  // so ESM import() can load it (directory imports are not supported in ESM).
  if (
    !name.endsWith(".node") &&
    !resolvedPath.endsWith(".js") &&
    !resolvedPath.endsWith(".mjs") &&
    !resolvedPath.endsWith(".cjs") &&
    fs.existsSync(resolvedPath) &&
    fs.statSync(resolvedPath).isDirectory()
  ) {
    const pkgPath = path.join(resolvedPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const entry = pkg.exports?.["."]?.import || pkg.main || "index.js";
        resolvedPath = path.resolve(resolvedPath, entry);
      } catch {
        resolvedPath = path.join(resolvedPath, "index.js");
      }
    } else {
      resolvedPath = path.join(resolvedPath, "index.js");
    }
  }

  try {
    const rawModule: unknown = name.endsWith(".node")
      ? typeof __non_webpack_require__ !== "undefined"
        ? __non_webpack_require__(resolvedPath)
        : // eslint-disable-next-line @typescript-eslint/no-require-imports
          require(resolvedPath)
      : await import(resolvedPath).then((m) => m.default || m);

    // The module might be the extension itself (default export) or a named export.
    // If it doesn't have an id, search through named exports for one that does.
    const extension: Extension | undefined =
      rawModule &&
      typeof rawModule === "object" &&
      "id" in (rawModule as Record<string, unknown>)
        ? (rawModule as Extension)
        : Object.values(rawModule as Record<string, unknown>).find(
            (v): v is Extension =>
              v !== null &&
              typeof v === "object" &&
              "id" in v,
          );

    if (!extension) {
      console.warn(
        `Extension ${name} loaded but no valid extension object found (no export with 'id' property)`,
      );
      return null;
    }

    return extension;
  } catch (err) {
    console.error(`Failed to load extension module ${name} from ${resolvedPath}:`, err);
    return null;
  }
}

/**
 * Register an extension's capabilities (view tasks, node types) into the registry.
 */
function registerExtension(extension: Extension, resolvedPath: string) {
  if (extension.viewTasks) {
    for (const [vType, tasks] of Object.entries(extension.viewTasks)) {
      for (const task of tasks) {
        registerTask(vType as GraphViewType, task, resolvedPath);
      }
    }
  }

  if (extension.nodeTypes) {
    for (const [type, appearance] of Object.entries(extension.nodeTypes)) {
      registerNodeType(type, appearance);
      trackNodeType(type, appearance);
    }
  }
}

/**
 * Dynamically discover and load extensions from multiple sources:
 *  - Project `.nexiq/config.json`
 *  - Built-in defaults (when no project config)
 *  - Global `~/.nexiq/config.json`
 *  - Global `~/.nexiq/extensions/`
 *  - Global npm/pnpm installations
 *
 * This replaces compile-time hardcoded extension imports.
 */
async function loadProjectExtensions(projectRoot: string) {
  const startedAt = performance.now();

  const extensionNames = collectExtensionNames(projectRoot);

  if (extensionNames.length === 0) {
    return {
      startMs: 0,
      endMs: performance.now() - startedAt,
      detail: "none found",
    };
  }

  // Cache check
  const cacheKey = `${projectRoot}::${extensionNames.join(",")}`;
  if (loadedExtensionState.has(cacheKey)) {
    return {
      startMs: 0,
      endMs: performance.now() - startedAt,
      detail: `${extensionNames.length} cached`,
    };
  }

  const resolvePaths = getExtensionResolvePaths(projectRoot);

  let loadedCount = 0;
  for (const name of extensionNames) {
    const ext = await loadExtensionModule(name, projectRoot, resolvePaths);
    if (ext) {
      registerExtension(ext, name);
      loadedCount++;
    }
  }

  loadedExtensionState.set(cacheKey, true);

  return {
    startMs: 0,
    endMs: performance.now() - startedAt,
    detail: `${loadedCount} loaded (${extensionNames.length} configured)`,
  };
}

const loadedExtensionState = new Map<string, boolean>();

/**
 * Tracks node types registered by dynamically loaded extensions.
 * These are bridged to the renderer process via IPC so custom node
 * appearances are available in the UI without compile-time registration.
 */
const registeredNodeTypes: Record<string, NodeAppearance> = {};

export function trackNodeType(type: string, appearance: NodeAppearance) {
  registeredNodeTypes[type] = appearance;
}

export function getRegisteredNodeTypes(): Record<string, NodeAppearance> {
  return { ...registeredNodeTypes };
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

  // Materialize source tables if they only exist as TEMP VIEWs
  // (single-project mode) — temp objects don't survive serialize().
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='files'")
      .get()
  ) {
    initDataTables(db);
    for (const tbl of [
      "packages",
      "files",
      "scopes",
      "entities",
      "symbols",
      "renders",
      "exports",
      "relations",
    ]) {
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?",
          )
          .get(tbl)
      ) {
        try {
          db.exec(`INSERT OR IGNORE INTO main.${tbl} SELECT * FROM "${tbl}"`);
        } catch {
          // Schema mismatch — source table may have different columns; skip
        }
      }
    }
  }

  // Serialize the shared in-memory DB for native tasks (e.g. Rust) so they
  // can deserialize it directly instead of re-aggregating source data.
  context.sqliteBuffer = db.serialize();

  const resultBuf = await task.runSqlite(context);

  if (resultBuf && resultBuf instanceof Uint8Array) {
    // Merge native task output tables into the shared database using
    // batch SQL INSERT OR REPLACE (much faster than row-by-row JS loops).
    // Write to a temp file and ATTACH so we can merge with batch SQL.
    // The temp file stays in the OS page cache (tmpfs on macOS/Linux).
    const tmpFile = tmp.fileSync({ postfix: ".sqlite" });
    const mergePath = tmpFile.name;
    try {
      fs.writeFileSync(mergePath, Buffer.from(resultBuf));
      db.exec(`ATTACH DATABASE '${mergePath}' AS merge_db`);
      db.exec(
        "INSERT OR REPLACE INTO main.out_nodes SELECT * FROM merge_db.out_nodes",
      );
      db.exec(
        "INSERT OR REPLACE INTO main.out_edges SELECT * FROM merge_db.out_edges",
      );
      db.exec(
        "INSERT OR REPLACE INTO main.out_combos SELECT * FROM merge_db.out_combos",
      );
      db.exec(
        "INSERT OR REPLACE INTO main.out_details SELECT * FROM merge_db.out_details",
      );
      db.exec("DETACH DATABASE merge_db");
    } finally {
      tmpFile.removeCallback();
    }
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

    console.log(`Attaching database: ${absolutePath}`);
    if (!fs.existsSync(absolutePath)) {
      console.error(`Database file does not exist: ${absolutePath}`);
    }
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
    const fbType = FB.stringToItemType(node.type);
    const isCustom = fbType === FB.ItemType.Custom;
    const customTypeOffset =
      isCustom && node.type
        ? builder.createString(node.type)
        : 0;

    FB.GraphNode.startGraphNode(builder);
    FB.GraphNode.addId(builder, idOffset);
    FB.GraphNode.addName(builder, nameOffset);
    FB.GraphNode.addType(builder, fbType);
    if (comboOffset) FB.GraphNode.addComboId(builder, comboOffset);
    if (colorOffset) FB.GraphNode.addColor(builder, colorOffset);
    if (node.radius) FB.GraphNode.addRadius(builder, node.radius);
    if (displayNameOffset)
      FB.GraphNode.addDisplayName(builder, displayNameOffset);
    if (gitStatusOffset) FB.GraphNode.addGitStatus(builder, gitStatusOffset);
    if (customTypeOffset) FB.GraphNode.addCustomType(builder, customTypeOffset);

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
    const fbType = FB.stringToItemType(combo.type);
    const isCustom = fbType === FB.ItemType.Custom;
    const customTypeOffset =
      isCustom && combo.type
        ? builder.createString(combo.type)
        : 0;

    FB.GraphCombo.startGraphCombo(builder);
    FB.GraphCombo.addId(builder, idOffset);
    FB.GraphCombo.addName(builder, nameOffset);
    FB.GraphCombo.addType(builder, fbType);
    if (parentOffset) FB.GraphCombo.addParentId(builder, parentOffset);
    if (colorOffset) FB.GraphCombo.addColor(builder, colorOffset);
    if (combo.radius) FB.GraphCombo.addRadius(builder, combo.radius);
    FB.GraphCombo.addCollapsed(builder, !!combo.collapsed);
    if (displayNameOffset)
      FB.GraphCombo.addDisplayName(builder, displayNameOffset);
    if (gitStatusOffset) FB.GraphCombo.addGitStatus(builder, gitStatusOffset);
    if (customTypeOffset) FB.GraphCombo.addCustomType(builder, customTypeOffset);

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



export async function generateGraphView(
  options: GenerateGraphViewOptions,
): Promise<GenerateGraphViewResult> {
  const {
    sqlitePath,
    snapshotData,
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
  console.log(`Generating view "${viewType}" for ${projectRoot}. Found ${tasks.length} tasks.`);

  let primary: PreparedViewDatabase;
  if (sqlitePath) {
    primary = await prepareViewDatabase(sqlitePath, projectRoot, analysisPaths);
  } else if (snapshotData) {
    // For snapshot data, create an empty in-memory DB with output tables
    const db = new Database(":memory:");
    initOutputTables(db);
    primary = {
      db,
      effectiveCacheDbPath: ":memory:",
      cleanup: () => db.close(),
    };
  } else {
    throw new Error("Either SQLite database or snapshot data is required for graph view generation");
  }

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
            const {
              id,
              name,
              type,
              combo,
              color,
              radius,
              displayName,
              gitStatus,
              ...rest
            } = node;
            insNode.run(
              id,
              typeof name === "string" ? name : JSON.stringify(name),
              type ?? null,
              combo ?? null,
              color ?? null,
              radius ?? null,
              displayName ?? null,
              gitStatus ?? null,
              Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
            );
          }
          const insEdge = primary.db.prepare(
            "INSERT OR REPLACE INTO out_edges (id, source, target, name, kind, category, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
          );
          for (const edge of legacyResult.edges) {
            const { id, source, target, name, edgeKind, category, ...rest } =
              edge;
            insEdge.run(
              id,
              source,
              target,
              name ?? null,
              edgeKind ?? null,
              category ?? null,
              Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
            );
          }
          const insCombo = primary.db.prepare(
            "INSERT OR REPLACE INTO out_combos (id, name, type, parent_id, color, radius, collapsed, display_name, git_status, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          );
          for (const combo of legacyResult.combos) {
            const {
              id,
              name,
              type,
              combo: parent_id,
              color,
              radius,
              collapsed,
              displayName,
              gitStatus,
              ...rest
            } = combo;
            insCombo.run(
              id,
              typeof name === "string" ? name : JSON.stringify(name),
              type ?? null,
              parent_id ?? null,
              color ?? null,
              radius ?? null,
              collapsed ? 1 : 0,
              displayName ?? null,
              gitStatus ?? null,
              Object.keys(rest).length > 0 ? JSON.stringify(rest) : null,
            );
          }
        }

        const durationMs = performance.now() - taskStartedAt;
        const nodeCount = primary.db.prepare("SELECT COUNT(*) as count FROM out_nodes").get() as { count: number };
        const edgeCount = primary.db.prepare("SELECT COUNT(*) as count FROM out_edges").get() as { count: number };
        console.log(`Task "${task.id}" finished in ${durationMs.toFixed(2)}ms. Current totals: ${nodeCount.count} nodes, ${edgeCount.count} edges`);

        if (process.env.DEBUG_EXTENSION_DB) {
          try {
            const debugDir = path.join(projectRoot, ".nexiq", "debug");
            fs.mkdirSync(debugDir, { recursive: true });
            const debugPath = path.join(debugDir, `${task.id}.sqlite`);
            fs.writeFileSync(debugPath, primary.db.serialize());
            console.log(`[DEBUG] Extension DB saved to ${debugPath}`);
          } catch (err) {
            console.error("[DEBUG] Failed to save extension DB:", err);
          }
        }

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

    const nodes = primary.db.prepare<[], OutNode>("SELECT * FROM out_nodes").all();
    const edges = primary.db.prepare<[], OutEdge>("SELECT * FROM out_edges").all();
    const combos = primary.db.prepare<[], OutCombo>("SELECT * FROM out_combos").all();

    return {
      result: {
        nodes: nodes.map((n) => {
          const meta = n.meta_json ? JSON.parse(n.meta_json) : undefined;
          return {
            id: n.id,
            name: n.name || "",
            type: n.type || undefined,
            combo: n.combo_id || undefined,
            color: n.color || undefined,
            radius: n.radius || undefined,
            displayName: n.display_name || undefined,
            gitStatus: n.git_status || undefined,
            ...meta,
            meta: meta,
          };
        }),
        edges: edges.map((e) => {
          const meta = e.meta_json ? JSON.parse(e.meta_json) : undefined;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            name: e.name || undefined,
            edgeKind: e.kind || undefined,
            category: e.category || undefined,
            ...meta,
            meta: meta,
          };
        }),
        combos: combos.map((c) => {
          const meta = c.meta_json ? JSON.parse(c.meta_json) : undefined;
          return {
            id: c.id,
            name: c.name || "",
            type: c.type || undefined,
            combo: c.parent_id || undefined,
            color: c.color || undefined,
            radius: c.radius || undefined,
            collapsed: !!c.collapsed,
            displayName: c.display_name || undefined,
            gitStatus: c.git_status || undefined,
            ...meta,
            meta: meta,
          };
        }),
        typeData: {},
      },
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
