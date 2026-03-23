import { ipcRenderer, contextBridge, type IpcRendererEvent } from "electron";
import type { IpcEvents } from "./types";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  SharedGraphSnapshotHandle,
} from "../src/graph-snapshot/types";
// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on<K extends keyof IpcEvents>(
    channel: K,
    listener: (payload: IpcEvents[K]) => void,
  ) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: IpcEvents[K],
    ) => listener(payload);
    ipcRenderer.on(channel, wrappedListener);
    return () => {
      ipcRenderer.removeListener(channel, wrappedListener);
    };
  },

  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args;
    return ipcRenderer.send(channel, ...omit);
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args;
    return ipcRenderer.invoke(channel, ...omit);
  },
  runCommand: (cmd: string) => ipcRenderer.invoke("run-cli", cmd),

  // You can expose other APTs you need here.
  // ...
});

let graphSnapshotPort: MessagePort | null = null;
let graphSnapshotRequestId = 0;
const graphSnapshotPendingRequests = new Map<
  string,
  {
    resolve: (handle: SharedGraphSnapshotHandle) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

function resetGraphSnapshotPort() {
  graphSnapshotPort = null;
  for (const pending of graphSnapshotPendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("Graph snapshot port disconnected"));
  }
  graphSnapshotPendingRequests.clear();
}

function handleGraphSnapshotPortMessage(
  event: MessageEvent<GraphSnapshotPortResponse>,
) {
  const message = event.data;
  const pending = graphSnapshotPendingRequests.get(message.requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeout);
  graphSnapshotPendingRequests.delete(message.requestId);

  if (message.type === "handle") {
    pending.resolve(message.handle);
    return;
  }

  pending.reject(new Error(message.message));
}

function ensureGraphSnapshotPort(): MessagePort {
  if (graphSnapshotPort) {
    return graphSnapshotPort;
  }

  const channel = new MessageChannel();
  graphSnapshotPort = channel.port2;
  graphSnapshotPort.onmessage = handleGraphSnapshotPortMessage;
  graphSnapshotPort.onmessageerror = () => {
    resetGraphSnapshotPort();
  };
  ipcRenderer.postMessage("graph-snapshot-connect", null, [channel.port1]);
  return graphSnapshotPort;
}

function requestGraphSnapshotHandle(
  type: GraphSnapshotPortRequest["type"],
  projectRoot: string,
  analysisPath?: string,
): Promise<SharedGraphSnapshotHandle> {
  const port = ensureGraphSnapshotPort();
  return new Promise((resolve, reject) => {
    const requestId = `graph-snapshot-${graphSnapshotRequestId++}`;
    const timeout = setTimeout(() => {
      graphSnapshotPendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for graph snapshot ${type}`));
    }, 30000);

    graphSnapshotPendingRequests.set(requestId, { resolve, reject, timeout });
    port.postMessage({
      type,
      requestId,
      projectRoot,
      analysisPath,
    } satisfies GraphSnapshotPortRequest);
  });
}

contextBridge.exposeInMainWorld("graphSnapshot", {
  open(projectRoot: string, analysisPath?: string) {
    return requestGraphSnapshotHandle("open", projectRoot, analysisPath);
  },
  getHandle(projectRoot: string, analysisPath?: string) {
    return requestGraphSnapshotHandle("get-handle", projectRoot, analysisPath);
  },
  refresh(projectRoot: string, analysisPath?: string) {
    return ipcRenderer.invoke("refresh-graph-snapshot", {
      projectRoot,
      analysisPath,
    });
  },
  onUpdate(listener: (payload: unknown) => void) {
    const wrappedListener = (_event: IpcRendererEvent, payload: unknown) =>
      listener(payload);
    ipcRenderer.on("graph-snapshot-updated", wrappedListener);
    return () => {
      ipcRenderer.removeListener("graph-snapshot-updated", wrappedListener);
    };
  },
});
