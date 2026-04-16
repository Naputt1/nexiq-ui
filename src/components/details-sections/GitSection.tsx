import React, { useEffect } from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";
import { useGitStore } from "@/hooks/useGitStore";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { GitDiffView } from "../GitDiffView";
import { type GraphNodeData } from "@/graph/hook";

export const GitSection: React.FC<DetailSectionProps> = ({
  item: baseItem,
  projectPath,
}) => {
  const item = baseItem as GraphNodeData;
  const diffs = useGitStore((s) => s.diffs);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);

  useEffect(() => {
    if (item.gitStatus && item.pureFileName) {
      loadDiff(projectPath, {
        file: item.pureFileName,
        commit: selectedCommit || undefined,
      });
    }
  }, [
    item.id,
    item.gitStatus,
    item.pureFileName,
    projectPath,
    selectedCommit,
    loadDiff,
  ]);

  if (!item.gitStatus) return null;

  const diffKey = `${selectedCommit || "current"}-${"working"}-${item.pureFileName || "all"}`;
  const itemDiffs = diffs[diffKey] || [];

  return (
    <GitDiffView
      diffs={itemDiffs}
      fileName={item.pureFileName || ""}
      scope={typeof item.scope === "object" ? item.scope : undefined}
    />
  );
};
