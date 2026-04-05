import { ForceLayout, type ForceOptions } from "./layout";

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

function buildEdges(
  sources: Uint32Array,
  targets: Uint32Array,
  nodeCount: number,
  linkDistance: number,
  attractionStrength: number,
) {
  const degree = new Uint16Array(Math.max(nodeCount, 1));
  for (let i = 0; i < sources.length; i += 1) {
    degree[sources[i]] += 1;
    degree[targets[i]] += 1;
  }

  return Array.from({ length: sources.length }, (_, index) => {
    const source = sources[index];
    const target = targets[index];
    const degreeBias = Math.max(degree[source] + degree[target], 1);
    const compactness = Math.min(1.8, 1 + degreeBias * 0.08);
    return {
      id: `e-${index}`,
      source: String(source),
      target: String(target),
      distance: Math.max(24, linkDistance / compactness),
      strength: attractionStrength * compactness,
    };
  });
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

  const nodes = Array.from({ length: positions.length / 2 }, (_, index) => ({
    id: String(index),
    x: positions[index * 2] ?? 0,
    y: positions[index * 2 + 1] ?? 0,
    radius: radii[index] ?? 0,
    fixed: fixed[index] === 1,
  }));

  const opts = {
    ...options,
    repulsionStrength: (options?.repulsionStrength ?? 300) * 1.15,
    gravity: options?.gravity ?? 0.08,
    collisionStrength: options?.collisionStrength ?? 0.9,
    linkDistance: options?.linkDistance ?? 80,
    attractionStrength: options?.attractionStrength ?? 0.14,
  } satisfies ForceOptions;

  const layout = new ForceLayout(
    nodes,
    buildEdges(
      sources,
      targets,
      nodes.length,
      opts.linkDistance ?? 80,
      opts.attractionStrength ?? 0.14,
    ),
    opts,
  );

  await layout.runSteps(iterations);

  const result = layout.getPositions();
  const nextPositions = new Float32Array(result.length * 2);
  for (let i = 0; i < result.length; i += 1) {
    nextPositions[i * 2] = result[i].x;
    nextPositions[i * 2 + 1] = result[i].y;
  }

  self.postMessage({
    type: "layout-result",
    id,
    positions: nextPositions,
  } satisfies LayoutResponse);
};
