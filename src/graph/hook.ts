import { useCallback, useEffect, useState } from "react";
// Graph Data Types
// Graph Data Class
import * as PIXI from "pixi.js";

import {
  GraphNode,
  GraphCombo,
  GraphArrow,
  type CurRender,
  type GraphNodeData,
  type GraphComboData,
  type GraphArrowData,
} from "./items/index";

export {
  GraphNode,
  GraphCombo,
  GraphArrow,
  type GraphNodeData,
  type GraphComboData,
  type GraphArrowData,
  type CurRender,
};
import { type UIItemState } from "@nexiq/shared";
import type { GraphViewBufferView } from "../view-snapshot/codec";
import { useGraphProfilerStore } from "../hooks/use-graph-profiler-store";

export type useGraphProps = {
  nodes?: GraphNodeData[];
  edges?: GraphArrowData[];
  combos?: GraphComboData[];
  viewBuffer?: GraphViewBufferView | null;
  config?: GraphDataConfig;
  projectPath?: string;
  targetPath?: string;
};

export type GraphDataCallbackParams =
  | { type: "new-nodes" }
  | { type: "new-edges" }
  | { type: "new-combos" }
  | {
      type: "combo-collapsed";
      id: string;
      previousRadius?: number;
      targetRadius?: number;
    }
  | { type: "combo-drag-move"; id: string; edgeIds: string[]; child?: boolean }
  | { type: "combo-drag-end"; id: string }
  | { type: "node-drag-move"; id: string; edgeIds: string[] }
  | { type: "node-drag-end"; id: string }
  | {
      type: "combo-radius-change";
      id: string;
      edgeIds: string[];
      child?: boolean;
    }
  | { type: "layout-change" }
  | { type: "child-moved" };

export type GraphDataCallback = (params: GraphDataCallbackParams) => void;

type InnerCallBackParams = { type: "child-moved" } | { type: "layout-change" };

type InnerCallBack = (params: InnerCallBackParams) => void;

// Graph Data Class

export interface GraphComboHookBase extends GraphComboData {
  nodes?: Record<string, GraphNode>;
  edges?: Record<string, GraphArrow>;
  combos?: string[];
}

export interface GraphComboHook extends GraphComboHookBase {
  comboRadiusChange: (id: string, radius: number) => void;
  comboCollapsed: (id: string) => void;
  comboDragMove: (id: string, e: PIXI.FederatedPointerEvent) => void;
  comboDragEnd: (id: string, e: PIXI.FederatedPointerEvent) => void;
  comboHover: () => void;
}

export interface GraphDataConfig {
  node: {
    color: string;
  };
  combo: {
    color: string;
    minRadius: number;
    maxRadius: number;
    padding: number;
  };
}

import LayoutWorker from "./layout.worker?worker";
import type { LayoutRequest, LayoutResponse } from "./layout.worker";

const SCALE_FACTOR = 0.6;

const defaultConfig: GraphDataConfig = {
  node: {
    color: "blue",
  },
  combo: {
    color: "blue",
    minRadius: 20,
    maxRadius: 20,
    padding: 10,
  },
};

export class GraphData {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphArrow> = new Map();
  private combos: Map<string, GraphCombo> = new Map();

  private comboChildMap: Map<string, string> = new Map();
  private edgeParentMap: Map<string, string> = new Map();

  private callback: Record<string, GraphDataCallback> = {};

  private comboToCreate: GraphComboData[] = [];
  private nodeToCreate: GraphNodeData[] = [];
  private edgeToCreate: GraphArrowData[] = [];
  private edgeIds: Record<string, Set<string>> = {};
  private layoutRequestOrder = new Map<string, string[]>();
  private layoutRequestStartedAt = new Map<string, number>();
  private profileRunId: string | null = null;

  private config: GraphDataConfig;

  private innerCallback: Map<string, InnerCallBack> = new Map();

  private isBatching = false;

  private worker: globalThis.Worker;

  public projectPath?: string;
  public targetPath?: string;

  private layoutInProgress: Set<string> = new Set();
  private draggingId: string | null = null;

  public lastModified: number = Date.now();
  private cachedAbsolutePositions: Map<string, { x: number; y: number }> =
    new Map();
  private cachedBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null = null;

  constructor(
    nodes: GraphNodeData[],
    edges: GraphArrowData[],
    combos: GraphComboData[],
    config?: GraphDataConfig,
    projectPath?: string,
    targetPath?: string,
  ) {
    this.projectPath = projectPath;
    this.targetPath = targetPath;
    this.worker = new LayoutWorker();
    this.worker.onmessage = (e: MessageEvent) => {
      const { type, id, positions } = e.data as LayoutResponse;
      if (type === "layout-result") {
        this.layoutInProgress.delete(id);
        const order = this.layoutRequestOrder.get(id) ?? [];
        this.layoutRequestOrder.delete(id);
        const startedAt = this.layoutRequestStartedAt.get(id);
        this.layoutRequestStartedAt.delete(id);
        if (this.profileRunId && startedAt != null) {
          useGraphProfilerStore.getState().addStage(this.profileRunId, {
            name: id === "root" ? "Root layout" : `Combo layout: ${id}`,
            durationMs: performance.now() - startedAt,
            source: "renderer",
            detail: `${order.length} items`,
          });
        }
        this.batch(() => {
          if (id === "root") {
            for (let index = 0; index < order.length; index += 1) {
              const pointId = order[index];
              if (pointId === this.draggingId) continue;
              const node = this.getPointByID(pointId);
              if (node) {
                node.x = positions[index * 2] ?? node.x;
                node.y = positions[index * 2 + 1] ?? node.y;
                if (!("collapsedRadius" in node)) {
                  node.isLayoutCalculated = true;
                }
              }
            }

            const edgeIds = new Set<string>();
            for (const pointId of order) {
              const ids = this.getComboEdges(pointId);
              for (const edgeId of ids) {
                edgeIds.add(edgeId);
              }
            }

            this.updateEdgePos(Array.from(edgeIds));

            for (const c of Array.from(this.combos.values())) {
              this.innerCallback.get(c.id)?.({ type: "layout-change" });
            }
          } else {
            const combo = this.getComboByID(id);
            if (combo) {
              for (let index = 0; index < order.length; index += 1) {
                const pointId = order[index];
                if (pointId === this.draggingId) continue;
                const node =
                  combo.child?.nodes[pointId] ?? combo.child?.combos[pointId];
                if (node) {
                  node.x = positions[index * 2] ?? node.x;
                  node.y = positions[index * 2 + 1] ?? node.y;
                  if (!("collapsedRadius" in node)) {
                    node.isLayoutCalculated = true;
                  }
                }
              }

              const edgeIds = new Set<string>();
              for (const pointId of order) {
                const ids = this.getComboEdges(pointId);
                for (const edgeId of ids) {
                  edgeIds.add(edgeId);
                }
              }

              this.updateEdgePos(Array.from(edgeIds));

              const oldRadius = combo.expandedRadius;
              combo.expandedRadius = this.calculateComboRadius(combo);
              if (!combo.collapsed) {
                combo.radius = combo.expandedRadius;
              }
              combo.isLayoutCalculated = true;
              this.innerCallback.get(id)?.({ type: "layout-change" });

              this.trigger({
                type: "combo-radius-change",
                id: combo.id,
                edgeIds: Array.from(edgeIds),
                child: true,
              });

              // Trigger parent layout to accommodate new radius if changed significantly
              if (Math.abs(combo.expandedRadius - oldRadius) > 1) {
                if (combo.parent == null) {
                  this.layout(true, combo.id);
                } else {
                  this.calculateComboChildrenLayout(
                    combo.parent.id,
                    true,
                    combo.id,
                  );
                }
              }
            }
          }

          this.markModified();
        }, true); // onlyLayout = true
      }
    };

    this.config = {
      ...defaultConfig,
      ...config,
      node: {
        ...defaultConfig.node,
        ...config?.node,
      },
      combo: {
        ...defaultConfig.combo,
        ...config?.combo,
      },
    };

    this.addCombos(combos);
    this.addNodes(nodes);
    this.addEdges(edges);
  }

  private markModified() {
    this.lastModified = Date.now();
    this.cachedAbsolutePositions.clear();
    this.cachedBounds = null;
  }

  public bind(cb: GraphDataCallback) {
    const id = crypto.randomUUID();
    this.callback[id] = cb;
    return id;
  }

  public unbind(id: string) {
    delete this.callback[id];
  }

  public setDraggingId(id: string | null) {
    this.draggingId = id;
  }

  private trigger(data: GraphDataCallbackParams) {
    if (this.isBatching) return;
    for (const cb of Object.values(this.callback)) {
      cb(data);
    }
  }

  public batch(fn: () => void, onlyLayout = false) {
    const prevBatching = this.isBatching;
    this.isBatching = true;
    try {
      fn();
    } finally {
      this.isBatching = prevBatching;
      if (!this.isBatching) {
        this.refresh(onlyLayout);
      }
    }
  }

  public refresh(onlyLayout = false) {
    this.curRender = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      combos: Object.fromEntries(this.combos),
    };

    if (onlyLayout) {
      this.trigger({ type: "layout-change" });
    } else {
      this.trigger({ type: "new-nodes" });
      this.trigger({ type: "new-combos" });
      this.trigger({ type: "new-edges" });
    }

    for (const c of Array.from(this.combos.values())) {
      this.innerCallback.get(c.id)?.({ type: "layout-change" });
    }
  }

  public clear() {
    this.nodes.clear();
    this.edges.clear();
    this.combos.clear();
    this.comboChildMap.clear();
    this.comboToCreate = [];
    this.nodeToCreate = [];
    this.edgeToCreate = [];
    this.edgeIds = {};
    this.markModified();
  }

  public setData(
    nodes: GraphNodeData[],
    edges: GraphArrowData[],
    combos: GraphComboData[],
    projectPath?: string,
    targetPath?: string,
  ) {
    if (projectPath) this.projectPath = projectPath;
    if (targetPath) this.targetPath = targetPath;

    this.batch(() => {
      this.clear();
      this.addCombos(combos);
      this.addNodes(nodes);
      this.addEdges(edges);
    });
  }

  public setDataFromViewBuffer(
    viewBuffer: GraphViewBufferView,
    projectPath?: string,
    targetPath?: string,
  ) {
    if (projectPath) this.projectPath = projectPath;
    if (targetPath) this.targetPath = targetPath;

    this.batch(() => {
      this.clear();
      const combos = Array.from({ length: viewBuffer.comboCount }, (_, index) =>
        viewBuffer.getCombo(index),
      );
      const nodes = Array.from({ length: viewBuffer.nodeCount }, (_, index) =>
        viewBuffer.getNode(index),
      );
      const edges = Array.from({ length: viewBuffer.edgeCount }, (_, index) =>
        viewBuffer.getEdge(index),
      );
      this.addCombos(combos);
      this.addNodes(nodes);
      this.addEdges(edges);
    });
  }

  public setProfileRunId(runId: string | null) {
    this.profileRunId = runId;
  }

  private getComboHook(id: string): GraphComboHookBase | undefined {
    const combo = this.getComboByID(id);
    if (combo == null) return;

    const { child, ...comboData } = combo;
    return {
      ...comboData,
      ...child,
      combos: child?.combos == null ? undefined : Object.keys(child.combos),
    };
  }

  public useCombo(id: string) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [state, setState] = useState<GraphComboHook | null>(null);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const callback = useCallback(
      (param: InnerCallBackParams) => {
        if (param.type === "child-moved") {
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s: GraphComboHook | null) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        } else if (param.type === "layout-change") {
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s: GraphComboHook | null) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        }
      },
      [setState, id],
    );

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const combo = this.getComboHook(id);
      if (combo == null) return;

      this.innerCallback.set(id, callback);

      const newData: GraphComboHook = {
        ...combo,
        comboCollapsed: (id: string) => {
          this.comboCollapsed(id);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s: GraphComboHook | null) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
        comboDragMove: (id: string, e: PIXI.FederatedPointerEvent) => {
          this.comboDragMove(id, e);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s: GraphComboHook | null) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
        comboDragEnd: (id: string, e: PIXI.FederatedPointerEvent) => {
          this.comboDragEnd(id, e);
        },
        comboRadiusChange: (id: string, radius: number) => {
          this.comboRadiusChange(id, radius);
          const combo = this.getComboHook(id);
          if (combo == null) return;

          setState((s: GraphComboHook | null) => {
            if (s == null) return null;

            return {
              ...s,
              ...combo,
            };
          });
        },
        comboHover: () => {
          this.calculateComboChildrenLayout(id);
        },
      };

      setState(newData);
    }, [id, callback]);

    return { ...state };
  }

  public calculateComboChildrenLayout(
    id: string,
    force = false,
    fixedId?: string,
  ) {
    const combo = this.getComboByID(id);
    if (combo == null) return;
    if (!force && combo.isLayoutCalculated) return;
    if (this.layoutInProgress.has(id)) return;

    // Check if we already have positions (from persistence)
    // If all children have x,y != 0 (or some check), maybe skips?
    // But persistence layer should set isLayoutCalculated = true if loaded.

    // If not calculated, send to worker
    const points = [
      ...Object.values(combo.child?.nodes ?? {}),
      ...Object.values(combo.child?.combos ?? {}),
    ];
    const pointIndex = new Map(points.map((point, index) => [point.id, index]));
    const positions = new Float32Array(points.length * 2);
    const radii = new Float32Array(points.length);
    const fixed = new Uint8Array(points.length);
    const edgePairs = Object.values(combo.child?.edges ?? {}).filter(
      (edge) =>
        pointIndex.has(edge.source) && pointIndex.has(edge.target),
    );
    const sources = new Uint32Array(edgePairs.length);
    const targets = new Uint32Array(edgePairs.length);

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      positions[index * 2] = point.x;
      positions[index * 2 + 1] = point.y;
      radii[index] = Number(
        "collapsedRadius" in point ? point.expandedRadius : point.radius,
      );
      fixed[index] = point.id === this.draggingId || point.id === fixedId ? 1 : 0;
    }

    for (let index = 0; index < edgePairs.length; index += 1) {
      const edge = edgePairs[index];
      sources[index] = pointIndex.get(edge.source)!;
      targets[index] = pointIndex.get(edge.target)!;
    }

    this.layoutRequestOrder.set(combo.id, points.map((point) => point.id));
    this.layoutRequestStartedAt.set(combo.id, performance.now());
    this.worker.postMessage({
      type: "layout",
      id: combo.id,
      nodeIds: points.map((point) => point.id),
      positions,
      radii,
      fixed,
      sources,
      targets,
      options: {
        repulsionStrength: 250 * combo.scale,
        linkDistance: 22 * combo.scale,
        attractionStrength: 0.18,
        damping: 0.8,
        gravity: 0.04,
        timeStep: 0.02,
        minNodeDistance: 25 * combo.scale,
        collisionStrength: 2,
        alpha: 1.0,
        alphaDecay: 0.005,
      },
      iterations: 1200,
    } satisfies LayoutRequest);
  }

  private _addChildEdge(e: GraphArrowData): boolean {
    if (e.combo == null) {
      return false;
    }

    const parentCombo = this.getComboByID(e.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const srcNode = this.getPointId(e.source);
      const targetNode = this.getPointId(e.target);

      if (srcNode == null || targetNode == null) {
        return false;
      }

      parentCombo.child.edges[e.id] = new GraphArrow({
        ...e,
        points: [],
        scale: Math.min(srcNode.scale, targetNode.scale),
      });
      this.edgeParentMap.set(e.id, parentCombo.id);
      this.updateEdgePos([e.id]);
      return true;
    }

    return false;
  }

  private _addChildNode(c: GraphNodeData): boolean {
    if (c.combo == null) {
      console.error("_addChildNode parent is null", c);
      return false;
    }

    const parentCombo = this.getComboByID(c.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const nodesSize = Object.keys(parentCombo.child.nodes).length;
      const combosSize = Object.keys(parentCombo.child.combos).length;
      const size = nodesSize + combosSize;

      let x = c.x;
      let y = c.y;

      if (c.ui) {
        x = (c.ui as UIItemState).x;
        y = (c.ui as UIItemState).y;
      } else if (parentCombo.ui?.children?.[c.id]) {
        x = (parentCombo.ui.children[c.id] as UIItemState).x;
        y = (parentCombo.ui.children[c.id] as UIItemState).y;
      }

      const scale = parentCombo.scale * SCALE_FACTOR;

      const getDeepSavedUi = (
        id: string,
        parent: GraphCombo,
      ): UIItemState | undefined => {
        if (c.ui) return c.ui;
        let current: GraphCombo | undefined = parent;
        while (current) {
          if (current.ui?.children?.[id]) return current.ui.children[id];
          if (current.ui?.vars?.[id]) return current.ui.vars[id];
          current = current.parent;
        }
        return undefined;
      };

      const savedUi = getDeepSavedUi(c.id, parentCombo);

      let radius =
        c.appearanceOverride?.radius ??
        savedUi?.radius ??
        c.radius ??
        this.config.combo.minRadius;
      if (!savedUi?.radius) {
        radius *= scale;
      }

      parentCombo.child.nodes[c.id] = new GraphNode({
        ...c,
        radius,
        color: (c.color as string) ?? this.config.node.color,
        isLayoutCalculated: !!(savedUi as UIItemState)?.isLayoutCalculated,
        x: x ?? (Math.random() - 0.5) * (size + 1) * 10 * scale,
        y: y ?? (Math.random() - 0.5) * (size + 1) * 10 * scale,
        parent: parentCombo,
        scale,
      });
      this.comboChildMap.set(c.id, c.combo);
      return true;
    }

    return false;
  }

  private _addNodes(count?: number) {
    if (count != null && count == this.nodeToCreate.length) {
      console.error(
        "_addNodes failed to create",
        count,
        this.nodeToCreate,
        Object.fromEntries(this.combos),
        this.comboChildMap.get("44d171ea-4fbf-4cc4-ae67-218df1a1caf2-render"),
      );
      return;
    }

    const newNodeToCreate: GraphNodeData[] = [];
    for (const c of this.nodeToCreate) {
      if (this._addChildNode(c)) {
        continue;
      }

      newNodeToCreate.push(c);
    }

    const prevCount = this.nodeToCreate.length;
    this.nodeToCreate = newNodeToCreate;

    if (this.nodeToCreate.length > 0) {
      this._addNodes(prevCount);
    }
  }

  public addNodes(nodes: GraphNodeData[]) {
    this.nodes.clear();
    for (const n of nodes) {
      if (n.combo == null) {
        this.nodes.set(
          n.id,
          new GraphNode({
            ...n,
            radius:
              n.appearanceOverride?.radius ??
              (n.ui as UIItemState)?.radius ??
              (n.radius as number) ??
              20,
            color: (n.color as string) ?? this.config.node.color,
            isLayoutCalculated: !!(n.ui as UIItemState)?.isLayoutCalculated,
            x:
              (n.ui as UIItemState)?.x ??
              (n.x as number) ??
              (Math.random() - 0.5) * 100, // Use UI position if available
            y:
              (n.ui as UIItemState)?.y ??
              (n.y as number) ??
              (Math.random() - 0.5) * 100,
            scale: 1,
          }),
        );
        continue;
      }

      if (this._addChildNode(n)) {
        continue;
      }

      this.nodeToCreate.push(n);
    }

    // Update radii for combos that have children nodes added
    for (const c of this.getAllCombos()) {
      if (c.isLayoutCalculated) {
        this.updateComboRadius(c.id);
      }
    }

    this.createEdges();
    this.markModified();

    this.trigger({ type: "new-nodes" });
  }

  private addEdgeId(nodeId: string, edgeId: string) {
    if (this.edgeIds[nodeId] == null) {
      this.edgeIds[nodeId] = new Set();
    }
    this.edgeIds[nodeId].add(edgeId);
  }

  private getPointId(id: string) {
    return this.getPointByID(id);
  }

  public getPointByID(id: string): GraphNode | GraphCombo | undefined {
    let item: GraphNode | GraphCombo | undefined =
      this.nodes.get(id) ?? this.combos.get(id);

    if (!item) {
      const parentId = this.comboChildMap.get(id);
      if (parentId) {
        const parent = this.getComboByID(parentId);
        if (parent && parent.child) {
          item = parent.child.nodes[id] ?? parent.child.combos[id];
        }
      }
    }

    return item;
  }

  private createEdges() {
    const newEdgesToCreate: GraphArrowData[] = [];
    for (const e of this.edgeToCreate) {
      if (e.combo == null) {
        const srcNode = this.getPointId(e.source);
        const targetNode = this.getPointId(e.target);

        if (srcNode == null || targetNode == null) {
          newEdgesToCreate.push(e);
          continue;
        }

        this.edges.set(
          e.id,
          new GraphArrow({
            ...e,
            points: [],
            scale: Math.min(srcNode.scale, targetNode.scale),
          }),
        );
        this.updateEdgePos([e.id]);
        continue;
      }

      if (!this._addChildEdge(e)) {
        newEdgesToCreate.push(e);
      }
    }

    this.edgeToCreate = newEdgesToCreate;
  }

  public addEdges(edges: GraphArrowData[]) {
    this.edges.clear();
    this.edgeParentMap.clear();
    for (const e of edges) {
      this.addEdgeId(e.source, e.id);
      this.addEdgeId(e.target, e.id);

      if (e.combo == null) {
        const srcNode = this.getPointId(e.source);
        const targetNode = this.getPointId(e.target);

        if (srcNode == null || targetNode == null) {
          this.edgeToCreate.push(e);
          continue;
        }

        this.edges.set(
          e.id,
          new GraphArrow({
            ...e,
            points: [],
            scale: Math.min(srcNode.scale, targetNode.scale),
          }),
        );
        this.updateEdgePos([e.id]);
        this.edgeParentMap.delete(e.id);
      }

      if (this._addChildEdge(e)) {
        continue;
      }

      this.edgeToCreate.push(e);
    }

    this.markModified();
    this.trigger({ type: "new-edges" });
  }

  private getComboByID(id: string, i = 0): GraphCombo | undefined {
    if (i > 100) {
      console.error("getComboByID: recursion depth exceeded for ID", id);
      return undefined;
    }

    if (this.combos.has(id)) {
      const parentCombo = this.combos.get(id);
      if (parentCombo != null) {
        return parentCombo;
      }
    }

    if (this.comboChildMap.has(id)) {
      const parentId = this.comboChildMap.get(id);
      if (parentId != null) {
        if (parentId === id) {
          console.error("getComboByID: self-parent cycle detected for ID", id);
          return undefined;
        }
        const parent = this.getComboByID(parentId, i + 1);
        if (parent != null) {
          return (parent.child?.combos as Record<string, GraphCombo>)[id];
        }
      }
    }

    return undefined;
  }

  private _addChildCombo(c: GraphComboData): boolean {
    if (c.combo == null) {
      console.error("_addChildCombo parent is null", c);
      return false;
    }

    const parentCombo = this.getComboByID(c.combo);
    if (parentCombo != null) {
      if (parentCombo.child == null) {
        parentCombo.child = {
          nodes: {},
          combos: {},
          edges: {},
        };
      }

      const nodesSize = Object.keys(parentCombo.child.nodes).length;
      const combosSize = Object.keys(parentCombo.child.combos).length;
      const size = nodesSize + combosSize;

      const scale = parentCombo.scale * SCALE_FACTOR;

      const getDeepSavedUi = (
        id: string,
        parent: GraphCombo,
      ): UIItemState | undefined => {
        if (c.ui) return c.ui;
        let current: GraphCombo | undefined = parent;
        while (current) {
          if (current.ui?.children?.[id]) return current.ui.children[id];
          if (current.ui?.vars?.[id]) return current.ui.vars[id];
          current = current.parent;
        }
        return undefined;
      };

      const savedUi = getDeepSavedUi(c.id, parentCombo);

      let collapsedRadius =
        savedUi?.collapsedRadius ??
        c.collapsedRadius ??
        this.config.combo.minRadius;
      if (!savedUi?.collapsedRadius && !savedUi?.radius) {
        collapsedRadius *= scale;
      }

      let expandedRadius =
        savedUi?.expandedRadius ??
        savedUi?.radius ??
        c.expandedRadius ??
        this.config.combo.maxRadius;

      if (!savedUi?.expandedRadius && !savedUi?.radius) {
        expandedRadius *= scale;
      }

      (parentCombo.child.combos as Record<string, GraphCombo>)[c.id] =
        new GraphCombo({
          ...c,
          collapsed: (savedUi as UIItemState)?.collapsed ?? c.collapsed,
          radius:
            ((savedUi as UIItemState)?.collapsed ?? c.collapsed)
              ? ((savedUi as UIItemState)?.radius ?? collapsedRadius)
              : ((savedUi as UIItemState)?.expandedRadius ?? expandedRadius),
          color: (c.color as string) ?? this.config.combo.color,
          collapsedRadius:
            (savedUi as UIItemState)?.collapsedRadius ?? collapsedRadius,
          expandedRadius:
            (savedUi as UIItemState)?.expandedRadius ?? expandedRadius,
          x:
            (c.ui as UIItemState)?.x ??
            (c.x as number) ??
            (Math.random() - 0.5) * (size + 1) * 50 * scale,
          y:
            (c.ui as UIItemState)?.y ??
            (c.y as number) ??
            (Math.random() - 0.5) * (size + 1) * 50 * scale,
          padding: (c.padding as number) ?? this.config.combo.padding,
          isLayoutCalculated: !!(savedUi as UIItemState)?.isLayoutCalculated,
          parent: parentCombo,
          scale,
        });
      this.comboChildMap.set(c.id, c.combo);
      return true;
    }

    return false;
  }

  private _addCombos(count?: number) {
    if (count != null && count == this.comboToCreate.length) {
      console.error("_addCombos failed to create", this.comboToCreate);
      return;
    }

    const newComboToCreate: GraphComboData[] = [];
    for (const c of this.comboToCreate) {
      if (this._addChildCombo(c)) {
        continue;
      }

      newComboToCreate.push(c);
    }

    const prevCount = this.comboToCreate.length;
    this.comboToCreate = newComboToCreate;

    if (this.comboToCreate.length > 0) {
      this._addCombos(prevCount);
    }
  }

  public addCombos(combos: GraphComboData[]) {
    this.combos.clear();
    for (const c of combos) {
      if (c.combo == null) {
        const collapsedRadius =
          c.ui?.collapsedRadius ??
          c.collapsedRadius ??
          this.config.combo.minRadius;
        const expandedRadius =
          c.ui?.expandedRadius ??
          c.ui?.radius ??
          c.expandedRadius ??
          this.config.combo.maxRadius;

        this.combos.set(
          c.id,
          new GraphCombo({
            ...c,
            collapsed: c.ui?.collapsed ?? c.collapsed,
            radius:
              (c.ui?.collapsed ?? c.collapsed)
                ? (c.ui?.radius ?? collapsedRadius)
                : (c.ui?.expandedRadius ?? expandedRadius),
            color: c.color ?? this.config.combo.color,
            collapsedRadius: c.ui?.collapsedRadius ?? collapsedRadius,
            expandedRadius: c.ui?.expandedRadius ?? expandedRadius,
            x: c.ui?.x ?? c.x ?? (Math.random() - 0.5) * combos.length * 10,
            y: c.ui?.y ?? c.y ?? (Math.random() - 0.5) * combos.length * 10,
            padding: c.padding ?? this.config.combo.padding,
            isLayoutCalculated: !!c.ui?.isLayoutCalculated,
            scale: 1,
          }),
        );
        continue;
      }

      if (this._addChildCombo(c)) {
        continue;
      }

      this.comboToCreate.push(c);
    }

    // add combo that have parent
    this._addCombos();
    this._addNodes();

    this.createEdges();
    this.markModified();

    this.trigger({ type: "new-combos" });
  }

  public comboCollapsed(id: string) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboCollapsed: combo not found");
      return;
    }

    const previousRadius = combo.radius;
    combo.collapsed = !combo.collapsed;
    combo.radius = combo.collapsed
      ? combo.collapsedRadius
      : combo.expandedRadius;

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.markModified();
    this.trigger({
      type: "combo-collapsed",
      id: combo.id,
      previousRadius,
      targetRadius: combo.radius,
    });

    if (!combo.collapsed) {
      // Ensure children of this combo are laid out so we know its expanded size
      this.calculateComboChildrenLayout(id, false);
    }
  }

  // trigger by self on collpase/expand
  public comboRadiusChange(id: string, radius: number) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboRadiusChange: combo not found");
      return;
    }

    combo.radius = radius;
    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.markModified();
    this.trigger({
      type: "combo-radius-change",
      id: combo.id,
      edgeIds,
      child: false,
    });

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);
    }
  }

  private updateEdgePos(ids: string[]) {
    for (const id of ids) {
      const edge = this.getEdge(id);
      if (edge == null) continue;

      const parentId = this.edgeParentMap.get(id);
      const srcVisible = this.getVisiblePoint(edge.source, parentId);
      const targetVisible = this.getVisiblePoint(edge.target, parentId);

      if (srcVisible == null || targetVisible == null) continue;

      if (srcVisible.item.id === targetVisible.item.id) {
        edge.points = [];
        continue;
      }

      const srcNode = srcVisible.item;
      const targetNode = targetVisible.item;

      edge.scale = Math.min(srcNode.scale, targetNode.scale);

      const parentNode = parentId ? this.getComboByID(parentId) : undefined;
      edge.updatePoints(srcNode, targetNode, parentNode);
    }
  }

  private getComboEdges(nodeId: string): string[] {
    const edgeIds = new Set<string>();
    const collect = (itemId: string) => {
      const ids = this.edgeIds[itemId];
      if (ids) {
        for (const eid of Array.from(ids)) {
          edgeIds.add(eid);
        }
      }

      const combo = this.getComboByID(itemId);
      if (combo && combo.child) {
        for (const childNode of Object.values(combo.child.nodes)) {
          collect(childNode.id);
        }
        for (const childCombo of Object.values(combo.child.combos)) {
          collect(childCombo.id);
        }
      }
    };
    collect(nodeId);
    return Array.from(edgeIds);
  }

  private calculateComboRadius(combo: GraphCombo): number {
    let maxRadius = 0;

    for (const node of Object.values(combo.child?.nodes ?? {})) {
      const dist = Math.sqrt(node.x * node.x + node.y * node.y) + node.radius;
      if (dist > maxRadius) maxRadius = dist;
    }

    for (const childCombo of Object.values(combo.child?.combos ?? {})) {
      const dist =
        Math.sqrt(childCombo.x * childCombo.x + childCombo.y * childCombo.y) +
        childCombo.expandedRadius;
      if (dist > maxRadius) maxRadius = dist;
    }

    return Math.max(
      maxRadius + combo.padding * combo.scale,
      combo.collapsedRadius,
      this.config.combo.maxRadius * combo.scale,
    );
  }

  private updateComboRadius(id: string) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("updateComboRadius: combo not found");
      return;
    }

    const radius = this.calculateComboRadius(combo);

    combo.expandedRadius = radius;
    if (!combo.collapsed) {
      combo.radius = radius;
    }

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);
    this.markModified();
    this.trigger({
      type: "combo-radius-change",
      id: id,
      edgeIds,
    });

    const cb = this.innerCallback.get(id);
    if (cb != null) {
      cb({
        type: "child-moved",
      });
    }

    if (combo.parent != null) {
      this.updateComboRadius(combo.parent.id);
    }
  }

  public comboDragMove(id: string, e: PIXI.FederatedPointerEvent) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboDragMove: combo not found");
      return;
    }

    combo.x = e.target.x;
    combo.y = e.target.y;

    const edgeIds = this.getComboEdges(id);
    this.updateEdgePos(edgeIds);

    this.markModified();

    // const parentCombo = this.getTopParent(id);
    // if (parentCombo == null) return;

    const parentId = combo.combo;
    if (parentId == null) {
      this.trigger({
        type: "combo-drag-move",
        id: combo.id,
        edgeIds,
      });
      return;
    }

    this.updateComboRadius(parentId);
    const cb = this.innerCallback.get(parentId);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });

    if (combo.parent != null) {
      this.updateComboRadius(parentId);

      const parentCb = this.innerCallback.get(parentId);
      if (parentCb == null) return;

      parentCb({
        type: "child-moved",
      });
    }
  }

  public comboDragEnd(id: string, _e: PIXI.FederatedPointerEvent) {
    this.trigger({
      type: "combo-drag-end",
      id: id,
    });
  }

  public comboChildNodeMove(
    id: string,
    nodeId: string,
    e: PIXI.FederatedPointerEvent,
  ) {
    const combo = this.getComboByID(id);
    if (combo == null) {
      console.error("comboChildNodeMove: combo not found");
      return;
    }

    const node = combo.child?.nodes[nodeId];
    if (node == null) {
      console.error("comboChildNodeMove: node not found");
      return;
    }

    node.x = e.target.x;
    node.y = e.target.y;

    const edgeIds = new Set<string>();

    const ids = this.getComboEdges(node.id);
    for (const edgeId of ids) {
      edgeIds.add(edgeId);
    }

    this.updateEdgePos(Array.from(edgeIds));

    this.markModified();
    this.trigger({
      type: "node-drag-move",
      id: nodeId,
      edgeIds: Array.from(edgeIds),
    });

    this.updateComboRadius(combo.id);
    const cb = this.innerCallback.get(combo.id);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });

    const comboId = combo.combo;
    if (comboId) {
      this.updateComboRadius(comboId);

      const parentCb = this.innerCallback.get(comboId);
      if (parentCb == null) return;

      parentCb({
        type: "child-moved",
      });
    }
  }

  public comboChildNodeEnd(_id: string, nodeId: string) {
    this.trigger({
      type: "node-drag-end",
      id: nodeId,
    });
  }

  public getVisiblePoint(
    id: string,
    limitId?: string,
  ):
    | { item: GraphNode | GraphCombo; isCollapsedAncestor: boolean }
    | undefined {
    const item = this.getPointByID(id);
    if (!item) return undefined;

    let highestCollapsed: GraphCombo | undefined = undefined;

    let p = item.parent;
    while (p && p.id !== limitId) {
      if (p.collapsed) {
        highestCollapsed = p;
      }
      p = p.parent;
    }

    if (highestCollapsed) {
      return { item: highestCollapsed, isCollapsedAncestor: true };
    }
    return { item, isCollapsedAncestor: false };
  }

  public getAbsolutePosition(id: string): { x: number; y: number } | undefined {
    if (this.cachedAbsolutePositions.has(id)) {
      return this.cachedAbsolutePositions.get(id);
    }

    let item: GraphNode | GraphCombo | undefined =
      this.nodes.get(id) ?? this.combos.get(id);

    if (!item) {
      const parentId = this.comboChildMap.get(id);
      if (parentId) {
        const parent = this.getComboByID(parentId);
        if (parent && parent.child) {
          item = parent.child.nodes[id] ?? parent.child.combos[id];
        }
      }
    }

    if (!item) return undefined;

    let x = item.x;
    let y = item.y;
    let currentId = id;

    while (this.comboChildMap.has(currentId)) {
      const parentId = this.comboChildMap.get(currentId)!;
      const parent = this.getComboByID(parentId);
      if (parent) {
        x += parent.x;
        y += parent.y;
        currentId = parentId;
      } else {
        break;
      }
    }

    const pos = { x, y };
    this.cachedAbsolutePositions.set(id, pos);
    return pos;
  }

  public getNodes() {
    return Object.fromEntries(this.nodes);
  }

  public getEdges() {
    return Object.fromEntries(this.edges);
  }

  public getCombos() {
    return Object.fromEntries(this.combos);
  }

  public updateCombo(combo: GraphCombo) {
    const target = this.getComboByID(combo.id);
    if (target) {
      Object.assign(target, combo);
    } else {
      this.combos.set(combo.id, new GraphCombo(combo));
    }

    this.markModified();
    this.trigger({ type: "new-combos" });

    const cb = this.innerCallback.get(combo.id);
    if (cb == null) return;

    cb({
      type: "child-moved",
    });
  }

  public updateNode(node: GraphNode) {
    const target = this.getPointId(node.id);
    if (target) {
      Object.assign(target, node);
    } else {
      this.nodes.set(node.id, new GraphNode(node));
    }
    this.markModified();
    this.trigger({ type: "new-nodes" });
  }

  public updateDataByPath(path: string[], value: unknown) {
    const category = path[0];
    const key = path[path.length - 1];

    if (category === "nodes" || category === "combos" || category === "edges") {
      // Find the target item by looking for an ID in the path
      let item: GraphNode | GraphCombo | GraphArrow | null = null;
      let propPath: string[] = [];

      // Search backwards for the first ID that matches an item
      for (let i = path.length - 2; i >= 0; i--) {
        const id = path[i];
        const found =
          category === "edges" ? this.getEdge(id) : this.getPointByID(id);
        if (found) {
          item = found;
          propPath = path.slice(i + 1);
          break;
        }
      }

      if (item) {
        if (propPath.length === 0) {
          // If editing the whole item, only allow if it's an object
          if (typeof value === "object" && value !== null) {
            Object.assign(item, value);
            this.markModified();
            this.refresh();
          }
          return;
        }

        const lastProp = propPath[propPath.length - 1];

        // Special case for combo collapsed
        if (
          lastProp === "collapsed" &&
          item instanceof GraphCombo &&
          "collapsed" in item
        ) {
          if (item.collapsed !== value) {
            this.comboCollapsed(item.id);
          }
          return;
        }

        // Traverse to the property to update
        let current = item as unknown as Record<string, unknown>;
        for (let i = 0; i < propPath.length - 1; i++) {
          const p = propPath[i];
          if (
            current[p] === undefined ||
            current[p] === null ||
            typeof current[p] !== "object"
          ) {
            return;
          }
          current = current[p] as Record<string, unknown>;
        }

        if (current && lastProp in current) {
          current[lastProp] = value;

          // Handle side effects for radius changes
          if (
            lastProp === "radius" ||
            lastProp === "expandedRadius" ||
            lastProp === "collapsedRadius"
          ) {
            const parent = (item as { parent?: { id: string } }).parent;
            if (parent) {
              this.updateComboRadius(parent.id);
            }
          }

          this.markModified();
          this.refresh();
        }
      }
    } else if (category === "config") {
      let current = this.config as unknown as Record<string, unknown>;
      for (let i = 1; i < path.length - 1; i++) {
        const p = path[i];
        if (current[p] && typeof current[p] === "object") {
          current = current[p] as Record<string, unknown>;
        } else {
          return;
        }
      }
      if (current) {
        current[key] = value;
        this.markModified();
        this.refresh();
      }
    } else if (category === "projectPath" || category === "targetPath") {
      (this as unknown as Record<string, unknown>)[category] = value;
      this.markModified();
      this.refresh();
    }
  }

  public getAllNodes(): GraphNode[] {
    const all: GraphNode[] = [];
    const collect = (
      nodes: Record<string, GraphNode>,
      combos: Record<string, GraphCombo>,
    ) => {
      for (const n of Object.values(nodes)) {
        all.push(n);
      }
      for (const c of Object.values(combos)) {
        if (c.child) {
          collect(c.child.nodes, c.child.combos);
        }
      }
    };
    collect(Object.fromEntries(this.nodes), Object.fromEntries(this.combos));
    return all;
  }

  public getAllCombos(): GraphCombo[] {
    const all: GraphCombo[] = [];
    const collect = (combos: Record<string, GraphCombo>) => {
      for (const c of Object.values(combos)) {
        all.push(c);
        if (c.child) {
          collect(c.child.combos);
        }
      }
    };
    collect(Object.fromEntries(this.combos));
    return all;
  }

  public getAllEdges(): GraphArrow[] {
    const all: GraphArrow[] = [];
    const collect = (
      edges: Record<string, GraphArrow>,
      combos: Record<string, GraphCombo>,
    ) => {
      for (const edge of Object.values(edges)) {
        all.push(edge);
      }
      for (const combo of Object.values(combos)) {
        if (combo.child) {
          collect(combo.child.edges, combo.child.combos);
        }
      }
    };
    collect(Object.fromEntries(this.edges), Object.fromEntries(this.combos));
    return all;
  }

  public expandAncestors(id: string) {
    const parentId = this.comboChildMap.get(id);
    if (!parentId) return;

    const parent = this.getComboByID(parentId);
    if (parent) {
      if (parent.collapsed) {
        parent.collapsed = false;

        // Trigger update for the parent combo to start expansion animation
        this.trigger({
          type: "combo-collapsed",
          id: parentId,
          previousRadius: parent.radius,
          targetRadius: parent.expandedRadius,
        });

        // Ensure child layout is calculated if it hasn't been before
        this.calculateComboChildrenLayout(parentId, false);

        // Trigger update for the parent combo (internal)
        const cb = this.innerCallback.get(parentId);
        if (cb) {
          cb({ type: "child-moved" }); // Triggers re-render of the combo
        }
      }
      this.expandAncestors(parentId);
    }
  }

  public getNode(id: string) {
    const point = this.getPointByID(id);
    if (point && !("collapsedRadius" in point)) {
      return point as GraphNode;
    }
    return undefined;
  }

  public getEdge(id: string) {
    if (this.edges.has(id)) return this.edges.get(id);
    const parentId = this.edgeParentMap.get(id);
    if (parentId) {
      const parent = this.getComboByID(parentId);
      if (parent && parent.child) {
        return parent.child.edges[id];
      }
    }
    return this.curRender.edges[id];
  }

  public nodeDragMove(nodeId: string, e: PIXI.FederatedPointerEvent) {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    node.x = e.target.x;
    node.y = e.target.y;

    const edgeIds = new Set<string>();
    const ids = this.getComboEdges(nodeId);
    for (const edgeId of ids) {
      edgeIds.add(edgeId);
    }

    this.updateEdgePos(Array.from(edgeIds));

    this.markModified();
    this.trigger({
      type: "node-drag-move",
      id: nodeId,
      edgeIds: Array.from(edgeIds),
    });
  }

  public nodeDragEnd(nodeId: string, _e: PIXI.FederatedPointerEvent) {
    this.trigger({
      type: "node-drag-end",
      id: nodeId,
    });
  }

  public getCombo(id: string) {
    return this.getComboByID(id);
  }

  public layout(force = false, fixedId?: string) {
    // Trigger layout for all expanded combos
    for (const c of Array.from(this.getAllCombos())) {
      if (!c.collapsed) {
        this.calculateComboChildrenLayout(c.id, false);
      }
    }

    const allItems = [
      ...Array.from(this.nodes.values()),
      ...Array.from(this.combos.values()),
    ];
    const allCalculated = allItems.every((c) => c.isLayoutCalculated);

    if (!force && allItems.length > 0 && allCalculated) {
      this.trigger({ type: "layout-change" });
      return;
    }

    const points = [
      ...Array.from(this.nodes.values()),
      ...Array.from(this.combos.values()),
    ];
    const pointIndex = new Map(points.map((point, index) => [point.id, index]));
    const positions = new Float32Array(points.length * 2);
    const radii = new Float32Array(points.length);
    const fixed = new Uint8Array(points.length);
    const edgePairs = Array.from(this.edges.values()).filter(
      (edge) =>
        pointIndex.has(edge.source) && pointIndex.has(edge.target),
    );
    const sources = new Uint32Array(edgePairs.length);
    const targets = new Uint32Array(edgePairs.length);

    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      positions[index * 2] = point.x;
      positions[index * 2 + 1] = point.y;
      radii[index] = Number(
        "collapsedRadius" in point ? point.expandedRadius : point.radius,
      );
      fixed[index] = point.id === this.draggingId || point.id === fixedId ? 1 : 0;
    }

    for (let index = 0; index < edgePairs.length; index += 1) {
      const edge = edgePairs[index];
      sources[index] = pointIndex.get(edge.source)!;
      targets[index] = pointIndex.get(edge.target)!;
    }

    this.layoutRequestOrder.set("root", points.map((point) => point.id));
    this.layoutRequestStartedAt.set("root", performance.now());
    this.worker.postMessage({
      type: "layout",
      id: "root",
      nodeIds: points.map((point) => point.id),
      positions,
      radii,
      fixed,
      sources,
      targets,
      iterations: 1200,
      options: {
        minNodeDistance: 200,
        linkDistance: 110,
        attractionStrength: 0.16,
        gravity: 0.18,
        repulsionStrength: 1300,
        collisionStrength: 1.2,
        alpha: 1.0,
        alphaDecay: 0.002,
      },
    } satisfies LayoutRequest);

    // Populate curRender immediately with current positions (even if not laid out yet)
    // or we might wait? But render() initializes curRender.
  }

  private curRender: CurRender = {
    nodes: {},
    edges: {},
    combos: {},
  };

  public getCurRender(): CurRender {
    return this.curRender;
  }

  public getCurNodes(): Record<string, GraphNode> {
    return this.curRender.nodes;
  }

  public getCurEdges(): Record<string, GraphArrow> {
    return this.curRender.edges;
  }

  public getCurCombos(): Record<string, GraphCombo> {
    return this.curRender.combos;
  }

  public getContentBounds(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } {
    if (this.cachedBounds) return this.cachedBounds;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const allNodes = this.getAllNodes();
    const allCombos = this.getAllCombos();

    if (allNodes.length === 0 && allCombos.length === 0) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }

    allNodes.forEach((n) => {
      const pos = this.getAbsolutePosition(n.id);
      if (pos) {
        minX = Math.min(minX, pos.x - n.radius);
        minY = Math.min(minY, pos.y - n.radius);
        maxX = Math.max(maxX, pos.x + n.radius);
        maxY = Math.max(maxY, pos.y + n.radius);
      }
    });

    allCombos.forEach((c) => {
      const pos = this.getAbsolutePosition(c.id);
      if (pos) {
        const r = c.collapsed ? c.collapsedRadius : c.expandedRadius;
        minX = Math.min(minX, pos.x - r);
        minY = Math.min(minY, pos.y - r);
        maxX = Math.max(maxX, pos.x + r);
        maxY = Math.max(maxY, pos.y + r);
      }
    });

    // If no positions are found, return a default
    if (minX === Infinity) {
      const defaultBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
      this.cachedBounds = defaultBounds;
      return defaultBounds;
    }

    const bounds = { minX, minY, maxX, maxY };
    this.cachedBounds = bounds;
    return bounds;
  }

  public getMinItemScale(): number {
    let minScale = 1;
    const allNodes = this.getAllNodes();
    const allCombos = this.getAllCombos();

    allNodes.forEach((n) => {
      if (n.scale && n.scale < minScale) minScale = n.scale;
    });

    allCombos.forEach((c) => {
      if (c.scale && c.scale < minScale) minScale = c.scale;
    });

    return minScale;
  }

  public render() {
    // Run the layout algorithm once, but don't force it if positions already exist
    this.layout(false);

    // Show all nodes/combos/edges initially (no viewport culling on initial render)
    // Viewport culling can be handled by the rendering layer if needed
    this.curRender = {
      nodes: Object.fromEntries(this.nodes),
      edges: Object.fromEntries(this.edges),
      combos: Object.fromEntries(this.combos),
    };

    this.markModified();

    // Trigger final updates to render everything
    this.trigger({ type: "new-combos" });
    this.trigger({ type: "new-nodes" });
    this.trigger({ type: "new-edges" });
  }

  public refreshEdges() {
    this.trigger({ type: "new-edges" });
  }
}

const useGraph: (option: useGraphProps) => GraphData = ({
  nodes = [],
  edges = [],
  combos = [],
  viewBuffer = null,
  config,
  projectPath,
  targetPath,
}) => {
  const [data] = useState(
    () => new GraphData(nodes, edges, combos, config, projectPath, targetPath),
  );

  useEffect(() => {
    if (viewBuffer) {
      data.setDataFromViewBuffer(viewBuffer, projectPath, targetPath);
      return;
    }
    data.setData(nodes, edges, combos, projectPath, targetPath);
  }, [nodes, edges, combos, viewBuffer, projectPath, targetPath, data]);

  // Register graph instance for devtools
  useEffect(() => {
    import("../hooks/use-graph-store").then(({ useGraphStore }) => {
      useGraphStore.getState().setGraphInstance(data);
    });

    return () => {
      import("../hooks/use-graph-store").then(({ useGraphStore }) => {
        useGraphStore.getState().setGraphInstance(null);
      });
    };
  }, [data]);

  return data;
};

export default useGraph;
