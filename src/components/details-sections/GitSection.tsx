import React, { useEffect } from "react";
import type { DetailSectionProps } from "@nexiq/extension-sdk";
import { useGitStore } from "@/hooks/useGitStore";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { GitDiffView } from "../GitDiffView";

export const GitSection: React.FC<DetailSectionProps> = ({
  projectPath,
  detail,
}) => {
  const diffs = useGitStore((s) => s.diffs);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const selectedCommit = useAppStateStore((s) => s.selectedCommit);

  const fileName = detail?.fileName || detail?.pureFileName;
  const gitStatus = detail?.gitStatus;
  const scope = detail?.scope;

  useEffect(() => {
    if (gitStatus && fileName) {
      loadDiff(projectPath, {
        file: fileName,
        commit: selectedCommit || undefined,
      });
    }
  }, [detail?.id, gitStatus, fileName, projectPath, selectedCommit, loadDiff]);

  if (!gitStatus) return null;

  const diffKey = `${selectedCommit || "current"}-${"working"}-${fileName || "all"}`;
  const itemDiffs = diffs[diffKey] || [];

  return (
    <GitDiffView diffs={itemDiffs} fileName={fileName || ""} scope={typeof scope === 'object' ? scope : undefined} />
  );
};
