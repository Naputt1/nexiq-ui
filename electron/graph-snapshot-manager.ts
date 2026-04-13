import {
  BrowserWindow,
  type MessagePortMain,
  type WebContents,
} from "electron";
import { type GraphNodeDetail } from "@nexiq/extension-sdk";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_SNAPSHOT_META_INDEX } from "../src/graph-snapshot/constants";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  LargeDataKind,
  LargeDataUpdateEvent,
} from "../src/graph-snapshot/types";

interface SnapshotController {
  kind: LargeDataKind;
  key: string;
  sqlitePath: string;
  worker: Worker;
  dataBuffer: ArrayBufferLike;
  metaBuffer: ArrayBufferLike;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (reason?: unknown) => void;
  inlineOnly?: boolean;
}

interface SnapshotPortSession {
  webContents: WebContents;
  port: MessagePortMain;
}

interface IncomingWorkerMessage extends LargeDataUpdateEvent {
  type:
    | "snapshot-updated"
    | "inline-result"
    | "inline-error"
    | "snapshot-error";
  requestId?: string;
  profilerRunId?: string;
  encoded?: Uint8Array;
  stages?: {
    id: string;
    name: string;
    startMs: number;
    endMs: number;
    parentId?: string;
    detail?: string;
  }[];
  details?: Record<string, GraphNodeDetail>;
}

interface OutgoingWorkerMessage {
  type: "initialize" | "refresh" | "generate-view" | "diff-analysis";
  kind?: LargeDataKind;
  key?: string;
  sqlitePath?: string;
  requestId?: string;
  [key: string]: unknown;
}

interface InlineRequest {
  resolve: (payload: {
    encoded: Uint8Array;
    stages?: {
      id: string;
      name: string;
      startMs: number;
      endMs: number;
      parentId?: string;
      detail?: string;
    }[];
    details?: Record<string, GraphNodeDetail>;
  }) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface ResolvedSnapshotPath {
  kind: LargeDataKind;
  key: string;
  sqlitePath: string;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
const bundledWorkerPath = path.resolve(
  currentModuleDir,
  "./graph-snapshot.worker.js",
);

export class GraphSnapshotManager {
  private controllers = new Map<string, SnapshotController>();
  private portSessions = new Map<number, Set<SnapshotPortSession>>();
  private inlineRequests = new Map<string, InlineRequest>();
  private readonly getWindows: () => BrowserWindow[];
  private readonly resolveSnapshotPath: (
    request: GraphSnapshotPortRequest,
  ) => Promise<ResolvedSnapshotPath>;

  constructor(
    getWindows: () => BrowserWindow[],
    resolveSnapshotPath: (
      request: GraphSnapshotPortRequest,
    ) => Promise<ResolvedSnapshotPath>,
  ) {
    this.getWindows = getWindows;
    this.resolveSnapshotPath = resolveSnapshotPath;
  }

  private broadcast(payload: LargeDataUpdateEvent) {
    for (const window of this.getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("large-data-updated", payload);
        if (payload.kind === "graph") {
          window.webContents.send("graph-snapshot-updated", payload);
        }
      }
    }
  }

  private getControllerId(kind: LargeDataKind, key: string) {
    return `${kind}:${key}`;
  }

  private createWorker(
    kind: LargeDataKind,
    key: string,
    sqlitePath: string,
    options?: { inlineOnly?: boolean },
  ): SnapshotController {
    const readyDeferred = deferred();
    const worker = new Worker(bundledWorkerPath, {});

    const controller: SnapshotController = {
      kind,
      key,
      sqlitePath,
      worker,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
      ready: readyDeferred.promise,
      resolveReady: readyDeferred.resolve,
      rejectReady: readyDeferred.reject,
      inlineOnly: options?.inlineOnly,
    };

    worker.on("message", (message: IncomingWorkerMessage) => {
      if (message.dataBuffer) {
        controller.dataBuffer = message.dataBuffer;
      }
      if (message.metaBuffer) {
        controller.metaBuffer = message.metaBuffer;
      }

      if (message.type === "snapshot-updated") {
        controller.resolveReady();
        this.broadcast({
          kind,
          key,
          snapshotVersion: message.snapshotVersion,
          byteLength: message.byteLength,
          status: message.status,
          handleChanged: message.handleChanged,
        });
        return;
      }

      if (
        message.type === "inline-result" &&
        message.requestId &&
        message.encoded
      ) {
        const request = this.inlineRequests.get(message.requestId);
        if (request) {
          clearTimeout(request.timeout);
          this.inlineRequests.delete(message.requestId);
          request.resolve({
            encoded: message.encoded,
            stages: message.stages,
            details: message.details,
          });
        }
        return;
      }

      if (message.type === "inline-error" && message.requestId) {
        const request = this.inlineRequests.get(message.requestId);
        if (request) {
          clearTimeout(request.timeout);
          this.inlineRequests.delete(message.requestId);
          request.reject(new Error(message.error));
        }
        return;
      }

      if (message.type === "snapshot-error") {
        controller.rejectReady(
          new Error(message.error ?? "Snapshot worker failed"),
        );
        this.broadcast({
          kind,
          key,
          snapshotVersion: message.snapshotVersion ?? 0,
          byteLength: message.byteLength ?? 0,
          status: message.status,
          handleChanged: message.handleChanged,
          error: message.error,
        });
        return;
      }
    });

    worker.on("error", (error: unknown) => {
      controller.rejectReady(error);
      const message = error instanceof Error ? error.message : String(error);
      this.broadcast({
        kind,
        key,
        snapshotVersion: 0,
        byteLength: 0,
        status: -1,
        error: message,
      });
    });

    if (options?.inlineOnly) {
      controller.resolveReady();
    } else {
      worker.postMessage({
        type: "initialize",
        kind,
        key,
        sqlitePath,
      });
    }

    this.controllers.set(this.getControllerId(kind, key), controller);
    return controller;
  }

  attachPort(webContents: WebContents, port: MessagePortMain) {
    const session: SnapshotPortSession = { webContents, port };
    const sessions = this.portSessions.get(webContents.id) ?? new Set();
    sessions.add(session);
    this.portSessions.set(webContents.id, sessions);

    const dispose = () => {
      const currentSessions = this.portSessions.get(webContents.id);
      if (currentSessions) {
        currentSessions.delete(session);
        if (currentSessions.size === 0) {
          this.portSessions.delete(webContents.id);
        }
      }
      port.close();
    };

    port.on("message", (event: { data: unknown }) => {
      void this.handlePortRequest(
        session,
        event.data as GraphSnapshotPortRequest,
      );
    });
    port.on("close", () => {
      const currentSessions = this.portSessions.get(webContents.id);
      if (currentSessions) {
        currentSessions.delete(session);
        if (currentSessions.size === 0) {
          this.portSessions.delete(webContents.id);
        }
      }
    });
    webContents.once("destroyed", dispose);
    port.start();
  }

  async requestInlineResult(
    kind: LargeDataKind,
    key: string,
    sqlitePath: string,
    message: OutgoingWorkerMessage,
  ): Promise<{
    encoded: Uint8Array;
    stages?: {
      id: string;
      name: string;
      startMs: number;
      endMs: number;
      parentId?: string;
      detail?: string;
    }[];
    details?: Record<string, GraphNodeDetail>;
  }> {
    const controllerId = this.getControllerId(kind, key);
    const existing = this.controllers.get(controllerId);
    const controller =
      existing && existing.sqlitePath === sqlitePath
        ? existing
        : this.createWorker(kind, key, sqlitePath, { inlineOnly: true });
    if (
      existing &&
      existing !== controller &&
      existing.sqlitePath !== sqlitePath
    ) {
      existing.worker.terminate();
    }

    await controller.ready;

    return new Promise((resolve, reject) => {
      const requestId = `inline-${Math.random().toString(36).substring(7)}`;
      const timeout = setTimeout(() => {
        this.inlineRequests.delete(requestId);
        reject(new Error(`Worker inline request timed out: ${message.type}`));
      }, 1800000);

      this.inlineRequests.set(requestId, { resolve, reject, timeout });
      controller.worker.postMessage({
        ...message,
        requestId,
      });
    });
  }

  private postPortMessage(
    session: SnapshotPortSession,
    response: GraphSnapshotPortResponse,
  ) {
    session.port.postMessage(response);
  }

  private async handlePortRequest(
    session: SnapshotPortSession,
    request: GraphSnapshotPortRequest,
  ) {
    try {
      const { kind, key, sqlitePath } = await this.resolveSnapshotPath(request);
      const handle = await this.open(kind, key, sqlitePath);
      this.postPortMessage(session, {
        type: "handle",
        kind,
        requestId: request.requestId,
        handle,
      });
    } catch (error) {
      const key =
        request.kind === "graph"
          ? request.analysisPath || request.projectRoot
          : `${request.projectRoot}::${request.commitHash || ""}::${request.subPath || ""}`;
      this.postPortMessage(session, {
        type: "error",
        kind: request.kind,
        requestId: request.requestId,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async open(kind: LargeDataKind, key: string, sqlitePath: string) {
    const controllerId = this.getControllerId(kind, key);
    const existing = this.controllers.get(controllerId);
    const controller =
      existing && existing.sqlitePath === sqlitePath
        ? existing
        : this.createWorker(kind, key, sqlitePath);

    if (existing && existing.sqlitePath !== sqlitePath) {
      existing.worker.terminate();
    }

    await controller.ready;

    return {
      key,
      kind,
      version:
        new Int32Array(controller.metaBuffer)[
          GRAPH_SNAPSHOT_META_INDEX.snapshotVersion
        ] ?? 0,
      dataBuffer: controller.dataBuffer,
      metaBuffer: controller.metaBuffer,
    };
  }

  async refresh(kind: LargeDataKind, key: string, sqlitePath?: string) {
    const controller = this.controllers.get(this.getControllerId(kind, key));
    if (!controller) {
      throw new Error(`No snapshot worker for ${kind}: ${key}`);
    }
    if (sqlitePath) {
      controller.sqlitePath = sqlitePath;
    }
    controller.worker.postMessage({
      type: "refresh",
      kind,
      sqlitePath: controller.sqlitePath,
    });
  }

  dispose() {
    for (const sessions of this.portSessions.values()) {
      for (const session of sessions) {
        session.port.close();
      }
    }
    this.portSessions.clear();
    for (const controller of this.controllers.values()) {
      controller.worker.terminate();
    }
    this.controllers.clear();
  }
}
