import type { TypeDataDeclare } from "@nexiq/shared";
import type { GraphArrowData, GraphComboData, GraphNodeData } from "@/graph/hook";
import type { GraphViewResult } from "../views/types";

const GRAPH_VIEW_MAGIC = 0x47564246; // GVBF
const GRAPH_VIEW_VERSION = 1;
const HEADER_LENGTH = 7;

type GraphItemDetail = GraphNodeData | GraphComboData | GraphArrowData;

function encodeString(value: string) {
  return new TextEncoder().encode(value);
}

function decodeString(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function serializeGraphItem(value: GraphItemDetail) {
  return JSON.stringify(value);
}

function parseGraphItem<T extends GraphItemDetail>(value: string) {
  return JSON.parse(value) as T;
}

function parseJsonValue<T>(value: string) {
  return JSON.parse(value) as T;
}

function buildStringTable(strings: string[]) {
  const encodedStrings = strings.map(encodeString);
  const offsets = new Int32Array(strings.length);
  const lengths = new Int32Array(strings.length);
  let totalLength = 0;

  for (let i = 0; i < encodedStrings.length; i += 1) {
    offsets[i] = totalLength;
    lengths[i] = encodedStrings[i].byteLength;
    totalLength += encodedStrings[i].byteLength;
  }

  const blob = new Uint8Array(totalLength);
  for (let i = 0; i < encodedStrings.length; i += 1) {
    blob.set(encodedStrings[i], offsets[i]);
  }

  return { offsets, lengths, blob };
}

export class GraphViewBufferView {
  nodeCount: number;
  edgeCount: number;
  comboCount: number;
  private stringIndexes: {
    nodes: Int32Array;
    edges: Int32Array;
    combos: Int32Array;
    typeData: number;
  };
  private offsets: Int32Array;
  private lengths: Int32Array;
  private blob: Uint8Array;
  private stringCache = new Map<number, string>();
  private nodeCache = new Map<number, GraphNodeData>();
  private edgeCache = new Map<number, GraphArrowData>();
  private comboCache = new Map<number, GraphComboData>();
  private typeDataCache?: Record<string, TypeDataDeclare>;
  private materializedCache?: GraphViewResult;

  constructor(buffer: ArrayBufferLike) {
    const header = new Int32Array(buffer, 0, HEADER_LENGTH);
    if (header[0] !== GRAPH_VIEW_MAGIC) {
      throw new Error("Invalid graph view buffer");
    }
    if (header[1] !== GRAPH_VIEW_VERSION) {
      throw new Error(`Unsupported graph view version: ${header[1]}`);
    }

    this.nodeCount = header[2];
    this.edgeCount = header[3];
    this.comboCount = header[4];
    const stringCount = header[5];
    const typeDataIndex = header[6];

    let byteOffset = HEADER_LENGTH * Int32Array.BYTES_PER_ELEMENT;

    this.stringIndexes = {
      nodes: new Int32Array(buffer, byteOffset, this.nodeCount),
      edges: new Int32Array(
        buffer,
        byteOffset + this.nodeCount * Int32Array.BYTES_PER_ELEMENT,
        this.edgeCount,
      ),
      combos: new Int32Array(
        buffer,
        byteOffset +
          (this.nodeCount + this.edgeCount) * Int32Array.BYTES_PER_ELEMENT,
        this.comboCount,
      ),
      typeData: typeDataIndex,
    };

    byteOffset +=
      (this.nodeCount + this.edgeCount + this.comboCount) *
      Int32Array.BYTES_PER_ELEMENT;

    this.offsets = new Int32Array(buffer, byteOffset, stringCount);
    byteOffset += stringCount * Int32Array.BYTES_PER_ELEMENT;

    this.lengths = new Int32Array(buffer, byteOffset, stringCount);
    byteOffset += stringCount * Int32Array.BYTES_PER_ELEMENT;

    this.blob = new Uint8Array(buffer, byteOffset);
  }

  private readString(index: number) {
    const cached = this.stringCache.get(index);
    if (cached !== undefined) {
      return cached;
    }

    const start = this.offsets[index];
    const length = this.lengths[index];
    const value = decodeString(this.blob.subarray(start, start + length));
    this.stringCache.set(index, value);
    return value;
  }

  getTypeData() {
    if (!this.typeDataCache) {
      this.typeDataCache = parseJsonValue<Record<string, TypeDataDeclare>>(
        this.readString(this.stringIndexes.typeData),
      );
    }
    return this.typeDataCache;
  }

  getNode(index: number) {
    const cached = this.nodeCache.get(index);
    if (cached) {
      return cached;
    }
    const value = parseGraphItem<GraphNodeData>(
      this.readString(this.stringIndexes.nodes[index]),
    );
    this.nodeCache.set(index, value);
    return value;
  }

  getEdge(index: number) {
    const cached = this.edgeCache.get(index);
    if (cached) {
      return cached;
    }
    const value = parseGraphItem<GraphArrowData>(
      this.readString(this.stringIndexes.edges[index]),
    );
    this.edgeCache.set(index, value);
    return value;
  }

  getCombo(index: number) {
    const cached = this.comboCache.get(index);
    if (cached) {
      return cached;
    }
    const value = parseGraphItem<GraphComboData>(
      this.readString(this.stringIndexes.combos[index]),
    );
    this.comboCache.set(index, value);
    return value;
  }

  materialize() {
    if (this.materializedCache) {
      return this.materializedCache;
    }
    const nodes = Array.from({ length: this.nodeCount }, (_, index) =>
      this.getNode(index),
    );
    const edges = Array.from({ length: this.edgeCount }, (_, index) =>
      this.getEdge(index),
    );
    const combos = Array.from({ length: this.comboCount }, (_, index) =>
      this.getCombo(index),
    );

    this.materializedCache = {
      nodes,
      edges,
      combos,
      typeData: this.getTypeData(),
    } satisfies GraphViewResult;
    return this.materializedCache;
  }
}

export function encodeGraphViewSnapshot(result: GraphViewResult): Uint8Array {
  const strings: string[] = [];
  const pushString = (value: string) => {
    const index = strings.length;
    strings.push(value);
    return index;
  };

  const nodeIndexes = new Int32Array(result.nodes.length);
  const edgeIndexes = new Int32Array(result.edges.length);
  const comboIndexes = new Int32Array(result.combos.length);

  for (let i = 0; i < result.nodes.length; i += 1) {
    nodeIndexes[i] = pushString(serializeGraphItem(result.nodes[i]));
  }
  for (let i = 0; i < result.edges.length; i += 1) {
    edgeIndexes[i] = pushString(serializeGraphItem(result.edges[i]));
  }
  for (let i = 0; i < result.combos.length; i += 1) {
    comboIndexes[i] = pushString(serializeGraphItem(result.combos[i]));
  }

  const typeDataIndex = pushString(JSON.stringify(result.typeData));
  const { offsets, lengths, blob } = buildStringTable(strings);

  const byteLength =
    HEADER_LENGTH * Int32Array.BYTES_PER_ELEMENT +
    (nodeIndexes.length + edgeIndexes.length + comboIndexes.length) *
      Int32Array.BYTES_PER_ELEMENT +
    offsets.byteLength +
    lengths.byteLength +
    blob.byteLength;

  const buffer = new ArrayBuffer(byteLength);
  const header = new Int32Array(buffer, 0, HEADER_LENGTH);
  header[0] = GRAPH_VIEW_MAGIC;
  header[1] = GRAPH_VIEW_VERSION;
  header[2] = result.nodes.length;
  header[3] = result.edges.length;
  header[4] = result.combos.length;
  header[5] = strings.length;
  header[6] = typeDataIndex;

  let byteOffset = HEADER_LENGTH * Int32Array.BYTES_PER_ELEMENT;
  new Int32Array(buffer, byteOffset, nodeIndexes.length).set(nodeIndexes);
  byteOffset += nodeIndexes.byteLength;
  new Int32Array(buffer, byteOffset, edgeIndexes.length).set(edgeIndexes);
  byteOffset += edgeIndexes.byteLength;
  new Int32Array(buffer, byteOffset, comboIndexes.length).set(comboIndexes);
  byteOffset += comboIndexes.byteLength;
  new Int32Array(buffer, byteOffset, offsets.length).set(offsets);
  byteOffset += offsets.byteLength;
  new Int32Array(buffer, byteOffset, lengths.length).set(lengths);
  byteOffset += lengths.byteLength;
  new Uint8Array(buffer, byteOffset).set(blob);

  return new Uint8Array(buffer);
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
