import * as PIXI from "pixi.js";
import type { BaseNode } from "./baseNode";
import type {
  GraphArrowData,
  Renderable,
  RenderContext,
  UsageOccurrenceData,
} from ".";
import {
  getDefaultArrowColor,
  getDirectFlowColor,
  getSideEffectFlowColor,
} from "../appearance";

export class GraphArrow implements Renderable {
  id: string;
  source: string;
  target: string;
  label?: string;
  edgeKind?: string;
  category?: string;
  flowRole?: "direct" | "side-effect" | null;
  usageCount: number;
  usages: UsageOccurrenceData[];
  highlighted: boolean;
  dimmed: boolean;
  opensTo?: { fileName: string; line: number; column: number };
  points: number[] = [];
  scale: number = 1;
  combo?: string;
  visible: boolean = true;
  opacity: number = 1;

  constructor(data: GraphArrowData) {
    this.id = data.id;
    this.source = data.source;
    this.target = data.target;
    this.label = data.label;
    this.edgeKind = data.edgeKind;
    this.category = data.category;
    this.flowRole = data.flowRole ?? null;
    this.usageCount = data.usageCount ?? 0;
    this.usages = data.usages ?? [];
    this.highlighted = data.highlighted ?? false;
    this.dimmed = data.dimmed ?? false;
    this.opensTo = data.opensTo;
    this.combo = data.combo;
    this.scale = data.scale ?? 1;
    this.points = data.points ?? [];
    this.visible = data.visible ?? true;
    this.opacity = data.opacity ?? 1;
  }

  updatePoints(from: BaseNode, to: BaseNode, relativeTo?: BaseNode) {
    const fromAbs = from.getAbsolutePosition();
    const toAbs = to.getAbsolutePosition();

    let fromPos = fromAbs;
    let toPos = toAbs;

    if (relativeTo) {
      const relAbs = relativeTo.getAbsolutePosition();
      fromPos = { x: fromAbs.x - relAbs.x, y: fromAbs.y - relAbs.y };
      toPos = { x: toAbs.x - relAbs.x, y: toAbs.y - relAbs.y };
    }

    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const angle = Math.atan2(dy, dx); // Fixed angle calculation for PixiJS (Y down)

    this.points = [
      fromPos.x + from.radius * Math.cos(angle),
      fromPos.y + from.radius * Math.sin(angle),
      toPos.x - to.radius * Math.cos(angle),
      toPos.y - to.radius * Math.sin(angle),
    ];
    this.scale = Math.min(from.scale, to.scale);
  }

  render(context: RenderContext, parent: PIXI.Container): PIXI.Graphics {
    const srcNode = context.graph.getPointByID(this.source);
    const targetNode = context.graph.getPointByID(this.target);

    // If either end is explicitly hidden or deleted, hide the edge
    const isVisible =
      srcNode?.visible !== false &&
      targetNode?.visible !== false &&
      srcNode?.gitStatus !== "deleted" &&
      targetNode?.gitStatus !== "deleted";

    const strokeColor =
      this.flowRole === "direct"
        ? getDirectFlowColor(context.customColors, context.theme)
        : this.flowRole === "side-effect"
          ? getSideEffectFlowColor(context.customColors, context.theme)
          : this.highlighted
            ? context.customColors?.nodeHighlight || "#2563eb"
            : getDefaultArrowColor(context.customColors, context.theme);

    const graphics = new PIXI.Graphics();
    graphics.label = this.id;
    graphics.visible = isVisible && this.points.length >= 4;
    graphics.alpha = this.dimmed ? 0.15 : context.hasGitChanges ? 0.1 : 1;

    if (graphics.visible) {
      this.drawArrow(graphics, strokeColor);
    }

    // Hit Area
    const hitArea = new PIXI.Graphics();
    hitArea.label = `${this.id}:hit`;
    hitArea.interactive = true;
    hitArea.cursor = "pointer";
    hitArea.visible = graphics.visible;

    if (hitArea.visible) {
      const p = this.points;
      hitArea
        .moveTo(p[0], p[1])
        .lineTo(p[2], p[3])
        .stroke({
          color: 0x000000,
          width: 14 * this.scale,
          alpha: 0.01,
          cap: "round",
          join: "round",
        });
    }

    const handleClick = (e: PIXI.FederatedPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();

      const event = e.originalEvent as unknown as PointerEvent;
      if (event.ctrlKey || event.metaKey) {
        const target = this.opensTo || this.usages[0];
        if (!target) return;
        const fileName =
          "fileName" in target ? target.fileName : target.filePath;
        window.ipcRenderer.invoke(
          "open-vscode",
          fileName,
          context.graph.projectPath,
          target.line,
          target.column,
        );
        return;
      }

      context.onSelectEdge?.(this.id, false);
    };

    hitArea.on("pointertap", handleClick);

    if (context.registerItem) {
      context.registerItem(this.id, graphics);
      context.registerItem(hitArea.label, hitArea);
    }

    parent.addChild(graphics);
    parent.addChild(hitArea);

    return graphics;
  }

  update(context: RenderContext, graphics: PIXI.Graphics) {
    graphics.visible = this.visible !== false;
    if (!graphics.visible) return;

    graphics.alpha = this.dimmed ? 0.2 : 1;
    const color = this.getArrowColor(context);

    this.drawArrow(graphics, color);

    const hitArea = graphics.children.find(
      (c) => c.label === `hit-${this.id}`,
    ) as PIXI.Graphics;
    if (hitArea) {
      hitArea.visible = graphics.visible;
      if (hitArea.visible) {
        hitArea.clear();
        const p = this.points;
        hitArea
          .moveTo(p[0], p[1])
          .lineTo(p[2], p[3])
          .stroke({
            color: 0x000000,
            width: 14 * this.scale,
            alpha: 0.01,
            cap: "round",
            join: "round",
          });
      }
    }
  }

  getArrowColor(context: RenderContext): string | number {
    return this.flowRole === "direct"
      ? getDirectFlowColor(context.customColors, context.theme)
      : this.flowRole === "side-effect"
        ? getSideEffectFlowColor(context.customColors, context.theme)
        : this.highlighted
          ? context.customColors?.nodeHighlight || "#2563eb"
          : getDefaultArrowColor(context.customColors, context.theme);
  }

  private drawArrow(graphics: PIXI.Graphics, color: string | number) {
    const p = this.points;
    const strokeWidth =
      ((this.highlighted ? 2 : 0.5) + (this.flowRole ? 0.5 : 0)) * this.scale;

    graphics.clear();
    graphics.moveTo(p[0], p[1]);
    graphics.lineTo(p[2], p[3]);
    graphics.stroke({ color, width: strokeWidth, cap: "round", join: "round" });

    // Arrow head
    const headLength = 6 * this.scale;
    const angle = Math.atan2(p[3] - p[1], p[2] - p[0]);

    graphics.moveTo(p[2], p[3]);
    graphics.lineTo(
      p[2] - headLength * Math.cos(angle - Math.PI / 6),
      p[3] - headLength * Math.sin(angle - Math.PI / 6),
    );
    graphics.lineTo(
      p[2] - headLength * Math.cos(angle + Math.PI / 6),
      p[3] - headLength * Math.sin(angle + Math.PI / 6),
    );
    graphics.closePath();
    graphics.fill(color);
  }
}
