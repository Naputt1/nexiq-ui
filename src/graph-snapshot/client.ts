import { decodeGraphSnapshot } from "./codec";
import { GRAPH_SNAPSHOT_META_INDEX, GRAPH_SNAPSHOT_STATUS } from "./constants";
import type {
  LargeDataKind,
  LargeDataRequestArgs,
  LargeDataUpdateEvent,
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  GraphSnapshotUpdateEvent,
  SharedLargeDataHandle,
  SharedGraphSnapshotHandle,
} from "./types";
import { decodeGraphViewSnapshot } from "../view-snapshot/codec";

export function getGraphSnapshotKey(projectRoot: string, analysisPath?: string) {
  return analysisPath || projectRoot;
}

export function getGitCommitAnalysisKey(
  projectRoot: string,
  commitHash: string,
  subPath?: string,
) {
  return `${projectRoot}::${commitHash}::${subPath || ""}`;
}

function createGraphSnapshotError(message: string) {
  return new Error(message);
}

export async function openLargeData(
  kind: LargeDataKind,
  args: LargeDataRequestArgs,
): Promise<SharedLargeDataHandle> {
  return window.largeData.open(kind, args);
}

export async function getLargeDataHandle(
  kind: LargeDataKind,
  args: LargeDataRequestArgs,
): Promise<SharedLargeDataHandle> {
  return window.largeData.getHandle(kind, args);
}

export async function refreshLargeData(
  kind: LargeDataKind,
  args: LargeDataRequestArgs,
) {
  await window.largeData.refresh(kind, args);
}

export function subscribeLargeData(
  listener: (payload: LargeDataUpdateEvent) => void,
) {
  return window.largeData.onUpdate(listener);
}

export async function openGraphSnapshot(
  projectRoot: string,
  analysisPath?: string,
): Promise<SharedGraphSnapshotHandle> {
  return openLargeData("graph", { projectRoot, analysisPath });
}

export async function getGraphSnapshotHandle(
  projectRoot: string,
  analysisPath?: string,
): Promise<SharedGraphSnapshotHandle> {
  return getLargeDataHandle("graph", { projectRoot, analysisPath });
}

export async function refreshGraphSnapshot(
  projectRoot: string,
  analysisPath?: string,
) {
  await refreshLargeData("graph", { projectRoot, analysisPath });
}

export function subscribeGraphSnapshot(
  listener: (payload: GraphSnapshotUpdateEvent) => void,
) {
  return subscribeLargeData((payload) => {
    if (payload.kind === "graph") {
      listener(payload);
    }
  });
}

export async function openGitCommitAnalysisSnapshot(
  projectRoot: string,
  commitHash: string,
  subPath?: string,
) {
  return openLargeData("git-commit-analysis", {
    projectRoot,
    commitHash,
    subPath,
  });
}

export async function openDiffAnalysisSnapshot(
  projectRoot: string,
  selectedCommit: string | null,
  subPath?: string,
) {
  return openLargeData("diff-analysis", {
    projectRoot,
    selectedCommit,
    subPath,
  });
}

export async function openViewResultSnapshot(args: LargeDataRequestArgs) {
  return openLargeData("view-result", args);
}

export function bridgeGraphSnapshotPort(port: MessagePort) {
  port.onmessage = async (event: MessageEvent<GraphSnapshotPortRequest>) => {
    const request = event.data;

    try {
      const handle =
        request.type === "open"
          ? await openLargeData(request.kind, request)
          : await getLargeDataHandle(request.kind, request);

      port.postMessage({
        type: "handle",
        kind: request.kind,
        requestId: request.requestId,
        handle,
      } satisfies GraphSnapshotPortResponse);
    } catch (error) {
      port.postMessage({
        type: "error",
        kind: request.kind,
        requestId: request.requestId,
        key:
          request.kind === "graph"
            ? getGraphSnapshotKey(request.projectRoot, request.analysisPath)
            : getGitCommitAnalysisKey(
                request.projectRoot,
                request.commitHash || "",
                request.subPath,
              ),
        message:
          error instanceof Error
            ? error.message
            : createGraphSnapshotError(String(error)).message,
      } satisfies GraphSnapshotPortResponse);
    }
  };

  port.onmessageerror = () => {
    port.close();
  };

  return () => {
    port.onmessage = null;
    port.onmessageerror = null;
    port.close();
  };
}

function readMetaValue(meta: Int32Array, index: number): number {
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    meta.buffer instanceof SharedArrayBuffer
  ) {
    return Atomics.load(meta, index);
  }
  return meta[index];
}

export function readGraphSnapshotData(handle: SharedGraphSnapshotHandle) {
  const meta = new Int32Array(handle.metaBuffer);
  const status = readMetaValue(meta, GRAPH_SNAPSHOT_META_INDEX.status);
  if (status !== GRAPH_SNAPSHOT_STATUS.READY) {
    throw new Error(`Graph snapshot not ready. status=${status}`);
  }
  const byteLength = readMetaValue(meta, GRAPH_SNAPSHOT_META_INDEX.byteLength);
  return decodeGraphSnapshot(new Uint8Array(handle.dataBuffer, 0, byteLength));
}

export const readLargeData = readGraphSnapshotData;

export function readViewResultData(handle: SharedLargeDataHandle) {
  const meta = new Int32Array(handle.metaBuffer);
  const status = readMetaValue(meta, GRAPH_SNAPSHOT_META_INDEX.status);
  if (status !== GRAPH_SNAPSHOT_STATUS.READY) {
    throw new Error(`View result not ready. status=${status}`);
  }
  const byteLength = readMetaValue(meta, GRAPH_SNAPSHOT_META_INDEX.byteLength);
  return decodeGraphViewSnapshot(
    new Uint8Array(handle.dataBuffer, 0, byteLength),
  );
}
