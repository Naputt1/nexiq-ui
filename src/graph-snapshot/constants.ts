export const GRAPH_SNAPSHOT_FILE_IDENTIFIER = "NGPH";
export const GRAPH_SNAPSHOT_SCHEMA_VERSION = 1;

export const GRAPH_SNAPSHOT_STATUS = {
  EMPTY: 0,
  READY: 1,
  ERROR: -1,
} as const;

export const GRAPH_SNAPSHOT_META_INDEX = {
  schemaVersion: 0,
  snapshotVersion: 1,
  byteLength: 2,
  status: 3,
} as const;

export const GRAPH_SNAPSHOT_META_LENGTH = 4;
export const INITIAL_GRAPH_SNAPSHOT_BUFFER_BYTES = 1024 * 1024;
