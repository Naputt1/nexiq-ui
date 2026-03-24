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

type WorkerMessage = InitializeMessage | RefreshMessage;

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

    if (message.sqlitePath) {
      sqlitePath = message.sqlitePath;
    }
    sendReady(writeSnapshot());
  } catch (error) {
    sendError(error);
  }
});
