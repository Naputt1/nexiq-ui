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
import { generateGraphView, getSerializedViewRegistry } from "./view-generator";
import type { GenerateViewRequest } from "../src/views/types";

const BACKEND_PORT = 3030;
let backendProcess: ChildProcess | null = null;
let backendWs: WebSocket | null = null;
const projectSqlitePaths = new Map<string, string>();

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
const graphSnapshotManager = new GraphSnapshotManager(() =>
  BrowserWindow.getAllWindows(),
  resolveSqlitePath,
);

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
  async (_: IpcMainInvokeEvent, analysisPath: string, projectPath: string) => {
    const response = await requestBackend("open_project", {
      projectPath,
      subProject: analysisPath === projectPath ? undefined : analysisPath,
    });
    if (response && response.sqlitePath) {
      projectSqlitePaths.set(analysisPath, response.sqlitePath);
    }
    return path.basename(analysisPath);
  },
);

ipcMain.handle(
  "generate-view",
  async (_: IpcMainInvokeEvent, args: GenerateViewRequest) => {
    const { data, projectRoot, analysisPath, view } = args;

    if (!projectRoot) {
      throw new Error("projectRoot is required to generate a view");
    }

    if (data) {
      return generateGraphView({
        view,
        data,
        projectRoot,
        analysisPath,
      });
    }

    const { sqlitePath } = await resolveSqlitePath(projectRoot, analysisPath);
    return generateGraphView({
      view,
      projectRoot,
      analysisPath,
      sqlitePath,
    });
  },
);

ipcMain.handle("debug-get-view-registry", async () => {
  return getSerializedViewRegistry();
});

async function resolveSqlitePath(projectRoot: string, analysisPath?: string) {
  const targetPath = analysisPath || projectRoot;
  let sqlitePath = projectSqlitePaths.get(targetPath);

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    const response = await requestBackend("open_project", {
      projectPath: projectRoot,
      subProject: targetPath === projectRoot ? undefined : targetPath,
    });
    if (response && response.sqlitePath) {
      sqlitePath = response.sqlitePath;
      projectSqlitePaths.set(targetPath, sqlitePath);
    }
  }

  if (!sqlitePath || !fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found for path: ${targetPath}`);
  }

  return { targetPath, sqlitePath };
}

ipcMain.on("graph-snapshot-connect", (event) => {
  const [port] = event.ports as MessagePortMain[];
  if (!port) {
    return;
  }
  graphSnapshotManager.attachPort(event.sender, port);
});

ipcMain.handle(
  "refresh-graph-snapshot",
  async (
    _: IpcMainInvokeEvent,
    args: { projectRoot: string; analysisPath?: string },
  ) => {
    const { targetPath, sqlitePath } = await resolveSqlitePath(
      args.projectRoot,
      args.analysisPath,
    );
    await graphSnapshotManager.refresh(targetPath, sqlitePath);
  },
);

ipcMain.handle(
  "git-analyze-commit",
  async (
    _: IpcMainInvokeEvent,
    projectRoot: string,
    commitHash: string,
    subPath?: string,
  ): Promise<DatabaseData> => {
    return requestBackend("git_analyze_commit", {
      projectPath: projectRoot,
      commitHash,
      subPath,
    });
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
      const response = await requestBackend("open_project", {
        projectPath: projectRoot,
        subProject: analysisPath === projectRoot ? undefined : analysisPath,
      });
      if (response && response.sqlitePath) {
        sqlitePath = response.sqlitePath;
        projectSqlitePaths.set(analysisPath, sqlitePath);
      }
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
    return requestBackend("get_project_icon", {
      projectPath: projectRoot,
    });
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
