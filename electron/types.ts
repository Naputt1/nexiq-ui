import type {
  NexiqConfig,
  SubProject,
  CustomColors,
  ProjectStatus,
  AppStateData,
  GraphViewType as SharedGraphViewType,
} from "@nexiq/shared";
import type { GraphSnapshotUpdateEvent } from "../src/graph-snapshot/types";

export type {
  NexiqConfig,
  SubProject,
  CustomColors,
  ProjectStatus,
  AppStateData,
};

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
}

export interface GlobalSettings {
  theme: "dark" | "light";
  customColors?: CustomColors;
  autoReload?: boolean;
}
