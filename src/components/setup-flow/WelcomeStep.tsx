import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { FolderOpen, Sparkles, ArrowRight, Search } from "lucide-react";

interface WelcomeStepProps {
  onSelectProject: (path: string) => void;
}

export function WelcomeStep({ onSelectProject }: WelcomeStepProps) {
  const [recents, setRecents] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Load recent projects
    window.ipcRenderer.invoke("get-recent-projects").then((projects) => {
      if (Array.isArray(projects)) {
        setRecents(projects);
      }
    });
  }, []);

  const handleOpenProject = async () => {
    setIsLoading(true);
    try {
      const path = await window.ipcRenderer.invoke("select-directory");
      if (path && typeof path === "string") {
        onSelectProject(path);
      }
    } catch (e) {
      console.error("Failed to select directory", e);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredRecents = recents.filter((path) =>
    path.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="min-h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.16),_transparent_30%),linear-gradient(180deg,_rgba(15,23,42,1)_0%,_rgba(9,9,11,1)_100%)] text-foreground">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-8 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-cyan-200">
            <Sparkles className="h-3.5 w-3.5" />
            Faster project navigation
          </div>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-white">
              Open a codebase and get straight to the graph.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-zinc-400">
              Recent projects reopen immediately when they already have config.
              New projects still get a quick setup pass so the graph opens with
              the right analysis scope.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="border-white/10 bg-white/[0.04] p-4 text-white shadow-2xl shadow-cyan-950/20">
              <div className="text-sm font-medium">Direct open</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Recents jump into the project instead of walking through setup
                again.
              </p>
            </Card>
            <Card className="border-white/10 bg-white/[0.04] p-4 text-white shadow-2xl shadow-cyan-950/20">
              <div className="text-sm font-medium">Cleaner selection</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Search, scan, and reopen the right workspace without extra
                clicks.
              </p>
            </Card>
            <Card className="border-white/10 bg-white/[0.04] p-4 text-white shadow-2xl shadow-cyan-950/20">
              <div className="text-sm font-medium">Scoped analysis</div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Multi-package projects can be narrowed down before the first
                load.
              </p>
            </Card>
          </div>
        </div>

        <Card className="border-white/10 bg-black/30 p-6 backdrop-blur-xl">
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.26em] text-zinc-500">
                  Project launcher
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  Choose a workspace
                </div>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
                <FolderOpen className="h-5 w-5" />
              </div>
            </div>

            <Button
              onClick={handleOpenProject}
              className="h-14 w-full justify-between rounded-2xl bg-cyan-500 text-base font-semibold text-slate-950 hover:bg-cyan-400"
              disabled={isLoading}
            >
              <span>{isLoading ? "Opening..." : "Open Project Folder"}</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
            
            <div className="relative mt-4">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-zinc-500" />
              </div>
              <input
                type="text"
                placeholder="Search recent projects..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400 placeholder:text-zinc-500"
              />
            </div>

            <div className="mt-2 flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-[0.26em] text-zinc-500">
                Recent Projects
              </h3>
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {filteredRecents.length === 0 ? (
                <p className="py-8 text-center text-sm italic text-zinc-500">
                  No recent projects found
                </p>
              ) : (
                filteredRecents.map((path) => (
                  <button
                    key={path}
                    onClick={() => onSelectProject(path)}
                    className="group flex w-full items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-left transition-all hover:border-cyan-400/30 hover:bg-cyan-500/[0.08]"
                  >
                    <div className="flex min-w-0 flex-col overflow-hidden">
                      <span className="truncate text-sm font-semibold text-white transition-colors group-hover:text-cyan-200">
                        {path.split("/").pop()}
                      </span>
                      <span className="w-full truncate text-xs text-zinc-500" title={path}>
                        {path}
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-cyan-200" />
                  </button>
                ))
              )}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
