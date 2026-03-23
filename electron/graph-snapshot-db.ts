import Database from "better-sqlite3";
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

export function readGraphSnapshotFromSqlite(sqlitePath: string): GraphSnapshotData {
  const db = new Database(sqlitePath, { readonly: true });
  try {
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
