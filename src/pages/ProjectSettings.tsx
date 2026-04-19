import { useState, useEffect, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { ProjectStatus, NexiqConfig } from "../../electron/types";
import debounce from "lodash.debounce";

interface SettingsProps {
  projectPath: string;
}

export function ProjectSettings({ projectPath }: SettingsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [ignorePatterns, setIgnorePatterns] = useState("");
  const [selectedIgnoreSubProjects, setSelectedIgnoreSubProjects] = useState<
    string[]
  >([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const projectRes = await window.ipcRenderer.invoke(
          "check-project-status",
          projectPath,
        );
        setStatus(projectRes);
        if (projectRes.config) {
          setIgnorePatterns(
            (projectRes.config.ignorePatterns || []).join("\n"),
          );
          setSelectedIgnoreSubProjects(
            projectRes.config.ignoreSubProjects || [],
          );
        }
      } catch (e) {
        console.error("Failed to fetch settings", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectPath]);

  const saveConfig = useMemo(
    () =>
      debounce(async (patternsStr: string, subProjects: string[]) => {
        if (!status) return;
        setIsSaving(true);
        try {
          const patterns = patternsStr
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p !== "");

          const config: NexiqConfig = {
            ...status.config,
            ignorePatterns: patterns,
            ignoreSubProjects: subProjects,
          };

          await window.ipcRenderer.invoke("save-project-config", {
            config,
            directoryPath: projectPath,
          });
          setShowSaved(true);
          setTimeout(() => setShowSaved(false), 2000);
        } catch (err) {
          console.error("Failed to save project config", err);
        } finally {
          setIsSaving(false);
        }
      }, 1000),
    [status, projectPath],
  );

  const handleIgnorePatternsChange = (value: string) => {
    setIgnorePatterns(value);
    saveConfig(value, selectedIgnoreSubProjects);
  };

  const toggleSubProject = (name: string) => {
    const nextSubProjects = selectedIgnoreSubProjects.includes(name)
      ? selectedIgnoreSubProjects.filter((n) => n !== name)
      : [...selectedIgnoreSubProjects, name];
    setSelectedIgnoreSubProjects(nextSubProjects);
    saveConfig(ignorePatterns, nextSubProjects);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-sm py-2 z-10 border-b border-border/40 mb-4">
        <h2 className="text-lg font-semibold tracking-tight">
          Project Settings
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isSaving && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </>
          )}
          {showSaved && !isSaving && (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              Saved
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold opacity-70">Ignore Files</h3>
            <p className="text-[11px] text-muted-foreground">
              Add glob patterns to ignore files from analysis (one per line).
            </p>
          </div>
          <Textarea
            value={ignorePatterns}
            onChange={(e) => handleIgnorePatternsChange(e.target.value)}
            placeholder="**/node_modules/**&#10;**/*.test.tsx&#10;**/ignored-folder/**"
            className="min-h-37.5 font-mono text-xs whitespace-pre bg-muted/30"
          />
        </div>

        {status?.isMonorepo && (
          <div className="space-y-4 pt-4 border-t border-border/40">
            <div>
              <h3 className="text-sm font-semibold opacity-70">
                Exclude Subprojects
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Select subprojects to exclude from the project selector.
              </p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {status.subProjects.map((sp) => (
                <div key={sp.name} className="flex items-center space-x-2">
                  <Checkbox
                    id={`subproject-${sp.name}`}
                    checked={selectedIgnoreSubProjects.includes(sp.name)}
                    onCheckedChange={() => toggleSubProject(sp.name)}
                  />
                  <label
                    htmlFor={`subproject-${sp.name}`}
                    className="text-xs font-medium leading-none cursor-pointer"
                  >
                    {sp.name}
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
