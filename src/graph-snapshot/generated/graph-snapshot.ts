import { Builder, ByteBuffer } from "flatbuffers";
import { GRAPH_SNAPSHOT_FILE_IDENTIFIER } from "../constants";

class FBTable {
  bb_pos = 0;
  bb!: ByteBuffer;

  __init(i: number, bb: ByteBuffer): this {
    this.bb_pos = i;
    this.bb = bb;
    return this;
  }

  protected stringField(field: number): string | null {
    const offset = this.bb.__offset(this.bb_pos, field);
    if (!offset) return null;
    const value = this.bb.__string(this.bb_pos + offset);
    return typeof value === "string" ? value : null;
  }

  protected intField(field: number, fallback = 0): number {
    const offset = this.bb.__offset(this.bb_pos, field);
    return offset ? this.bb.readInt32(this.bb_pos + offset) : fallback;
  }

  protected floatField(field: number, fallback = 0): number {
    const offset = this.bb.__offset(this.bb_pos, field);
    return offset ? this.bb.readFloat32(this.bb_pos + offset) : fallback;
  }

  protected boolField(field: number, fallback = false): boolean {
    const offset = this.bb.__offset(this.bb_pos, field);
    return offset ? !!this.bb.readInt8(this.bb_pos + offset) : fallback;
  }
}

export class PackageRow extends FBTable {
  static startPackageRow(builder: Builder) {
    builder.startObject(4);
  }
  static addId(builder: Builder, value: number) {
    builder.addFieldOffset(0, value, 0);
  }
  static addName(builder: Builder, value: number) {
    builder.addFieldOffset(1, value, 0);
  }
  static addVersion(builder: Builder, value: number) {
    builder.addFieldOffset(2, value, 0);
  }
  static addPath(builder: Builder, value: number) {
    builder.addFieldOffset(3, value, 0);
  }
  static endPackageRow(builder: Builder) {
    return builder.endObject();
  }
  id() { return this.stringField(4); }
  name() { return this.stringField(6); }
  version() { return this.stringField(8); }
  path() { return this.stringField(10); }
}

export class PackageDependencyRow extends FBTable {
  static startPackageDependencyRow(builder: Builder) { builder.startObject(4); }
  static addPackageId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addDependencyName(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addDependencyVersion(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addIsDev(builder: Builder, value: boolean) { builder.addFieldInt8(3, value ? 1 : 0, 0); }
  static endPackageDependencyRow(builder: Builder) { return builder.endObject(); }
  packageId() { return this.stringField(4); }
  dependencyName() { return this.stringField(6); }
  dependencyVersion() { return this.stringField(8); }
  isDev() { return this.boolField(10); }
}

export class FileRow extends FBTable {
  static startFileRow(builder: Builder) { builder.startObject(7); }
  static addId(builder: Builder, value: number) { builder.addFieldInt32(0, value, 0); }
  static addPath(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addPackageId(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addHash(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addFingerprint(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addDefaultExport(builder: Builder, value: number) { builder.addFieldOffset(5, value, 0); }
  static addStarExportsJson(builder: Builder, value: number) { builder.addFieldOffset(6, value, 0); }
  static endFileRow(builder: Builder) { return builder.endObject(); }
  id() { return this.intField(4); }
  path() { return this.stringField(6); }
  packageId() { return this.stringField(8); }
  hash() { return this.stringField(10); }
  fingerprint() { return this.stringField(12); }
  defaultExport() { return this.stringField(14); }
  starExportsJson() { return this.stringField(16); }
}

export class EntityRow extends FBTable {
  static startEntityRow(builder: Builder) { builder.startObject(11); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addScopeId(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addKind(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addName(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addType(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addLine(builder: Builder, value: number) { builder.addFieldInt32(5, value, 0); }
  static addColumn(builder: Builder, value: number) { builder.addFieldInt32(6, value, 0); }
  static addEndLine(builder: Builder, value: number) { builder.addFieldInt32(7, value, 0); }
  static addEndColumn(builder: Builder, value: number) { builder.addFieldInt32(8, value, 0); }
  static addDeclarationKind(builder: Builder, value: number) { builder.addFieldOffset(9, value, 0); }
  static addDataJson(builder: Builder, value: number) { builder.addFieldOffset(10, value, 0); }
  static endEntityRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  scopeId() { return this.stringField(6); }
  kind() { return this.stringField(8); }
  name() { return this.stringField(10); }
  type() { return this.stringField(12); }
  line() { return this.intField(14); }
  column() { return this.intField(16); }
  endLine() { return this.intField(18); }
  endColumn() { return this.intField(20); }
  declarationKind() { return this.stringField(22); }
  dataJson() { return this.stringField(24); }
}

export class ScopeRow extends FBTable {
  static startScopeRow(builder: Builder) { builder.startObject(6); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addFileId(builder: Builder, value: number) { builder.addFieldInt32(1, value, 0); }
  static addParentId(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addKind(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addEntityId(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addDataJson(builder: Builder, value: number) { builder.addFieldOffset(5, value, 0); }
  static endScopeRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  fileId() { return this.intField(6); }
  parentId() { return this.stringField(8); }
  kind() { return this.stringField(10); }
  entityId() { return this.stringField(12); }
  dataJson() { return this.stringField(14); }
}

export class SymbolRow extends FBTable {
  static startSymbolRow(builder: Builder) { builder.startObject(8); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addEntityId(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addScopeId(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addName(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addPath(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addIsAlias(builder: Builder, value: boolean) { builder.addFieldInt8(5, value ? 1 : 0, 0); }
  static addHasDefault(builder: Builder, value: boolean) { builder.addFieldInt8(6, value ? 1 : 0, 0); }
  static addDataJson(builder: Builder, value: number) { builder.addFieldOffset(7, value, 0); }
  static endSymbolRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  entityId() { return this.stringField(6); }
  scopeId() { return this.stringField(8); }
  name() { return this.stringField(10); }
  path() { return this.stringField(12); }
  isAlias() { return this.boolField(14); }
  hasDefault() { return this.boolField(16); }
  dataJson() { return this.stringField(18); }
}

export class RenderRow extends FBTable {
  static startRenderRow(builder: Builder) { builder.startObject(11); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addFileId(builder: Builder, value: number) { builder.addFieldInt32(1, value, 0); }
  static addParentEntityId(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addParentRenderId(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addRenderIndex(builder: Builder, value: number) { builder.addFieldInt32(4, value, 0); }
  static addTag(builder: Builder, value: number) { builder.addFieldOffset(5, value, 0); }
  static addSymbolId(builder: Builder, value: number) { builder.addFieldOffset(6, value, 0); }
  static addLine(builder: Builder, value: number) { builder.addFieldInt32(7, value, 0); }
  static addColumn(builder: Builder, value: number) { builder.addFieldInt32(8, value, 0); }
  static addKind(builder: Builder, value: number) { builder.addFieldOffset(9, value, 0); }
  static addDataJson(builder: Builder, value: number) { builder.addFieldOffset(10, value, 0); }
  static endRenderRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  fileId() { return this.intField(6); }
  parentEntityId() { return this.stringField(8); }
  parentRenderId() { return this.stringField(10); }
  renderIndex() { return this.intField(12); }
  tag() { return this.stringField(14); }
  symbolId() { return this.stringField(16); }
  line() { return this.intField(18); }
  column() { return this.intField(20); }
  kind() { return this.stringField(22); }
  dataJson() { return this.stringField(24); }
}

export class ExportRow extends FBTable {
  static startExportRow(builder: Builder) { builder.startObject(6); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addScopeId(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addSymbolId(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addEntityId(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addName(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addIsDefault(builder: Builder, value: boolean) { builder.addFieldInt8(5, value ? 1 : 0, 0); }
  static endExportRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  scopeId() { return this.stringField(6); }
  symbolId() { return this.stringField(8); }
  entityId() { return this.stringField(10); }
  name() { return this.stringField(12); }
  isDefault() { return this.boolField(14); }
}

export class RelationRow extends FBTable {
  static startRelationRow(builder: Builder) { builder.startObject(6); }
  static addFromId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addToId(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addKind(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addLine(builder: Builder, value: number) { builder.addFieldInt32(3, value, 0); }
  static addColumn(builder: Builder, value: number) { builder.addFieldInt32(4, value, 0); }
  static addDataJson(builder: Builder, value: number) { builder.addFieldOffset(5, value, 0); }
  static endRelationRow(builder: Builder) { return builder.endObject(); }
  fromId() { return this.stringField(4); }
  toId() { return this.stringField(6); }
  kind() { return this.stringField(8); }
  line() { return this.intField(10); }
  column() { return this.intField(12); }
  dataJson() { return this.stringField(14); }
}

export class UiStateRow extends FBTable {
  static startUiStateRow(builder: Builder) { builder.startObject(11); }
  static addId(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addX(builder: Builder, value: number) { builder.addFieldFloat32(1, value, 0); }
  static addY(builder: Builder, value: number) { builder.addFieldFloat32(2, value, 0); }
  static addRadius(builder: Builder, value: number) { builder.addFieldFloat32(3, value, 0); }
  static addCollapsedRadius(builder: Builder, value: number) { builder.addFieldFloat32(4, value, 0); }
  static addExpandedRadius(builder: Builder, value: number) { builder.addFieldFloat32(5, value, 0); }
  static addIsLayoutCalculated(builder: Builder, value: boolean) { builder.addFieldInt8(6, value ? 1 : 0, 0); }
  static addCollapsed(builder: Builder, value: boolean) { builder.addFieldInt8(7, value ? 1 : 0, 0); }
  static addHasRadius(builder: Builder, value: boolean) { builder.addFieldInt8(8, value ? 1 : 0, 0); }
  static addHasCollapsedRadius(builder: Builder, value: boolean) { builder.addFieldInt8(9, value ? 1 : 0, 0); }
  static addHasExpandedRadius(builder: Builder, value: boolean) { builder.addFieldInt8(10, value ? 1 : 0, 0); }
  static endUiStateRow(builder: Builder) { return builder.endObject(); }
  id() { return this.stringField(4); }
  x() { return this.floatField(6); }
  y() { return this.floatField(8); }
  radius() { return this.floatField(10); }
  collapsedRadius() { return this.floatField(12); }
  expandedRadius() { return this.floatField(14); }
  isLayoutCalculated() { return this.boolField(16); }
  collapsed() { return this.boolField(18); }
  hasRadius() { return this.boolField(20); }
  hasCollapsedRadius() { return this.boolField(22); }
  hasExpandedRadius() { return this.boolField(24); }
}

export class DiffData extends FBTable {
  static startDiffData(builder: Builder) { builder.startObject(3); }
  static addAdded(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addModified(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addDeleted(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static endDiffData(builder: Builder) { return builder.endObject(); }

  private vectorField(index: number): number {
    const offset = this.bb.__offset(this.bb_pos, index);
    return offset ? this.bb.__vector(this.bb_pos + offset) : 0;
  }
  private vectorLength(index: number): number {
    const offset = this.bb.__offset(this.bb_pos, index);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  added(index: number): string | null {
    const offset = this.vectorField(4);
    if (!offset) return null;
    const value = this.bb.__string(offset + index * 4);
    return typeof value === "string" ? value : null;
  }
  addedLength() { return this.vectorLength(4); }
  modified(index: number): string | null {
    const offset = this.vectorField(6);
    if (!offset) return null;
    const value = this.bb.__string(offset + index * 4);
    return typeof value === "string" ? value : null;
  }
  modifiedLength() { return this.vectorLength(6); }
  deleted(index: number): string | null {
    const offset = this.vectorField(8);
    if (!offset) return null;
    const value = this.bb.__string(offset + index * 4);
    return typeof value === "string" ? value : null;
  }
  deletedLength() { return this.vectorLength(8); }
}

export class GraphSnapshot extends FBTable {
  static getRootAsGraphSnapshot(bb: ByteBuffer, obj?: GraphSnapshot): GraphSnapshot {
    bb.setPosition(bb.position() + bb.readInt32(bb.position()));
    return (obj ?? new GraphSnapshot()).__init(bb.position(), bb);
  }
  static bufferHasIdentifier(bb: ByteBuffer): boolean {
    return bb.__has_identifier(GRAPH_SNAPSHOT_FILE_IDENTIFIER);
  }
  static startGraphSnapshot(builder: Builder) { builder.startObject(11); }
  static addPackages(builder: Builder, value: number) { builder.addFieldOffset(0, value, 0); }
  static addPackageDependencies(builder: Builder, value: number) { builder.addFieldOffset(1, value, 0); }
  static addFiles(builder: Builder, value: number) { builder.addFieldOffset(2, value, 0); }
  static addEntities(builder: Builder, value: number) { builder.addFieldOffset(3, value, 0); }
  static addScopes(builder: Builder, value: number) { builder.addFieldOffset(4, value, 0); }
  static addSymbols(builder: Builder, value: number) { builder.addFieldOffset(5, value, 0); }
  static addRenders(builder: Builder, value: number) { builder.addFieldOffset(6, value, 0); }
  static addExports(builder: Builder, value: number) { builder.addFieldOffset(7, value, 0); }
  static addRelations(builder: Builder, value: number) { builder.addFieldOffset(8, value, 0); }
  static addUiState(builder: Builder, value: number) { builder.addFieldOffset(9, value, 0); }
  static addDiff(builder: Builder, value: number) { builder.addFieldOffset(10, value, 0); }
  static endGraphSnapshot(builder: Builder) { return builder.endObject(); }

  private vectorOffset(field: number): number {
    const offset = this.bb.__offset(this.bb_pos, field);
    return offset ? this.bb.__vector(this.bb_pos + offset) : 0;
  }
  private vectorLength(field: number): number {
    const offset = this.bb.__offset(this.bb_pos, field);
    return offset ? this.bb.__vector_len(this.bb_pos + offset) : 0;
  }
  packages(index: number, obj?: PackageRow) {
    const offset = this.vectorOffset(4);
    return offset ? (obj ?? new PackageRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  packagesLength() { return this.vectorLength(4); }
  packageDependencies(index: number, obj?: PackageDependencyRow) {
    const offset = this.vectorOffset(6);
    return offset ? (obj ?? new PackageDependencyRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  packageDependenciesLength() { return this.vectorLength(6); }
  files(index: number, obj?: FileRow) {
    const offset = this.vectorOffset(8);
    return offset ? (obj ?? new FileRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  filesLength() { return this.vectorLength(8); }
  entities(index: number, obj?: EntityRow) {
    const offset = this.vectorOffset(10);
    return offset ? (obj ?? new EntityRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  entitiesLength() { return this.vectorLength(10); }
  scopes(index: number, obj?: ScopeRow) {
    const offset = this.vectorOffset(12);
    return offset ? (obj ?? new ScopeRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  scopesLength() { return this.vectorLength(12); }
  symbols(index: number, obj?: SymbolRow) {
    const offset = this.vectorOffset(14);
    return offset ? (obj ?? new SymbolRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  symbolsLength() { return this.vectorLength(14); }
  renders(index: number, obj?: RenderRow) {
    const offset = this.vectorOffset(16);
    return offset ? (obj ?? new RenderRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  rendersLength() { return this.vectorLength(16); }
  exports(index: number, obj?: ExportRow) {
    const offset = this.vectorOffset(18);
    return offset ? (obj ?? new ExportRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  exportsLength() { return this.vectorLength(18); }
  relations(index: number, obj?: RelationRow) {
    const offset = this.vectorOffset(20);
    return offset ? (obj ?? new RelationRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  relationsLength() { return this.vectorLength(20); }
  uiState(index: number, obj?: UiStateRow) {
    const offset = this.vectorOffset(22);
    return offset ? (obj ?? new UiStateRow()).__init(this.bb.__indirect(offset + index * 4), this.bb) : null;
  }
  uiStateLength() { return this.vectorLength(22); }
  diff(obj?: DiffData) {
    const offset = this.bb.__offset(this.bb_pos, 24);
    return offset ? (obj ?? new DiffData()).__init(this.bb.__indirect(this.bb_pos + offset), this.bb) : null;
  }
}
