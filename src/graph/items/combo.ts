import * as PIXI from "pixi.js";
import type {
  CurRender,
  RenderContext,
  GraphNode,
  GraphArrow,
  GraphComboData,
} from ".";
import { BaseNode } from "./baseNode";
import { resolveNodeAppearance } from "../appearance";

export class GraphCombo extends BaseNode {
  [key: string]: unknown;
  collapsed: boolean;
  collapsedRadius: number;
  expandedRadius: number;
  padding: number;
  child?: CurRender;
  private lastClickTime: number = 0;
  private animationFrame: number | null = null;

  constructor(data: GraphComboData) {
    super(data);
    this.collapsed = data.collapsed ?? true;
    this.collapsedRadius = data.collapsedRadius ?? 20;
    this.expandedRadius = data.expandedRadius ?? 40;
    this.padding = data.padding ?? 10;
    this.appearanceOverride = data.appearanceOverride;
    this.radius =
      data.radius ??
      (this.collapsed ? this.collapsedRadius : this.expandedRadius);
    this.child = data.child;
  }

  render(context: RenderContext, parent: PIXI.Container): PIXI.Container {
    if (this.visible === false) return new PIXI.Container();

    const container = new PIXI.Container();
    container.label = this.id;
    container.x = this.x;
    container.y = this.y;
    container.interactive = true;
    container.cursor = "pointer";
    container.alpha = context.hasGitChanges && !this.gitStatus ? 0.2 : 1;

    let dragData: PIXI.FederatedPointerEvent | null = null;

    container.on("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      dragData = e;
      context.graph.setDraggingId(this.id);

      const onMove = (moveEvent: PIXI.FederatedPointerEvent) => {
        if (dragData) {
          context.graph.comboDragMove(this.id, moveEvent);
        }
      };

      const onUp = () => {
        dragData = null;
        context.graph.setDraggingId(null);
        context.graph.comboDragEnd(this.id, e);
        context.app.stage.off("pointermove", onMove);
        context.app.stage.off("pointerup", onUp);
        context.app.stage.off("pointerupoutside", onUp);
      };

      context.app.stage.on("pointermove", onMove);
      context.app.stage.on("pointerup", onUp);
      context.app.stage.on("pointerupoutside", onUp);
    });

    container.on("pointertap", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();

      const now = Date.now();
      const isDoubleClick = now - this.lastClickTime < 300;
      this.lastClickTime = now;

      if (isDoubleClick) {
        e.stopPropagation();
        context.graph.comboCollapsed(this.id);
        return;
      }

      const event = e.originalEvent as unknown as PointerEvent;
      if (event.ctrlKey || event.metaKey) {
        e.stopPropagation();
        window.ipcRenderer.invoke(
          "open-vscode",
          this.fileName,
          this.projectPath || context.graph.projectPath,
          this.loc?.line,
          this.loc?.column,
        );
      } else {
        context.onSelect?.(this.id, false);
      }
    });

    // Background Circle
    const appearance = resolveNodeAppearance(
      context.customColors,
      this.type,
      this.id,
      this.appearanceOverride,
    );
    const baseRadius =
      (this.appearanceOverride?.collapsedRadius ??
        appearance.radius ??
        this.collapsedRadius / this.scale) * this.scale;
    this.collapsedRadius = baseRadius;
    if (this.appearanceOverride?.expandedRadius != null) {
      this.expandedRadius = this.appearanceOverride.expandedRadius * this.scale;
    } else if (this.expandedRadius < baseRadius) {
      this.expandedRadius = baseRadius;
    }
    const radius = this.collapsed ? this.collapsedRadius : this.expandedRadius;
    this.radius = radius;
    const highlightColor =
      context.customColors?.comboHighlight ||
      (context.theme === "dark" ? "#3b82f6" : "#2563eb");

    const fillColor = this.getFillColor(context);

    const graphics = new PIXI.Graphics();
    graphics.label = `bg-${this.id}`;

    graphics.circle(0, 0, radius);
    if (this.collapsed) {
      graphics.fill(fillColor);
    } else {
      // Expanded: transparent fill but maybe a subtle border or background
      graphics.fill({ color: 0x000000, alpha: 0.01 }); // Almost transparent but clickable
    }

    const strokeColor = this.highlighted
      ? highlightColor
      : context.theme === "dark"
        ? "#555"
        : fillColor;

    graphics.stroke({
      color: strokeColor,
      width: this.highlighted ? 4 * this.scale : 2 * this.scale,
      alignment: 0,
    });

    container.addChild(graphics);

    // Content Container
    const contentContainer = new PIXI.Container();
    contentContainer.label = `content-${this.id}`;
    container.addChild(contentContainer);

    // If not collapsed, render children
    if (!this.collapsed && this.child) {
      for (const edge of Object.values(this.child.edges) as GraphArrow[]) {
        edge.render(context, contentContainer);
      }
      for (const sub of Object.values(this.child.combos) as GraphCombo[]) {
        sub.render(context, contentContainer);
      }
      for (const node of Object.values(this.child.nodes) as GraphNode[]) {
        node.render(context, contentContainer);
      }
    }

    // Label
    this.renderLabel(container, radius + 10 * this.scale, context);

    // Git Status
    this.renderGitStatus(container, radius, 6, context);

    if (context.registerItem) {
      context.registerItem(this.id, container);
    }

    parent.addChild(container);
    return container;
  }

  update(context: RenderContext, container: PIXI.Container) {
    container.x = this.x;
    container.y = this.y;
    container.alpha = context.hasGitChanges && !this.gitStatus ? 0.2 : 1;
    container.visible = this.visible !== false;

    if (!container.visible) return;

    const rootBg = container.children.find(
      (c) => c.label === `bg-${this.id}`,
    ) as PIXI.Graphics;
    if (rootBg) {
      rootBg.clear();
      const radius = this.radius;
      rootBg.circle(0, 0, radius);
      const fillColor = this.getFillColor(context);

      if (this.collapsed) {
        rootBg.fill(fillColor);
      } else {
        rootBg.fill({ color: 0x000000, alpha: 0.01 });
      }

      const highlightColor =
        context.customColors?.comboHighlight ||
        (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      const strokeColor = this.highlighted
        ? highlightColor
        : context.theme === "dark"
          ? "#555"
          : fillColor;

      rootBg.stroke({
        color: strokeColor,
        width: this.highlighted ? 4 * this.scale : 2 * this.scale,
        alignment: 0,
      });

      // Update hitArea
      rootBg.hitArea = new PIXI.Circle(0, 0, radius);
    }

    const contentContainer = container.children.find(
      (c) => c.label === `content-${this.id}`,
    ) as PIXI.Container | undefined;
    if (contentContainer) {
      contentContainer.visible = !this.collapsed;
    }

    this.updateLabel(container, this.radius + 10 * this.scale, context);
    this.updateGitStatus(container, this.radius, 6, context);
  }

  animateRadius(
    context: RenderContext,
    container: PIXI.Container,
    targetRadius: number,
  ) {
    const rootBg = container.children.find(
      (c) => c.label === `bg-${this.id}`,
    ) as PIXI.Graphics | undefined;
    if (!rootBg) return;

    if (this.animationFrame != null) {
      cancelAnimationFrame(this.animationFrame);
    }

    const startRadius = this.radius;
    const diff = targetRadius - startRadius;
    const startedAt = performance.now();
    const duration = 180;

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.radius = startRadius + diff * eased;
      this.update(context, container);

      if (progress < 1) {
        this.animationFrame = requestAnimationFrame(tick);
      } else {
        this.radius = targetRadius;
        this.update(context, container);
        this.animationFrame = null;
      }
    };

    this.animationFrame = requestAnimationFrame(tick);
  }

  getFillColor(context: RenderContext): string {
    if (this.type === "jsx") return "#f97316";
    return (
      resolveNodeAppearance(
        context.customColors,
        this.type,
        this.id,
        this.appearanceOverride,
      ).color || this.color
    );
  }

  calculateRadius(configMaxRadius: number): number {
    let maxR = 0;

    if (this.child) {
      for (const node of Object.values(this.child.nodes)) {
        const dist = Math.sqrt(node.x * node.x + node.y * node.y) + node.radius;
        if (dist > maxR) maxR = dist;
      }

      for (const childCombo of Object.values(this.child.combos)) {
        const dist =
          Math.sqrt(childCombo.x * childCombo.x + childCombo.y * childCombo.y) +
          childCombo.expandedRadius;
        if (dist > maxR) maxR = dist;
      }
    }

    return Math.max(
      maxR + this.padding * this.scale,
      this.collapsedRadius,
      configMaxRadius * this.scale,
    );
  }

  updateRadius(configMaxRadius: number) {
    const radius = this.calculateRadius(configMaxRadius);
    this.expandedRadius = radius;
    if (!this.collapsed) {
      this.radius = radius;
    }
  }
}
