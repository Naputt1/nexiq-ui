import type {
  NexiqConfig,
  SubProject,
  ProjectStatus,
  AppStateData,
  GraphViewType as SharedGraphViewType,
} from "@nexiq/shared";
import type { GraphAppearance } from "@nexiq/extension-sdk";
import type { GraphSnapshotUpdateEvent, LargeDataUpdateEvent } from "../src/graph-snapshot/types";

export type {
  NexiqConfig,
  SubProject,
  ProjectStatus,
  AppStateData,
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
}

export interface GlobalSettings {
  theme: "dark" | "light";
  appearance?: GraphAppearance;
  autoReload?: boolean;
}
