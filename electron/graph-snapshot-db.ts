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

function readUIState(db: Database.Database): UIStateMap {
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

export function readGraphSnapshotFromSqlite(
  sqlitePath: string,
  analysisPaths?: string[],
): GraphSnapshotData {
  const db = new Database(sqlitePath, { readonly: true });
  try {
    // Check if this is a workspace database
    if (tableExists(db, "workspace_packages")) {
      const workspacePackages =
        optionalRows<WorkspacePackageRow>(db, "workspace_packages");
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
        uiState: readUIState(db),
        diff: undefined,
      };

      // Read each package database
      filteredPackages.forEach((pkg, index) => {
        if (!fs.existsSync(pkg.db_path)) return;

        const pkgDb = new Database(pkg.db_path, { readonly: true });
        try {
          const pkgPath = pkg.path;
          const fileIdOffset = (index + 1) * 1000000;

          // Helper to qualify string IDs
          const qualify = (id: string | null | undefined) => {
            if (!id) return null;
            if (id.startsWith("workspace:")) return id;
            return `workspace:${pkgPath}:${id}`;
          };

          // 1. Packages & Dependencies (Add from pkgDb if available, otherwise use pkg from workspaceDb)
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
          aggregated.package_dependencies!.push(
            ...optionalRows<PackageDependencyRow>(
              pkgDb,
              "package_dependencies",
            ),
          );

          // 2. Files (Offset IDs)
          const fRows = requiredRows<FileRow>(pkgDb, "files");
          aggregated.files.push(
            ...fRows.map((f) => ({
              ...f,
              id: fileIdOffset + f.id,
              package_id: f.package_id || pkg.package_id,
            })),
          );

          // 3. Scopes (Qualify IDs, Offset file_id, Qualify parent_id & entity_id)
          const sRows = requiredRows<ScopeRow>(pkgDb, "scopes");
          aggregated.scopes.push(
            ...sRows.map((s) => ({
              ...s,
              id: qualify(s.id)!,
              file_id: fileIdOffset + s.file_id,
              parent_id: qualify(s.parent_id),
              entity_id: qualify(s.entity_id),
            })),
          );

          // 4. Entities (Qualify IDs, Qualify scope_id)
          const eRows = requiredRows<EntityRow>(pkgDb, "entities");
          aggregated.entities.push(
            ...eRows.map((e) => ({
              ...e,
              id: qualify(e.id)!,
              scope_id: qualify(e.scope_id)!,
            })),
          );

          // 5. Symbols (Qualify IDs, Qualify entity_id, Qualify scope_id)
          const symRows = requiredRows<SymbolRow>(pkgDb, "symbols");
          aggregated.symbols.push(
            ...symRows.map((s) => ({
              ...s,
              id: qualify(s.id)!,
              entity_id: qualify(s.entity_id)!,
              scope_id: qualify(s.scope_id)!,
            })),
          );

          // 6. Renders (Qualify IDs, Offset file_id, Qualify parent_entity_id, Qualify parent_render_id, Qualify symbol_id)
          const rRows = requiredRows<RenderRow>(pkgDb, "renders");
          aggregated.renders.push(
            ...rRows.map((r) => ({
              ...r,
              id: qualify(r.id)!,
              file_id: fileIdOffset + r.file_id,
              parent_entity_id: qualify(r.parent_entity_id)!,
              parent_render_id: qualify(r.parent_render_id),
              symbol_id: qualify(r.symbol_id),
            })),
          );

          // 7. Exports (Qualify IDs, Qualify scope_id, Qualify symbol_id, Qualify entity_id)
          const expRows = requiredRows<ExportRow>(pkgDb, "exports");
          aggregated.exports.push(
            ...expRows.map((e) => ({
              ...e,
              id: qualify(e.id)!,
              scope_id: qualify(e.scope_id)!,
              symbol_id: qualify(e.symbol_id),
              entity_id: qualify(e.entity_id),
            })),
          );

          // 8. Relations (Qualify from_id & to_id)
          const relRows = requiredRows<RelationRow>(pkgDb, "relations");
          aggregated.relations.push(
            ...relRows.map((r) => ({
              ...r,
              from_id: qualify(r.from_id)!,
              to_id: qualify(r.to_id)!,
            })),
          );
        } finally {
          pkgDb.close();
        }
      });

      return aggregated;
    }

    // Default: Single project database
    return {
      packages: optionalRows<PackageRow>(db, "packages"),
      package_dependencies: optionalRows<PackageDependencyRow>(
        db,
        "package_dependencies",
      ),
      files: requiredRows<FileRow>(db, "files"),
      entities: requiredRows<EntityRow>(db, "entities"),
      scopes: requiredRows<ScopeRow>(db, "scopes"),
      symbols: requiredRows<SymbolRow>(db, "symbols"),
      renders: requiredRows<RenderRow>(db, "renders"),
      exports: requiredRows<ExportRow>(db, "exports"),
      relations: requiredRows<RelationRow>(db, "relations"),
      uiState: readUIState(db),
      diff: undefined,
    };
  } finally {
    db.close();
  }
}
