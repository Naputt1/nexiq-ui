import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  SharedGraphSnapshotHandle,
} from "./types";

const open = vi.fn<
  (projectRoot: string, analysisPath?: string) => Promise<SharedGraphSnapshotHandle>
>();
const getHandle = vi.fn<
  (projectRoot: string, analysisPath?: string) => Promise<SharedGraphSnapshotHandle>
>();

describe("graph snapshot client", () => {
  beforeEach(() => {
    vi.resetModules();
    open.mockReset();
    getHandle.mockReset();
    (
      globalThis as typeof globalThis & {
        window: Window & {
          graphSnapshot: {
            open: typeof open;
            getHandle: typeof getHandle;
          };
        };
      }
    ).window = {
      graphSnapshot: {
        open,
        getHandle,
      },
    } as Window & {
      graphSnapshot: {
        open: typeof open;
        getHandle: typeof getHandle;
      };
    };
  });

  it("uses invoke-backed snapshot methods for open and get-handle", async () => {
    open.mockImplementation(async (projectRoot, analysisPath) => ({
      key: analysisPath || projectRoot,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    }));
    getHandle.mockImplementation(async (projectRoot, analysisPath) => ({
      key: analysisPath || projectRoot,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    }));

    const { getGraphSnapshotHandle, openGraphSnapshot } = await import("./client");

    const openHandle = await openGraphSnapshot("/repo", "/repo/pkg");
    const refreshedHandle = await getGraphSnapshotHandle("/repo", "/repo/pkg");

    expect(open).toHaveBeenCalledWith("/repo", "/repo/pkg");
    expect(getHandle).toHaveBeenCalledWith("/repo", "/repo/pkg");
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
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
    });

    const { bridgeGraphSnapshotPort } = await import("./client");
    bridgeGraphSnapshotPort(port);

    await port.onmessage?.({
      data: {
        type: "open",
        requestId: "req-1",
        projectRoot: "/repo",
        analysisPath: "/repo/pkg",
      } satisfies GraphSnapshotPortRequest,
    } as MessageEvent<GraphSnapshotPortRequest>);

    expect(postedMessages).toEqual([
      {
        type: "handle",
        requestId: "req-1",
        handle: expect.objectContaining({ key: "/repo/pkg" }),
      },
    ]);
  });
});
