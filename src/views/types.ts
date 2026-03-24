import { type GraphViewResult, type GraphViewTask } from "@nexiq/extension-sdk";
import type { GraphViewType } from "../../electron/types";

export type { GraphViewResult, GraphViewTask };

export type GenerateViewRequest = {
  view: GraphViewType;
  projectRoot: string;
  analysisPath?: string;
  analysisPaths?: string[];
  selectedCommit?: string | null;
  subPath?: string;
  refreshHandle?: boolean;
};

export type SerializedViewRegistry = {
  registry: Record<string, { id: string; priority: number }[]>;
};
