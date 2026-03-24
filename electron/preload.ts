import { ipcRenderer, contextBridge, type IpcRendererEvent } from "electron";
import type { IpcEvents } from "./types";
import type {
  GraphSnapshotPortRequest,
  LargeDataKind,
  LargeDataRequestArgs,
  SharedLargeDataHandle,
  SharedGraphSnapshotHandle,
  LargeDataUpdateEvent,
  GraphSnapshotUpdateEvent,
} from "../src/graph-snapshot/types";
// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld("ipcRenderer", {
  on<K extends keyof IpcEvents>(
    channel: K,
    listener: (payload: IpcEvents[K]) => void,
  ) {
    const wrappedListener = (_event: IpcRendererEvent, payload: IpcEvents[K]) =>
      listener(payload);
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
    resolve: (handle: SharedLargeDataHandle) => void;
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

function handleGraphSnapshotPortMessage(event: MessageEvent) {
  const message = event.data as {
    requestId: string;
    type: string;
    handle: SharedLargeDataHandle;
    message: string;
  };
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
  ipcRenderer.postMessage("large-data-connect", null, [channel.port1]);
  return graphSnapshotPort;
}

function requestGraphSnapshotHandle(
  kind: LargeDataKind,
  type: GraphSnapshotPortRequest["type"],
  args: LargeDataRequestArgs,
): Promise<SharedLargeDataHandle> {
  const port = ensureGraphSnapshotPort();
  return new Promise((resolve, reject) => {
    const requestId = `graph-snapshot-${graphSnapshotRequestId++}`;
    const timeout = setTimeout(() => {
      graphSnapshotPendingRequests.delete(requestId);
      reject(new Error(`Timed out waiting for graph snapshot ${type}`));
    }, 30000);

    graphSnapshotPendingRequests.set(requestId, { resolve, reject, timeout });
    port.postMessage({
      kind,
      type,
      requestId,
      ...args,
    } satisfies GraphSnapshotPortRequest);
  });
}

contextBridge.exposeInMainWorld("largeData", {
  open(kind: LargeDataKind, args: LargeDataRequestArgs) {
    if (kind === "diff-analysis" || kind === "view-result") {
      return ipcRenderer.invoke("open-inline-large-data", {
        kind,
        ...args,
      });
    }
    return requestGraphSnapshotHandle(kind, "open", args);
  },
  getHandle(kind: LargeDataKind, args: LargeDataRequestArgs) {
    if (kind === "diff-analysis" || kind === "view-result") {
      return ipcRenderer.invoke("get-inline-large-data-handle", {
        kind,
        ...args,
      });
    }
    return requestGraphSnapshotHandle(kind, "get-handle", args);
  },
  refresh(kind: LargeDataKind, args: LargeDataRequestArgs) {
    return ipcRenderer.invoke("refresh-large-data", {
      kind,
      ...args,
    });
  },
  onUpdate(listener: (payload: LargeDataUpdateEvent) => void) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: LargeDataUpdateEvent,
    ) => listener(payload);
    ipcRenderer.on("large-data-updated", wrappedListener);
    return () => {
      ipcRenderer.removeListener("large-data-updated", wrappedListener);
    };
  },
});

contextBridge.exposeInMainWorld("graphSnapshot", {
  open(projectRoot: string, analysisPath?: string) {
    return requestGraphSnapshotHandle("graph", "open", {
      projectRoot,
      analysisPath,
    }) as Promise<SharedGraphSnapshotHandle>;
  },
  getHandle(projectRoot: string, analysisPath?: string) {
    return requestGraphSnapshotHandle("graph", "get-handle", {
      projectRoot,
      analysisPath,
    }) as Promise<SharedGraphSnapshotHandle>;
  },
  refresh(projectRoot: string, analysisPath?: string) {
    return ipcRenderer.invoke("refresh-large-data", {
      kind: "graph",
      projectRoot,
      analysisPath,
    });
  },
  onUpdate(listener: (payload: GraphSnapshotUpdateEvent) => void) {
    const wrappedListener = (
      _event: IpcRendererEvent,
      payload: GraphSnapshotUpdateEvent,
    ) => {
      if (
        payload &&
        typeof payload === "object" &&
        "kind" in payload &&
        payload.kind === "graph"
      ) {
        listener(payload);
      }
    };
    ipcRenderer.on("large-data-updated", wrappedListener);
    return () => {
      ipcRenderer.removeListener("large-data-updated", wrappedListener);
    };
  },
});
