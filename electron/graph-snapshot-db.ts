import Database from "better-sqlite3";
import fs from "fs";
import type {
  EntityRow,
  ExportRow,
  FileRow,
  PackageDependencyRow,
  PackageRow,
  RelationRow,
  RenderRow,
  ScopeRow,
  SymbolRow,
  UIStateMap,
} from "@nexiq/shared";
import type { GraphSnapshotData } from "../src/graph-snapshot/types";
import path from "path";

interface UIStateRow {
  id: string;
  x: number;
  y: number;
  radius: number | null;
  collapsed_radius: number | null;
  expanded_radius: number | null;
  is_layout_calculated: number;
  collapsed: number;
}

interface WorkspacePackageRow {
  path: string;
  db_path: string;
  package_id: string;
  name: string;
  version: string | null;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
    )
    .get(name) as { name: string } | undefined;
  return !!row;
}

function requiredRows<T>(db: Database.Database, table: string): T[] {
  return db.prepare(`SELECT * FROM ${table}`).all() as T[];
}

function optionalRows<T>(db: Database.Database, table: string): T[] {
  if (!tableExists(db, table)) {
    return [];
  }
  return db.prepare(`SELECT * FROM ${table}`).all() as T[];
}

export function readUIState(db: Database.Database): UIStateMap {
  if (!tableExists(db, "ui_state")) {
    return {};
  }

  const rows = db.prepare("SELECT * FROM ui_state").all() as UIStateRow[];
  const state: UIStateMap = {};
  for (const row of rows) {
    state[row.id] = {
      x: row.x,
      y: row.y,
      radius: row.radius ?? undefined,
      collapsedRadius: row.collapsed_radius ?? undefined,
      expandedRadius: row.expanded_radius ?? undefined,
      isLayoutCalculated: !!row.is_layout_calculated,
      collapsed: !!row.collapsed,
    };
  }
  return state;
}

export interface ReadOptions {
  includePackages?: boolean;
  includePackageDependencies?: boolean;
  includeFiles?: boolean;
  includeEntities?: boolean;
  includeScopes?: boolean;
  includeSymbols?: boolean;
  includeRenders?: boolean;
  includeExports?: boolean;
  includeRelations?: boolean;
  includeUiState?: boolean;
}

export function openUnifiedDatabase(
  sqlitePath: string,
  _analysisPaths?: string[],
  options: { readonly?: boolean } = { readonly: true },
): Database.Database {
  // Ensure absolute path resolution for reliable access in workers
  const absolutePath = path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(process.cwd(), sqlitePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`SQLite database file does not exist at: ${absolutePath}`);
  }

  if (!options.readonly) {
    console.warn(
      `[SQLite] Opening database at ${absolutePath} with write permissions. This is discouraged for view generation; use in-memory buffers instead.`,
    );
  }

  try {
    return new Database(absolutePath, options);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[SQLite Error] Failed to open database at ${absolutePath}: ${errorMsg}`,
    );
    throw new Error(
      `Unable to open database file at ${absolutePath}: ${errorMsg}`,
    );
  }
}

export function readGraphSnapshotFromSqlite(
  sqlitePath: string,
  analysisPaths?: string[],
  options: ReadOptions = {
    includePackages: true,
    includePackageDependencies: true,
    includeFiles: true,
    includeEntities: true,
    includeScopes: true,
    includeSymbols: true,
    includeRenders: true,
    includeExports: true,
    includeRelations: true,
    includeUiState: true,
  },
): GraphSnapshotData {
  const absolutePath = path.isAbsolute(sqlitePath)
    ? sqlitePath
    : path.resolve(process.cwd(), sqlitePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `SQLite database file does not exist at: ${absolutePath} (readGraphSnapshotFromSqlite)`,
    );
  }

  const db = new Database(absolutePath, { readonly: true });
  try {
    // Check if this is a workspace database
    if (tableExists(db, "workspace_packages")) {
      const workspacePackages = optionalRows<WorkspacePackageRow>(
        db,
        "workspace_packages",
      );
      const filteredPackages =
        analysisPaths && analysisPaths.length > 0
          ? workspacePackages.filter((p) => analysisPaths.includes(p.path))
          : workspacePackages;

      const aggregated: GraphSnapshotData = {
        packages: [],
        package_dependencies: [],
        files: [],
        entities: [],
        scopes: [],
        symbols: [],
        renders: [],
        exports: [],
        relations: [],
        uiState: options.includeUiState ? readUIState(db) : {},
        diff: undefined,
      };

      // Read each package database
      filteredPackages.forEach((pkg, index) => {
        if (!fs.existsSync(pkg.db_path)) {
          console.warn(
            `[SQLite] Package database not found at ${pkg.db_path} for package ${pkg.name}`,
          );
          return;
        }

        console.log(
          `[SQLite] Opening package database: ${pkg.name} at ${pkg.db_path}`,
        );
        const pkgDb = new Database(pkg.db_path, { readonly: true });
        try {
          const pkgPath = pkg.path;
          const fileIdOffset = (index + 1) * 1000000;

          const pkgPrefix = `workspace:${pkgPath}:`;

          // 1. Packages & Dependencies
          if (options.includePackages) {
            const pRows = optionalRows<PackageRow>(pkgDb, "packages");
            if (pRows.length > 0) {
              aggregated.packages!.push(...pRows);
            } else {
              aggregated.packages!.push({
                id: pkg.package_id,
                name: pkg.name,
                version: pkg.version || "0.0.0",
                path: pkg.path,
              });
            }
          }
          if (options.includePackageDependencies) {
            aggregated.package_dependencies!.push(
              ...optionalRows<PackageDependencyRow>(
                pkgDb,
                "package_dependencies",
              ),
            );
          }

          // 2. Files
          if (options.includeFiles) {
            const fRows = requiredRows<FileRow>(pkgDb, "files");
            for (const f of fRows) {
              aggregated.files.push({
                ...f,
                id: fileIdOffset + f.id,
                package_id: f.package_id || pkg.package_id,
              });
            }
          }

          // 3. Scopes
          if (options.includeScopes) {
            const sRows = requiredRows<ScopeRow>(pkgDb, "scopes");
            aggregated.scopes.push(
              ...sRows.map((s) => ({
                ...s,
                id: `${pkgPrefix}${s.id}`,
                file_id: fileIdOffset + s.file_id,
                parent_id: s.parent_id ? `${pkgPrefix}${s.parent_id}` : null,
                entity_id: s.entity_id ? `${pkgPrefix}${s.entity_id}` : null,
              })),
            );
          }

          // 4. Entities
          if (options.includeEntities) {
            const eRows = requiredRows<EntityRow>(pkgDb, "entities");
            aggregated.entities.push(
              ...eRows.map((e) => ({
                ...e,
                id: `${pkgPrefix}${e.id}`,
                scope_id: `${pkgPrefix}${e.scope_id}`,
              })),
            );
          }

          // 5. Symbols
          if (options.includeSymbols) {
            const symRows = requiredRows<SymbolRow>(pkgDb, "symbols");
            aggregated.symbols.push(
              ...symRows.map((s) => ({
                ...s,
                id: `${pkgPrefix}${s.id}`,
                entity_id: `${pkgPrefix}${s.entity_id}`,
                scope_id: `${pkgPrefix}${s.scope_id}`,
              })),
            );
          }

          // 6. Renders
          if (options.includeRenders) {
            const rRows = requiredRows<RenderRow>(pkgDb, "renders");
            aggregated.renders.push(
              ...rRows.map((r) => ({
                ...r,
                id: `${pkgPrefix}${r.id}`,
                file_id: fileIdOffset + r.file_id,
                parent_entity_id: `${pkgPrefix}${r.parent_entity_id}`,
                parent_render_id: r.parent_render_id
                  ? `${pkgPrefix}${r.parent_render_id}`
                  : null,
                symbol_id: r.symbol_id ? `${pkgPrefix}${r.symbol_id}` : null,
              })),
            );
          }

          // 7. Exports
          if (options.includeExports) {
            const expRows = requiredRows<ExportRow>(pkgDb, "exports");
            aggregated.exports.push(
              ...expRows.map((e) => ({
                ...e,
                id: `${pkgPrefix}${e.id}`,
                scope_id: `${pkgPrefix}${e.scope_id}`,
                symbol_id: e.symbol_id ? `${pkgPrefix}${e.symbol_id}` : null,
                entity_id: e.entity_id ? `${pkgPrefix}${e.entity_id}` : null,
              })),
            );
          }

          // 8. Relations
          if (options.includeRelations) {
            const relRows = requiredRows<RelationRow>(pkgDb, "relations");
            aggregated.relations.push(
              ...relRows.map((r) => ({
                ...r,
                from_id: `${pkgPrefix}${r.from_id}`,
                to_id: `${pkgPrefix}${r.to_id}`,
              })),
            );
          }
        } finally {
          pkgDb.close();
        }
      });

      return aggregated;
    }

    // Default: Single project database
    return {
      packages: options.includePackages
        ? optionalRows<PackageRow>(db, "packages")
        : [],
      package_dependencies: options.includePackageDependencies
        ? optionalRows<PackageDependencyRow>(db, "package_dependencies")
        : [],
      files: options.includeFiles ? requiredRows<FileRow>(db, "files") : [],
      entities: options.includeEntities
        ? requiredRows<EntityRow>(db, "entities")
        : [],
      scopes: options.includeScopes ? requiredRows<ScopeRow>(db, "scopes") : [],
      symbols: options.includeSymbols
        ? requiredRows<SymbolRow>(db, "symbols")
        : [],
      renders: options.includeRenders
        ? requiredRows<RenderRow>(db, "renders")
        : [],
      exports: options.includeExports
        ? requiredRows<ExportRow>(db, "exports")
        : [],
      relations: options.includeRelations
        ? requiredRows<RelationRow>(db, "relations")
        : [],
      uiState: options.includeUiState ? readUIState(db) : {},
      diff: undefined,
    };
  } finally {
    db.close();
  }
}
