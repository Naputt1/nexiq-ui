import React, { useEffect } from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";
import { useGitStore } from "@/hooks/useGitStore";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { GitDiffView } from "../GitDiffView";
import { type GraphNodeData } from "@/graph/hook";

export const GitSection: React.FC<DetailSectionProps> = ({
  item: baseItem,
  projectPath,
  detail,
}) => {
  const item = baseItem as GraphNodeData;
  const diffs = useGitStore((s) => s.diffs);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);

  const fileName = detail?.fileName || item.pureFileName;
  const scope =
    detail?.raw && typeof detail.raw === "object" && "scope" in detail.raw
      ? detail.raw.scope
      : typeof item.scope === "object"
        ? item.scope
        : undefined;

  useEffect(() => {
    if (item.gitStatus && fileName) {
      loadDiff(projectPath, {
        file: fileName,
        commit: selectedCommit || undefined,
      });
    }
  }, [
    item.id,
    item.gitStatus,
    fileName,
    projectPath,
    selectedCommit,
    loadDiff,
  ]);

  if (!item.gitStatus) return null;

  const diffKey = `${selectedCommit || "current"}-${"working"}-${fileName || "all"}`;
  const itemDiffs = diffs[diffKey] || [];

  return (
    <GitDiffView diffs={itemDiffs} fileName={fileName || ""} scope={scope} />
  );
};
