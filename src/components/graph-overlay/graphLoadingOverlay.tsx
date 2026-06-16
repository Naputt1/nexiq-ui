import { useAppStateStore } from "@/hooks/use-app-state-store";
import { Loader2 } from "lucide-react";

type GraphLoadingOverlayProps = { isPending: boolean };

const GraphLoadingOverlay: React.FC<GraphLoadingOverlayProps> = ({
  isPending,
}) => {
  const isGeneratingView = useAppStateStore((s) => s.isGeneratingView);

  if (!isGeneratingView && !isPending) return undefined;

  return (
    <div className="absolute inset-0 z-10 bg-background/50 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <span className="text-sm font-medium text-muted-foreground animate-pulse">
        Generating graph view...
      </span>
    </div>
  );
};

export default GraphLoadingOverlay;
