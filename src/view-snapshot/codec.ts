import { FlatBuffers } from "@nexiq/shared";
import * as flatbuffers from "flatbuffers";
import type {
  GraphArrowData,
  GraphComboData,
  GraphNodeData,
} from "@/graph/hook";
import type { GraphViewResult } from "../views/types";
import { type GraphNodeDetail } from "@nexiq/extension-sdk";

// The Magic and Version are now handled by FlatBuffers file_identifier "NXGV"

export class GraphViewBufferView {
  private view: FlatBuffers.GraphView;
  private materializedCache?: GraphViewResult;

  constructor(buffer: ArrayBufferLike) {
    const uint8Array = new Uint8Array(buffer);
    const byteBuffer = new flatbuffers.ByteBuffer(uint8Array);

    if (!FlatBuffers.GraphView.bufferHasIdentifier(byteBuffer)) {
      throw new Error("Invalid graph view buffer identifier");
    }

    this.view = FlatBuffers.GraphView.getRootAsGraphView(byteBuffer);
  }

  get nodeCount() {
    return this.view.nodesLength();
  }
  get edgeCount() {
    return this.view.edgesLength();
  }
  get comboCount() {
    return this.view.combosLength();
  }

  getTypeData() {
    return this.materialize().typeData;
  }

  materialize(): GraphViewResult {
    if (this.materializedCache) {
      return this.materializedCache;
    }

    const nodes: GraphNodeData[] = [];
    for (let i = 0; i < this.view.nodesLength(); i++) {
      const node = this.view.nodes(i)!;
      nodes.push({
        id: node.id()!,
        name: node.name()!,
        displayName: node.displayName()!,
        type: this.mapItemType(node.type()),
        combo: node.comboId() || undefined,
        color: node.color() || undefined,
        radius: node.radius() > 0 ? node.radius() : undefined,
      } as GraphNodeData);
    }

    const combos: GraphComboData[] = [];
    for (let i = 0; i < this.view.combosLength(); i++) {
      const combo = this.view.combos(i)!;
      combos.push({
        id: combo.id()!,
        name: combo.name()!,
        displayName: combo.displayName()!,
        type: this.mapItemType(combo.type()),
        combo: combo.parentId() || undefined,
        collapsed: combo.collapsed(),
        color: combo.color() || undefined,
        radius: combo.radius() > 0 ? combo.radius() : undefined,
      } as GraphComboData);
    }

    const edges: GraphArrowData[] = [];
    for (let i = 0; i < this.view.edgesLength(); i++) {
      const edge = this.view.edges(i)!;
      edges.push({
        id: edge.id()!,
        source: edge.source()!,
        target: edge.target()!,
        name: edge.name() || undefined,
        edgeKind: edge.kind()!,
        category: edge.category()!,
      } as GraphArrowData);
    }

    const details: Record<string, GraphNodeDetail> = {};
    for (let i = 0; i < this.view.detailsLength(); i++) {
      const detail = this.view.details(i)!;
      const loc = detail.loc();
      details[detail.id()!] = {
        id: detail.id()!,
        fileName: detail.fileName() || undefined,
        projectPath: detail.projectPath() || undefined,
        loc: loc ? { line: loc.line(), column: loc.column() } : undefined,
        raw: detail.dataJson() ? JSON.parse(detail.dataJson()!) : undefined,
      };
    }

    this.materializedCache = {
      nodes,
      edges,
      combos,
      details,
      // typeData is currently not in the FBS root directly but can be added or parsed from details if needed
      typeData: {},
    };
    return this.materializedCache;
  }

  private mapItemType(type: FlatBuffers.ItemType): string {
    switch (type) {
      case FlatBuffers.ItemType.Package:
        return "package";
      case FlatBuffers.ItemType.Scope:
        return "scope";
      case FlatBuffers.ItemType.Component:
        return "component";
      case FlatBuffers.ItemType.Hook:
        return "hook";
      case FlatBuffers.ItemType.State:
        return "state";
      case FlatBuffers.ItemType.Memo:
        return "memo";
      case FlatBuffers.ItemType.Callback:
        return "callback";
      case FlatBuffers.ItemType.Ref:
        return "ref";
      case FlatBuffers.ItemType.Effect:
        return "effect";
      case FlatBuffers.ItemType.Prop:
        return "prop";
      case FlatBuffers.ItemType.Render:
        return "render";
      case FlatBuffers.ItemType.RenderGroup:
        return "render-group";
      case FlatBuffers.ItemType.SourceGroup:
        return "source-group";
      case FlatBuffers.ItemType.PathGroup:
        return "path-group";
      default:
        return "scope";
    }
  }
}

export function encodeGraphViewSnapshot(result: GraphViewResult): Uint8Array {
  const builder = new flatbuffers.Builder(1024 * 1024);

  const nodeOffsets = result.nodes.map((node) => {
    // Pre-create all strings before starting the object to avoid nesting issues
    const id = builder.createString(String(node.id));
    const nameStr = typeof node.name === "string" ? node.name : String(node.name || "");
    const name = builder.createString(nameStr);
    const displayName = builder.createString(String(node.displayName || ""));
    const comboId = node.combo ? builder.createString(String(node.combo)) : 0;
    const color = node.color ? builder.createString(String(node.color)) : 0;

    FlatBuffers.GraphNode.startGraphNode(builder);
    FlatBuffers.GraphNode.addId(builder, id);
    FlatBuffers.GraphNode.addType(builder, mapToItemType(node.type as string));
    FlatBuffers.GraphNode.addName(builder, name);
    FlatBuffers.GraphNode.addDisplayName(builder, displayName);
    if (comboId) FlatBuffers.GraphNode.addComboId(builder, comboId);
    if (color) FlatBuffers.GraphNode.addColor(builder, color);
    FlatBuffers.GraphNode.addRadius(builder, node.radius || 0);
    return FlatBuffers.GraphNode.endGraphNode(builder);
  });
  const nodesVector = FlatBuffers.GraphView.createNodesVector(
    builder,
    nodeOffsets,
  );

  const comboOffsets = result.combos.map((combo) => {
    const id = builder.createString(String(combo.id));
    const nameStr = typeof combo.name === "string" ? combo.name : String(combo.name || "");
    const name = builder.createString(nameStr);
    const displayName = builder.createString(String(combo.displayName || ""));
    const parentId = combo.combo ? builder.createString(String(combo.combo)) : 0;
    const color = combo.color ? builder.createString(String(combo.color)) : 0;

    FlatBuffers.GraphCombo.startGraphCombo(builder);
    FlatBuffers.GraphCombo.addId(builder, id);
    FlatBuffers.GraphCombo.addType(
      builder,
      mapToItemType(combo.type as string),
    );
    FlatBuffers.GraphCombo.addName(builder, name);
    FlatBuffers.GraphCombo.addDisplayName(builder, displayName);
    if (parentId) FlatBuffers.GraphCombo.addParentId(builder, parentId);
    if (color) FlatBuffers.GraphCombo.addColor(builder, color);
    FlatBuffers.GraphCombo.addCollapsed(builder, !!combo.collapsed);
    FlatBuffers.GraphCombo.addRadius(builder, combo.radius || 0);
    return FlatBuffers.GraphCombo.endGraphCombo(builder);
  });
  const combosVector = FlatBuffers.GraphView.createCombosVector(
    builder,
    comboOffsets,
  );

  const edgeOffsets = result.edges.map((edge) => {
    const id = builder.createString(edge.id);
    const source = builder.createString(edge.source);
    const target = builder.createString(edge.target);
    const name = builder.createString(edge.name || "");
    const kind = builder.createString(edge.edgeKind || "");
    const category = builder.createString(edge.category || "");

    FlatBuffers.GraphEdge.startGraphEdge(builder);
    FlatBuffers.GraphEdge.addId(builder, id);
    FlatBuffers.GraphEdge.addSource(builder, source);
    FlatBuffers.GraphEdge.addTarget(builder, target);
    FlatBuffers.GraphEdge.addName(builder, name);
    FlatBuffers.GraphEdge.addKind(builder, kind);
    FlatBuffers.GraphEdge.addCategory(builder, category);
    return FlatBuffers.GraphEdge.endGraphEdge(builder);
  });
  const edgesVector = FlatBuffers.GraphView.createEdgesVector(
    builder,
    edgeOffsets,
  );

  const detailOffsets = Object.values(result.details || {}).map((detail) => {
    const id = builder.createString(detail.id);
    const fileName = detail.fileName
      ? builder.createString(detail.fileName)
      : 0;
    const projectPath = detail.projectPath
      ? builder.createString(detail.projectPath)
      : 0;
    const dataJson = detail.raw
      ? builder.createString(JSON.stringify(detail.raw))
      : 0;

    const loc = detail.loc
      ? FlatBuffers.Loc.createLoc(
          builder,
          detail.loc.line,
          detail.loc.column,
        )
      : 0;

    FlatBuffers.GraphNodeDetail.startGraphNodeDetail(builder);
    FlatBuffers.GraphNodeDetail.addId(builder, id);
    if (fileName) FlatBuffers.GraphNodeDetail.addFileName(builder, fileName);
    if (projectPath)
      FlatBuffers.GraphNodeDetail.addProjectPath(builder, projectPath);
    if (loc) FlatBuffers.GraphNodeDetail.addLoc(builder, loc);
    if (dataJson) FlatBuffers.GraphNodeDetail.addDataJson(builder, dataJson);
    return FlatBuffers.GraphNodeDetail.endGraphNodeDetail(builder);
  });
  const detailsVector = FlatBuffers.GraphView.createDetailsVector(
    builder,
    detailOffsets,
  );

  FlatBuffers.GraphView.startGraphView(builder);
  FlatBuffers.GraphView.addNodes(builder, nodesVector);
  FlatBuffers.GraphView.addCombos(builder, combosVector);
  FlatBuffers.GraphView.addEdges(builder, edgesVector);
  FlatBuffers.GraphView.addDetails(builder, detailsVector);
  const root = FlatBuffers.GraphView.endGraphView(builder);

  builder.finish(root, "NXGV");
  return builder.asUint8Array();
}

function mapToItemType(type: string | number | undefined): FlatBuffers.ItemType {
  if (typeof type === "number") return type;
  if (!type) return FlatBuffers.ItemType.Scope;
  const t = type.toLowerCase().replace(/-/g, "").replace(/group$/, "group"); // normalization
  switch (t) {
    case "package":
      return FlatBuffers.ItemType.Package;
    case "scope":
      return FlatBuffers.ItemType.Scope;
    case "component":
      return FlatBuffers.ItemType.Component;
    case "hook":
      return FlatBuffers.ItemType.Hook;
    case "state":
      return FlatBuffers.ItemType.State;
    case "memo":
      return FlatBuffers.ItemType.Memo;
    case "callback":
      return FlatBuffers.ItemType.Callback;
    case "ref":
      return FlatBuffers.ItemType.Ref;
    case "effect":
      return FlatBuffers.ItemType.Effect;
    case "prop":
      return FlatBuffers.ItemType.Prop;
    case "render":
      return FlatBuffers.ItemType.Render;
    case "rendergroup":
      return FlatBuffers.ItemType.RenderGroup;
    case "sourcegroup":
      return FlatBuffers.ItemType.SourceGroup;
    case "pathgroup":
      return FlatBuffers.ItemType.PathGroup;
    default:
      return FlatBuffers.ItemType.Scope;
  }
}

export function decodeGraphViewSnapshot(data: Uint8Array) {
  return new GraphViewBufferView(
    data.byteOffset === 0 &&
      data.byteLength === data.buffer.byteLength &&
      data.buffer instanceof ArrayBuffer
      ? data.buffer
      : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
}
