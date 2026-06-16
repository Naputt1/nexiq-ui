import { useViewportUiStore } from "@/hooks/use-viewport-ui-store";
import { ZoomSlider } from "../ZoomSlider";

function ViewportZoomSlider({
  onChange,
}: {
  onChange: (zoom: number) => void;
}) {
  const zoom = useViewportUiStore((s) => s.zoom);
  const zoomRange = useViewportUiStore((s) => s.zoomRange);

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20">
      <ZoomSlider
        value={zoom}
        min={zoomRange.min}
        max={zoomRange.max}
        onChange={onChange}
      />
    </div>
  );
}

export default ViewportZoomSlider;
