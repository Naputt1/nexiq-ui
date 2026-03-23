import type {
  AnalyzedDiff,
  DatabaseData,
  UIStateMap,
  EntityRow,
  ScopeRow,
  FileRow,
  SymbolRow,
  RenderRow,
  RelationRow,
  PackageRow,
  PackageDependencyRow,
} from "@nexiq/shared";

export interface GraphSnapshotData extends Pick<
  DatabaseData,
  | "packages"
  | "package_dependencies"
  | "files"
  | "entities"
  | "scopes"
  | "symbols"
  | "renders"
  | "exports"
  | "relations"
  | "diff"
> {
  uiState: UIStateMap;
}

export interface SharedGraphSnapshotHandle {
  key: string;
  dataBuffer: SharedArrayBuffer;
  metaBuffer: SharedArrayBuffer;
}

export interface GraphSnapshotUpdateEvent {
  key: string;
  snapshotVersion: number;
  byteLength: number;
  status: number;
  handleChanged?: boolean;
  error?: string;
  dataBuffer?: SharedArrayBuffer;
  metaBuffer?: SharedArrayBuffer;
}

export interface GraphSnapshotPortBaseMessage {
  requestId: string;
}

export interface GraphSnapshotPortOpenRequest extends GraphSnapshotPortBaseMessage {
  type: "open";
  projectRoot: string;
  analysisPath?: string;
}

export interface GraphSnapshotPortGetHandleRequest extends GraphSnapshotPortBaseMessage {
  type: "get-handle";
  projectRoot: string;
  analysisPath?: string;
}

export type GraphSnapshotPortRequest =
  | GraphSnapshotPortOpenRequest
  | GraphSnapshotPortGetHandleRequest;

export interface GraphSnapshotPortHandleResponse extends GraphSnapshotPortBaseMessage {
  type: "handle";
  handle: SharedGraphSnapshotHandle;
}

export interface GraphSnapshotPortErrorResponse extends GraphSnapshotPortBaseMessage {
  type: "error";
  key?: string;
  message: string;
}

export type GraphSnapshotPortResponse =
  | GraphSnapshotPortHandleResponse
  | GraphSnapshotPortErrorResponse;

export interface GraphSnapshotIndexes {
  entityById: Map<string, EntityRow>;
  scopeById: Map<string, ScopeRow>;
  fileById: Map<number, FileRow>;
  filePathById: Map<number, string>;
  scopeByEntityId: Map<string, ScopeRow>;
  symbolsByEntityId: Map<string, SymbolRow[]>;
  rendersByParentEntityId: Map<string, RenderRow[]>;
  relationsByNodeId: Map<string, RelationRow[]>;
  packageById: Map<string, PackageRow>;
  packageDependenciesByPackageId: Map<string, PackageDependencyRow[]>;
}

export interface IndexedGraphSnapshotData extends GraphSnapshotData {
  __indexes: GraphSnapshotIndexes;
}

export function createEmptyGraphSnapshotData(): GraphSnapshotData {
  return {
    packages: [],
    package_dependencies: [],
    files: [],
    entities: [],
    scopes: [],
    symbols: [],
    renders: [],
    exports: [],
    relations: [],
    uiState: {},
    diff: undefined,
  };
}

export function toDatabaseData(
  data: GraphSnapshotData,
  diff?: AnalyzedDiff,
): DatabaseData {
  return {
    packages: data.packages ?? [],
    package_dependencies: data.package_dependencies ?? [],
    files: data.files,
    entities: data.entities,
    scopes: data.scopes,
    symbols: data.symbols,
    renders: data.renders,
    exports: data.exports,
    relations: data.relations,
    diff: diff ?? data.diff,
  };
}
