import {
  BrowserWindow,
  type MessagePortMain,
  type WebContents,
} from "electron";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GraphSnapshotPortRequest,
  GraphSnapshotPortResponse,
  GraphSnapshotUpdateEvent,
} from "../src/graph-snapshot/types";

interface SnapshotController {
  key: string;
  sqlitePath: string;
  worker: Worker;
  dataBuffer: SharedArrayBuffer;
  metaBuffer: SharedArrayBuffer;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (reason?: unknown) => void;
}

interface SnapshotPortSession {
  webContents: WebContents;
  port: MessagePortMain;
}

interface ResolvedSnapshotPath {
  targetPath: string;
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
  private readonly getWindows: () => BrowserWindow[];
  private readonly resolveSnapshotPath: (
    projectRoot: string,
    analysisPath?: string,
  ) => Promise<ResolvedSnapshotPath>;

  constructor(
    getWindows: () => BrowserWindow[],
    resolveSnapshotPath: (
      projectRoot: string,
      analysisPath?: string,
    ) => Promise<ResolvedSnapshotPath>,
  ) {
    this.getWindows = getWindows;
    this.resolveSnapshotPath = resolveSnapshotPath;
  }

  private broadcast(payload: GraphSnapshotUpdateEvent) {
    for (const window of this.getWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("graph-snapshot-updated", payload);
      }
    }
  }

  private createWorker(key: string, sqlitePath: string): SnapshotController {
    const readyDeferred = deferred();
    const worker = new Worker(bundledWorkerPath, {});

    const controller: SnapshotController = {
      key,
      sqlitePath,
      worker,
      dataBuffer: new SharedArrayBuffer(0),
      metaBuffer: new SharedArrayBuffer(0),
      ready: readyDeferred.promise,
      resolveReady: readyDeferred.resolve,
      rejectReady: readyDeferred.reject,
    };

    worker.on(
      "message",
      (message: GraphSnapshotUpdateEvent & { type: string }) => {
        if (message.dataBuffer) {
          controller.dataBuffer = message.dataBuffer;
        }
        if (message.metaBuffer) {
          controller.metaBuffer = message.metaBuffer;
        }

        if (message.type === "snapshot-updated") {
          controller.resolveReady();
          this.broadcast({
            key,
            snapshotVersion: message.snapshotVersion,
            byteLength: message.byteLength,
            status: message.status,
            handleChanged: message.handleChanged,
          });
          return;
        }

        controller.rejectReady(
          new Error(message.error ?? "Snapshot worker failed"),
        );
        this.broadcast({
          key,
          snapshotVersion: message.snapshotVersion ?? 0,
          byteLength: message.byteLength ?? 0,
          status: message.status,
          handleChanged: message.handleChanged,
          error: message.error,
        });
      },
    );

    worker.on("error", (error: unknown) => {
      controller.rejectReady(error);
      const message = error instanceof Error ? error.message : String(error);
      this.broadcast({
        key,
        snapshotVersion: 0,
        byteLength: 0,
        status: -1,
        error: message,
      });
    });

    worker.postMessage({
      type: "initialize",
      key,
      sqlitePath,
    });

    this.controllers.set(key, controller);
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

    port.on("message", (event) => {
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
      const { targetPath, sqlitePath } = await this.resolveSnapshotPath(
        request.projectRoot,
        request.analysisPath,
      );
      const handle = await this.open(targetPath, sqlitePath);
      this.postPortMessage(session, {
        type: "handle",
        requestId: request.requestId,
        handle,
      });
    } catch (error) {
      const key = request.analysisPath || request.projectRoot;
      this.postPortMessage(session, {
        type: "error",
        requestId: request.requestId,
        key,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async open(key: string, sqlitePath: string) {
    const existing = this.controllers.get(key);
    const controller =
      existing && existing.sqlitePath === sqlitePath
        ? existing
        : this.createWorker(key, sqlitePath);

    if (existing && existing.sqlitePath !== sqlitePath) {
      existing.worker.terminate();
    }

    await controller.ready;

    function cloneToShared(buffer: SharedArrayBuffer): SharedArrayBuffer {
      const copy = new SharedArrayBuffer(buffer.byteLength);
      new Uint8Array(copy).set(new Uint8Array(buffer));
      return copy;
    }

    return {
      key,
      dataBuffer: cloneToShared(controller.dataBuffer),
      metaBuffer: cloneToShared(controller.metaBuffer),
    };
  }

  async refresh(key: string, sqlitePath?: string) {
    const controller = this.controllers.get(key);
    if (!controller) {
      throw new Error(`No graph snapshot worker for key: ${key}`);
    }
    if (sqlitePath) {
      controller.sqlitePath = sqlitePath;
    }
    controller.worker.postMessage({
      type: "refresh",
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
