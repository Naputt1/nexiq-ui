import { describe, expect, it } from "vitest";
import { decodeGraphSnapshot, encodeGraphSnapshot } from "./codec";
import { withGraphSnapshotIndexes } from "./indexes";
import type { GraphSnapshotData } from "./types";

const snapshotFixture: GraphSnapshotData = {
  packages: [
    {
      id: "app@1.0.0",
      name: "app",
      version: "1.0.0",
      path: "/repo/packages/app",
    },
  ],
  package_dependencies: [
    {
      id: 1,
      package_id: "app@1.0.0",
      dependency_name: "react",
      dependency_version: "19.0.0",
      is_dev: false,
    },
  ],
  files: [
    {
      id: 1,
      path: "/repo/packages/app/src/App.tsx",
      package_id: "app@1.0.0",
      hash: "hash",
      fingerprint: "fingerprint",
      default_export: "App",
      star_exports_json: "[]",
    },
  ],
  entities: [
    {
      id: "entity:App",
      scope_id: "scope:module",
      kind: "component",
      name: "App",
      type: "function",
      line: 1,
      column: 1,
      end_line: 10,
      end_column: 1,
      declaration_kind: "const",
      data_json: null,
    },
  ],
  scopes: [
    {
      id: "scope:module",
      file_id: 1,
      parent_id: null,
      kind: "module",
      entity_id: null,
      data_json: null,
    },
  ],
  symbols: [
    {
      id: "symbol:App",
      entity_id: "entity:App",
      scope_id: "scope:module",
      name: "App",
      path: null,
      is_alias: 0,
      has_default: 1,
      data_json: null,
    },
  ],
  renders: [],
  exports: [
    {
      id: "export:App",
      scope_id: "scope:module",
      symbol_id: "symbol:App",
      entity_id: null,
      name: "default",
      is_default: 1,
    },
  ],
  relations: [],
  uiState: {
    "symbol:App": {
      x: 10,
      y: 20,
      radius: 30,
      collapsedRadius: undefined,
      expandedRadius: undefined,
      isLayoutCalculated: true,
      collapsed: false,
    },
  },
  diff: {
    added: ["symbol:App"],
    modified: [],
    deleted: [],
  },
};

describe("graph snapshot codec", () => {
  it("round-trips schema v5 graph data through FlatBuffers", () => {
    const encoded = encodeGraphSnapshot(snapshotFixture);
    const decoded = decodeGraphSnapshot(encoded);

    expect(decoded.packages).toEqual(snapshotFixture.packages);
    expect(decoded.package_dependencies).toEqual([
      {
        ...snapshotFixture.package_dependencies[0],
        id: 0,
      },
    ]);
    expect(decoded.files).toEqual(snapshotFixture.files);
    expect(decoded.entities).toEqual(snapshotFixture.entities);
    expect(decoded.scopes).toEqual(snapshotFixture.scopes);
    expect(decoded.symbols).toEqual(snapshotFixture.symbols);
    expect(decoded.exports).toEqual(snapshotFixture.exports);
    expect(decoded.uiState["symbol:App"]).toEqual(
      snapshotFixture.uiState["symbol:App"],
    );
    expect(decoded.diff).toEqual(snapshotFixture.diff);
  });

  it("builds stable indexes for task execution", () => {
    const indexed = withGraphSnapshotIndexes(snapshotFixture);

    expect(indexed.__indexes.entityById.get("entity:App")?.name).toBe("App");
    expect(indexed.__indexes.fileById.get(1)?.path).toBe(
      "/repo/packages/app/src/App.tsx",
    );
    expect(
      indexed.__indexes.packageDependenciesByPackageId.get("app@1.0.0")?.[0]
        ?.dependency_name,
    ).toBe("react");
  });
});
