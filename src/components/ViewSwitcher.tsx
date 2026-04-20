import { useAppStateStore } from "@/hooks/use-app-state-store";
import type { GraphViewType } from "../../electron/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitCompare, Layout } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function ViewSwitcher({
  className,
  isCollapsed,
  compact = false,
}: {
  className?: string;
  isCollapsed?: boolean;
  compact?: boolean;
}) {
  const view = useAppStateStore((s) => s.view);
  const setView = useAppStateStore((s) => s.setView);
  const gitComparisonEnabled = useAppStateStore(
    (s) => s.gitComparisonEnabled,
  );
  const setGitComparisonEnabled = useAppStateStore(
    (s) => s.setGitComparisonEnabled,
  );

  if (isCollapsed) {
    return (
      <div className={cn("flex justify-center p-2", className)}>
        <Layout className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        compact ? "flex items-center gap-2" : "flex flex-col gap-2 p-2",
        className,
      )}
    >
      {!compact && (
        <label className="text-[10px] font-bold uppercase text-muted-foreground px-2">
          View
        </label>
      )}
      <Select value={view} onValueChange={(val) => setView(val as GraphViewType)}>
        <SelectTrigger className={cn("h-8 text-xs", compact ? "w-36" : "w-full")}>
          <div className="flex items-center gap-2">
            <Layout className="h-3.5 w-3.5" />
            <SelectValue placeholder="Select View" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="component">Component View</SelectItem>
          <SelectItem value="file">File View</SelectItem>
          <SelectItem value="router">Router View</SelectItem>
          <SelectItem value="package">Package View</SelectItem>
        </SelectContent>
      </Select>
      <Button
        variant={gitComparisonEnabled ? "default" : "outline"}
        size="sm"
        className={cn("h-8 text-xs gap-2", compact ? "px-3" : "w-full")}
        onClick={() => setGitComparisonEnabled(!gitComparisonEnabled)}
      >
        <GitCompare className="h-3.5 w-3.5" />
        Git Compare
      </Button>
    </div>
  );
}
