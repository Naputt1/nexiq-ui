import fs from "node:fs";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  type MessagePortMain,
  type MenuItemConstructorOptions,
  type IpcMainInvokeEvent,
} from "electron";
import { store } from "./store";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";

import { WebSocket } from "ws";
import { spawn, ChildProcess } from "node:child_process";
import Database from "better-sqlite3";
import { UISqliteDB } from "./ui-sqlite-db";
import { GraphSnapshotManager } from "./graph-snapshot-manager";
import {
  GRAPH_SNAPSHOT_META_INDEX,
  GRAPH_SNAPSHOT_SCHEMA_VERSION,
  GRAPH_SNAPSHOT_STATUS,
} from "../src/graph-snapshot/constants";

import { getSerializedViewRegistry } from "./view-generator";
import type { GenerateViewRequest } from "../src/views/types";
import type {
  GraphSnapshotPortRequest,
  LargeDataKind,
  LargeDataRequestArgs,
  SharedLargeDataHandle,
} from "../src/graph-snapshot/types";

const BACKEND_PORT = 3030;
let backendProcess: ChildProcess | null = null;
let backendWs: WebSocket | null = null;
const projectSqlitePaths = new Map<string, string>();
const gitCommitSnapshotPaths = new Map<string, string>();
const inlineLargeDataHandles = new Map<
  string,
  {
    kind: LargeDataKind;
    key: string;
    version: number;
    dataBuffer: ArrayBufferLike;
    metaBuffer: ArrayBufferLike;
  }
>();

async function isBackendAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${BACKEND_PORT}`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(false);
    }, 500);

    ws.on("open", () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve(true);
    });

    ws.on("error", () => {
      clearTimeout(timeout);
      ws.terminate();
      resolve(false);
    });
  });
}

async function startBackend() {
  if (backendProcess) return;

  // if (process.env.VITE_EXTERNAL_BACKEND === "true") {
  //   console.log("Using external backend as requested by VITE_EXTERNAL_BACKEND");
  //   connectToBackend();
  //   return;
  // }

  // Try to connect to an existing backend first
  if (await isBackendAlive()) {
    console.log(
      `Using existing backend already running on port ${BACKEND_PORT}`,
    );
    connectToBackend();
    return;
  }

  // Get server path from environment variable or default location
  let serverDist = process.env.REACT_MAP_SERVER_PATH;

  if (!serverDist) {
    // If we are in the monorepo, it's still at ../../server/dist/index.js
    // but in a separate repo it should be provided.
    serverDist = path.join(
      process.env.APP_ROOT!,
      "..",
      "nexiq",
      "packages",
      "server",
      "dist",
      "index.js",
    );
  }

  if (!fs.existsSync(serverDist)) {
    console.warn(`Backend server not found at: ${serverDist}. 
Please set REACT_MAP_SERVER_PATH or use VITE_EXTERNAL_BACKEND=true.`);
    return;
  }

  console.log(`Starting backend from: ${serverDist}`);

  backendProcess = spawn("node", [serverDist], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: {
      ...process.env,
      PORT: BACKEND_PORT.toString(),
      NODE_ENV: VITE_DEV_SERVER_URL ? "development" : "production",
    },
  });

  backendProcess.on("error", (err) => {
    console.error("Failed to start backend process:", err);
  });

  backendProcess.on("exit", (code) => {
    console.log(`Backend process exited with code ${code}`);
    backendProcess = null;
  });

  // Wait a bit for the server to start
  await new Promise((resolve) => setTimeout(resolve, 2000));
  connectToBackend();
}

function connectToBackend() {
  if (backendWs) return;

  backendWs = new WebSocket(`ws://localhost:${BACKEND_PORT}`);

  backendWs.on("open", () => {
    console.log("Connected to shared backend");
  });

  backendWs.on("message", (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      handleBackendMessage(parsed);
      // Handle messages from backend (e.g., project_opened, graph_data)
      // This will need to be integrated with the window management logic
    } catch (e: unknown) {
      console.error("Error handling backend message", e);
    }
  });

  backendWs.on("error", (err) => {
    console.warn("Backend connection error, retrying in 5s...", err.message);
    backendWs = null;
    setTimeout(connectToBackend, 5000);
  });

  backendWs.on("close", () => {
    console.log("Backend connection closed");
    backendWs = null;
  });
}

const pendingRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: NodeJS.Timeout;
    chunksMap: Map<string, string[]>;
  }
>();

interface BackendResponsePayload {
  chunk?: string;
  index?: number;
  total?: number;
  message?: string;
  [key: string]: unknown;
}

interface BackendMessage {
  type: string;
  payload: BackendResponsePayload;
  requestId: string;
}

function handleBackendMessage(data: BackendMessage) {
  try {
    const {
      type: responseType,
      payload: responsePayload,
      requestId: responseId,
    } = data;

    const pending = pendingRequests.get(responseId);
    if (!pending) return;

    if (responseType === "chunked_response") {
      const { chunk, index, total } = responsePayload;
      if (
        typeof chunk !== "string" ||
        typeof index !== "number" ||
        typeof total !== "number"
      ) {
        return;
      }

      let chunks = pending.chunksMap.get(responseId);
      if (!chunks) {
        chunks = new Array(total);
        pending.chunksMap.set(responseId, chunks);
      }
      chunks[index] = chunk;

      // Check if all chunks received
      const receivedCount = chunks.filter((c) => c !== undefined).length;
      if (receivedCount === total) {
        clearTimeout(pending.timeout);
        const fullData = chunks.join("");
        pending.chunksMap.delete(responseId);
        pendingRequests.delete(responseId);
        try {
          pending.resolve(JSON.parse(fullData));
        } catch (e) {
          pending.reject(new Error(`Failed to parse reassembled JSON: ${e}`));
        }
      }
      return;
    }

    clearTimeout(pending.timeout);
    pendingRequests.delete(responseId);

    if (responseType === "error") {
      pending.reject(
        new Error(responsePayload.message || "Unknown backend error"),
      );
    } else {
      pending.resolve(responsePayload);
    }
  } catch (e) {
    console.error("Error in handleBackendMessage", e);
  }
}

async function requestBackend<K extends BackendMessageType>(
  type: K,
  payload: BackendRequestMap[K]["payload"],
  timeoutMs: number = 30000,
): Promise<BackendRequestMap[K]["response"]> {
  if (!backendWs || backendWs.readyState !== WebSocket.OPEN) {
    throw new Error("Backend not connected");
  }

  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).substring(7);

    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timeout waiting for backend response: ${type}`));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timeout,
      chunksMap: new Map(),
    });

    backendWs!.send(JSON.stringify({ type, payload, requestId }));
  });
}

import type { AppStateData, GlobalSettings } from "./types";
import type {
  DatabaseData,
  GitStatus,
  GitCommit,
  GitFileDiff,
  UIStateMap,
  NexiqConfig,
  BackendRequestMap,
  BackendMessageType,
} from "@nexiq/shared";
import { resolvePath } from "./utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

const windowProjects = new Map<number, string | null>();
let isQuitting = false;
const graphSnapshotManager = new GraphSnapshotManager(
  () => BrowserWindow.getAllWindows(),
  resolveLargeDataSnapshotPath,
);

function getInlineHandleId(kind: LargeDataKind, key: string) {
  return `${kind}:${key}`;
}

function buildHandleFromEntry(entry: {
  kind: LargeDataKind;
  key: string;
  version: number;
  dataBuffer: ArrayBufferLike;
  metaBuffer: ArrayBufferLike;
}): SharedLargeDataHandle {
  return {
    kind: entry.kind,
    key: entry.key,
    version: entry.version,
    dataBuffer: entry.dataBuffer,
    metaBuffer: entry.metaBuffer,
  };
}

function broadcastLargeDataUpdate(payload: {
  kind: LargeDataKind;
  key: string;
  snapshotVersion: number;
  byteLength: number;
  status: number;
  handleChanged?: boolean;
  error?: string;
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("large-data-updated", payload);
      if (payload.kind === "graph") {
        window.webContents.send("graph-snapshot-updated", payload);
      }
    }
  }
}

function broadcastGraphPipelineProfile(payload: {
  id: string;
  key: string;
  projectRoot: string;
  view?: string;
  byteLength?: number;
  stages: {
    name: string;
    durationMs: number;
    detail?: string;
  }[];
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send("graph-pipeline-profile", payload);
    }
  }
}

function storeInlineLargeData(
  kind: LargeDataKind,
  key: string,
  encoded: Uint8Array,
) {
  const handleId = getInlineHandleId(kind, key);
  const previous = inlineLargeDataHandles.get(handleId);
  const version = (previous?.version ?? 0) + 1;
  const dataBuffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(dataBuffer).set(encoded);
  const metaBuffer = new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
  const meta = new Int32Array(metaBuffer);
  meta[GRAPH_SNAPSHOT_META_INDEX.schemaVersion] = GRAPH_SNAPSHOT_SCHEMA_VERSION;
  meta[GRAPH_SNAPSHOT_META_INDEX.snapshotVersion] = version;
  meta[GRAPH_SNAPSHOT_META_INDEX.byteLength] = encoded.byteLength;
  meta[GRAPH_SNAPSHOT_META_INDEX.status] = GRAPH_SNAPSHOT_STATUS.READY;

  const entry = {
    kind,
    key,
    version,
    dataBuffer,
    metaBuffer,
  };
  inlineLargeDataHandles.set(handleId, entry);
  broadcastLargeDataUpdate({
    kind,
    key,
    snapshotVersion: version,
    byteLength: encoded.byteLength,
    status: GRAPH_SNAPSHOT_STATUS.READY,
    handleChanged: true,
  });
  return buildHandleFromEntry(entry);
}

function getDiffAnalysisKey(
  projectRoot: string,
  selectedCommit: string | null | undefined,
  subPath?: string,
) {
  return `${projectRoot}::${selectedCommit ?? "current"}::${subPath || ""}`;
}

function getViewResultKey(args: GenerateViewRequest) {
  return JSON.stringify({
    projectRoot: args.projectRoot,
    analysisPath: args.analysisPath ?? null,
    analysisPaths: args.analysisPaths ? [...args.analysisPaths].sort() : null,
    selectedCommit: args.selectedCommit ?? null,
    subPath: args.subPath ?? null,
    view: args.view,
  });
}

async function openInlineLargeData(
  args: LargeDataRequestArgs & { kind: LargeDataKind },
) {
  if (args.kind === "diff-analysis") {
    const key = getDiffAnalysisKey(
      args.projectRoot,
      args.selectedCommit,
      args.subPath,
    );
    const cached = inlineLargeDataHandles.get(
      getInlineHandleId(args.kind, key),
    );
    if (cached && !args.refreshHandle) {
      return buildHandleFromEntry(cached);
    }

    const { targetPath } = await resolveSqlitePath(
      args.projectRoot,
      args.subPath ? path.join(args.projectRoot, args.subPath) : undefined,
      args.analysisPaths,
    );

    let commitSqlitePath;
    let parentSqlitePath;
    let headSqlitePath;

    if (args.selectedCommit) {
      const res = await resolveGitCommitSnapshotPath(
        args.projectRoot,
        args.selectedCommit,
        args.subPath,
      );
      commitSqlitePath = res.sqlitePath;
      try {
        const parentRes = await resolveGitCommitSnapshotPath(
          args.projectRoot,
          `${args.selectedCommit}^`,
          args.subPath,
        );
        parentSqlitePath = parentRes.sqlitePath;
      } catch {
        // Parent might not exist
      }
    } else {
      await resolveSqlitePath(
        args.projectRoot,
        args.subPath ? path.join(args.projectRoot, args.subPath) : undefined,
      );
      const headRes = await resolveGitCommitSnapshotPath(
        args.projectRoot,
        "HEAD",
        args.subPath,
      );
      headSqlitePath = headRes.sqlitePath;
    }

    const { sqlitePath } = await resolveSqlitePath(
      args.projectRoot,
      args.subPath ? path.join(args.projectRoot, args.subPath) : undefined,
      args.analysisPaths,
    );

    // Ensure worker exists
    await graphSnapshotManager.open("graph", targetPath, sqlitePath);

    const encoded = await graphSnapshotManager.requestInlineResult(targetPath, {
      type: "diff-analysis",
      kind: args.kind,
      projectRoot: args.projectRoot,
      selectedCommit: args.selectedCommit,
      subPath: args.subPath,
      sqlitePath,
      commitSqlitePath,
      parentSqlitePath,
      headSqlitePath,
    });

    return storeInlineLargeData(args.kind, key, encoded);
  }

  if (args.kind === "view-result") {
    if (!args.view) {
      throw new Error("view is required for view-result handles");
    }

    const request: GenerateViewRequest = {
      view: args.view,
      projectRoot: args.projectRoot,
      analysisPath: args.analysisPath,
      analysisPaths: args.analysisPaths,
      selectedCommit: args.selectedCommit,
      subPath: args.subPath,
      refreshHandle: args.refreshHandle,
    };
    const key = getViewResultKey(request);
    const cached = inlineLargeDataHandles.get(
      getInlineHandleId(args.kind, key),
    );
    if (cached && !args.refreshHandle) {
      return buildHandleFromEntry(cached);
    }

    const timings: {
      name: string;
      durationMs: number;
      detail?: string;
    }[] = [];

    const resolveStartedAt = performance.now();
    const { targetPath, sqlitePath } = await resolveSqlitePath(
      args.projectRoot,
      args.analysisPath,
      args.analysisPaths,
    );
    timings.push({
      name: "Resolve sqlite path",
      durationMs: performance.now() - resolveStartedAt,
      detail: sqlitePath,
    });

    // Ensure worker exists
    const workerReadyAt = performance.now();
    await graphSnapshotManager.open("graph", targetPath, sqlitePath);
    timings.push({
      name: "Warm graph worker",
      durationMs: performance.now() - workerReadyAt,
      detail: targetPath,
    });

    const generateStartedAt = performance.now();
    const encoded = await graphSnapshotManager.requestInlineResult(targetPath, {
      type: "generate-view",
      kind: args.kind,
      projectRoot: args.projectRoot,
      analysisPath: args.analysisPath,
      analysisPaths: args.analysisPaths,
      selectedCommit: args.selectedCommit,
      subPath: args.subPath,
      view: args.view,
      sqlitePath,
    });
    timings.push({
      name: "Generate view from sqlite",
      durationMs: performance.now() - generateStartedAt,
      detail: `${encoded.byteLength} bytes`,
    });

    const storeStartedAt = performance.now();
    const handle = storeInlineLargeData(args.kind, key, encoded);
    timings.push({
      name: "Store inline buffer",
      durationMs: performance.now() - storeStartedAt,
      detail: `${encoded.byteLength} bytes`,
    });
    broadcastGraphPipelineProfile({
      id: `${key}:${handle.version}`,
      key,
      projectRoot: args.projectRoot,
      view: args.view,
      byteLength: encoded.byteLength,
      stages: timings,
    });
    return handle;
  }

  throw new Error(`Unsupported inline large data kind: ${args.kind}`);
}

function createWindow(projectPath?: string, forceEmpty: boolean = false) {
  if (projectPath) {
    for (const [id, path] of windowProjects.entries()) {
      if (path === projectPath) {
        const existingWindow = BrowserWindow.fromId(id);
        if (existingWindow) {
          existingWindow.focus();
          return existingWindow;
        }
      }
    }
  }

  const window = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC!, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  window.maximize();

  windowProjects.set(window.id, projectPath || null);
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );

  window.on("closed", () => {
    if (!isQuitting) {
      windowProjects.delete(window.id);
      store.setOpenProjects(
        Array.from(windowProjects.values()).map((p) => p || ""),
      );
    }
  });

  if (VITE_DEV_SERVER_URL) {
    window.webContents.openDevTools();
  }

  // Test active push message to Renderer-process.
  window.webContents.on("did-finish-load", () => {
    window.webContents.send(
      "main-process-message",
      new Date().toLocaleString(),
    );
  });

  window.webContents.on("before-input-event", (event, input) => {
    const key = input.key.toLowerCase();
    const ctrlOrCmd = input.control || input.meta;
    const shift = input.shift;

    // Ctrl + Shift + R → reload the whole app
    if (ctrlOrCmd && shift && key === "r") {
      event.preventDefault();
      console.log("Reloading the whole app");
      window.webContents.reload();
      return;
    }

    // Ctrl + R → reload the current project
    if (ctrlOrCmd && !shift && key === "r") {
      event.preventDefault();
      console.log("Reloading current project");
      window.webContents.send("reload-project");
    }

    // Ctrl + Shift + N → new window
    if (ctrlOrCmd && shift && key === "n") {
      event.preventDefault();
      createWindow(undefined, true);
    }
  });

  if (VITE_DEV_SERVER_URL) {
    let url = VITE_DEV_SERVER_URL;
    const params = new URLSearchParams();
    if (projectPath) {
      params.append("projectPath", projectPath);
    } else if (forceEmpty) {
      params.append("empty", "true");
    }

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
    window.loadURL(url);
  } else {
    const indexPath = path.join(RENDERER_DIST, "index.html");
    const params = new URLSearchParams();
    if (projectPath) {
      params.append("projectPath", projectPath);
    } else if (forceEmpty) {
      params.append("empty", "true");
    }

    const queryString = params.toString();
    if (queryString) {
      window.loadURL(`file://${indexPath}#/?${queryString}`);
    } else {
      window.loadFile(indexPath);
    }
  }

  return window;
}

function createMenu() {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ] as MenuItemConstructorOptions[],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            createWindow(undefined, true);
          },
        },
        { type: "separator" },
        {
          label: "Open Folder...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const focusedWindow = BrowserWindow.getFocusedWindow();
            const result = await dialog.showOpenDialog(focusedWindow!, {
              properties: ["openDirectory"],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              createWindow(result.filePaths[0]);
            }
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "close" }] as MenuItemConstructorOptions[])),
      ] as MenuItemConstructorOptions[],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Handle SIGINT and SIGTERM for better dev experience (Ctrl+C)
process.on("SIGINT", () => {
  app.quit();
});

process.on("SIGTERM", () => {
  app.quit();
});

app.on("before-quit", async () => {
  isQuitting = true;
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );
  graphSnapshotManager.dispose();
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});

app.on("will-quit", async () => {
  isQuitting = true;
  store.setOpenProjects(
    Array.from(windowProjects.values()).map((p) => p || ""),
  );
  graphSnapshotManager.dispose();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  createMenu();
  startBackend();

  if (process.platform === "darwin") {
    const dockMenu = Menu.buildFromTemplate([
      {
        label: "New Window",
        click() {
          createWindow(undefined, true);
        },
      },
    ]);
    app.dock?.setMenu(dockMenu);
  }

  const openProjects = store.getOpenProjects();
  if (openProjects.length > 0) {
    openProjects.forEach((project) => {
      createWindow(project || undefined);
    });
  } else {
    createWindow();
  }
});

ipcMain.handle("run-cli", async (_: IpcMainInvokeEvent, command: string) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) reject(error.message);
      else resolve(stdout || stderr);
    });
  });
});

let firstOpen = true;
ipcMain.handle(
  "open-vscode",
  async (
    _: IpcMainInvokeEvent,
    filePath: string,
    projectRoot?: string,
    line?: number,
    column?: number,
  ) => {
    return new Promise((resolve, reject) => {
      let absolutePath = filePath;
      if (projectRoot) {
        if (!path.isAbsolute(filePath)) {
          absolutePath = path.join(projectRoot, filePath);
        } else if (filePath.startsWith("/") && !fs.existsSync(filePath)) {
          // Handle the case where it starts with / but is relative to project root
          // On macOS, /src/views is "absolute" but might not exist at root of disk
          absolutePath = path.join(projectRoot, filePath);
        }
      }

      let location = absolutePath;
      if (line != null) {
        location += `:${line}`;
        if (column != null) {
          location += `:${column}`;
        }
      }

      let cmd = `code -g ${location}`;

      if (firstOpen) {
        // handle for windows and linux
        if (os.platform() === "darwin") {
          // cmd = `open -a "Visual Studio Code" --args -g ${path}`;
          cmd += `\nosascript -e 'tell application "Visual Studio Code" to activate'`;
        }
        firstOpen = false;
      }

      exec(cmd, (error, stdout, stderr) => {
        if (error) reject(error.message);
        else resolve(stdout || stderr);
      });
    });
  },
);

ipcMain.handle("select-directory", async (event: IpcMainInvokeEvent) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, {
    properties: ["openDirectory"],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("get-recent-projects", () => {
  return store.getRecentProjects();
});

ipcMain.handle(
  "read-source-file",
  async (_: IpcMainInvokeEvent, filePath: string, projectRoot: string) => {
    const resolvedPath = resolvePath(projectRoot, filePath);
    return {
      path: resolvedPath,
      content: fs.readFileSync(resolvedPath, "utf8"),
    };
  },
);

ipcMain.handle(
  "set-last-project",
  (event: IpcMainInvokeEvent, path: string | null) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      if (path) {
        // Check if already open in ANOTHER window
        for (const [id, p] of windowProjects.entries()) {
          if (p === path && id !== window.id) {
            const existingWindow = BrowserWindow.fromId(id);
            if (existingWindow) {
              existingWindow.focus();
              window.close();
              return true;
            }
          }
        }
        windowProjects.set(window.id, path);
      } else {
        windowProjects.delete(window.id);
      }
      store.setOpenProjects(
        Array.from(windowProjects.values()).map((p) => p || ""),
      );
    }
    return false;
  },
);

ipcMain.handle(
  "check-project-status",
  async (_: IpcMainInvokeEvent, directoryPath: string) => {
    return requestBackend("check_project_status", {
      projectPath: directoryPath,
    });
  },
);

ipcMain.handle(
  "save-project-config",
  async (
    _: IpcMainInvokeEvent,
    { config, directoryPath }: { config: NexiqConfig; directoryPath: string },
  ) => {
    const result = await requestBackend("save_project_config", {
      projectPath: directoryPath,
      config,
    });
    if (result.success) {
      store.addRecentProject(directoryPath);
    }
    return result.success;
  },
);

ipcMain.handle("set-project", (_: IpcMainInvokeEvent, _path: string) => {
  // We can store it per-window if needed, but for now we'll rely on the renderer
  // and query params for the initial path.
  // If we need to track current project in main, we should use a Map<windowId, path>
});

ipcMain.handle(
  "git-status",
  async (_: IpcMainInvokeEvent, projectRoot: string): Promise<GitStatus> => {
    return requestBackend("git_status", {
      projectPath: projectRoot,
    });
  },
);

ipcMain.handle(
  "git-log",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    options: number | { limit?: number; path?: string } = 50,
  ): Promise<GitCommit[]> => {
    return requestBackend("git_log", {
      projectPath: projectRoot,
      options,
    });
  },
);

ipcMain.handle(
  "git-diff",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    options: {
      file?: string;
      commit?: string;
      baseCommit?: string;
      staged?: boolean;
    },
  ): Promise<GitFileDiff[]> => {
    return requestBackend("git_diff", {
      projectPath: projectRoot,
      options,
    });
  },
);

ipcMain.handle(
  "analyze-project",
  async (
    _: IpcMainInvokeEvent,
    analysisPaths: string | string[],
    projectPath: string,
  ) => {
    const paths = Array.isArray(analysisPaths)
      ? analysisPaths
      : [analysisPaths];
    await resolveSqlitePath(projectPath, undefined, paths);
    return path.basename(paths[0] || projectPath);
  },
);

ipcMain.handle(
  "get-analysis-errors",
  async (_: IpcMainInvokeEvent, projectRoot: string, analysisPath?: string) => {
    let sqlitePath = projectSqlitePaths.get(analysisPath || projectRoot);
    if (!sqlitePath) {
      const resolved = await resolveSqlitePath(
        projectRoot,
        analysisPath === projectRoot ? undefined : analysisPath,
      );
      sqlitePath = resolved.sqlitePath;
    }

    if (!sqlitePath || !fs.existsSync(sqlitePath)) {
      return {
        fileErrors: [],
        resolveErrors: [],
      };
    }

    const db = new Database(sqlitePath, { readonly: true });
    try {
      const fileErrors = db
        .prepare(
          "SELECT * FROM file_analysis_errors ORDER BY created_at DESC, file_path ASC",
        )
        .all();
      const resolveErrors = db
        .prepare(
          "SELECT * FROM resolve_errors ORDER BY created_at DESC, file_path ASC",
        )
        .all();

      return {
        fileErrors,
        resolveErrors,
      };
    } finally {
      db.close();
    }
  },
);

ipcMain.handle(
  "generate-view",
  async (_: IpcMainInvokeEvent, args: GenerateViewRequest) => {
    return openInlineLargeData({
      kind: "view-result",
      projectRoot: args.projectRoot,
      analysisPath: args.analysisPath,
      selectedCommit: args.selectedCommit,
      subPath: args.subPath,
      view: args.view,
      refreshHandle: args.refreshHandle,
    });
  },
);

ipcMain.handle("debug-get-view-registry", async () => {
  return getSerializedViewRegistry();
});

async function resolveSqlitePath(
  projectRoot: string,
  analysisPath?: string,
  analysisPaths?: string[],
) {
  const rawPaths =
    analysisPaths && analysisPaths.length > 0
      ? [...analysisPaths].sort()
      : analysisPath
        ? [analysisPath]
        : [projectRoot];

  // Convert absolute paths to relative to projectRoot for the backend if they are inside projectRoot
  const paths = rawPaths.map((p) => {
    if (path.isAbsolute(p) && p.startsWith(projectRoot)) {
      const relative = path.relative(projectRoot, p);
      return relative === "" ? projectRoot : relative;
    }
    return p;
  });

  const targetId =
    paths.length === 1 && paths[0] === projectRoot
      ? projectRoot
      : `${projectRoot}:${paths.join(",")}`;

  let sqlitePath = projectSqlitePaths.get(targetId);

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    const response = (await requestBackend("open_project", {
      projectPath: projectRoot,
      subProject:
        paths.length === 1 && paths[0] !== projectRoot ? paths[0] : undefined,
      subProjects:
        paths.length > 1 || (paths.length === 1 && paths[0] !== projectRoot)
          ? paths
          : undefined,
    })) as unknown as { sqlitePath: string };
    if (response && response.sqlitePath) {
      sqlitePath = response.sqlitePath;
      projectSqlitePaths.set(targetId, sqlitePath);
    }
  }

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found for paths: ${paths.join(", ")}`);
  }

  return { targetPath: targetId, sqlitePath };
}

function getGitCommitSnapshotKey(
  projectRoot: string,
  commitHash: string,
  subPath?: string,
) {
  return `${projectRoot}::${commitHash}::${subPath || ""}`;
}

async function resolveGitCommitSnapshotPath(
  projectRoot: string,
  commitHash: string,
  subPath?: string,
) {
  const key = getGitCommitSnapshotKey(projectRoot, commitHash, subPath);
  let sqlitePath = gitCommitSnapshotPaths.get(key);

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    const response = (await requestBackend("git_analyze_commit", {
      projectPath: projectRoot,
      commitHash,
      subPath,
    })) as unknown as { sqlitePath: string };
    if (response?.sqlitePath) {
      const sp = response.sqlitePath;
      sqlitePath = sp;
      gitCommitSnapshotPaths.set(key, sp);
    }
  }

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found for git commit: ${commitHash}`);
  }

  return { key, sqlitePath };
}

async function resolveLargeDataSnapshotPath(request: GraphSnapshotPortRequest) {
  if (request.kind === "graph") {
    const { targetPath, sqlitePath } = await resolveSqlitePath(
      request.projectRoot,
      request.analysisPath,
      request.analysisPaths,
    );
    return {
      kind: request.kind,
      key: targetPath,
      sqlitePath,
    };
  }

  if (!request.commitHash) {
    throw new Error("commitHash is required for git commit analysis snapshots");
  }

  const { key, sqlitePath } = await resolveGitCommitSnapshotPath(
    request.projectRoot,
    request.commitHash,
    request.subPath,
  );
  return {
    kind: request.kind,
    key,
    sqlitePath,
  };
}

ipcMain.on("large-data-connect", (event) => {
  const [port] = event.ports as MessagePortMain[];
  if (!port) {
    return;
  }
  graphSnapshotManager.attachPort(event.sender, port);
});

ipcMain.on("graph-snapshot-connect", (event) => {
  const [port] = event.ports as MessagePortMain[];
  if (!port) {
    return;
  }
  graphSnapshotManager.attachPort(event.sender, port);
});

ipcMain.handle(
  "open-inline-large-data",
  async (
    _: IpcMainInvokeEvent,
    args: LargeDataRequestArgs & { kind: LargeDataKind },
  ) => {
    return openInlineLargeData(args);
  },
);

ipcMain.handle(
  "get-inline-large-data-handle",
  async (
    _: IpcMainInvokeEvent,
    args: LargeDataRequestArgs & { kind: LargeDataKind },
  ) => {
    if (args.kind === "graph" || args.kind === "git-commit-analysis") {
      throw new Error(`Use port-backed large data for ${args.kind}`);
    }

    const key =
      args.kind === "diff-analysis"
        ? getDiffAnalysisKey(
            args.projectRoot,
            args.selectedCommit,
            args.subPath,
          )
        : getViewResultKey({
            projectRoot: args.projectRoot,
            analysisPath: args.analysisPath,
            analysisPaths: args.analysisPaths,
            selectedCommit: args.selectedCommit,
            subPath: args.subPath,
            view: args.view!,
            refreshHandle: args.refreshHandle,
          });
    const cached = inlineLargeDataHandles.get(
      getInlineHandleId(args.kind, key),
    );
    return cached ? buildHandleFromEntry(cached) : openInlineLargeData(args);
  },
);

ipcMain.handle(
  "refresh-large-data",
  async (
    _: IpcMainInvokeEvent,
    args: {
      kind: LargeDataKind;
      projectRoot: string;
      analysisPath?: string;
      commitHash?: string;
      subPath?: string;
      selectedCommit?: string | null;
      view?: GenerateViewRequest["view"];
      refreshHandle?: boolean;
    },
  ) => {
    if (args.kind === "diff-analysis" || args.kind === "view-result") {
      await openInlineLargeData({
        ...args,
        refreshHandle: true,
      });
      return;
    }
    const { key, sqlitePath } = await resolveLargeDataSnapshotPath({
      type: "open",
      requestId: "refresh",
      ...args,
    });
    await graphSnapshotManager.refresh(args.kind, key, sqlitePath);
  },
);

ipcMain.handle(
  "refresh-graph-snapshot",
  async (
    _: IpcMainInvokeEvent,
    args: {
      projectRoot: string;
      analysisPath?: string;
      analysisPaths?: string[];
    },
  ) => {
    const { targetPath, sqlitePath } = await resolveSqlitePath(
      args.projectRoot,
      args.analysisPath,
    );
    await graphSnapshotManager.refresh("graph", targetPath, sqlitePath);
  },
);

ipcMain.handle(
  "git-analyze-commit",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    commitHash: string,
    subPath?: string,
  ): Promise<SharedLargeDataHandle> => {
    const { key, sqlitePath } = await resolveGitCommitSnapshotPath(
      projectRoot,
      commitHash,
      subPath,
    );
    return graphSnapshotManager.open("git-commit-analysis", key, sqlitePath);
  },
);

ipcMain.handle(
  "analyze-diff",
  async (
    _: IpcMainInvokeEvent,
    dataA: DatabaseData,
    dataB: DatabaseData,
  ): Promise<DatabaseData> => {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    const mapA = new Map(dataA.entities.map((e) => [e.id, e]));
    const mapB = new Map(dataB.entities.map((e) => [e.id, e]));

    for (const [id, entityB] of mapB.entries()) {
      if (!mapA.has(id)) {
        added.push(id);
      } else {
        const entityA = mapA.get(id);
        if (entityA && entityA.data_json !== entityB.data_json) {
          modified.push(id);
        }
      }
    }

    for (const id of mapA.keys()) {
      if (!mapB.has(id)) {
        deleted.push(id);
      }
    }

    return {
      ...dataB,
      diff: {
        added,
        modified,
        deleted,
      },
    };
  },
);

ipcMain.handle(
  "read-state",
  async (_: IpcMainInvokeEvent, projectRoot: string) => {
    return requestBackend("read_state", { projectPath: projectRoot });
  },
);

ipcMain.handle(
  "save-state",
  async (_: IpcMainInvokeEvent, projectRoot: string, state: AppStateData) => {
    return requestBackend("save_state", {
      projectPath: projectRoot,
      state,
    });
  },
);

ipcMain.handle(
  "update-graph-position",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    analysisPath: string,
    positions: UIStateMap,
    contextId?: string,
  ) => {
    let sqlitePath = projectSqlitePaths.get(analysisPath);
    if (!sqlitePath) {
      // If not in cache, try to get it from backend
      const { sqlitePath: sp } = await resolveSqlitePath(
        projectRoot,
        analysisPath === projectRoot ? undefined : analysisPath,
      );
      sqlitePath = sp;
    }

    if (sqlitePath && fs.existsSync(sqlitePath)) {
      try {
        const db = new Database(sqlitePath);
        const uiDb = new UISqliteDB(db);
        uiDb.saveUIState(positions);
        db.close();
        return true;
      } catch (e) {
        console.error("Failed to save UI state to sqlite", e);
      }
    }

    // Fallback to backend process if direct write fails or sqlitePath not found
    return (requestBackend as (...args: unknown[]) => Promise<boolean>)(
      "update_graph_position",
      {
        projectPath: projectRoot,
        subProject: analysisPath === projectRoot ? undefined : analysisPath,
        positions,
        contextId,
      },
    );
  },
);

ipcMain.handle(
  "get-project-icon",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
  ): Promise<string | null> => {
    const response = await requestBackend("get_project_icon", {
      projectPath: projectRoot,
    });
    const iconPath = response?.icon;

    if (
      iconPath &&
      typeof iconPath === "string" &&
      !iconPath.startsWith("data:") &&
      path.isAbsolute(iconPath)
    ) {
      if (fs.existsSync(iconPath)) {
        try {
          const ext = path.extname(iconPath).toLowerCase().slice(1);
          const buffer = fs.readFileSync(iconPath);
          const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext}`;
          return `data:${mimeType};base64,${buffer.toString("base64")}`;
        } catch (e) {
          console.error("Failed to read project icon file:", e);
        }
      }
    }

    return iconPath || null;
  },
);

ipcMain.handle("get-global-config", async () => {
  return store.getGlobalConfig();
});

ipcMain.handle(
  "save-global-config",
  async (_: IpcMainInvokeEvent, config: GlobalSettings) => {
    store.saveGlobalConfig(config);
    return true;
  },
);
