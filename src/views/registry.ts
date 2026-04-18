import { type GraphViewType } from "../../electron/types";
import { type GraphViewTask } from "./types";
import { fileTask, packageTask } from "@nexiq/file-extension";
import { allExtensions } from "./tasks/all-tasks";
import { componentRustTask } from "@nexiq/component-extension";
import { gitTask } from "@nexiq/git-extension";

const registry: Record<string, GraphViewTask[]> = {
  component: [componentRustTask, gitTask],
  file: [componentRustTask, fileTask, gitTask],
  router: [gitTask], // Default to gitTask for router too
  package: [packageTask, gitTask],
};

// Automatically register tasks from all extensions
for (const extension of allExtensions) {
  if (extension.viewTasks) {
    for (const [view, tasks] of Object.entries(extension.viewTasks)) {
      for (const task of tasks) {
        const viewType = view as GraphViewType;
        if (!registry[viewType]) {
          registry[viewType] = [];
        }
        // Check if task already registered
        if (!registry[viewType].some((t) => t.id === task.id)) {
          registry[viewType].push(task);
        }
      }
    }
  }
}

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
