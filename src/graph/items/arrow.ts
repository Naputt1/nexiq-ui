import Konva from "konva";
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
    const angle = Math.atan2(-dy, dx);

    this.points = [
      fromPos.x + -from.radius * Math.cos(angle + Math.PI),
      fromPos.y + from.radius * Math.sin(angle + Math.PI),
      toPos.x + -to.radius * Math.cos(angle),
      toPos.y + to.radius * Math.sin(angle),
    ];
    this.scale = Math.min(from.scale, to.scale);
  }

  render(context: RenderContext, parent: Konva.Container): Konva.Arrow {
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

    const arrow = new Konva.Arrow({
      id: this.id,
      points: this.points,
      fill: strokeColor,
      stroke: strokeColor,
      strokeWidth: ((this.highlighted ? 2 : 0.5) + (this.flowRole ? 0.5 : 0)) * this.scale,
      pointerWidth: 6 * this.scale,
      pointerLength: 6 * this.scale,
      lineJoin: "round",
      perfectDrawEnabled: false,
      listening: false,
      visible: isVisible && this.points.length >= 4,
      opacity: this.dimmed ? 0.15 : context.hasGitChanges ? 0.1 : 1,
    });

    const hitAreaId = `${this.id}:hit`;
    const hitArea = new Konva.Line({
      id: hitAreaId,
      points: this.points,
      stroke: "#000000",
      strokeWidth: 14 * this.scale,
      opacity: 0,
      lineCap: "round",
      lineJoin: "round",
      listening: true,
      visible: isVisible && this.points.length >= 4,
    });

    const handleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      if (e.evt.ctrlKey || e.evt.metaKey) {
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

    hitArea.on("click", handleClick);
    hitArea.on("tap", handleClick);

    if (context.registerItem) {
      context.registerItem(this.id, arrow);
      context.registerItem(hitAreaId, hitArea);
    }

    parent.add(arrow);
    parent.add(hitArea);

    return arrow;
  }
}
