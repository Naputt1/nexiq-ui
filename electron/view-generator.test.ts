import { beforeEach, describe, expect, it, vi } from "vitest";
import { type GraphViewResult, type GraphViewTask } from "@nexiq/extension-sdk";
import { getTasksForView } from "../src/views/registry";

const {
  mockReadGraphSnapshotFromSqlite,
  mockOpenUnifiedDatabase,
  mockReadUIState,
} = vi.hoisted(() => ({
  mockReadGraphSnapshotFromSqlite: vi.fn(),
  mockOpenUnifiedDatabase: vi.fn(),
  mockReadUIState: vi.fn(() => ({})),
}));

vi.mock("./graph-snapshot-db", () => ({
  readGraphSnapshotFromSqlite: mockReadGraphSnapshotFromSqlite,
  openUnifiedDatabase: mockOpenUnifiedDatabase,
  readUIState: mockReadUIState,
}));

vi.mock("../src/views/registry", () => ({
  getTasksForView: vi.fn(() => [
    {
      id: "test-task",
      priority: 1,
      run: (_data: GraphViewResult): GraphViewResult => ({
        nodes: [{ id: "symbol:App", name: "App", ui: { existing: true }, radius: 20 } as any],
        edges: [],
        combos: [
          {
            id: "combo:Main",
            name: "Main",
            radius: 40,
            collapsedRadius: 40,
            expandedRadius: 100,
          } as any,
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
    mockReadUIState.mockReset();
    mockReadUIState.mockReturnValue({});
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
    mockReadUIState.mockReturnValue({
      "symbol:App": {
        x: 10,
        y: 20,
        radius: 30,
        collapsedRadius: undefined,
        expandedRadius: undefined,
        isLayoutCalculated: true,
        collapsed: false,
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
      radius: 20, // Ignore 30 from UI state
    });
    expect(mockReadUIState).toHaveBeenCalledTimes(1);
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
    mockReadUIState.mockReturnValue({
      "symbol:App": {
        x: 10,
        y: 20,
        radius: 30,
        collapsedRadius: undefined,
        expandedRadius: undefined,
        isLayoutCalculated: true,
        collapsed: false,
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
    expect(mockReadUIState).toHaveBeenCalledTimes(2);
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
      radius: 20, // Ignore 40 from UI state
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
            } as any,
          ],
        }),
      },
    ] as GraphViewTask[]);

    mockReadUIState.mockReturnValue({
      "node:1": { x: 100, y: 100, radius: 20 },
    });

    const result = await generateGraphView({
      projectRoot: "/repo",
      view: "component",
    });

    expect(result.nodes[0]).toMatchObject({
      id: "node:1",
      radius: 50, // Lock winning
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
            } as any,
          ],
        }),
      },
    ] as GraphViewTask[]);

    mockReadUIState.mockReturnValue({
      "combo:1": {
        x: 0,
        y: 0,
        radius: 30,
        collapsedRadius: 30,
        expandedRadius: 100,
      },
    });

    const result = await generateGraphView({
      projectRoot: "/repo",
      view: "component",
    });

    expect(result.combos[0]).toMatchObject({
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
