import { Route, Routes, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";

import { useAppStateStore } from "./hooks/use-app-state-store";
import { useGraphProfilerStore } from "./hooks/use-graph-profiler-store";
import { SettingsModal } from "./components/SettingsModal";

function App() {
  const { projectRoot: storedProjectRoot, setProjectRoot } = useProjectStore();
  const [searchParams] = useSearchParams();

  // Try to get projectPath from hash (via useSearchParams) or from main URL search
  const urlProjectPath =
    searchParams.get("projectPath") ||
    new URLSearchParams(window.location.search).get("projectPath");

  const urlSubProject =
    searchParams.get("subProject") ||
    new URLSearchParams(window.location.search).get("subProject");

  const isEmpty =
    searchParams.get("empty") === "true" ||
    new URLSearchParams(window.location.search).get("empty") === "true";

  useEffect(() => {
    if (urlProjectPath) {
      setProjectRoot(urlProjectPath);
    }
    if (urlSubProject) {
      const paths = urlSubProject.split(",").filter(Boolean);
      useAppStateStore.getState().setSelectedSubProjects(paths);
    }
  }, [urlProjectPath, urlSubProject, setProjectRoot]);

  // Use project root from URL if available, otherwise from store (if not explicitly empty)
  const projectRoot = urlProjectPath || (isEmpty ? null : storedProjectRoot);

  useEffect(() => {
    if (projectRoot) {
      const name = projectRoot.split(/[/\\]/).filter(Boolean).pop();
      document.title = name ? `${name} - nexiq` : "nexiq";
    } else {
      document.title = "nexiq";
    }
  }, [projectRoot]);

  useEffect(() => {
    return window.ipcRenderer.on("graph-pipeline-profile", (payload) => {
      useGraphProfilerStore.getState().startRun({
        id: payload.id,
        logicalKey: payload.logicalKey,
        key: payload.key,
        projectRoot: payload.projectRoot,
        view: payload.view,
        startedAt: Date.now(),
        byteLength: payload.byteLength,
        handleVersion: payload.handleVersion,
        status: payload.status ?? "in_progress",
      });
      useGraphProfilerStore.getState().mergeStages(
        payload.id,
        payload.stages.map((stage) => ({
          ...stage,
          parentId: stage.parentId ?? "renderer:handle-wait",
          source: "backend" as const,
        })),
      );
      useGraphProfilerStore.getState().completeRun(payload.id, {
        status: payload.status ?? "completed",
        byteLength: payload.byteLength,
        handleVersion: payload.handleVersion,
      });
    });
  }, []);

  const handleProjectComplete = async (
    path: string,
    analysisPaths?: string[],
  ) => {
    // Save to main process first
    const wasFocusedElsewhere = await window.ipcRenderer.invoke(
      "set-last-project",
      path,
    );
    if (wasFocusedElsewhere) return;

    // Use hash-based navigation for compatibility with HashRouter
    let url = `/?projectPath=${encodeURIComponent(path)}`;
    if (analysisPaths && analysisPaths.length > 0) {
      const filtered = analysisPaths.filter((p) => p !== path);
      if (filtered.length > 0) {
        url += `&subProject=${encodeURIComponent(filtered.join(","))}`;
      }
    }
    window.location.hash = url;
  };

  if (!projectRoot) {
    return <SetupFlow onComplete={handleProjectComplete} />;
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <ComponentGraph
              projectPath={projectRoot}
              subProject={urlSubProject || undefined}
            />
          }
        />
      </Routes>
      <SettingsModal />
    </>
  );
}

export default App;
