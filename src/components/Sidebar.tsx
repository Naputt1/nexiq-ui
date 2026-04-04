import { useState, useEffect, useMemo } from "react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Files,
  GitBranch,
  Settings as SettingsIcon,
  Settings2,
  Box,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { GitPanel } from "./GitPanel";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "../../electron/types";
import { Button } from "@/components/ui/button";
import { ProjectSelectionModal } from "./ProjectSelectionModal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarProps {
  currentPath: string;
  projectRoot: string;
  onLocateFile?: (filePath: string) => void;
  onSelectNode?: (id: string) => void;
  isLoading?: boolean;
}

interface SubProject {
  name: string;
  path: string;
}

export function ProjectSidebar({
  currentPath,
  projectRoot,
  onLocateFile,
  onSelectNode,
}: SidebarProps) {
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const activeTab = useAppStateStore((s) => s.activeTab);
  const setActiveTab = useAppStateStore((s) => s.setActiveTab);
  const selectedSubProjects = useAppStateStore((s) => s.selectedSubProjects);
  const setSelectedSubProjects = useAppStateStore(
    (s) => s.setSelectedSubProjects,
  );
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const projectName = useMemo(() => {
    return projectRoot.split(/[/\\]/).pop() || "Project";
  }, [projectRoot]);

  const projectInitial = useMemo(() => {
    return projectName.charAt(0).toUpperCase();
  }, [projectName]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await window.ipcRenderer.invoke(
          "check-project-status",
          projectRoot,
        );
        setStatus(res);
        if (res.subProjects) {
          setSubProjects(res.subProjects);
        }
      } catch (e) {
        console.error("Failed to fetch subprojects", e);
      }
    };

    const fetchIcon = async () => {
      try {
        const url = await window.ipcRenderer.invoke(
          "get-project-icon",
          currentPath,
        );
        setIconUrl(url);
      } catch (e) {
        console.error("Failed to fetch project icon", e);
      }
    };

    fetchStatus();
    fetchIcon();
  }, [projectRoot, currentPath]);

  const currentConfig = status?.config;
  const filteredSubProjects = useMemo(() => {
    if (!currentConfig?.ignoreSubProjects) return subProjects;
    return subProjects.filter(
      (sp) => !currentConfig.ignoreSubProjects?.includes(sp.name),
    );
  }, [subProjects, currentConfig]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasProjectSelector = filteredSubProjects.length > 1;

  const collapsedActionClass = cn(
    "p-2 rounded-md transition-colors",
    "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
  );

  return (
    <ShadcnSidebar collapsible="icon" className="border-r border-border">
      <ProjectSelectionModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        subProjects={filteredSubProjects}
        initialSelected={selectedSubProjects}
        onApply={(paths) => setSelectedSubProjects(paths)}
      />
      <SidebarHeader className="border-b border-border p-0">
        <div className="flex h-12 items-center px-4">
          <div
            className={cn(
              "flex items-center gap-2 font-semibold w-full",
              isCollapsed && "justify-center",
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded text-primary-foreground shrink-0 overflow-hidden",
                !iconUrl && "bg-primary",
              )}
            >
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt={projectName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-sm font-bold">{projectInitial}</span>
              )}
            </div>
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {projectName}
            </span>
          </div>
        </div>

        <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
          <div className="flex p-1 bg-muted/50 rounded-md">
            <button
              onClick={() => setActiveTab("projects")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded transition-all",
                activeTab === "projects"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Files className="h-3.5 w-3.5" />
              Explorer
            </button>
            <button
              onClick={() => setActiveTab("git")}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-medium rounded transition-all",
                activeTab === "git"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Git
            </button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="flex flex-col min-h-0">
        {isCollapsed ? (
          <TooltipProvider>
            <div className="flex flex-col items-center gap-4 py-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab("projects")}
                    className={cn(
                      collapsedActionClass,
                      activeTab === "projects" &&
                        "bg-accent text-accent-foreground",
                    )}
                  >
                    <Files className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Explorer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab("git")}
                    className={cn(
                      collapsedActionClass,
                      activeTab === "git" && "bg-accent text-accent-foreground",
                    )}
                  >
                    <GitBranch className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">Git</TooltipContent>
              </Tooltip>
              {hasProjectSelector && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className={collapsedActionClass}
                    >
                      <Box className="h-5 w-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Analysis Targets</TooltipContent>
                </Tooltip>
              )}
            </div>
          </TooltipProvider>
        ) : activeTab === "projects" ? (
          <SidebarGroup className="p-0 flex-1 min-h-0 flex flex-col">
            <SidebarHeader className="border-none grow-0">
              <SidebarGroupContent className="p-2 pt-4 flex flex-col gap-2">
                {hasProjectSelector && (
                  <div className="flex items-center justify-between px-2">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                      <Box className="h-3 w-3" />
                      Analysis Targets
                    </label>
                  </div>
                )}
              </SidebarGroupContent>
            </SidebarHeader>

            {hasProjectSelector && (
              <div className="px-2 mb-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs justify-between group"
                  onClick={() => setIsModalOpen(true)}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Box className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span className="truncate">
                      {selectedSubProjects.length === 0
                        ? "No projects selected"
                        : selectedSubProjects.length ===
                            filteredSubProjects.length
                          ? "All projects selected"
                          : `${selectedSubProjects.length} projects selected`}
                    </span>
                  </div>
                  <Settings2 className="h-3 w-3 opacity-50" />
                </Button>
              </div>
            )}

            <div className="flex-1 min-h-0" />
          </SidebarGroup>
        ) : (
          <div className="flex-1 min-h-0">
            <GitPanel
              projectRoot={projectRoot}
              onLocateFile={onLocateFile}
              onSelectNode={onSelectNode}
            />
          </div>
        )}
      </SidebarContent>

      <SidebarFooter
        className={cn(
          "p-4 border-t border-border flex flex-col gap-2",
          isCollapsed && "flex justify-center p-2",
        )}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`/project-settings?projectPath=${encodeURIComponent(projectRoot)}`}
                className={cn(
                  "flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-2",
                  isCollapsed && "p-2 justify-center",
                )}
              >
                <SettingsIcon className="h-4 w-4" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Project Settings
                </span>
              </Link>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">Project Settings</TooltipContent>
            )}
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to={`/global-settings?projectPath=${encodeURIComponent(projectRoot)}`}
                className={cn(
                  "flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-2",
                  isCollapsed && "p-2 justify-center",
                )}
              >
                <Settings2 className="h-4 w-4" />
                <span className="group-data-[collapsible=icon]:hidden">
                  Global Settings
                </span>
              </Link>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right">Global Settings</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
