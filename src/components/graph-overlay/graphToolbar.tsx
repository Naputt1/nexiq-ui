import { AlertTriangle, Search } from "lucide-react";
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

  const handleOpenErrors = useCallback(() => {
    setBottomPanelTab("errors");
    setBottomPanelOpen(true);
  }, [setBottomPanelOpen, setBottomPanelTab]);

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
      <Button variant="ghost" size="sm" onClick={toggleBottomPanel}>
        Source
      </Button>
      {totalErrorCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={handleOpenErrors}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          {totalErrorCount} issues
        </Button>
      )}
    </Card>
  );
};

export default GraphToolbar;
