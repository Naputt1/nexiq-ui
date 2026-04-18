import { Builder, ByteBuffer } from "flatbuffers";
import type {
  EntityRow,
  ExportRow as SharedExportRow,
  FileRow as SharedFileRow,
  PackageDependencyRow as SharedPackageDependencyRow,
  PackageRow as SharedPackageRow,
  RelationRow as SharedRelationRow,
  RenderRow as SharedRenderRow,
  ScopeRow as SharedScopeRow,
  SymbolRow as SharedSymbolRow,
} from "@nexiq/shared";
import { type UIItemState } from "../graph/types";
import { GRAPH_SNAPSHOT_FILE_IDENTIFIER } from "./constants";
import {
  DiffData,
  EntityRow as FBEntityRow,
  ExportRow,
  FileRow,
  GraphSnapshot,
  PackageDependencyRow,
  PackageRow,
  RelationRow,
  RenderRow,
  ScopeRow,
  SymbolRow,
  UiStateRow,
} from "./generated/graph-snapshot";
import {
  createEmptyGraphSnapshotData,
  type GraphSnapshotData,
} from "./types";

function createStringOffset(builder: Builder, value: string | null | undefined) {
  return value == null ? 0 : builder.createSharedString(value);
}

function createOffsetsVector(builder: Builder, offsets: number[]) {
  builder.startVector(4, offsets.length, 4);
  for (let i = offsets.length - 1; i >= 0; i -= 1) {
    builder.addOffset(offsets[i]!);
  }
  return builder.endVector();
}

function createStringVector(builder: Builder, values: string[]) {
  const offsets = values.map((value) => builder.createSharedString(value));
  return createOffsetsVector(builder, offsets);
}

function createPackageOffset(builder: Builder, row: SharedPackageRow) {
  const id = createStringOffset(builder, row.id);
  const name = createStringOffset(builder, row.name);
  const version = createStringOffset(builder, row.version);
  const path = createStringOffset(builder, row.path);
  PackageRow.startPackageRow(builder);
  PackageRow.addPath(builder, path);
  PackageRow.addVersion(builder, version);
  PackageRow.addName(builder, name);
  PackageRow.addId(builder, id);
  return PackageRow.endPackageRow(builder);
}

function createPackageDependencyOffset(
  builder: Builder,
  row: SharedPackageDependencyRow,
) {
  const packageId = createStringOffset(builder, row.package_id);
  const dependencyName = createStringOffset(builder, row.dependency_name);
  const dependencyVersion = createStringOffset(builder, row.dependency_version);
  PackageDependencyRow.startPackageDependencyRow(builder);
  PackageDependencyRow.addIsDev(builder, row.is_dev);
  PackageDependencyRow.addDependencyVersion(builder, dependencyVersion);
  PackageDependencyRow.addDependencyName(builder, dependencyName);
  PackageDependencyRow.addPackageId(builder, packageId);
  return PackageDependencyRow.endPackageDependencyRow(builder);
}

function createFileOffset(builder: Builder, row: SharedFileRow) {
  const path = createStringOffset(builder, row.path);
  const packageId = createStringOffset(builder, row.package_id);
  const hash = createStringOffset(builder, row.hash);
  const fingerprint = createStringOffset(builder, row.fingerprint);
  const defaultExport = createStringOffset(builder, row.default_export);
  const starExportsJson = createStringOffset(builder, row.star_exports_json);
  FileRow.startFileRow(builder);
  FileRow.addStarExportsJson(builder, starExportsJson);
  FileRow.addDefaultExport(builder, defaultExport);
  FileRow.addFingerprint(builder, fingerprint);
  FileRow.addHash(builder, hash);
  FileRow.addPackageId(builder, packageId);
  FileRow.addPath(builder, path);
  FileRow.addId(builder, row.id);
  return FileRow.endFileRow(builder);
}

function createEntityOffset(builder: Builder, row: EntityRow) {
  const id = createStringOffset(builder, row.id);
  const scopeId = createStringOffset(builder, row.scope_id);
  const kind = createStringOffset(builder, row.kind);
  const name = createStringOffset(builder, row.name);
  const type = createStringOffset(builder, row.type);
  const declarationKind = createStringOffset(builder, row.declaration_kind);
  const dataJson = createStringOffset(builder, row.data_json);
  FBEntityRow.startEntityRow(builder);
  FBEntityRow.addDataJson(builder, dataJson);
  FBEntityRow.addDeclarationKind(builder, declarationKind);
  FBEntityRow.addEndColumn(builder, row.end_column ?? 0);
  FBEntityRow.addEndLine(builder, row.end_line ?? 0);
  FBEntityRow.addColumn(builder, row.column ?? 0);
  FBEntityRow.addLine(builder, row.line ?? 0);
  FBEntityRow.addType(builder, type);
  FBEntityRow.addName(builder, name);
  FBEntityRow.addKind(builder, kind);
  FBEntityRow.addScopeId(builder, scopeId);
  FBEntityRow.addId(builder, id);
  return FBEntityRow.endEntityRow(builder);
}

function createScopeOffset(builder: Builder, row: SharedScopeRow) {
  const id = createStringOffset(builder, row.id);
  const parentId = createStringOffset(builder, row.parent_id);
  const kind = createStringOffset(builder, row.kind);
  const entityId = createStringOffset(builder, row.entity_id);
  const dataJson = createStringOffset(builder, row.data_json);
  ScopeRow.startScopeRow(builder);
  ScopeRow.addDataJson(builder, dataJson);
  ScopeRow.addEntityId(builder, entityId);
  ScopeRow.addKind(builder, kind);
  ScopeRow.addParentId(builder, parentId);
  ScopeRow.addFileId(builder, row.file_id);
  ScopeRow.addId(builder, id);
  return ScopeRow.endScopeRow(builder);
}

function createSymbolOffset(builder: Builder, row: SharedSymbolRow) {
  const id = createStringOffset(builder, row.id);
  const entityId = createStringOffset(builder, row.entity_id);
  const scopeId = createStringOffset(builder, row.scope_id);
  const name = createStringOffset(builder, row.name);
  const path = createStringOffset(builder, row.path);
  const dataJson = createStringOffset(builder, row.data_json);
  SymbolRow.startSymbolRow(builder);
  SymbolRow.addDataJson(builder, dataJson);
  SymbolRow.addHasDefault(builder, !!row.has_default);
  SymbolRow.addIsAlias(builder, !!row.is_alias);
  SymbolRow.addPath(builder, path);
  SymbolRow.addName(builder, name);
  SymbolRow.addScopeId(builder, scopeId);
  SymbolRow.addEntityId(builder, entityId);
  SymbolRow.addId(builder, id);
  return SymbolRow.endSymbolRow(builder);
}

function createRenderOffset(builder: Builder, row: SharedRenderRow) {
  const id = createStringOffset(builder, row.id);
  const parentEntityId = createStringOffset(builder, row.parent_entity_id);
  const parentRenderId = createStringOffset(builder, row.parent_render_id);
  const tag = createStringOffset(builder, row.tag);
  const symbolId = createStringOffset(builder, row.symbol_id);
  const kind = createStringOffset(builder, row.kind);
  const dataJson = createStringOffset(builder, row.data_json);
  RenderRow.startRenderRow(builder);
  RenderRow.addDataJson(builder, dataJson);
  RenderRow.addKind(builder, kind);
  RenderRow.addColumn(builder, row.column ?? 0);
  RenderRow.addLine(builder, row.line ?? 0);
  RenderRow.addSymbolId(builder, symbolId);
  RenderRow.addTag(builder, tag);
  RenderRow.addRenderIndex(builder, row.render_index);
  RenderRow.addParentRenderId(builder, parentRenderId);
  RenderRow.addParentEntityId(builder, parentEntityId);
  RenderRow.addFileId(builder, row.file_id);
  RenderRow.addId(builder, id);
  return RenderRow.endRenderRow(builder);
}

function createExportOffset(builder: Builder, row: SharedExportRow) {
  const id = createStringOffset(builder, row.id);
  const scopeId = createStringOffset(builder, row.scope_id);
  const symbolId = createStringOffset(builder, row.symbol_id);
  const entityId = createStringOffset(builder, row.entity_id);
  const name = createStringOffset(builder, row.name);
  ExportRow.startExportRow(builder);
  ExportRow.addIsDefault(builder, !!row.is_default);
  ExportRow.addName(builder, name);
  ExportRow.addEntityId(builder, entityId);
  ExportRow.addSymbolId(builder, symbolId);
  ExportRow.addScopeId(builder, scopeId);
  ExportRow.addId(builder, id);
  return ExportRow.endExportRow(builder);
}

function createRelationOffset(builder: Builder, row: SharedRelationRow) {
  const fromId = createStringOffset(builder, row.from_id);
  const toId = createStringOffset(builder, row.to_id);
  const kind = createStringOffset(builder, row.kind);
  const dataJson = createStringOffset(builder, row.data_json);
  RelationRow.startRelationRow(builder);
  RelationRow.addDataJson(builder, dataJson);
  RelationRow.addColumn(builder, row.column ?? 0);
  RelationRow.addLine(builder, row.line ?? 0);
  RelationRow.addKind(builder, kind);
  RelationRow.addToId(builder, toId);
  RelationRow.addFromId(builder, fromId);
  return RelationRow.endRelationRow(builder);
}

function createUiStateOffset(
  builder: Builder,
  [id, row]: [string, UIItemState],
) {
  const idOffset = createStringOffset(builder, id);
  UiStateRow.startUiStateRow(builder);
  UiStateRow.addHasExpandedRadius(builder, row.expandedRadius != null);
  UiStateRow.addHasCollapsedRadius(builder, row.collapsedRadius != null);
  UiStateRow.addHasRadius(builder, row.radius != null);
  UiStateRow.addCollapsed(builder, !!row.collapsed);
  UiStateRow.addIsLayoutCalculated(builder, !!row.isLayoutCalculated);
  UiStateRow.addExpandedRadius(builder, row.expandedRadius ?? 0);
  UiStateRow.addCollapsedRadius(builder, row.collapsedRadius ?? 0);
  UiStateRow.addRadius(builder, row.radius ?? 0);
  UiStateRow.addY(builder, row.y);
  UiStateRow.addX(builder, row.x);
  UiStateRow.addId(builder, idOffset);
  return UiStateRow.endUiStateRow(builder);
}

function createDiffOffset(builder: Builder, diff: GraphSnapshotData["diff"]) {
  if (!diff) return 0;
  const added = createStringVector(builder, diff.added);
  const modified = createStringVector(builder, diff.modified);
  const deleted = createStringVector(builder, diff.deleted);
  DiffData.startDiffData(builder);
  DiffData.addDeleted(builder, deleted);
  DiffData.addModified(builder, modified);
  DiffData.addAdded(builder, added);
  return DiffData.endDiffData(builder);
}

function readString(value: string | null) {
  return value ?? null;
}

export function encodeGraphSnapshot(data: GraphSnapshotData): Uint8Array {
  const builder = new Builder(1024);

  const packages = createOffsetsVector(
    builder,
    (data.packages ?? []).map((row) => createPackageOffset(builder, row)),
  );
  const packageDependencies = createOffsetsVector(
    builder,
    (data.package_dependencies ?? []).map((row) =>
      createPackageDependencyOffset(builder, row),
    ),
  );
  const files = createOffsetsVector(
    builder,
    data.files.map((row) => createFileOffset(builder, row)),
  );
  const entities = createOffsetsVector(
    builder,
    data.entities.map((row) => createEntityOffset(builder, row)),
  );
  const scopes = createOffsetsVector(
    builder,
    data.scopes.map((row) => createScopeOffset(builder, row)),
  );
  const symbols = createOffsetsVector(
    builder,
    data.symbols.map((row) => createSymbolOffset(builder, row)),
  );
  const renders = createOffsetsVector(
    builder,
    data.renders.map((row) => createRenderOffset(builder, row)),
  );
  const exportsOffset = createOffsetsVector(
    builder,
    data.exports.map((row) => createExportOffset(builder, row)),
  );
  const relations = createOffsetsVector(
    builder,
    data.relations.map((row) => createRelationOffset(builder, row)),
  );
  const uiState = createOffsetsVector(
    builder,
    Object.entries(data.uiState).map((entry) => createUiStateOffset(builder, entry)),
  );
  const diff = createDiffOffset(builder, data.diff);

  GraphSnapshot.startGraphSnapshot(builder);
  GraphSnapshot.addDiff(builder, diff);
  GraphSnapshot.addUiState(builder, uiState);
  GraphSnapshot.addRelations(builder, relations);
  GraphSnapshot.addExports(builder, exportsOffset);
  GraphSnapshot.addRenders(builder, renders);
  GraphSnapshot.addSymbols(builder, symbols);
  GraphSnapshot.addScopes(builder, scopes);
  GraphSnapshot.addEntities(builder, entities);
  GraphSnapshot.addFiles(builder, files);
  GraphSnapshot.addPackageDependencies(builder, packageDependencies);
  GraphSnapshot.addPackages(builder, packages);
  const root = GraphSnapshot.endGraphSnapshot(builder);
  builder.finish(root, GRAPH_SNAPSHOT_FILE_IDENTIFIER);
  return builder.asUint8Array();
}

export function decodeGraphSnapshot(bytes: Uint8Array): GraphSnapshotData {
  const bb = new ByteBuffer(bytes);
  const snapshot = GraphSnapshot.getRootAsGraphSnapshot(bb);
  const data = createEmptyGraphSnapshotData();

  for (let i = 0; i < snapshot.packagesLength(); i += 1) {
    const row = snapshot.packages(i);
    if (!row) continue;
    data.packages!.push({
      id: row.id() ?? "",
      name: row.name() ?? "",
      version: row.version() ?? "",
      path: row.path() ?? "",
    });
  }

  for (let i = 0; i < snapshot.packageDependenciesLength(); i += 1) {
    const row = snapshot.packageDependencies(i);
    if (!row) continue;
    data.package_dependencies!.push({
      id: i,
      package_id: row.packageId() ?? "",
      dependency_name: row.dependencyName() ?? "",
      dependency_version: row.dependencyVersion() ?? "",
      is_dev: row.isDev(),
    });
  }

  for (let i = 0; i < snapshot.filesLength(); i += 1) {
    const row = snapshot.files(i);
    if (!row) continue;
    data.files.push({
      id: row.id(),
      path: row.path() ?? "",
      package_id: readString(row.packageId()),
      hash: row.hash() ?? "",
      fingerprint: row.fingerprint() ?? "",
      default_export: readString(row.defaultExport()),
      star_exports_json: readString(row.starExportsJson()),
    });
  }

  for (let i = 0; i < snapshot.entitiesLength(); i += 1) {
    const row = snapshot.entities(i);
    if (!row) continue;
    data.entities.push({
      id: row.id() ?? "",
      scope_id: row.scopeId() ?? "",
      kind: row.kind() ?? "",
      name: readString(row.name()),
      type: readString(row.type()),
      line: row.line() || null,
      column: row.column() || null,
      end_line: row.endLine() || null,
      end_column: row.endColumn() || null,
      declaration_kind: readString(row.declarationKind()),
      data_json: readString(row.dataJson()),
    });
  }

  for (let i = 0; i < snapshot.scopesLength(); i += 1) {
    const row = snapshot.scopes(i);
    if (!row) continue;
    data.scopes.push({
      id: row.id() ?? "",
      file_id: row.fileId(),
      parent_id: readString(row.parentId()),
      kind: row.kind() ?? "",
      entity_id: readString(row.entityId()),
      data_json: readString(row.dataJson()),
    });
  }

  for (let i = 0; i < snapshot.symbolsLength(); i += 1) {
    const row = snapshot.symbols(i);
    if (!row) continue;
    data.symbols.push({
      id: row.id() ?? "",
      entity_id: row.entityId() ?? "",
      scope_id: row.scopeId() ?? "",
      name: row.name() ?? "",
      path: readString(row.path()),
      is_alias: row.isAlias() ? 1 : 0,
      has_default: row.hasDefault() ? 1 : 0,
      data_json: readString(row.dataJson()),
    });
  }

  for (let i = 0; i < snapshot.rendersLength(); i += 1) {
    const row = snapshot.renders(i);
    if (!row) continue;
    data.renders.push({
      id: row.id() ?? "",
      file_id: row.fileId(),
      parent_entity_id: row.parentEntityId() ?? "",
      parent_render_id: readString(row.parentRenderId()),
      render_index: row.renderIndex(),
      tag: row.tag() ?? "",
      symbol_id: readString(row.symbolId()),
      line: row.line() || null,
      column: row.column() || null,
      kind: row.kind() ?? "",
      data_json: readString(row.dataJson()),
    });
  }

  for (let i = 0; i < snapshot.exportsLength(); i += 1) {
    const row = snapshot.exports(i);
    if (!row) continue;
    data.exports.push({
      id: row.id() ?? "",
      scope_id: row.scopeId() ?? "",
      symbol_id: readString(row.symbolId()),
      entity_id: readString(row.entityId()),
      name: readString(row.name()),
      is_default: row.isDefault() ? 1 : 0,
    });
  }

  for (let i = 0; i < snapshot.relationsLength(); i += 1) {
    const row = snapshot.relations(i);
    if (!row) continue;
    data.relations.push({
      from_id: row.fromId() ?? "",
      to_id: row.toId() ?? "",
      kind: row.kind() ?? "",
      line: row.line() || null,
      column: row.column() || null,
      data_json: readString(row.dataJson()),
    });
  }

  for (let i = 0; i < snapshot.uiStateLength(); i += 1) {
    const row = snapshot.uiState(i);
    if (!row) continue;
    const id = row.id();
    if (!id) continue;
    data.uiState[id] = {
      x: row.x(),
      y: row.y(),
      radius: row.hasRadius() ? row.radius() : undefined,
      collapsedRadius: row.hasCollapsedRadius()
        ? row.collapsedRadius()
        : undefined,
      expandedRadius: row.hasExpandedRadius() ? row.expandedRadius() : undefined,
      isLayoutCalculated: row.isLayoutCalculated(),
      collapsed: row.collapsed(),
    };
  }

  const diff = snapshot.diff();
  if (diff) {
    data.diff = {
      added: Array.from({ length: diff.addedLength() }, (_, index) => diff.added(index) ?? ""),
      modified: Array.from(
        { length: diff.modifiedLength() },
        (_, index) => diff.modified(index) ?? "",
      ),
      deleted: Array.from(
        { length: diff.deletedLength() },
        (_, index) => diff.deleted(index) ?? "",
      ),
    };
  }

  return data;
}
