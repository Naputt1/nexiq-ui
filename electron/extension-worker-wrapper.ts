import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import {
  initOutputTables,
  type Extension,
  type GraphViewType,
  type TaskContext,
} from "@nexiq/extension-sdk";

interface ExtensionWorkerData {
  sqliteBuffer: Uint8Array;
  extensionPath: string;
  taskId: string;
  projectRoot: string;
  analysisPaths?: string[];
  viewType: GraphViewType;
}

async function run() {
  const {
    sqliteBuffer,
    extensionPath,
    taskId,
    projectRoot,
    analysisPaths,
    viewType,
  } = workerData as ExtensionWorkerData;

  try {
    // 1. Initialize in-memory database from buffer
    if (!sqliteBuffer || sqliteBuffer.byteLength === 0) {
      throw new Error(
        `Task ${taskId}: Received empty or missing SQLite buffer`,
      );
    }

    const db = new Database(Buffer.from(sqliteBuffer), { readonly: false });

    // 2. Ensure output tables exist
    initOutputTables(db);

    // 3. Load extension and find task
    // We use dynamic import for the extension
    const extension: Extension = await import(extensionPath).then(
      (m) => m.default || m,
    );

    // Extensions in this project typically have viewTasks: Record<string, GraphViewTask[]>
    const tasks = extension.viewTasks?.[viewType] || [];
    const task = tasks.find((t) => t.id === taskId);

    if (!task) {
      throw new Error(`Task ${taskId} not found in extension ${extensionPath}`);
    }

    if (!task.runSqlite) {
      throw new Error(`Task ${taskId} does not implement runSqlite`);
    }

    // 4. Run task
    const context: TaskContext = {
      db,
      projectRoot,
      analysisPaths,
      viewType,
      sqliteBuffer, // Pass it along if needed
    };

    const result = await task.runSqlite(context);

    // 5. Serialize back to buffer
    const updatedBuffer =
      result instanceof Uint8Array ? result : db.serialize();
    db.close();

    // 6. Return updated buffer
    parentPort?.postMessage({
      type: "success",
      sqliteBuffer: updatedBuffer,
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

void run();
