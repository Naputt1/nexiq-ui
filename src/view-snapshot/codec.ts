import type { GraphViewResult } from "../views/types";

export function encodeGraphViewSnapshot(result: GraphViewResult): Uint8Array {
  // Skipping recursive validation for performance as it blocks the main thread
  return new TextEncoder().encode(JSON.stringify(result));
}

export function decodeGraphViewSnapshot(data: Uint8Array): GraphViewResult {
  return JSON.parse(new TextDecoder().decode(data)) as GraphViewResult;
}
