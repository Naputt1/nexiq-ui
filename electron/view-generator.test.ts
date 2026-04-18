import { beforeEach, describe, expect, it, vi } from "vitest";
import { type GraphViewResult, type GraphViewTask } from "@nexiq/extension-sdk";
import { getTasksForView } from "../src/views/registry";

const { mockReadGraphSnapshotFromSqlite, mockOpenUnifiedDatabase } = vi.hoisted(
  () => ({
    mockReadGraphSnapshotFromSqlite: vi.fn(),
    mockOpenUnifiedDatabase: vi.fn(),
  }),
);

vi.mock("./graph-snapshot-db", () => ({
  readGraphSnapshotFromSqlite: mockReadGraphSnapshotFromSqlite,
  openUnifiedDatabase: mockOpenUnifiedDatabase,
}));

vi.mock("../src/views/registry", () => ({
  getTasksForView: vi.fn(() => [
    {
      id: "test-task",
      priority: 1,
      run: (_data: GraphViewResult): GraphViewResult => ({
        nodes: [
          { id: "symbol:App", name: "App", ui: { existing: true }, radius: 20 },
        ],
        edges: [],
        combos: [
          {
            id: "combo:Main",
            name: "Main",
            radius: 40,
            collapsedRadius: 40,
            expandedRadius: 100,
          },
        ],
        typeData: {},
      }),
    },
  ]),
  registerTask: vi.fn(),
  serializeRegistry: vi.fn(() => ({
    registry: {
      component: [{ id: "test-task", priority: 1 }],
    },
  })),
}));

import { generateGraphView, getSerializedViewRegistry } from "./view-generator";

describe("view-generator", () => {
  beforeEach(() => {
    mockReadGraphSnapshotFromSqlite.mockReset();
    mockOpenUnifiedDatabase.mockReset();
    mockOpenUnifiedDatabase.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) }),
      close: vi.fn(),
    });
  });

  it("generates graph view for sqlite-backed generation", async () => {
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
      uiState: {},
    });

    const result = await generateGraphView({
      sqlitePath: "/tmp/test.sqlite",
      projectRoot: "/repo",
      view: "component",
    });

    expect(result.result.nodes[0]).toMatchObject({
      id: "symbol:App",
      radius: 20,
    });
  });

  it("supports repeated sqlite-backed generation", async () => {
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
      uiState: {},
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

    expect(first.result.nodes[0]?.id).toBe("symbol:App");
    expect(second.result.nodes[0]?.id).toBe("symbol:App");
  });

  it("supports generation from snapshot data", async () => {
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
        uiState: {},
      },
    });

    expect(result.result.nodes[0]).toMatchObject({
      id: "symbol:App",
      radius: 20,
    });
  });

  it("preserves appearanceOverride in nodes", async () => {
    vi.mocked(getTasksForView).mockReturnValue([
      {
        id: "override-task",
        priority: 1,
        run: (res: GraphViewResult): GraphViewResult => ({
          ...res,
          nodes: [
            {
              id: "node:1",
              name: "Node 1",
              appearanceOverride: { color: "red", radius: 50 },
              radius: 50,
            },
          ],
        }),
      },
    ] as GraphViewTask[]);

    const result = await generateGraphView({
      projectRoot: "/repo",
      view: "component",
      sqlitePath: "/tmp/test.sqlite",
    });

    expect(result.result.nodes[0]).toMatchObject({
      id: "node:1",
      radius: 50,
      appearanceOverride: { color: "red", radius: 50 },
    });
  });

  it("preserves appearanceOverride in combos", async () => {
    vi.mocked(getTasksForView).mockReturnValue([
      {
        id: "combo-task",
        priority: 1,
        run: (res: GraphViewResult): GraphViewResult => ({
          ...res,
          combos: [
            {
              id: "combo:1",
              name: "Combo 1",
              appearanceOverride: { collapsedRadius: 60, expandedRadius: 120 },
              collapsedRadius: 60,
              expandedRadius: 120,
            },
          ],
        }),
      },
    ] as GraphViewTask[]);

    const result = await generateGraphView({
      projectRoot: "/repo",
      view: "component",
      sqlitePath: "/tmp/test.sqlite",
    });

    expect(result.result.combos[0]).toMatchObject({
      id: "combo:1",
      collapsedRadius: 60,
      expandedRadius: 120,
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
