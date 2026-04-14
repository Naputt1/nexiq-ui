import init, { ForceLayout } from "@nexiq/layout-wasm";
import type { ForceOptions } from "./layout";

export type LayoutRequest = {
  type: "layout";
  id: string;
  nodeIds: string[];
  positions: Float32Array;
  radii: Float32Array;
  fixed: Uint8Array;
  sources: Uint32Array;
  targets: Uint32Array;
  options?: ForceOptions;
  iterations?: number;
};

export type LayoutResponse = {
  type: "layout-result";
  id: string;
  positions: Float32Array;
};

let wasmPromise: Promise<any> | null = null;

async function ensureWasm() {
  if (!wasmPromise) {
    wasmPromise = init();
  }
  return wasmPromise;
}

self.onmessage = async (e: MessageEvent<LayoutRequest>) => {
  const {
    type,
    id,
    positions,
    radii,
    fixed,
    sources,
    targets,
    options,
    iterations = 1000,
  } = e.data;

  if (type !== "layout") return;

  await ensureWasm();

  const opts = {
    ...options,
    repulsionStrength: (options?.repulsionStrength ?? 300) * 1.15,
    gravity: options?.gravity ?? 0.08,
    collisionStrength: options?.collisionStrength ?? 0.9,
    linkDistance: options?.linkDistance ?? 80,
    attractionStrength: options?.attractionStrength ?? 0.14,
    alpha: options?.alpha ?? 1.0,
    alphaDecay: options?.alphaDecay ?? 0.02,
    theta: options?.theta ?? 0.5,
    damping: options?.damping ?? 0.9,
    timeStep: options?.timeStep ?? 0.016,
    maxDisplacement: options?.maxDisplacement ?? 100,
    minNodeDistance: options?.minNodeDistance ?? 0,
    nodeRadius: options?.nodeRadius ?? 0,
  } satisfies Partial<ForceOptions>;

  const layout = new ForceLayout(
    positions,
    radii,
    fixed,
    sources,
    targets,
    opts,
  );

  layout.run_steps(iterations);

  const nextPositions = new Float32Array(positions.length);
  layout.get_positions(nextPositions);

  self.postMessage({
    type: "layout-result",
    id,
    positions: nextPositions,
  } satisfies LayoutResponse);
};
