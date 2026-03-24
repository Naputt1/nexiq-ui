import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8 w-screen">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <Button
          onClick={onBack}
          variant="ghost"
          className="self-start text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Button>

        <Card className="p-8 bg-card border-border shadow-xl">
          <div className="flex flex-col gap-2 mb-8">
            <h2 className="text-3xl font-bold tracking-tight text-primary">
              Configure Analysis
            </h2>
            <p className="text-muted-foreground">
              Select which sub-projects you want to analyze in this monorepo.
            </p>
          </div>

          <div className="space-y-6 mb-8">
            {/* Project Info Section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest block mb-1">
                  Structure
                </label>
                <div className="text-sm font-semibold">
                  {initialStatus.isMonorepo ? "Monorepo" : "Single Project"}
                </div>
              </div>
              <div className="p-4 bg-muted/30 rounded-lg border border-border">
                <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest block mb-1">
                  Type
                </label>
                <div className="text-sm font-semibold capitalize">
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
                    <label className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
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

                  <div className="border border-border rounded-lg overflow-hidden bg-muted/10 divide-y divide-border max-h-100 overflow-y-auto">
                    {initialStatus.subProjects.map((pkg) => (
                      <div
                        key={pkg.path}
                        className="flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors cursor-pointer"
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
                            className="text-sm font-medium leading-none cursor-pointer truncate"
                          >
                            {pkg.name}
                          </label>
                          <span className="text-[10px] text-muted-foreground font-mono truncate mt-1 opacity-60">
                            {pkg.path.replace(projectPath, "") || "/"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {!initialStatus.isMonorepo && (
              <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg flex items-center gap-3">
                <Checkbox checked disabled />
                <div>
                  <div className="text-sm font-medium">
                    Standard Project Analysis
                  </div>
                  <div className="text-xs text-muted-foreground">
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
                <p className="text-xs text-muted-foreground mt-0.5">
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
              className="flex-1 h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-bold shadow-lg shadow-primary/20"
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
