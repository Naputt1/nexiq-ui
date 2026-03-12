import { type DatabaseData } from "@react-map/shared";
import {
  type GraphViewResult,
  type GraphViewTask,
} from "@react-map/extension-sdk";

export type { GraphViewResult, GraphViewTask };

export type ViewWorkerResponse = {
  result: GraphViewResult;
  isIncremental?: boolean;
  done?: boolean;
};

export type GraphViewGenerator = (data: DatabaseData) => GraphViewResult;
