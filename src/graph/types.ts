export interface UIItemState {
  x: number;
  y: number;
  radius?: number;
  collapsedRadius?: number;
  expandedRadius?: number;
  isLayoutCalculated?: boolean;
  collapsed?: boolean;
}

export type UIStateMap = Record<string, UIItemState>;
