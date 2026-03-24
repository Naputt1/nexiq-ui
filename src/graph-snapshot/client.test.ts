import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  LargeDataKind,
  SharedGraphSnapshotHandle,
} from "./types";

const open = vi.fn<
  (
    kind: LargeDataKind,
    args: {
      projectRoot: string;
      analysisPath?: string;
      commitHash?: string;
      subPath?: string;
    },
  ) => Promise<SharedGraphSnapshotHandle>
>();
const getHandle = vi.fn<
  (
    kind: LargeDataKind,
    args: {
      projectRoot: string;
      analysisPath?: string;
      commitHash?: string;
      subPath?: string;
    },
  ) => Promise<SharedGraphSnapshotHandle>
>();

describe("graph snapshot client", () => {
  beforeEach(() => {
    vi.resetModules();
    open.mockReset();
    getHandle.mockReset();
    (globalThis as unknown as { window: unknown }).window = {
      largeData: {
        open,
        getHandle,
      },
    };
  });

  it("uses invoke-backed snapshot methods for open and get-handle", async () => {
    open.mockImplementation(async (kind, args) => ({
      key: args.analysisPath || args.projectRoot,
      kind,
      version: 1,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    }));
    getHandle.mockImplementation(async (kind, args) => ({
      key: args.analysisPath || args.projectRoot,
      kind,
      version: 1,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    }));

    const { getGraphSnapshotHandle, openGraphSnapshot } =
      await import("./client");

    const openHandle = await openGraphSnapshot("/repo", "/repo/pkg");
    const refreshedHandle = await getGraphSnapshotHandle("/repo", "/repo/pkg");

    expect(open).toHaveBeenCalledWith("graph", {
      projectRoot: "/repo",
      analysisPath: "/repo/pkg",
    });
    expect(getHandle).toHaveBeenCalledWith("graph", {
      projectRoot: "/repo",
      analysisPath: "/repo/pkg",
    });
    expect(openHandle.key).toBe("/repo/pkg");
    expect(refreshedHandle.key).toBe("/repo/pkg");
  });

  it("rejects when open fails", async () => {
    open.mockRejectedValue(new Error("boom"));

    const { openGraphSnapshot } = await import("./client");

    await expect(openGraphSnapshot("/repo")).rejects.toThrow("boom");
  });

  it("bridges worker snapshot requests over invoke-backed APIs", async () => {
    const postedMessages: GraphSnapshotPortResponse[] = [];
    const port = {
      onmessage: null,
      onmessageerror: null,
      postMessage(message: GraphSnapshotPortResponse) {
        postedMessages.push(message);
      },
      close() {},
    } as unknown as MessagePort;

    open.mockResolvedValue({
      key: "/repo/pkg",
      kind: "graph",
      version: 1,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    });

    const { bridgeGraphSnapshotPort } = await import("./client");
    bridgeGraphSnapshotPort(port);

    await port.onmessage?.({
      data: {
        type: "open",
        kind: "graph",
        requestId: "req-1",
        projectRoot: "/repo",
        analysisPath: "/repo/pkg",
      } satisfies GraphSnapshotPortRequest,
    } as MessageEvent<GraphSnapshotPortRequest>);

    expect(postedMessages).toEqual([
      {
        type: "handle",
        kind: "graph",
        requestId: "req-1",
        handle: expect.objectContaining({ key: "/repo/pkg" }),
      },
    ]);
  });
});
