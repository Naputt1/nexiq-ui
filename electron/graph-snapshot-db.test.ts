import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { readGraphSnapshotFromSqlite } from "./graph-snapshot-db";

const tempDirs: string[] = [];

function createDbPath(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-snapshot-"));
  tempDirs.push(dir);
  return path.join(dir, `${name}.sqlite`);
}

function createCoreSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL,
      package_id TEXT,
      hash TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      default_export TEXT,
      star_exports_json TEXT
    );
    CREATE TABLE entities (
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
    CREATE TABLE scopes (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL,
      parent_id TEXT,
      kind TEXT NOT NULL,
      entity_id TEXT,
      data_json TEXT
    );
    CREATE TABLE symbols (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT,
      is_alias BOOLEAN DEFAULT 0,
      has_default BOOLEAN DEFAULT 0,
      data_json TEXT
    );
    CREATE TABLE renders (
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
    CREATE TABLE exports (
      id TEXT PRIMARY KEY,
      scope_id TEXT NOT NULL,
      symbol_id TEXT,
      entity_id TEXT,
      name TEXT,
      is_default BOOLEAN DEFAULT 0
    );
    CREATE TABLE relations (
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER,
      column INTEGER,
      data_json TEXT
    );
  `);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("readGraphSnapshotFromSqlite", () => {
  it("loads graph core tables without requiring analysis tables", () => {
    const dbPath = createDbPath("core-only");
    const db = new Database(dbPath);
    createCoreSchema(db);
    db.prepare(
      "INSERT INTO files (id, path, package_id, hash, fingerprint, default_export, star_exports_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(1, "/src/App.tsx", null, "hash", "fingerprint", "App", "[]");
    db.prepare(
      "INSERT INTO scopes (id, file_id, parent_id, kind, entity_id, data_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("scope:module", 1, null, "module", null, null);
    db.prepare(
      "INSERT INTO entities (id, scope_id, kind, name, type, line, column, end_line, end_column, declaration_kind, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "entity:App",
      "scope:module",
      "component",
      "App",
      "function",
      1,
      1,
      10,
      1,
      "const",
      null,
    );
    db.prepare(
      "INSERT INTO symbols (id, entity_id, scope_id, name, path, is_alias, has_default, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("symbol:App", "entity:App", "scope:module", "App", null, 0, 1, null);
    db.prepare(
      "INSERT INTO exports (id, scope_id, symbol_id, entity_id, name, is_default) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("export:App", "scope:module", "symbol:App", null, "default", 1);
    db.exec(`
      CREATE TABLE ui_state (
        id TEXT PRIMARY KEY,
        x REAL,
        y REAL,
        radius REAL,
        collapsed_radius REAL,
        expanded_radius REAL,
        is_layout_calculated BOOLEAN,
        collapsed BOOLEAN
      );
    `);
    db.prepare(
      "INSERT INTO ui_state (id, x, y, radius, collapsed_radius, expanded_radius, is_layout_calculated, collapsed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("symbol:App", 10, 20, 30, null, null, 1, 0);
    db.close();

    const snapshot = readGraphSnapshotFromSqlite(dbPath);

    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.entities).toHaveLength(1);
    expect(snapshot.symbols).toHaveLength(1);
    expect(snapshot.packages).toEqual([]);
    expect(snapshot.package_dependencies).toEqual([]);
    expect(snapshot.uiState["symbol:App"]?.x).toBe(10);
  });

  it("loads package metadata only when package tables exist", () => {
    const dbPath = createDbPath("with-packages");
    const db = new Database(dbPath);
    createCoreSchema(db);
    db.exec(`
      CREATE TABLE packages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        path TEXT NOT NULL
      );
      CREATE TABLE package_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        package_id TEXT NOT NULL,
        dependency_name TEXT NOT NULL,
        dependency_version TEXT NOT NULL,
        is_dev BOOLEAN DEFAULT 0
      );
    `);
    db.prepare(
      "INSERT INTO packages (id, name, version, path) VALUES (?, ?, ?, ?)",
    ).run("app@1.0.0", "app", "1.0.0", "/repo/packages/app");
    db.prepare(
      "INSERT INTO package_dependencies (package_id, dependency_name, dependency_version, is_dev) VALUES (?, ?, ?, ?)",
    ).run("app@1.0.0", "react", "19.0.0", 0);
    db.close();

    const snapshot = readGraphSnapshotFromSqlite(dbPath);

    expect(snapshot.packages).toHaveLength(1);
    expect(snapshot.package_dependencies).toHaveLength(1);
    expect(snapshot.package_dependencies![0]?.dependency_name).toBe("react");
  });
});
