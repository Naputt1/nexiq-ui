import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import type { ProjectStatus } from "./types";
import { useAppStateStore } from "../../hooks/use-app-state-store";

interface ConfigStepProps {
  path: string;
  status: ProjectStatus;
  onConfirm: (analysisPaths?: string[]) => void;
  onBack: () => void;
}

export function ConfigStep({
  path: projectPath,
  status: initialStatus,
  onConfirm,
  onBack,
}: ConfigStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [ignorePatterns, setIgnorePatterns] = useState(
    (initialStatus.config?.ignorePatterns || []).join("\n"),
  );
  const selectedSubProjects = useAppStateStore(
    (state) => state.selectedSubProjects,
  );
  const setSelectedSubProjects = useAppStateStore(
    (state) => state.setSelectedSubProjects,
  );
  const toggleSubProject = useAppStateStore((state) => state.toggleSubProject);

  // Initialize selectedSubProjects if empty and it's a monorepo
  useEffect(() => {
    if (
      initialStatus.isMonorepo &&
      initialStatus.subProjects &&
      selectedSubProjects.length === 0
    ) {
      // By default, select all sub-projects
      setSelectedSubProjects(initialStatus.subProjects.map((p) => p.path));
    } else if (!initialStatus.isMonorepo && selectedSubProjects.length === 0) {
      setSelectedSubProjects([projectPath]);
    }
  }, [initialStatus, projectPath]);

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      const baseConfig = initialStatus.config || {
        entry: "src/index.tsx",
      };

      const configToSave = {
        ...baseConfig,
        analysisPaths:
          selectedSubProjects.length > 0 ? selectedSubProjects : [projectPath],
        ignorePatterns: ignorePatterns
          .split("\n")
          .map((pattern: string) => pattern.trim())
          .filter(Boolean),
      };

      await window.ipcRenderer.invoke("save-project-config", {
        config: configToSave,
        directoryPath: projectPath,
      });

      // Trigger analysis for all selected projects
      await window.ipcRenderer.invoke(
        "analyze-project",
        selectedSubProjects,
        projectPath,
      );

      onConfirm(selectedSubProjects);
    } catch (error) {
      console.error("Failed to save config:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.14),_transparent_28%),linear-gradient(180deg,_rgba(15,23,42,1)_0%,_rgba(9,9,11,1)_100%)] p-8 text-foreground">
      <div className="flex w-full max-w-4xl flex-col gap-6">
        <Button
          onClick={onBack}
          variant="ghost"
          className="self-start text-zinc-400 hover:text-white"
        >
          ← Back
        </Button>

        <Card className="border-white/10 bg-black/30 p-8 shadow-2xl shadow-cyan-950/20 backdrop-blur-xl">
          <div className="flex flex-col gap-2 mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Configure Analysis
            </h2>
            <p className="text-zinc-400">
              Pick the parts of the workspace that should be analyzed and add
              any paths you want excluded before the graph loads.
            </p>
          </div>

          <div className="space-y-6 mb-8">
            {/* Project Info Section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Structure
                </label>
                <div className="text-sm font-semibold text-white">
                  {initialStatus.isMonorepo ? "Monorepo" : "Single Project"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Type
                </label>
                <div className="text-sm font-semibold capitalize text-white">
                  {initialStatus.projectType}
                </div>
              </div>
            </div>

            {/* Sub-projects Selection */}
            {initialStatus.isMonorepo &&
              initialStatus.subProjects &&
              initialStatus.subProjects.length > 1 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      Sub-Projects ({initialStatus.subProjects.length})
                    </label>
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-[10px] uppercase font-bold text-primary"
                      onClick={() => {
                        if (
                          selectedSubProjects.length ===
                          initialStatus.subProjects?.length
                        ) {
                          setSelectedSubProjects([]);
                        } else {
                          setSelectedSubProjects(
                            initialStatus.subProjects?.map((p) => p.path) || [],
                          );
                        }
                      }}
                    >
                      {selectedSubProjects.length ===
                      initialStatus.subProjects?.length
                        ? "Deselect All"
                        : "Select All"}
                    </Button>
                  </div>

                  <div className="max-h-100 overflow-y-auto divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                    {initialStatus.subProjects.map((pkg) => (
                      <div
                        key={pkg.path}
                        className="flex cursor-pointer items-center gap-3 p-4 transition-colors hover:bg-white/[0.04]"
                        onClick={() => toggleSubProject(pkg.path)}
                      >
                        <Checkbox
                          id={`pkg-${pkg.path}`}
                          checked={selectedSubProjects.includes(pkg.path)}
                          onCheckedChange={() => toggleSubProject(pkg.path)}
                        />
                        <div className="flex flex-col flex-1 min-w-0">
                          <label
                            htmlFor={`pkg-${pkg.path}`}
                            className="cursor-pointer truncate text-sm font-medium leading-none text-white"
                          >
                            {pkg.name}
                          </label>
                          <span className="mt-1 truncate font-mono text-[10px] text-zinc-500">
                            {pkg.path.replace(projectPath, "") || "/"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Exclude Paths
              </label>
              <Textarea
                value={ignorePatterns}
                onChange={(event) => setIgnorePatterns(event.target.value)}
                placeholder="**/node_modules/**&#10;**/*.test.tsx&#10;apps/legacy/**"
                className="min-h-[140px] rounded-2xl border-white/10 bg-white/[0.03] font-mono text-sm text-white placeholder:text-zinc-600"
              />
            </div>

            {!initialStatus.isMonorepo && (
              <div className="flex items-center gap-3 rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-4">
                <Checkbox checked disabled />
                <div>
                  <div className="text-sm font-medium text-white">
                    Standard Project Analysis
                  </div>
                  <div className="text-xs text-zinc-400">
                    The entire project will be analyzed.
                  </div>
                </div>
              </div>
            )}

            {/* Config Status */}
            <div
              className={`p-4 rounded-lg flex items-start gap-3 border ${
                initialStatus.hasConfig
                ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-amber-500/5 border-amber-500/20"
              }`}
            >
              <div
                className={`w-2 h-2 rounded-full mt-1.5 ${
                  initialStatus.hasConfig ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <div>
                <div
                  className={`text-sm font-bold ${
                    initialStatus.hasConfig
                      ? "text-emerald-500/90"
                      : "text-amber-500/90"
                  }`}
                >
                  {initialStatus.hasConfig
                    ? "Existing Config Found"
                    : "New Config Required"}
                </div>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {initialStatus.hasConfig
                    ? "We'll update your existing nexiq.config.json with the new selections."
                    : "A nexiq.config.json will be created in your project root."}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <Button
              onClick={handleConfirm}
              className="h-12 flex-1 rounded-2xl bg-cyan-500 font-bold text-slate-950 shadow-lg shadow-cyan-950/20 hover:bg-cyan-400"
              disabled={
                isSaving ||
                (initialStatus.isMonorepo && selectedSubProjects.length === 0)
              }
            >
              {isSaving
                ? "Analyzing..."
                : initialStatus.hasConfig
                  ? "Update & Re-analyze"
                  : "Start Analysis"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
