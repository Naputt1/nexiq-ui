import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import { GraphData, type GraphDataCallbackParams } from "./hook";
import {
  type GraphNode,
  type GraphCombo,
  type GraphArrow,
  type RenderContext,
} from "./items/index";
import type { CustomColors } from "../../electron/types";

export class PixiRenderer {
  app: PIXI.Application;
  viewport!: Viewport;
  graph: GraphData;
  onSelect?: (id: string, center?: boolean, highlight?: boolean) => void;
  onSelectEdge?: (id: string, center?: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  onZoomRangeChange?: (range: { min: number; max: number }) => void;
  onViewportSettled?: (viewport: { x: number; y: number; zoom: number }) => void;
  onRenderComplete?: (durationMs: number) => void;
  theme: "dark" | "light" = "dark";
  customColors?: CustomColors;
  viewportChangeInProgress = false;
  isReady = false;
  readyPromise: Promise<void>;
  private renderQueued = false;

  private items = new Map<string, PIXI.Container>();
  private edges = new Map<string, PIXI.Container>();
  private combos = new Map<string, PIXI.Container>();
  private nodes = new Map<string, PIXI.Container>();

  private bindId: string | null = null;
  private minimapContainer!: PIXI.Container;
  private minimapGraphics!: PIXI.Graphics;
  private minimapViewportRect!: PIXI.Graphics;
  private resizeAnimationFrame: number | null = null;
  private minimapTimeout: ReturnType<typeof setTimeout> | null = null;
  private minimapAnimationFrame: number | null = null;
  private viewportSettledTimeout: ReturnType<typeof setTimeout> | null = null;
  private minimapLastRenderAt = 0;
  private viewportClampInProgress = false;
  private edgeLayer!: PIXI.Container;
  private comboLayer!: PIXI.Container;
  private nodeLayer!: PIXI.Container;

  private minimapSize = 150;
  private minimapPadding = 10;
  private viewportPadding = 240;
  private zoomRange = { min: 0.1, max: 5 };

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string, center?: boolean, highlight?: boolean) => void,
    onSelectEdge?: (id: string, center?: boolean) => void,
    onZoomChange?: (zoom: number) => void,
    onZoomRangeChange?: (range: { min: number; max: number }) => void,
    onViewportSettled?: (viewport: {
      x: number;
      y: number;
      zoom: number;
    }) => void,
    onRenderComplete?: (durationMs: number) => void,
    theme: "dark" | "light" = "dark",
    customColors?: CustomColors,
  ) {
    this.app = new PIXI.Application();

    // Initialize application asynchronously
    this.readyPromise = this.initApp(container, width, height);

    this.graph = graph;
    this.onSelect = onSelect;
    this.onSelectEdge = onSelectEdge;
    this.onZoomChange = onZoomChange;
    this.onZoomRangeChange = onZoomRangeChange;
    this.onViewportSettled = onViewportSettled;
    this.onRenderComplete = onRenderComplete;
    this.theme = theme;
    this.customColors = customColors;

    this.bindId = this.graph.bind(this.handleGraphEvent.bind(this));
  }

  private async initApp(
    container: HTMLDivElement,
    width: number,
    height: number,
  ) {
    await this.app.init({
      width,
      height,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      backgroundColor: this.theme === "dark" ? 0x1e1e1e : 0xffffff,
    });
    container.appendChild(this.app.canvas);

    this.viewport = new Viewport({
      screenWidth: width,
      screenHeight: height,
      worldWidth: 1000,
      worldHeight: 1000,
      events: this.app.renderer.events,
    });

    this.app.stage.addChild(this.viewport);
    this.viewport.drag().pinch().wheel().decelerate();

    this.edgeLayer = new PIXI.Container();
    this.comboLayer = new PIXI.Container();
    this.nodeLayer = new PIXI.Container();
    this.viewport.addChild(this.edgeLayer);
    this.viewport.addChild(this.comboLayer);
    this.viewport.addChild(this.nodeLayer);

    this.minimapContainer = new PIXI.Container();
    this.minimapGraphics = new PIXI.Graphics();
    this.minimapViewportRect = new PIXI.Graphics();
    this.minimapContainer.addChild(this.minimapGraphics);
    this.minimapContainer.addChild(this.minimapViewportRect);
    this.minimapContainer.visible = false;
    this.app.stage.addChild(this.minimapContainer);

    this.viewport.on("moved", () => {
      this.enforceViewportPolicy();
      this.publishZoomState();
      this.scheduleViewportSettled();
      this.requestMinimapRender();
    });

    this.isReady = true;
    this.render();
  }

  destroy() {
    if (this.bindId) {
      this.graph.unbind(this.bindId);
    }

    if (this.minimapTimeout) {
      clearTimeout(this.minimapTimeout);
      this.minimapTimeout = null;
    }
    if (this.minimapAnimationFrame != null) {
      cancelAnimationFrame(this.minimapAnimationFrame);
      this.minimapAnimationFrame = null;
    }
    if (this.viewportSettledTimeout) {
      clearTimeout(this.viewportSettledTimeout);
      this.viewportSettledTimeout = null;
    }
    if (this.resizeAnimationFrame != null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
      this.resizeAnimationFrame = null;
    }

    const doDestroy = () => {
      try {
        this.app.destroy(true, { children: true, texture: true });
      } catch (e) {
        console.warn("PixiJS destroy error:", e);
      }
    };

    if (this.isReady) {
      doDestroy();
    } else {
      this.readyPromise.then(doDestroy).catch(console.error);
    }
  }

  resize(width: number, height: number) {
    if (!this.isReady) {
      this.readyPromise.then(() => this.resize(width, height));
      return;
    }
    if (this.resizeAnimationFrame !== null) {
      cancelAnimationFrame(this.resizeAnimationFrame);
    }

    this.resizeAnimationFrame = requestAnimationFrame(() => {
      this.app.renderer.resize(width, height);
      this.viewport.resize(width, height);
      this.enforceViewportPolicy();
      this.publishZoomState();
      this.scheduleViewportSettled();
      this.requestMinimapRender();
      this.resizeAnimationFrame = null;
    });
  }

  focusItem(id: string, scale: number = 1.5) {
    if (!this.isReady) {
      this.readyPromise.then(() => this.focusItem(id, scale));
      return;
    }
    const pos = this.graph.getAbsolutePosition(id);
    if (pos) {
      const clampedScale = this.clampZoomValue(scale);
      this.viewportChangeInProgress = true;
      this.viewport.animate({
        position: pos,
        scale: clampedScale,
        time: 300,
        ease: "easeInOutQuad",
        callbackOnComplete: () => {
          this.enforceViewportPolicy();
          this.viewportChangeInProgress = false;
          this.publishZoomState();
          this.scheduleViewportSettled();
        },
      });
    }
  }

  setViewport(x: number, y: number, zoom: number) {
    if (!this.isReady) {
      this.readyPromise.then(() => this.setViewport(x, y, zoom));
      return;
    }
    this.viewport.position.set(x, y);
    this.viewport.scale.set(this.clampZoomValue(zoom));
    this.enforceViewportPolicy();
    this.publishZoomState();
    this.scheduleViewportSettled();
    this.requestMinimapRender();
  }

  setCustomColors(colors: CustomColors) {
    this.customColors = colors;
    if (!this.isReady) {
      this.readyPromise.then(() => this.setCustomColors(colors));
      return;
    }
    this.render();
  }

  setTheme(theme: "dark" | "light") {
    this.theme = theme;
    if (!this.isReady) {
      this.readyPromise.then(() => this.setTheme(theme));
      return;
    }
    this.app.renderer.background.color = theme === "dark" ? 0x1e1e1e : 0xffffff;
    this.render();
    this.requestMinimapRender();
  }

  setZoom(zoom: number) {
    if (!this.isReady) {
      this.readyPromise.then(() => this.setZoom(zoom));
      return;
    }
    this.viewport.setZoom(this.clampZoomValue(zoom), true);
    this.enforceViewportPolicy();
    this.publishZoomState();
    this.scheduleViewportSettled();
    this.requestMinimapRender();
  }

  getZoomRange() {
    return this.zoomRange;
  }

  private updateZoomRange() {
    const previousRange = this.zoomRange;
    const bounds = this.graph.getContentBounds();
    const totalWidth = Math.max(
      bounds.maxX - bounds.minX + this.viewportPadding * 2,
      1,
    );
    const totalHeight = Math.max(
      bounds.maxY - bounds.minY + this.viewportPadding * 2,
      1,
    );
    const fitZoom = Math.min(
      this.viewport.screenWidth / totalWidth,
      this.viewport.screenHeight / totalHeight,
    );
    const deepestScale = Math.max(this.graph.getMinItemScale(), 0.05);

    const min = Math.max(0.02, Math.min(fitZoom * 0.9, deepestScale));
    const max = Math.min(12, Math.max(2.5, 1 / deepestScale + fitZoom));

    this.zoomRange = {
      min,
      max: Math.max(max, min + 0.1),
    };

    if (
      previousRange.min !== this.zoomRange.min ||
      previousRange.max !== this.zoomRange.max
    ) {
      this.onZoomRangeChange?.(this.zoomRange);
    }
  }

  private requestMinimapRender() {
    if (!this.isReady || !this.minimapContainer || !this.minimapGraphics) {
      return;
    }
    this.minimapContainer.visible = true;
    if (this.minimapTimeout) {
      clearTimeout(this.minimapTimeout);
    }
    const now = performance.now();
    const shouldThrottle = now - this.minimapLastRenderAt < 90;
    if (shouldThrottle) {
      if (this.minimapAnimationFrame == null) {
        this.minimapAnimationFrame = requestAnimationFrame(() => {
          this.minimapAnimationFrame = null;
          this.minimapLastRenderAt = performance.now();
          this.renderMinimap();
        });
      }
    } else {
      this.minimapLastRenderAt = now;
      this.renderMinimap();
    }
    this.minimapTimeout = setTimeout(() => {
      this.minimapContainer.visible = false;
      this.minimapTimeout = null;
    }, 2000);
  }

  private publishZoomState() {
    if (!this.isReady || !this.viewport || !this.viewport.scale) {
      return;
    }
    this.onZoomChange?.(this.viewport.scale.x);
  }

  private scheduleViewportSettled() {
    if (!this.onViewportSettled) return;
    if (this.viewportSettledTimeout) {
      clearTimeout(this.viewportSettledTimeout);
    }
    this.viewportSettledTimeout = setTimeout(() => {
      this.viewportSettledTimeout = null;
      if (!this.isReady || !this.viewport || !this.viewport.scale) {
        return;
      }
      this.onViewportSettled?.({
        x: this.viewport.x,
        y: this.viewport.y,
        zoom: this.viewport.scale.x,
      });
    }, 120);
  }

  private renderMinimap() {
    if (
      !this.isReady ||
      !this.minimapContainer ||
      !this.minimapGraphics ||
      !this.minimapViewportRect
    ) {
      return;
    }
    if (!this.minimapContainer.visible) return;

    const { nodes, combos, bounds } = this.getVisibleMinimapState();
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;

    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 20;
    const totalWidth = contentWidth + padding * 2;
    const totalHeight = contentHeight + padding * 2;

    const scale = Math.min(
      this.minimapSize / totalWidth,
      this.minimapSize / totalHeight,
    );

    const mmWidth = totalWidth * scale;
    const mmHeight = totalHeight * scale;

    const xOffset =
      (this.app?.screen?.width ?? 0) - mmWidth - this.minimapPadding;
    const yOffset = this.minimapPadding;

    this.minimapContainer.position.set(xOffset, yOffset);

    this.minimapGraphics.clear();
    // Background
    this.minimapGraphics
      .rect(0, 0, mmWidth, mmHeight)
      .fill(this.theme === "dark" ? 0x1e1e1e : 0xf5f5f5)
      .stroke({ color: this.theme === "dark" ? 0x333333 : 0xdddddd, width: 1 });

    const getMMX = (x: number) => (x - (bounds.minX - padding)) * scale;
    const getMMY = (y: number) => (y - (bounds.minY - padding)) * scale;

    combos.forEach((c) => {
      const pos = this.graph.getAbsolutePosition(c.id);
      if (pos) {
        this.minimapGraphics
          .circle(getMMX(pos.x), getMMY(pos.y), 2)
          .fill(this.theme === "dark" ? 0x444444 : 0xcccccc);
      }
    });

    nodes.forEach((n) => {
      const pos = this.graph.getAbsolutePosition(n.id);
      if (pos) {
        this.minimapGraphics
          .circle(getMMX(pos.x), getMMY(pos.y), 1)
          .fill(this.theme === "dark" ? 0x666666 : 0xaaaaaa);
      }
    });

    // Viewport rect
    this.minimapViewportRect.clear();
    const vpX = getMMX(this.viewport.left);
    const vpY = getMMY(this.viewport.top);
    const vpW = this.viewport.screenWidthInWorldPixels * scale;
    const vpH = this.viewport.screenHeightInWorldPixels * scale;

    this.minimapViewportRect
      .rect(vpX, vpY, vpW, vpH)
      .stroke({ color: 0x3b82f6, width: 1 })
      .fill({ color: 0x3b82f6, alpha: 0.1 });
  }

  private clampZoomValue(zoom: number) {
    return Math.min(this.zoomRange.max, Math.max(this.zoomRange.min, zoom));
  }

  private isItemVisibleInViewport(id: string) {
    const point = this.graph.getPointByID(id);
    if (!point || point.visible === false) return false;

    let parent = point.parent;
    while (parent) {
      if (parent.visible === false || parent.collapsed) {
        return false;
      }
      parent = parent.parent;
    }

    return true;
  }

  private getVisibleMinimapState() {
    const nodes = this.graph
      .getAllNodes()
      .filter((node) => this.isItemVisibleInViewport(node.id));
    const combos = this.graph
      .getAllCombos()
      .filter((combo) => this.isItemVisibleInViewport(combo.id));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const node of nodes) {
      const pos = this.graph.getAbsolutePosition(node.id);
      if (!pos) continue;
      minX = Math.min(minX, pos.x - node.radius);
      minY = Math.min(minY, pos.y - node.radius);
      maxX = Math.max(maxX, pos.x + node.radius);
      maxY = Math.max(maxY, pos.y + node.radius);
    }

    for (const combo of combos) {
      const pos = this.graph.getAbsolutePosition(combo.id);
      if (!pos) continue;
      const radius = combo.collapsed ? combo.collapsedRadius : combo.expandedRadius;
      minX = Math.min(minX, pos.x - radius);
      minY = Math.min(minY, pos.y - radius);
      maxX = Math.max(maxX, pos.x + radius);
      maxY = Math.max(maxY, pos.y + radius);
    }

    if (minX === Infinity) {
      return {
        nodes,
        combos,
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      };
    }

    return {
      nodes,
      combos,
      bounds: { minX, minY, maxX, maxY },
    };
  }

  private getPaddedBounds() {
    const bounds = this.graph.getContentBounds();
    return {
      minX: bounds.minX - this.viewportPadding,
      minY: bounds.minY - this.viewportPadding,
      maxX: bounds.maxX + this.viewportPadding,
      maxY: bounds.maxY + this.viewportPadding,
    };
  }

  private enforceViewportPolicy() {
    if (!this.isReady || this.viewportClampInProgress) return;
    this.viewportClampInProgress = true;
    this.updateZoomRange();

    const zoom = this.clampZoomValue(this.viewport.scale.x);
    if (zoom !== this.viewport.scale.x || zoom !== this.viewport.scale.y) {
      this.viewport.scale.set(zoom);
    }

    const bounds = this.getPaddedBounds();
    const worldWidth = bounds.maxX - bounds.minX;
    const worldHeight = bounds.maxY - bounds.minY;

    const minX = this.viewport.screenWidth - bounds.maxX * zoom;
    const maxX = -bounds.minX * zoom;
    const minY = this.viewport.screenHeight - bounds.maxY * zoom;
    const maxY = -bounds.minY * zoom;

    let nextX = this.viewport.x;
    let nextY = this.viewport.y;

    if (worldWidth * zoom <= this.viewport.screenWidth) {
      nextX =
        this.viewport.screenWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * zoom;
    } else {
      nextX = Math.min(maxX, Math.max(minX, nextX));
    }

    if (worldHeight * zoom <= this.viewport.screenHeight) {
      nextY =
        this.viewport.screenHeight / 2 -
        ((bounds.minY + bounds.maxY) / 2) * zoom;
    } else {
      nextY = Math.min(maxY, Math.max(minY, nextY));
    }

    if (nextX !== this.viewport.x || nextY !== this.viewport.y) {
      this.viewport.position.set(nextX, nextY);
    }

    this.viewportClampInProgress = false;
  }

  private handleGraphEvent(params: GraphDataCallbackParams) {
    switch (params.type) {
      case "new-nodes":
        if (this.nodes.size !== this.graph.getAllNodes().length) {
          this.requestRender();
        } else {
          this.updateNodes();
        }
        break;
      case "new-combos":
        if (this.combos.size !== this.graph.getAllCombos().length) {
          this.requestRender();
        } else {
          this.updateCombos();
        }
        break;
      case "new-edges":
        if (this.edges.size !== this.graph.getAllEdges().length) {
          this.requestRender();
        } else {
          this.updateEdges(this.graph.getAllEdges().map((edge) => edge.id));
          this.requestMinimapRender();
        }
        break;
      case "combo-collapsed":
        this.handleComboCollapsed(
          params.id,
          params.previousRadius,
          params.targetRadius,
        );
        break;
      case "combo-drag-move":
        this.handleComboDragMove(params.id, params.edgeIds);
        this.requestMinimapRender();
        break;
      case "node-drag-move":
        this.updateEdges(params.edgeIds);
        this.requestMinimapRender();
        break;
      case "combo-radius-change":
        this.handleComboRadiusChange(params.id, params.edgeIds);
        break;
      case "combo-drag-end":
      case "node-drag-end":
        this.updateAllItems();
        break;
      case "layout-change":
      case "child-moved":
        this.updateAllItems();
        break;
    }
  }

  public requestRender() {
    if (this.renderQueued || !this.isReady) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  public render() {
    if (!this.isReady) return;
    const renderStartedAt = performance.now();

    for (const child of this.edgeLayer.removeChildren()) {
      child.destroy({ children: true, texture: true, textureSource: true });
    }
    for (const child of this.comboLayer.removeChildren()) {
      child.destroy({ children: true, texture: true, textureSource: true });
    }
    for (const child of this.nodeLayer.removeChildren()) {
      child.destroy({ children: true, texture: true, textureSource: true });
    }

    this.items.clear();
    this.edges.clear();
    this.combos.clear();
    this.nodes.clear();

    const cur = this.graph.getCurRender();
    const context = this.getRenderContext();

    for (const edge of Object.values(cur.edges) as GraphArrow[]) {
      edge.render(context, this.edgeLayer);
    }
    for (const combo of Object.values(cur.combos) as GraphCombo[]) {
      combo.render(context, this.comboLayer);
    }
    for (const node of Object.values(cur.nodes) as GraphNode[]) {
      node.render(context, this.nodeLayer);
    }
    this.updateZoomRange();
    this.enforceViewportPolicy();
    this.publishZoomState();
    this.scheduleViewportSettled();
    this.requestMinimapRender();
    this.onRenderComplete?.(performance.now() - renderStartedAt);
  }

  private getRenderContext(): RenderContext {
    return {
      graph: this.graph,
      app: this.app,
      viewport: this.viewport,
      onSelect: this.onSelect,
      onSelectEdge: this.onSelectEdge,
      registerItem: (id, item) => {
        this.items.set(id, item as PIXI.Container);
        if (item instanceof PIXI.Container) {
          if (this.graph.getCombo(id)) {
            this.combos.set(id, item);
          } else if (this.graph.getNode(id)) {
            this.nodes.set(id, item);
          }
        }
        if (this.graph.getEdge(id)) {
          this.edges.set(id, item);
        }
      },
      hasGitChanges: Object.values(this.graph.getCurNodes()).some(
        (n) => !!n.gitStatus,
      ),
      theme: this.theme,
      customColors: this.customColors,
    };
  }

  private handleComboCollapsed(
    id: string,
    previousRadius?: number,
    targetRadius?: number,
  ) {
    this.requestRender();

    requestAnimationFrame(() => {
      const combo = this.graph.getCombo(id);
      const container = this.combos.get(id);
      if (!combo || !container) return;
      const context = this.getRenderContext();
      combo.radius = previousRadius ?? combo.radius;
      combo.animateRadius(context, container, targetRadius ?? combo.radius);
      this.updateEdges(this.graph.getAllEdges().map((edge) => edge.id));
    });
  }

  private handleComboDragMove(id: string, edgeIds: string[]) {
    const item = this.combos.get(id);
    const combo = this.graph.getCombo(id);
    if (item && combo) {
      item.position.set(combo.x, combo.y);
      this.updateEdges(edgeIds);
    }
  }

  private handleComboRadiusChange(_id: string, _edgeIds: string[]) {
    this.updateAllItems();
  }

  private updateEdges(edgeIds: string[]) {
    for (const eid of edgeIds) {
      const edge = this.graph.getEdge(eid);
      const item = this.edges.get(eid);
      if (edge && item) {
        const context = this.getRenderContext();
        edge.update(context, item);
      }
    }
  }

  private updateAllItems() {
    if (!this.isReady) return;
    const context = this.getRenderContext();

    for (const node of this.graph.getAllNodes()) {
      const container = this.nodes.get(node.id);
      if (container && node) node.update(context, container);
    }
    for (const combo of this.graph.getAllCombos()) {
      const container = this.combos.get(combo.id);
      if (container && combo) combo.update(context, container);
    }
    for (const edge of this.graph.getAllEdges()) {
      const container = this.edges.get(edge.id);
      if (container && edge) edge.update(context, container);
    }
    this.enforceViewportPolicy();
    this.requestMinimapRender();
  }

  private updateNodes() {
    if (!this.isReady) return;
    const context = this.getRenderContext();
    for (const node of this.graph.getAllNodes()) {
      const container = this.nodes.get(node.id);
      if (container) {
        node.update(context, container);
      }
    }
  }

  private updateCombos() {
    if (!this.isReady) return;
    const context = this.getRenderContext();
    for (const combo of this.graph.getAllCombos()) {
      const container = this.combos.get(combo.id);
      if (!container) continue;
      const targetRadius = combo.collapsed
        ? combo.collapsedRadius
        : combo.expandedRadius;
      combo.animateRadius(context, container, targetRadius);
    }
    this.updateEdges(this.graph.getAllEdges().map((edge) => edge.id));
  }
}
