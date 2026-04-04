import { create } from "zustand";

interface ViewportUiState {
  zoom: number;
  zoomRange: { min: number; max: number };
  setZoom: (zoom: number) => void;
  setZoomRange: (zoomRange: { min: number; max: number }) => void;
}

export const useViewportUiStore = create<ViewportUiState>((set) => ({
  zoom: 1,
  zoomRange: { min: 0.1, max: 5 },
  setZoom: (zoom) => set({ zoom }),
  setZoomRange: (zoomRange) => set({ zoomRange }),
}));
