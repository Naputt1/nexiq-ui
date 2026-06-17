import { type Extension, registerNodeType } from "@nexiq/extension-sdk";
import { registerDetailSection } from "./detail-sections";
import { allExtensions } from "../views/tasks/all-tasks";
import type { GraphData } from "@/graph/hook";

const extensions: Map<string, Extension<GraphData>> = new Map();

/**
 * Loads and registers an extension's UI components.
 */
export function loadExtension(extension: Extension<GraphData>) {
  if (extensions.has(extension.id)) return;
  extensions.set(extension.id, extension);

  // Register detail sections
  if (extension.detailSections) {
    for (const section of extension.detailSections) {
      registerDetailSection(section);
    }
  }

  // Register custom node types
  if (extension.nodeTypes) {
    for (const [type, appearance] of Object.entries(extension.nodeTypes)) {
      registerNodeType(type, appearance);
    }
  }
}

// Automatically load UI parts of all extensions
for (const ext of allExtensions) {
  loadExtension(ext);
}

/**
 * Expose for dynamic registration from the client or main process.
 */
window.registerNexiqExtension = loadExtension;

/**
 * Returns all loaded extensions.
 */
export function getExtensions(): Extension<GraphData>[] {
  return Array.from(extensions.values());
}
