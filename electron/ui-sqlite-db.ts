import { SqliteDB } from "@nexiq/shared/db";
import type { Database } from "better-sqlite3";
import { type UIStateMap } from "../src/graph/types";

interface UIStateRow {
  id: string;
  view_name: string;
  x: number;
  y: number;
  radius: number | null;
  collapsed_radius: number | null;
  expanded_radius: number | null;
  is_layout_calculated: number;
  collapsed: number;
}

export class UISqliteDB extends SqliteDB {
  constructor(db: Database) {
    super(db);
    this.initUISchema();
  }

  private initUISchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ui_state (
        id TEXT,
        view_name TEXT,
        x REAL,
        y REAL,
        radius REAL,
        collapsed_radius REAL,
        expanded_radius REAL,
        is_layout_calculated BOOLEAN,
        collapsed BOOLEAN,
        PRIMARY KEY (id, view_name)
      );
    `);
  }

  public saveUIState(positions: UIStateMap, viewName: string) {
    const upsert = this.db.prepare(`
      INSERT OR REPLACE INTO ui_state (
        id, view_name, x, y, radius, collapsed_radius, expanded_radius, is_layout_calculated, collapsed
      ) VALUES (
        @id, @view_name, @x, @y, @radius, @collapsed_radius, @expanded_radius, @is_layout_calculated, @collapsed
      )
    `);

    const transaction = this.db.transaction((states: UIStateMap) => {
      for (const [id, state] of Object.entries(states)) {
        upsert.run({
          id,
          view_name: viewName,
          x: state.x,
          y: state.y,
          radius: state.radius ?? null,
          collapsed_radius: state.collapsedRadius ?? null,
          expanded_radius: state.expandedRadius ?? null,
          is_layout_calculated: state.isLayoutCalculated ? 1 : 0,
          collapsed: state.collapsed ? 1 : 0,
        });
      }
    });

    transaction(positions);
  }

  public getUIState(viewName: string): UIStateMap {
    const rows = this.db
      .prepare("SELECT * FROM ui_state WHERE view_name = ?")
      .all(viewName) as UIStateRow[];
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
}
