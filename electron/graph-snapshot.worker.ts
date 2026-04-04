import { parentPort } from "node:worker_threads";
import {
  GRAPH_SNAPSHOT_META_INDEX,
  GRAPH_SNAPSHOT_SCHEMA_VERSION,
  GRAPH_SNAPSHOT_STATUS,
  INITIAL_GRAPH_SNAPSHOT_BUFFER_BYTES,
} from "../src/graph-snapshot/constants";
import { encodeGraphSnapshot } from "../src/graph-snapshot/codec";
import { readGraphSnapshotFromSqlite } from "./graph-snapshot-db";
import type { LargeDataKind } from "../src/graph-snapshot/types";
import { generateGraphView } from "./view-generator";
import { encodeGraphViewSnapshot } from "../src/view-snapshot/codec";
import {
  analyzeDatabaseDiff,
  createEmptyDatabaseData,
} from "../src/lib/diff-analysis";
import { toDatabaseData } from "../src/graph-snapshot/types";
import fs from "node:fs";
import type { GraphViewType } from "./types";

interface InitializeMessage {
  type: "initialize";
  kind: LargeDataKind;
  key: string;
  sqlitePath: string;
}

interface RefreshMessage {
  type: "refresh";
  kind: LargeDataKind;
  sqlitePath?: string;
}

interface GenerateViewMessage {
  type: "generate-view";
  requestId: string;
  profilerRunId?: string;
  kind: "view-result";
  projectRoot: string;
  analysisPath?: string;
  selectedCommit?: string | null;
  subPath?: string;
  view: GraphViewType;
  sqlitePath?: string;
  analysisPaths?: string[];
}

interface ProfileStage {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  parentId?: string;
  detail?: string;
}

interface DiffAnalysisMessage {
  type: "diff-analysis";
  requestId: string;
  profilerRunId?: string;
  kind: "diff-analysis";
  projectRoot: string;
  selectedCommit: string | null;
  subPath?: string;
  sqlitePath?: string;
  headSqlitePath?: string;
  commitSqlitePath?: string;
  parentSqlitePath?: string;
}

type WorkerMessage =
  | InitializeMessage
  | RefreshMessage
  | GenerateViewMessage
  | DiffAnalysisMessage;

let key = "";
let kind: LargeDataKind = "graph";
let sqlitePath = "";
let dataBuffer = new SharedArrayBuffer(INITIAL_GRAPH_SNAPSHOT_BUFFER_BYTES);
const metaBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);

function writeSnapshot(): {
  snapshotVersion: number;
  byteLength: number;
  replacedBuffer: boolean;
} {
  const meta = new Int32Array(metaBuffer);
  const encoded = encodeGraphSnapshot(readGraphSnapshotFromSqlite(sqlitePath));
  let replacedBuffer = false;

  if (encoded.byteLength > dataBuffer.byteLength) {
    let nextSize = dataBuffer.byteLength;
    while (nextSize < encoded.byteLength) {
      nextSize *= 2;
    }
    dataBuffer = new SharedArrayBuffer(nextSize);
    replacedBuffer = true;
  }

  const target = new Uint8Array(dataBuffer);
  target.fill(0, 0, meta[GRAPH_SNAPSHOT_META_INDEX.byteLength] || 0);
  target.set(encoded, 0);

  const nextVersion =
    Atomics.add(meta, GRAPH_SNAPSHOT_META_INDEX.snapshotVersion, 1) + 1;
  Atomics.store(
    meta,
    GRAPH_SNAPSHOT_META_INDEX.schemaVersion,
    GRAPH_SNAPSHOT_SCHEMA_VERSION,
  );
  Atomics.store(meta, GRAPH_SNAPSHOT_META_INDEX.byteLength, encoded.byteLength);
  Atomics.store(
    meta,
    GRAPH_SNAPSHOT_META_INDEX.status,
    GRAPH_SNAPSHOT_STATUS.READY,
  );
  Atomics.notify(meta, GRAPH_SNAPSHOT_META_INDEX.snapshotVersion);

  return {
    snapshotVersion: nextVersion,
    byteLength: encoded.byteLength,
    replacedBuffer,
  };
}

async function handleGenerateView(message: GenerateViewMessage) {
  try {
    const generationStartedAt = performance.now();
    const viewGeneration = await generateGraphView({
      view: message.view,
      projectRoot: message.projectRoot,
      analysisPath: message.analysisPath,
      analysisPaths: message.analysisPaths,
      selectedCommit: message.selectedCommit,
      subPath: message.subPath,
      sqlitePath: message.sqlitePath,
    });
    const computeDurationMs = performance.now() - generationStartedAt;

    const encoded = encodeGraphViewSnapshot(viewGeneration.result);
    const totalDurationMs = performance.now() - generationStartedAt;
    const stages: ProfileStage[] = [
      ...viewGeneration.stages,
      {
        id: "worker:view-compute",
        name: "Compute graph view",
        startMs: 0,
        endMs: computeDurationMs,
        detail: `${viewGeneration.result.nodes.length} nodes, ${viewGeneration.result.edges.length} edges, ${viewGeneration.result.combos.length} combos`,
      },
      {
        id: "worker:encode-view-buffer",
        name: "Encode view buffer",
        startMs: computeDurationMs,
        endMs: totalDurationMs,
        parentId: "main:request-inline-result",
        detail: `${encoded.byteLength} bytes`,
      },
    ];
    parentPort?.postMessage({
      type: "inline-result",
      requestId: message.requestId,
      profilerRunId: message.profilerRunId,
      kind: message.kind,
      encoded,
      stages,
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "inline-error",
      requestId: message.requestId,
      kind: message.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleDiffAnalysis(message: DiffAnalysisMessage) {
  try {
    const diffStartedAt = performance.now();
    let dataB;
    let dataA;

    if (message.selectedCommit) {
      if (!message.commitSqlitePath)
        throw new Error("Missing commitSqlitePath");
      dataB = readGraphSnapshotFromSqlite(message.commitSqlitePath);
      if (message.parentSqlitePath && fs.existsSync(message.parentSqlitePath)) {
        dataA = readGraphSnapshotFromSqlite(message.parentSqlitePath);
      } else {
        dataA = { ...createEmptyDatabaseData(), uiState: {} };
      }
    } else {
      if (!message.sqlitePath) throw new Error("Missing sqlitePath");
      if (!message.headSqlitePath) throw new Error("Missing headSqlitePath");
      dataB = readGraphSnapshotFromSqlite(message.sqlitePath);
      dataA = readGraphSnapshotFromSqlite(message.headSqlitePath);
    }

    const diffResult = analyzeDatabaseDiff(
      toDatabaseData(dataA),
      toDatabaseData(dataB),
    );

    const snapshotData = {
      ...dataB,
      diff: diffResult.diff,
      uiState: dataB.uiState ?? {},
    };

    const encodeStartedAt = performance.now();
    const encoded = encodeGraphSnapshot(snapshotData);
    const encodeDurationMs = performance.now() - encodeStartedAt;
    const totalDurationMs = performance.now() - diffStartedAt;
    const computeDurationMs = totalDurationMs - encodeDurationMs;
    parentPort?.postMessage({
      type: "inline-result",
      requestId: message.requestId,
      profilerRunId: message.profilerRunId,
      kind: message.kind,
      encoded,
      stages: [
        {
          id: "worker:diff-analysis",
          name: "Compute diff analysis",
          startMs: 0,
          endMs: computeDurationMs,
        },
        {
          id: "worker:encode-diff-snapshot",
          name: "Encode diff snapshot",
          startMs: computeDurationMs,
          endMs: totalDurationMs,
          detail: `${encoded.byteLength} bytes`,
        },
      ],
    });
  } catch (error) {
    parentPort?.postMessage({
      type: "inline-error",
      requestId: message.requestId,
      kind: message.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sendReady(payload: {
  snapshotVersion: number;
  byteLength: number;
  replacedBuffer: boolean;
}) {
  parentPort?.postMessage({
    type: "snapshot-updated",
    kind,
    key,
    snapshotVersion: payload.snapshotVersion,
    byteLength: payload.byteLength,
    status: GRAPH_SNAPSHOT_STATUS.READY,
    handleChanged: payload.replacedBuffer,
    dataBuffer: payload.replacedBuffer ? dataBuffer : undefined,
    metaBuffer: payload.replacedBuffer ? metaBuffer : undefined,
  });
}

function sendError(error: unknown) {
  const meta = new Int32Array(metaBuffer);
  Atomics.store(
    meta,
    GRAPH_SNAPSHOT_META_INDEX.status,
    GRAPH_SNAPSHOT_STATUS.ERROR,
  );
  parentPort?.postMessage({
    type: "snapshot-error",
    kind,
    key,
    status: GRAPH_SNAPSHOT_STATUS.ERROR,
    error: error instanceof Error ? error.message : String(error),
    dataBuffer,
    metaBuffer,
  });
}

parentPort?.on("message", (message: WorkerMessage) => {
  try {
    if (message.type === "initialize") {
      kind = message.kind;
      key = message.key;
      sqlitePath = message.sqlitePath;
      sendReady(writeSnapshot());
      return;
    }

    if (message.type === "refresh") {
      if (message.sqlitePath) {
        sqlitePath = message.sqlitePath;
      }
      sendReady(writeSnapshot());
      return;
    }

    if (message.type === "generate-view") {
      void handleGenerateView(message);
      return;
    }

    if (message.type === "diff-analysis") {
      void handleDiffAnalysis(message);
      return;
    }
  } catch (error) {
    sendError(error);
  }
});
