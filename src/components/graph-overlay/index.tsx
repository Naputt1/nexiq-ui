import { useCallback } from "react";
import { SidebarTrigger } from "../ui/sidebar";
import { cn } from "@/lib/utils";
import GraphCommand from "./graphCommand";
import ViewportZoomSlider from "./graphZoomSlider";
import type { PixiRenderer } from "@/graph/pixiRenderer";
import GraphSearch from "./graphSearch";
import GraphToolbar from "./graphToolbar";
import GraphLoadingOverlay from "./graphLoadingOverlay";

type GraphOverlayProps = {
  setSize: (size: { width: number; height: number }) => void;
  handleReloadProject: () => void;
  rendererRef: React.RefObject<PixiRenderer | null>;
  isPending: boolean;
  children: React.ReactNode;
};

const GraphOverlay: React.FC<GraphOverlayProps> = ({
  setSize,
  handleReloadProject,
  rendererRef,
  isPending,
  children,
}) => {
  const handleZoomChange = useCallback(
    (zoom: number) => {
      rendererRef.current?.setZoom(zoom);
    },
    [rendererRef],
  );

  return (
    <div className="flex-1 relative min-w-0 h-full">
      <SidebarTrigger className={cn("absolute top-4 left-4 z-120")} />
      <GraphToolbar />
      <GraphSearch rendererRef={rendererRef} />
      <GraphCommand
        children={children}
        setSize={setSize}
        handleReloadProject={handleReloadProject}
        rendererRef={rendererRef}
      />
      <GraphLoadingOverlay isPending={isPending} />
      <ViewportZoomSlider onChange={handleZoomChange} />
    </div>
  );
};

export default GraphOverlay;
