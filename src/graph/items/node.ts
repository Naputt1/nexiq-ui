import * as PIXI from "pixi.js";
import { BaseNode } from "./baseNode";
import type { GraphNodeData, RenderContext } from ".";
import { resolveNodeAppearance } from "../appearance";

export class GraphNode extends BaseNode {
  [key: string]: unknown;
  constructor(data: GraphNodeData) {
    super(data);
  }

  render(context: RenderContext, parent: PIXI.Container): PIXI.Container {
    const container = new PIXI.Container();
    container.label = this.id;
    container.x = this.x;
    container.y = this.y;
    container.interactive = true;
    container.cursor = "pointer";
    container.alpha = context.hasGitChanges && !this.gitStatus ? 0.2 : 1;

    let dragData: PIXI.FederatedPointerEvent | null = null;

    container.on("pointerdown", (e) => {
      if (e.button !== 0) {
        if (e.button === 1) {
          // Middle mouse button - pan handled by viewport usually, but we can trigger it here if needed
        }
        return;
      }
      e.stopPropagation();
      dragData = e;
      context.graph.setDraggingId(this.id);

      // Global move listener for dragging
      const onMove = (moveEvent: PIXI.FederatedPointerEvent) => {
        if (dragData) {
          if (this.parent) {
            context.graph.comboChildNodeMove(
              this.parent.id,
              this.id,
              moveEvent,
            );
          } else {
            context.graph.nodeDragMove(this.id, moveEvent);
          }
        }
      };

      const onUp = () => {
        dragData = null;
        context.graph.setDraggingId(null);
        if (this.parent) {
          context.graph.comboChildNodeEnd(this.parent.id, this.id);
        } else {
          context.graph.nodeDragEnd(this.id, e);
        }
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

    const highlightColor =
      context.customColors?.nodeHighlight ||
      (context.theme === "dark" ? "#3b82f6" : "#2563eb");

    const appearance = resolveNodeAppearance(
      context.customColors,
      this.type,
      this.id,
      this.appearanceOverride,
    );
    if (appearance.radius != null) {
      this.radius = appearance.radius * this.scale;
    }
    const fillColor = this.getFillColor(context);

    const graphics = new PIXI.Graphics();

    // Draw Node Circle
    graphics.circle(0, 0, this.radius);
    graphics.fill(fillColor);

    if (this.highlighted) {
      graphics.stroke({
        color: highlightColor,
        width: 2 * this.scale,
        alignment: 0, // Inside
      });
      // PixiJS v8 shadow/blur is more complex, skipping for now or using a simple filter if performance allows
    }

    container.addChild(graphics);

    if (this.label) {
      this.renderLabel(
        container,
        (this.radius || 0) + 10 * this.scale,
        context,
      );
    }

    this.renderGitStatus(container, this.radius, 4, context);

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

    const graphics = container.children.find(
      (c) => c.label === `bg-${this.id}`,
    ) as PIXI.Graphics;
    if (graphics) {
      graphics.clear();
      graphics.circle(0, 0, this.radius);
      graphics.fill(this.getFillColor(context));

      const highlightColor =
        context.customColors?.nodeHighlight ||
        (context.theme === "dark" ? "#3b82f6" : "#2563eb");
      graphics.stroke({
        color: this.highlighted
          ? highlightColor
          : context.theme === "dark"
            ? "#555"
            : "#ccc",
        width: (this.highlighted ? 3 : 1) * this.scale,
      });
    }
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
}
