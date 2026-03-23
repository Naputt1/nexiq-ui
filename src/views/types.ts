import { type DatabaseData } from "@nexiq/shared";
import { type GraphViewResult, type GraphViewTask } from "@nexiq/extension-sdk";
import type { GraphViewType } from "../../electron/types";

export type { GraphViewResult, GraphViewTask };

export type GenerateViewRequest = {
  view: GraphViewType;
  data?: DatabaseData;
  projectRoot?: string;
  analysisPath?: string;
  refreshHandle?: boolean;
};

export type SerializedViewRegistry = {
  registry: Record<string, { id: string; priority: number }[]>;
};

export type GraphViewGenerator = (data: DatabaseData) => GraphViewResult;
