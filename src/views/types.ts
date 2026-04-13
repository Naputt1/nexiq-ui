import {
  type GraphViewResult,
  type TaskContext,
  type GraphViewTask,
} from "@nexiq/extension-sdk";
import type { GraphViewType } from "../../electron/types";

export type { GraphViewResult, TaskContext, GraphViewTask };

export type GenerateViewRequest = {
  view: GraphViewType;
  projectRoot: string;
  analysisPath?: string;
  analysisPaths?: string[];
  selectedCommit?: string | null;
  subPath?: string;
  refreshHandle?: boolean;
  profilerRunId?: string;
  profilerLogicalKey?: string;
};

export interface ViewGenerationStage {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  parentId?: string;
  detail?: string;
}

export interface GenerateGraphViewResult {
  result: GraphViewResult;
  stages: ViewGenerationStage[];
  nodeDataBuffer?: SharedArrayBuffer;
  detailBuffer?: SharedArrayBuffer;
}

export type SerializedViewRegistry = {
  registry: Record<string, { id: string; priority: number }[]>;
};
