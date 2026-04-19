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
    container.visible = this.visible !== false;

    if (this.visible === false) {
      if (context.registerItem) {
        context.registerItem(this.id, container);
      }
      parent.addChild(container);
      return container;
    }

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
        // fileName and loc live in the details map (from the FlatBuffer), not on the node
        import("../../hooks/use-graph-store").then(({ useGraphStore }) => {
          const detail = useGraphStore.getState().details[this.id];
          const fileName = detail?.fileName || this.fileName;
          const projectPath =
            detail?.projectPath ||
            this.projectPath ||
            context.graph.projectPath;
          const loc = detail?.loc || this.loc;
          if (fileName) {
            window.ipcRenderer.invoke(
              "open-vscode",
              fileName,
              projectPath,
              loc?.line,
              loc?.column,
            );
          }
        });
      } else {
        context.onSelect?.(this.id, false);
      }
    });

    container.on("rightclick", (e) => {
      e.stopPropagation();
      context.onRightClick?.(this.id, e.client.x, e.client.y);
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
    graphics.label = `bg-${this.id}`;

    // Draw Node Circle
    graphics.circle(0, 0, this.radius);
    graphics.fill(fillColor);
    graphics.stroke({
      color: this.highlighted ? highlightColor : fillColor,
      width: (this.highlighted ? 2 : 1) * this.scale,
      alignment: 0,
    });

    if (this.highlighted) {
      // PixiJS v8 shadow/blur is more complex, skipping for now
    }

    container.addChild(graphics);

    this.renderLabel(container, (this.radius || 0) + 10 * this.scale, context);

    this.renderGitStatus(container, this.radius, 4, context);

    if (context.registerItem) {
      context.registerItem(this.id, container);
    }

    parent.addChild(container);
    return container;
  }

  update(context: RenderContext, container: PIXI.Container) {
    if (!container) return;
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

      const fillColor = this.getFillColor(context);
      const highlightColor =
        context.customColors?.nodeHighlight ||
        (context.theme === "dark" ? "#3b82f6" : "#2563eb");

      graphics.stroke({
        color: this.highlighted ? highlightColor : fillColor,
        width: (this.highlighted ? 3 : 1) * this.scale,
      });
    }

    this.updateLabel(container, (this.radius || 0) + 10 * this.scale, context);
    this.updateGitStatus(container, this.radius, 4, context);
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
