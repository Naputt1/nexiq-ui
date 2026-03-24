import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Box, CheckCircle2, Circle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SubProject {
  name: string;
  path: string;
}

interface ProjectSelectionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  subProjects: SubProject[];
  initialSelected: string[];
  onApply: (selectedPaths: string[]) => void;
}

export function ProjectSelectionModal({
  isOpen,
  onOpenChange,
  subProjects,
  initialSelected,
  onApply,
}: ProjectSelectionModalProps) {
  const [selectedPaths, setSelectedPaths] = useState<string[]>(initialSelected);
  const [searchQuery, setSearchQuery] = useState("");

  // When opening, reset to initialSelected
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setSelectedPaths(initialSelected);
    }
  }

  const filteredProjects = subProjects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleProject = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path],
    );
  };

  const selectAll = () => {
    setSelectedPaths(subProjects.map((p) => p.path));
  };

  const deselectAll = () => {
    setSelectedPaths([]);
  };

  const handleApply = () => {
    onApply(selectedPaths);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] h-[600px] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-2 mb-1">
            <Box className="h-5 w-5 text-primary" />
            <DialogTitle>Select Analysis Targets</DialogTitle>
          </div>
          <DialogDescription>
            Choose the sub-projects you want to include in the graph analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 border-b bg-muted/30">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              className="pl-9 h-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between mt-3 px-1">
            <span className="text-xs text-muted-foreground">
              {selectedPaths.length} of {subProjects.length} selected
            </span>
            <div className="flex gap-3">
              <button
                onClick={selectAll}
                className="text-xs font-medium text-primary hover:underline flex items-center gap-1"
              >
                <CheckCircle2 className="h-3 w-3" />
                Select All
              </button>
              <button
                onClick={deselectAll}
                className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Circle className="h-3 w-3" />
                Deselect All
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <div className="grid gap-1">
            {filteredProjects.map((project) => (
              <div
                key={project.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors cursor-pointer hover:bg-accent/50 group",
                  selectedPaths.includes(project.path) && "bg-accent/30",
                )}
                onClick={() => toggleProject(project.path)}
              >
                <Checkbox
                  checked={selectedPaths.includes(project.path)}
                  onCheckedChange={() => toggleProject(project.path)}
                  className="h-4 w-4"
                />
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium leading-none truncate group-hover:text-foreground">
                    {project.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground truncate mt-1">
                    {project.path}
                  </span>
                </div>
              </div>
            ))}
            {filteredProjects.length === 0 && (
              <div className="py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No projects found matching "{searchQuery}"
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/10">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            size="sm"
          >
            Cancel
          </Button>
          <Button onClick={handleApply} size="sm">
            Apply Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
