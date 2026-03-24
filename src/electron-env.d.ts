/// <reference types="vite-plugin-electron/electron-env" />

import {
  DatabaseData,
  GitStatus,
  GitCommit,
  GitFileDiff,
  UIStateMap,
} from "@nexiq/shared";
import type {
  LargeDataKind,
  LargeDataRequestArgs,
  LargeDataUpdateEvent,
  SharedLargeDataHandle,
  GraphSnapshotUpdateEvent,
} from "./graph-snapshot/types";
import {
  AppStateData,
  IpcEvents,
  ProjectStatus,
  NexiqConfig,
  GlobalSettings,
} from "../electron/types";
import type { GraphData } from "./graph/hook";

import type { Extension } from "@nexiq/extension-sdk";
import type {
  GenerateViewRequest,
  SerializedViewRegistry,
} from "./views/types";

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      APP_ROOT: string;
      VITE_PUBLIC: string;
    }
  }

  interface Window {
    nexiqGraph: GraphData;
    nexiqSearch: (value: string) => void;
    registerNexiqExtension: (extension: Extension) => void;
    graphSnapshot: {
      open: (
        projectRoot: string,
        analysisPath?: string,
      ) => Promise<import("./graph-snapshot/types").SharedGraphSnapshotHandle>;
      getHandle: (
        projectRoot: string,
        analysisPath?: string,
      ) => Promise<import("./graph-snapshot/types").SharedGraphSnapshotHandle>;
      refresh: (projectRoot: string, analysisPath?: string) => Promise<void>;
      onUpdate: (
        listener: (payload: GraphSnapshotUpdateEvent) => void,
      ) => () => void;
    };
    largeData: {
      open: (
        kind: LargeDataKind,
        args: LargeDataRequestArgs,
      ) => Promise<SharedLargeDataHandle>;
      getHandle: (
        kind: LargeDataKind,
        args: LargeDataRequestArgs,
      ) => Promise<SharedLargeDataHandle>;
      refresh: (
        kind: LargeDataKind,
        args: LargeDataRequestArgs,
      ) => Promise<void>;
      onUpdate: (
        listener: (payload: LargeDataUpdateEvent) => void,
      ) => () => void;
    };
    ipcRenderer: {
      invoke(channel: "run-cli", command: string): Promise<string>;
      invoke(
        channel: "open-vscode",
        path: string,
        projectRoot?: string,
        line?: number,
        column?: number,
      ): Promise<string>;
      invoke(channel: "select-directory"): Promise<string | null>;
      invoke(channel: "get-recent-projects"): Promise<string[]>;
      invoke(
        channel: "check-project-status",
        directoryPath: string,
      ): Promise<ProjectStatus>;
      invoke(
        channel: "save-project-config",
        args: { config: NexiqConfig; directoryPath: string },
      ): Promise<boolean>;
      invoke(channel: "set-project", path: string): Promise<void>;
      invoke(channel: "get-project"): Promise<string | null>;
      invoke(
        channel: "analyze-project",
        analysisPaths: string | string[],
        projectPath: string,
      ): Promise<string>;
      invoke(
        channel: "generate-view",
        args: GenerateViewRequest,
      ): Promise<SharedLargeDataHandle>;
      invoke(
        channel: "debug-get-view-registry",
      ): Promise<SerializedViewRegistry>;
      invoke(
        channel: "read-state",
        projectRoot: string,
      ): Promise<AppStateData | null>;
      invoke(
        channel: "save-state",
        projectRoot: string,
        state: AppStateData,
      ): Promise<boolean>;
      invoke(channel: "git-status", projectRoot: string): Promise<GitStatus>;
      invoke(
        channel: "git-log",
        projectRoot: string,
        options?: number | { limit?: number; path?: string },
      ): Promise<GitCommit[]>;
      invoke(
        channel: "git-stage",
        projectRoot: string,
        files: string[],
      ): Promise<void>;
      invoke(
        channel: "git-unstage",
        projectRoot: string,
        files: string[],
      ): Promise<void>;
      invoke(
        channel: "git-diff",
        projectRoot: string,
        options: {
          file?: string;
          commit?: string;
          staged?: boolean;
          baseCommit?: string;
        },
      ): Promise<GitFileDiff[]>;
      invoke(
        channel: "git-analyze-commit",
        projectRoot: string,
        commitHash: string,
        subPath?: string,
      ): Promise<SharedLargeDataHandle>;
      invoke(
        channel: "analyze-diff",
        dataA: DatabaseData,
        dataB: DatabaseData,
      ): Promise<DatabaseData>;
      on<K extends keyof IpcEvents>(
        channel: K,
        listener: (payload: IpcEvents[K]) => void,
      ): () => void;
      send(channel: string, ...args: unknown[]): void;
      invoke(channel: "get-last-project"): Promise<string | null>;
      invoke(
        channel: "set-last-project",
        path: string | null,
      ): Promise<boolean>;
      invoke(
        channel: "update-graph-position",
        projectRoot: string,
        analysisPath: string,
        positions: UIStateMap,
        contextId?: string,
      ): Promise<boolean>;
      invoke(
        channel: "get-project-icon",
        projectRoot: string,
      ): Promise<string | null>;
      invoke(channel: "get-global-config"): Promise<GlobalSettings>;
      invoke(
        channel: "save-global-config",
        config: GlobalSettings,
      ): Promise<boolean>;
    };
  }
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

export {};
