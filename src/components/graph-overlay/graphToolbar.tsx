import { AlertTriangle, Lock, Search, Unlock } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ViewSwitcher } from "./ViewSwitcher";
import { useAppStateStore } from "@/hooks/use-app-state-store";
import { useCallback } from "react";
import { useGraphStore } from "@/hooks/use-graph-store";

const GraphToolbar = () => {
  const isBottomPanelOpen = useAppStateStore((s) => s.sidebar.bottom.isOpen);
  const setBottomPanelTab = useAppStateStore((s) => s.setBottomPanelTab);
  const setBottomPanelOpen = useAppStateStore((s) => s.setBottomPanelOpen);
  const setIsSearchOpen = useAppStateStore((s) => s.setIsSearchOpen);

  const totalErrorCount = useGraphStore((s) => s.totalErrorCount);
  const locked = useGraphStore((s) => s.locked);
  const setLocked = useGraphStore((s) => s.setLocked);

  const toggleBottomPanel = useCallback(() => {
    setBottomPanelTab("source");
    setBottomPanelOpen(!isBottomPanelOpen);
  }, [isBottomPanelOpen, setBottomPanelOpen, setBottomPanelTab]);

  return (
    <Card className="absolute bottom-4 right-4 z-20 flex flex-row items-center gap-2 p-2 shadow-lg">
      <ViewSwitcher compact />
      <Button variant="ghost" size="sm" onClick={() => setIsSearchOpen(true)}>
        <Search className="h-4 w-4" />
        Search
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocked(!locked)}
        title={locked ? "Unlock nodes" : "Lock nodes"}
      >
        {locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
      </Button>
      <Button
        variant={totalErrorCount > 0 ? "outline" : "ghost"}
        size="sm"
        className="gap-2"
        onClick={toggleBottomPanel}
      >
        Source
        {totalErrorCount > 0 && (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            {totalErrorCount}
          </>
        )}
      </Button>
    </Card>
  );
};

export default GraphToolbar;
