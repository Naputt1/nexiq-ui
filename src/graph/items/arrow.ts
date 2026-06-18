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
  name?: string;
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
  isBidirectional: boolean = false;
  labelIndex: number = 0;
  labelCount: number = 1;
  isDuplicateLabel: boolean = false;
  duplicateCount: number = 1;
  sourceScale: number = 1;
  targetScale: number = 1;

  constructor(data: GraphArrowData) {
    this.id = data.id;
    this.source = data.source;
    this.target = data.target;
    this.name = data.name;
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
    this.sourceScale = from.scale;
    this.targetScale = to.scale;
    this.scale = (from.scale + to.scale) / 2;
  }

  render(context: RenderContext, parent: PIXI.Container): PIXI.Container {
    const srcNode = context.graph.getPointByID(this.source);
    const targetNode = context.graph.getPointByID(this.target);

    // If either end is explicitly hidden or deleted, hide the edge
    const isVisible =
      this.visible !== false &&
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

    const container = new PIXI.Container();
    container.label = this.id;

    const graphics = new PIXI.Graphics();
    graphics.label = this.id;
    graphics.visible = isVisible && this.points.length >= 4;
    graphics.alpha = this.dimmed ? 0.15 : context.hasGitChanges ? 0.1 : 1;

    if (graphics.visible) {
      const targetTipOffset =
        ((targetNode?.highlighted ? 3 : 1) * 0.5 + 0.5) * this.targetScale;
      const sourceTipOffset =
        ((srcNode?.highlighted ? 3 : 1) * 0.5 + 0.5) * this.sourceScale;
      this.drawArrow(
        graphics,
        strokeColor,
        this.isBidirectional,
        targetTipOffset,
        sourceTipOffset,
      );
    }

    // Hit Area
    const hitArea = new PIXI.Graphics();
    hitArea.label = `hit-${this.id}`;
    hitArea.eventMode = "static";
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
      context.registerItem(this.id, container);
      context.registerItem(hitArea.label, hitArea);
    }

    container.addChild(graphics);
    container.addChild(hitArea);
    parent.addChild(container);
    this.renderLabel(parent, context);

    return container;
  }

  update(context: RenderContext, container: PIXI.Container) {
    container.visible = this.visible !== false;
    if (!container.visible) return;

    const graphics = container.children.find(
      (child) => child.label === this.id,
    ) as PIXI.Graphics | undefined;
    if (!graphics) return;

    graphics.alpha = this.dimmed ? 0.2 : 1;
    const color = this.getArrowColor(context);

    const srcNode = context.graph.getPointByID(this.source);
    const targetNode = context.graph.getPointByID(this.target);
    const targetTipOffset =
      ((targetNode?.highlighted ? 3 : 1) * 0.5 + 0.5) * this.targetScale;
    const sourceTipOffset =
      ((srcNode?.highlighted ? 3 : 1) * 0.5 + 0.5) * this.sourceScale;
    this.drawArrow(
      graphics,
      color,
      this.isBidirectional,
      targetTipOffset,
      sourceTipOffset,
    );

    const hitArea = container.children.find(
      (c) => c.label === `hit-${this.id}`,
    ) as PIXI.Graphics;
    if (hitArea) {
      hitArea.visible = container.visible;
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

    const labelParent = container.parent ?? container;
    this.renderLabel(labelParent, context);
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

  private renderLabel(parent: PIXI.Container, context: RenderContext) {
    const existing = parent.children.find(
      (child) => child.label === `label-${this.id}`,
    ) as PIXI.BitmapText | undefined;

    const isIncidentToFocused =
      !context.focusedId ||
      this.source === context.focusedId ||
      this.target === context.focusedId;

    if (!this.name || this.points.length < 4 || !isIncidentToFocused) {
      existing?.destroy();
      return;
    }

    if (this.isDuplicateLabel) {
      existing?.destroy();
      return;
    }

    const midX = (this.points[0] + this.points[2]) / 2;
    const midY = (this.points[1] + this.points[3]) / 2;

    const text =
      existing ??
      new PIXI.BitmapText({
        text: this.name,
        style: {
          fill: context.theme === "dark" ? "white" : "black",
          fontSize: 10 * this.scale,
          align: "center",
        },
      });

    text.text = this.duplicateCount > 1 ? `${this.name} (${this.duplicateCount})` : this.name;
    text.style.fontSize = 10 * this.scale;
    text.style.fill =
      context.customColors?.labelColor ||
      (context.theme === "dark" ? "white" : "black");

    text.anchor.set(0.5, 0.5);

    const centerY = midY - 6 * this.scale;
    const spacing = 14 * this.scale;
    const stackY =
      this.labelCount > 1
        ? centerY + (this.labelIndex - (this.labelCount - 1) / 2) * spacing
        : centerY;

    text.position.set(midX, stackY);
    text.label = `label-${this.id}`;

    if (!existing) {
      parent.addChild(text);
    }
  }

  private drawArrowHead(
    graphics: PIXI.Graphics,
    x: number,
    y: number,
    angle: number,
    headLength: number,
    color: string | number,
  ) {
    graphics.moveTo(x, y);
    graphics.lineTo(
      x - headLength * Math.cos(angle - Math.PI / 6),
      y - headLength * Math.sin(angle - Math.PI / 6),
    );
    graphics.lineTo(
      x - headLength * Math.cos(angle + Math.PI / 6),
      y - headLength * Math.sin(angle + Math.PI / 6),
    );
    graphics.closePath();
    graphics.fill(color);
  }

  private drawArrow(
    graphics: PIXI.Graphics,
    color: string | number,
    bidirectional?: boolean,
    targetTipOffset: number = 0,
    sourceTipOffset: number = 0,
  ) {
    const p = this.points;
    const baseWidth = (this.highlighted ? 2 : 0.5) + (this.flowRole ? 0.5 : 0);
    const angle = Math.atan2(p[3] - p[1], p[2] - p[0]);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);

    const hw0 = (baseWidth * this.sourceScale) / 2;
    const hw1 = (baseWidth * this.targetScale) / 2;

    graphics.clear();

    // Arrowhead dimensions
    const headLength = 6 * this.targetScale;
    const headDepth = headLength * Math.cos(Math.PI / 6);
    const startHeadLength = bidirectional ? 6 * this.sourceScale : 0;
    const startHeadDepth = startHeadLength * Math.cos(Math.PI / 6);

    const totalLen = Math.sqrt((p[2] - p[0]) ** 2 + (p[3] - p[1]) ** 2);

    // Target arrowhead tip (offset outward from node border past the stroke)
    const targetTipX = p[2] - targetTipOffset * Math.cos(angle);
    const targetTipY = p[3] - targetTipOffset * Math.sin(angle);

    // Shaft end at target arrowhead base
    const tx = targetTipX - headDepth * Math.cos(angle);
    const ty = targetTipY - headDepth * Math.sin(angle);
    const tFrac =
      totalLen > 0
        ? Math.max(0, Math.min(1, 1 - (headDepth + targetTipOffset) / totalLen))
        : 1;
    const thw = hw0 + tFrac * (hw1 - hw0);

    // Shaft start depends on whether there's a source arrowhead
    let sx = p[0],
      sy = p[1];
    let shw = hw0;
    let sourceTipX = p[0],
      sourceTipY = p[1];

    if (bidirectional) {
      sourceTipX = p[0] - sourceTipOffset * Math.cos(angle);
      sourceTipY = p[1] - sourceTipOffset * Math.sin(angle);
      sx = sourceTipX + startHeadDepth * Math.cos(angle);
      sy = sourceTipY + startHeadDepth * Math.sin(angle);
      const sFrac =
        totalLen > 0
          ? Math.max(
              0,
              Math.min(1, (startHeadDepth - sourceTipOffset) / totalLen),
            )
          : 0;
      shw = hw0 + sFrac * (hw1 - hw0);
    }

    // Tapered quadrilateral shaft
    graphics
      .moveTo(sx + shw * perpX, sy + shw * perpY)
      .lineTo(tx + thw * perpX, ty + thw * perpY)
      .lineTo(tx - thw * perpX, ty - thw * perpY)
      .lineTo(sx - shw * perpX, sy - shw * perpY)
      .closePath()
      .fill(color);

    // Rounded cap at target shaft end
    graphics.circle(tx, ty, thw).fill(color);

    // Rounded cap at source shaft end (only for bidirectional — otherwise the node fill covers it)
    if (bidirectional) {
      graphics.circle(sx, sy, shw).fill(color);
    }

    // Arrowhead at target
    this.drawArrowHead(
      graphics,
      targetTipX,
      targetTipY,
      angle,
      headLength,
      color,
    );

    // Arrowhead at source (bidirectional)
    if (bidirectional) {
      this.drawArrowHead(
        graphics,
        sourceTipX,
        sourceTipY,
        angle + Math.PI,
        startHeadLength,
        color,
      );
    }
  }
}
