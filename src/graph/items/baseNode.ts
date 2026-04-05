import type {
  ComponentInfoRender,
  PropData,
  TypeData,
  TypeDataParam,
  VariableLoc,
  VariableName,
  VariableScope,
} from "@nexiq/shared";
import * as PIXI from "pixi.js";
import type { LabelData } from "../label";
import type { GraphCombo } from "./combo";
import type {
  BaseNodeData,
  GraphItemPosition,
  Renderable,
  RenderContext,
} from ".";
import type { AppearanceOverride } from "@nexiq/extension-sdk";

export abstract class BaseNode implements Renderable {
  id: string;
  x: number;
  y: number;
  radius: number;
  scale: number;
  parent?: GraphCombo;
  gitStatus?: "added" | "modified" | "deleted";
  visible: boolean = true;
  combo?: string;
  name: VariableName | string;
  projectPath?: string;
  fileName: string;
  pureFileName?: string;
  label?: LabelData;
  color: string;
  highlighted: boolean = false;
  isLayoutCalculated: boolean = false;
  displayName?: string;
  appearanceOverride?: AppearanceOverride;
  [key: string]: unknown;

  // From DetailItemData
  scope?: VariableScope;
  loc?: VariableLoc;
  props?: PropData[];
  propData?: PropData;
  propType?: TypeData;
  type?:
    | "component"
    | "hook"
    | "type"
    | "interface"
    | "state"
    | "render"
    | "effect"
    | "memo"
    | "callback"
    | "ref"
    | "prop"
    | "jsx"
    | "normal"
    | (string & {});
  typeParams?: TypeDataParam[];
  extends?: string[];
  children?: Record<string, ComponentInfoRender>;
  ui?: BaseNodeData["ui"];

  constructor(data: BaseNodeData) {
    this.id = data.id;
    this.x = data.x ?? 0;
    this.y = data.y ?? 0;
    this.radius = data.radius ?? 20;
    this.scale = data.scale ?? 1;
    this.parent = data.parent;
    this.gitStatus = data.gitStatus;
    this.visible = data.visible ?? true;
    this.combo = data.combo;
    this.name = data.name;
    this.projectPath = data.projectPath;
    this.fileName = data.fileName ?? "";
    this.pureFileName = data.pureFileName;
    this.label = data.label;
    this.color = data.color ?? "blue";
    this.highlighted = data.highlighted ?? false;
    this.isLayoutCalculated = data.isLayoutCalculated ?? false;
    this.displayName = data.displayName;

    this.scope = data.scope;
    this.loc = data.loc;
    this.props = data.props;
    this.propData = data.propData;
    this.propType = data.propType;
    this.type = data.type;
    this.typeParams = data.typeParams;
    this.extends = data.extends;
    this.children = data.children;
    this.ui = data.ui;
    this.appearanceOverride = data.appearanceOverride;
  }

  abstract render(
    context: RenderContext,
    parent: PIXI.Container,
  ): PIXI.Container | PIXI.Graphics;

  abstract getFillColor(context: RenderContext): string;

  protected renderLabel(
    container: PIXI.Container,
    offsetY: number,
    context: RenderContext,
  ) {
    if (!this.label) return;

    // TODO: optimiseation by prebuild the font
    const hiResFactor = 1; // Used 1 instead of 4 to save VRAM. `resolution: devicePixelRatio` is enough for retina handling.
    const text = new PIXI.BitmapText({
      text: this.label.text,
      style: {
        fill:
          this.label.fill ||
          context.customColors?.labelColor ||
          (context.theme === "dark" ? "white" : "black"),
        fontSize: 12 * this.scale * hiResFactor,
        align: "center",
      },
    });

    text.scale.set(1 / hiResFactor);
    text.anchor.set(0.5, 0);
    text.y = offsetY;
    text.label = `label-${this.id}`;
    container.addChild(text);
  }

  protected updateLabel(
    container: PIXI.Container,
    offsetY: number,
    context: RenderContext,
  ) {
    const existing = container.children.find(
      (child) => child.label === `label-${this.id}`,
    ) as PIXI.BitmapText | undefined;

    if (!this.label) {
      existing?.destroy();
      return;
    }

    const fill =
      this.label.fill ||
      context.customColors?.labelColor ||
      (context.theme === "dark" ? "white" : "black");

    if (!existing) {
      this.renderLabel(container, offsetY, context);
      return;
    }

    existing.text = this.label.text;
    existing.style.fill = fill;
    existing.style.fontSize = 12 * this.scale;
    existing.anchor.set(0.5, 0);
    existing.y = offsetY;
  }

  protected renderGitStatus(
    container: PIXI.Container,
    radius: number,
    indicatorSize: number = 4,
    context: RenderContext,
  ) {
    if (!this.gitStatus) return;

    const statusColor =
      this.gitStatus === "added"
        ? context.customColors?.gitAdded || "#22c55e"
        : this.gitStatus === "modified"
          ? context.customColors?.gitModified || "#f59e0b"
          : context.customColors?.gitDeleted || "#ef4444";

    const indicator = new PIXI.Graphics()
      .circle(radius * 0.7, -radius * 0.7, indicatorSize * this.scale)
      .fill(statusColor)
      .stroke({ color: 0xffffff, width: 1 * this.scale });

    indicator.label = `git-status-${this.id}`;
    container.addChild(indicator);
  }

  protected updateGitStatus(
    container: PIXI.Container,
    radius: number,
    indicatorSize: number = 4,
    context: RenderContext,
  ) {
    const existing = container.children.find(
      (child) => child.label === `git-status-${this.id}`,
    ) as PIXI.Graphics | undefined;

    if (!this.gitStatus) {
      existing?.destroy();
      return;
    }

    const statusColor =
      this.gitStatus === "added"
        ? context.customColors?.gitAdded || "#22c55e"
        : this.gitStatus === "modified"
          ? context.customColors?.gitModified || "#f59e0b"
          : context.customColors?.gitDeleted || "#ef4444";

    const indicator = existing ?? new PIXI.Graphics();
    indicator.label = `git-status-${this.id}`;
    indicator.clear();
    indicator
      .circle(radius * 0.7, -radius * 0.7, indicatorSize * this.scale)
      .fill(statusColor)
      .stroke({ color: 0xffffff, width: 1 * this.scale });

    if (!existing) {
      container.addChild(indicator);
    }
  }

  getAbsolutePosition(): GraphItemPosition {
    let ax = this.x;
    let ay = this.y;
    let p = this.parent;
    while (p) {
      ax += p.x;
      ay += p.y;
      p = p.parent;
    }
    return { x: ax, y: ay };
  }
}
