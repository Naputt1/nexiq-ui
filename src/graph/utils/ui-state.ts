import { type GraphData } from "../hook";
import { type UIStateMap } from "../types";

/**
 * Generates a deterministic position based on a string ID.
 * Useful for consistent initial layout.
 */
export function getDeterministicPosition(
  id: string,
  range = 100,
): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  const x = ((hash & 0xffff) / 0xffff - 0.5) * range;
  const y = (((hash >> 16) & 0xffff) / 0xffff - 0.5) * range;
  return { x, y };
}

/**
 * Extracts all relevant UI state (positions, radii, layout status) from the graph.
 * This includes nodes and combos at all levels.
 */
export function extractUIState(graph: GraphData): UIStateMap {
  const state: UIStateMap = {};

  // Extract from all nodes
  graph.getAllNodes().forEach((n) => {
    state[n.id] = {
      x: n.x,
      y: n.y,
      radius: n.radius,
      isLayoutCalculated: n.isLayoutCalculated,
    };
  });

  // Extract from all combos
  graph.getAllCombos().forEach((c) => {
    state[c.id] = {
      x: c.x,
      y: c.y,
      radius: c.radius,
      collapsedRadius: c.collapsedRadius,
      // For combos, expandedRadius represents the full calculated size including children
      expandedRadius: c.expandedRadius,
      isLayoutCalculated: c.isLayoutCalculated,
      collapsed: c.collapsed,
    };
  });

  return state;
}
