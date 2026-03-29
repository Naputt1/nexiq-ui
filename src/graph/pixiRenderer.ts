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
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void;
  theme: "dark" | "light" = "dark";
  customColors?: CustomColors;
  viewportChangeInProgress = false;
  isReady = false;
  readyPromise: Promise<void>;
  private renderQueued = false;

  private items = new Map<string, PIXI.Container>();
  private edges = new Map<string, PIXI.Graphics>();
  private combos = new Map<string, PIXI.Container>();
  private nodes = new Map<string, PIXI.Container>();

  private bindId: string | null = null;
  private minimapContainer!: PIXI.Container;
  private minimapGraphics!: PIXI.Graphics;
  private minimapViewportRect!: PIXI.Graphics;
  private resizeAnimationFrame: number | null = null;
  private minimapTimeout: ReturnType<typeof setTimeout> | null = null;

  private minimapSize = 150;
  private minimapPadding = 10;

  constructor(
    container: HTMLDivElement,
    graph: GraphData,
    width: number,
    height: number,
    onSelect?: (id: string, center?: boolean, highlight?: boolean) => void,
    onSelectEdge?: (id: string, center?: boolean) => void,
    onViewportChange?: (viewport: {
      x: number;
      y: number;
      zoom: number;
    }) => void,
    theme: "dark" | "light" = "dark",
    customColors?: CustomColors,
  ) {
    this.app = new PIXI.Application();

    // Initialize application asynchronously
    this.readyPromise = this.initApp(container, width, height);

    this.graph = graph;
    this.onSelect = onSelect;
    this.onSelectEdge = onSelectEdge;
    this.onViewportChange = onViewportChange;
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

    this.minimapContainer = new PIXI.Container();
    this.minimapGraphics = new PIXI.Graphics();
    this.minimapViewportRect = new PIXI.Graphics();
    this.minimapContainer.addChild(this.minimapGraphics);
    this.minimapContainer.addChild(this.minimapViewportRect);
    this.minimapContainer.visible = false;
    this.app.stage.addChild(this.minimapContainer);

    this.viewport.on("moved", () => {
      this.triggerViewportChange();
      this.requestMinimapRender();
    });

    this.isReady = true;
    this.render();
  }

  destroy() {
    if (this.bindId) {
      this.graph.unbind(this.bindId);
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
      this.viewportChangeInProgress = true;
      this.viewport.animate({
        position: pos,
        scale: scale,
        time: 300,
        ease: "easeInOutQuad",
        callbackOnComplete: () => {
          this.viewportChangeInProgress = false;
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
    this.viewport.scale.set(zoom);
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
    this.viewport.setZoom(zoom, true);
    this.requestMinimapRender();
    this.triggerViewportChange();
  }

  getZoomRange() {
    return { min: 0.1, max: 5 };
  }

  private requestMinimapRender() {
    this.minimapContainer.visible = true;
    if (this.minimapTimeout) {
      clearTimeout(this.minimapTimeout);
    }
    this.renderMinimap();
    this.minimapTimeout = setTimeout(() => {
      this.minimapContainer.visible = false;
      this.minimapTimeout = null;
    }, 2000);
  }

  private triggerViewportChange() {
    if (this.onViewportChange) {
      this.onViewportChange({
        x: this.viewport.x,
        y: this.viewport.y,
        zoom: this.viewport.scale.x,
      });
    }
  }

  private renderMinimap() {
    if (!this.minimapContainer.visible) return;

    const bounds = this.graph.getContentBounds();
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

    const xOffset = this.app.screen.width - mmWidth - this.minimapPadding;
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

    // Draw Combos and Nodes as dots
    const combos = this.graph.getAllCombos();
    const nodes = this.graph.getAllNodes();

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

  private handleGraphEvent(params: GraphDataCallbackParams) {
    switch (params.type) {
      case "new-nodes":
      case "new-combos":
      case "new-edges":
        this.requestRender();
        break;
      case "combo-collapsed":
        this.handleComboCollapsed(params.id);
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

    // Properly clean up all previous WebGL resources to prevent GPU memory leaks
    for (let i = this.viewport.children.length - 1; i >= 0; i--) {
      const child = this.viewport.children[i];
      child.destroy({ children: true, texture: true, textureSource: true });
    }

    this.items.clear();
    this.edges.clear();
    this.combos.clear();
    this.nodes.clear();

    const cur = this.graph.getCurRender();
    const context = this.getRenderContext();

    for (const edge of Object.values(cur.edges) as GraphArrow[]) {
      edge.render(context, this.viewport);
    }
    for (const combo of Object.values(cur.combos) as GraphCombo[]) {
      combo.render(context, this.viewport);
    }
    for (const node of Object.values(cur.nodes) as GraphNode[]) {
      node.render(context, this.viewport);
    }
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
        if (item instanceof PIXI.Graphics && this.graph.getEdge(id)) {
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

  private handleComboCollapsed(_id: string) {
    // For now, just re-render. In a real app we'd animate radius and alpha.
    this.requestRender();
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
      if (edge && item && edge) {
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
      const graphics = this.edges.get(edge.id);
      if (graphics && edge) edge.update(context, graphics);
    }
  }
}
