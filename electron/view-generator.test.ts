import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseData } from "@nexiq/shared";

const { mockReadGraphSnapshotFromSqlite, mockOpenUnifiedDatabase } = vi.hoisted(() => ({
  mockReadGraphSnapshotFromSqlite: vi.fn(),
  mockOpenUnifiedDatabase: vi.fn(),
}));

vi.mock("./graph-snapshot-db", () => ({
  readGraphSnapshotFromSqlite: mockReadGraphSnapshotFromSqlite,
  openUnifiedDatabase: mockOpenUnifiedDatabase,
}));

vi.mock("../src/views/registry", () => ({
  getTasksForView: () => [
    {
      id: "test-task",
      priority: 1,
      run: (_data: DatabaseData) => ({
        nodes: [{ id: "symbol:App", ui: { existing: true } }],
        edges: [],
        combos: [],
        typeData: {},
      }),
    },
  ],
  registerTask: vi.fn(),
  serializeRegistry: () => ({
    registry: {
      component: [{ id: "test-task", priority: 1 }],
    },
  }),
}));

import {
  generateGraphView,
  getSerializedViewRegistry,
} from "./view-generator";

describe("view-generator", () => {
  beforeEach(() => {
    mockReadGraphSnapshotFromSqlite.mockReset();
    mockOpenUnifiedDatabase.mockReset();
    mockOpenUnifiedDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
      close: vi.fn(),
    });
  });

  it("applies UI state for sqlite-backed generation", async () => {
    mockReadGraphSnapshotFromSqlite.mockReturnValue({
      packages: [],
      package_dependencies: [],
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
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
    });

    const result = await generateGraphView({
      sqlitePath: "/tmp/test.sqlite",
      projectRoot: "/repo",
      view: "component",
    });

    expect(result.nodes[0]).toMatchObject({
      id: "symbol:App",
      x: 10,
      y: 20,
      radius: 30,
    });
    expect(mockReadGraphSnapshotFromSqlite).toHaveBeenCalledWith(
      "/tmp/test.sqlite",
      undefined,
      {
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
    );
  });

  it("supports repeated sqlite-backed generation without renderer worker state", async () => {
    mockReadGraphSnapshotFromSqlite.mockReturnValue({
      packages: [],
      package_dependencies: [],
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
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
    });

    const first = await generateGraphView({
      sqlitePath: "/tmp/test.sqlite",
      projectRoot: "/repo",
      view: "component",
    });
    const second = await generateGraphView({
      sqlitePath: "/tmp/test.sqlite",
      projectRoot: "/repo",
      view: "component",
    });

    expect(first.nodes[0]?.id).toBe("symbol:App");
    expect(second.nodes[0]).toMatchObject({ x: 10, y: 20 });
    expect(mockReadGraphSnapshotFromSqlite).toHaveBeenCalledTimes(2);
  });

  it("supports diff-based generation from snapshot data", async () => {
    const result = await generateGraphView({
      projectRoot: "/repo",
      view: "component",
      snapshotData: {
        packages: [],
        package_dependencies: [],
        files: [],
        entities: [],
        scopes: [],
        symbols: [],
        renders: [],
        exports: [],
        relations: [],
        uiState: {
          "symbol:App": {
            x: 100,
            y: 200,
            radius: 40,
            collapsedRadius: undefined,
            expandedRadius: undefined,
            isLayoutCalculated: true,
            collapsed: false,
          },
        },
      },
    });

    expect(result.nodes[0]).toMatchObject({
      id: "symbol:App",
      x: 100,
      y: 200,
      radius: 40,
    });
  });

  it("serializes the backend registry for devtools", () => {
    expect(getSerializedViewRegistry()).toEqual({
      registry: {
        component: [{ id: "test-task", priority: 1 }],
      },
    });
  });
});
