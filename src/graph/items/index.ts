import type * as PIXI from "pixi.js";
import type { Viewport } from "pixi-viewport";
import type {
  ComponentInfoRender,
  PropData,
  TypeData,
  TypeDataParam,
  VariableLoc,
  VariableName,
  VariableScope,
  UIItemState,
} from "@nexiq/shared";
import type { GraphData } from "../hook";
import type { GraphArrow } from "./arrow";
import type { GraphCombo } from "./combo";
import type { GraphNode } from "./node";
import type { CustomColors } from "../../../electron/types";
import type { AppearanceOverride } from "@nexiq/extension-sdk";

export * from "./arrow";
export * from "./combo";
export * from "./node";

export interface GraphItemPosition {
  x: number;
  y: number;
}

export interface CurRender {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphArrow>;
  combos: Record<string, GraphCombo>;
}

export interface UsageOccurrenceData {
  usageId: string;
  filePath: string;
  line: number;
  column: number;
  ownerId: string;
  ownerKind: string;
  accessPath?: string[] | undefined;
  isOptional?: boolean | undefined;
  isComputed?: boolean | undefined;
  hiddenIntermediate?: string | undefined;
  displayLabel?: string | undefined;
}

export type ComboChild = CurRender;

export interface RenderContext {
  graph: GraphData;
  onSelect?: (id: string, center?: boolean, highlight?: boolean) => void;
  onSelectEdge?: (id: string, center?: boolean) => void;
  registerItem?: (
    id: string,
    item: PIXI.Container | PIXI.Graphics | PIXI.Text,
  ) => void;
  hasGitChanges: boolean;
  app: PIXI.Application;
  viewport: Viewport;
  theme: "dark" | "light";
  customColors?: CustomColors;
}

export interface Renderable {
  render(
    context: RenderContext,
    parent: PIXI.Container,
  ): PIXI.Container | PIXI.Graphics;
}

export interface PointData {
  x?: number;
  y?: number;
  color?: string;
  radius?: number;
  combo?: string;
  highlighted?: boolean;
}

export interface DetailItemData {
  id: string;
  name: VariableName | string;
  projectPath?: string;
  fileName?: string;
  pureFileName?: string;
  scope?: VariableScope | string;
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
    | "normal"
    | "jsx"
    | (string & {});
  typeParams?: TypeDataParam[];
  extends?: string[];
  tag?: string;
  children?: Record<string, ComponentInfoRender>;
  hooks?: string[];
  gitStatus?: "added" | "modified" | "deleted";
  declarationKind?:
    | "const"
    | "let"
    | "var"
    | "using"
    | "await using"
    | undefined;
  visible?: boolean;
  displayName?: string;
  ui?: UIItemState & {
    children?: Record<string, UIItemState>;
    vars?: Record<string, UIItemState>;
  };
  appearanceOverride?: AppearanceOverride;
  [key: string]: unknown;
}

export interface BaseNodeData extends DetailItemData, PointData {
  scale?: number;
  parent?: GraphCombo;
  isLayoutCalculated?: boolean;
}

export type GraphNodeData = BaseNodeData;

export interface GraphComboData extends BaseNodeData {
  collapsed?: boolean;
  collapsedRadius?: number;
  expandedRadius?: number;
  padding?: number;
  child?: CurRender;
}

export interface GraphArrowData {
  id: string;
  source: string;
  target: string;
  name?: string;
  edgeKind?: string;
  category?: string;
  flowRole?: "direct" | "side-effect" | null;
  usageCount?: number;
  usages?: UsageOccurrenceData[];
  highlighted?: boolean;
  dimmed?: boolean;
  opensTo?: { fileName: string; line: number; column: number };
  points?: number[];
  scale?: number;
  combo?: string;
  visible?: boolean;
  opacity?: number;
  [key: string]: unknown;
}
