import type {
  NexiqConfig,
  SubProject,
  ProjectStatus,
  AppStateData,
  GraphViewType as SharedGraphViewType,
  FileAnalysisErrorRow,
  ResolveErrorRow,
} from "@nexiq/shared";
import type { GraphAppearance } from "@nexiq/extension-sdk";
import type {
  GraphSnapshotUpdateEvent,
  LargeDataUpdateEvent,
} from "../src/graph-snapshot/types";

export type {
  NexiqConfig,
  SubProject,
  ProjectStatus,
  AppStateData,
  FileAnalysisErrorRow,
  ResolveErrorRow,
};
export type { GraphAppearance };
export type CustomColors = GraphAppearance;

export type GraphViewType = SharedGraphViewType | "package";

export interface PnpmWorkspace {
  packages?: string[];
}

export interface PackageJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

export interface IpcEvents {
  "main-process-message": string;
  "reload-project": void;
  "git-status-changed": void;
  "graph-snapshot-updated": GraphSnapshotUpdateEvent;
  "large-data-updated": LargeDataUpdateEvent;
  "graph-pipeline-profile": {
    id: string;
    logicalKey: string;
    key: string;
    projectRoot: string;
    view?: string;
    byteLength?: number;
    handleVersion?: number;
    status?: "in_progress" | "completed" | "superseded" | "failed";
    stages: {
      id: string;
      name: string;
      startMs: number;
      endMs: number;
      parentId?: string;
      detail?: string;
    }[];
  };
}

export interface GlobalSettings {
  theme: "dark" | "light";
  appearance?: GraphAppearance;
  autoReload?: boolean;
}

export interface SourceFilePayload {
  path: string;
  content: string;
}
