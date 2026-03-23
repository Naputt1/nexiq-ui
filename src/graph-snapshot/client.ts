import { decodeGraphSnapshot } from "./codec";
import { GRAPH_SNAPSHOT_META_INDEX, GRAPH_SNAPSHOT_STATUS } from "./constants";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  GraphSnapshotUpdateEvent,
  SharedGraphSnapshotHandle,
} from "./types";

export function getGraphSnapshotKey(projectRoot: string, analysisPath?: string) {
  return analysisPath || projectRoot;
}

function createGraphSnapshotError(message: string) {
  return new Error(message);
}

export async function openGraphSnapshot(
  projectRoot: string,
  analysisPath?: string,
): Promise<SharedGraphSnapshotHandle> {
  return window.graphSnapshot.open(projectRoot, analysisPath);
}

export async function getGraphSnapshotHandle(
  projectRoot: string,
  analysisPath?: string,
): Promise<SharedGraphSnapshotHandle> {
  return window.graphSnapshot.getHandle(projectRoot, analysisPath);
}

export async function refreshGraphSnapshot(
  projectRoot: string,
  analysisPath?: string,
) {
  await window.graphSnapshot.refresh(projectRoot, analysisPath);
}

export function subscribeGraphSnapshot(
  listener: (payload: GraphSnapshotUpdateEvent) => void,
) {
  return window.graphSnapshot.onUpdate(listener);
}

export function bridgeGraphSnapshotPort(port: MessagePort) {
  port.onmessage = async (event: MessageEvent<GraphSnapshotPortRequest>) => {
    const request = event.data;

    try {
      const handle =
        request.type === "open"
          ? await openGraphSnapshot(request.projectRoot, request.analysisPath)
          : await getGraphSnapshotHandle(request.projectRoot, request.analysisPath);

      port.postMessage({
        type: "handle",
        requestId: request.requestId,
        handle,
      } satisfies GraphSnapshotPortResponse);
    } catch (error) {
      port.postMessage({
        type: "error",
        requestId: request.requestId,
        key: getGraphSnapshotKey(request.projectRoot, request.analysisPath),
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

export function readGraphSnapshotData(handle: SharedGraphSnapshotHandle) {
  const meta = new Int32Array(handle.metaBuffer);
  const status = Atomics.load(meta, GRAPH_SNAPSHOT_META_INDEX.status);
  if (status !== GRAPH_SNAPSHOT_STATUS.READY) {
    throw new Error(`Graph snapshot not ready. status=${status}`);
  }
  const byteLength = Atomics.load(meta, GRAPH_SNAPSHOT_META_INDEX.byteLength);
  return decodeGraphSnapshot(new Uint8Array(handle.dataBuffer, 0, byteLength));
}
