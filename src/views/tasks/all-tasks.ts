import type { Extension } from "@nexiq/extension-sdk";

/**
 * Extensions that are built-in or loaded at startup.
 * UI extensions are now intended to be loaded dynamically from the client project
 * instead of being bundled as direct dependencies.
 */
export const allExtensions: Extension[] = [];
