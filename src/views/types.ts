import { type DatabaseData } from "@nexiq/shared";
import { type GraphViewResult, type GraphViewTask } from "@nexiq/extension-sdk";

export type { GraphViewResult, GraphViewTask };

export type ViewWorkerResponse = {
  result: GraphViewResult;
  isIncremental?: boolean;
  done?: boolean;
};

export type GraphViewGenerator = (data: DatabaseData) => GraphViewResult;
