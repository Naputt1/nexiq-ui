import { type Extension, registerNodeType } from "@nexiq/extension-sdk";
import { registerDetailSection } from "./detail-sections";
import type { GraphData } from "@/graph/hook";
import type { NodeAppearance } from "@nexiq/extension-sdk";

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

/**
 * Initialize/renderer extension state with data from the main process.
 * Called at app startup and when projects are opened, to sync dynamically
 * discovered extension data (e.g. custom node types) into the renderer's
 * extension SDK registry.
 */
export async function initRendererExtensions() {
  try {
    const nodeTypes = await window.extensionRegistry.getNodeTypes();
    for (const [type, appearance] of Object.entries(nodeTypes)) {
      registerNodeType(type, appearance as NodeAppearance);
    }
  } catch (err) {
    console.error("Failed to initialize renderer extensions:", err);
  }
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
