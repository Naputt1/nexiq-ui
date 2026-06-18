import { type GraphViewType } from "../../electron/types";
import { type GraphViewTask } from "./types";

const registry: Record<string, GraphViewTask[]> = {};

/**
 * Returns a prioritized list of tasks for a given view type.
 */
export function getTasksForView(view: GraphViewType): GraphViewTask[] {
  const tasks = registry[view] || [];
  return [...tasks].sort((a, b) => a.priority - b.priority);
}

/**
 * Allows extensions or other modules to register new tasks dynamically.
 */
export function registerTask(
  view: GraphViewType,
  task: GraphViewTask,
  extensionPath?: string,
) {
  if (!registry[view]) {
    registry[view] = [];
  }
  // Check if task already registered
  if (registry[view].some((t) => t.id === task.id)) return;

  if (extensionPath) {
    task.extensionPath = extensionPath;
  }
  registry[view].push(task);
}

/**
 * Returns the entire registry for debugging.
 */
export function getRegistry() {
  return registry;
}

export function serializeRegistry() {
  const serializedRegistry: Record<string, { id: string; priority: number }[]> =
    {};

  for (const [view, tasks] of Object.entries(registry)) {
    serializedRegistry[view] = tasks.map((task) => ({
      id: task.id,
      priority: task.priority,
    }));
  }

  return {
    registry: serializedRegistry,
  };
}
