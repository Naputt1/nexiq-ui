import { create } from "zustand";
import type { GraphAppearance } from "../../electron/types";
import { normalizeGraphAppearance } from "@nexiq/extension-sdk";

interface ConfigState {
  theme: "dark" | "light";
  appearance: GraphAppearance;
  customColors: GraphAppearance;
  setTheme: (theme: "dark" | "light") => void;
  setAppearance: (appearance: GraphAppearance) => void;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  theme: "dark",
  appearance: normalizeGraphAppearance(),
  customColors: normalizeGraphAppearance(),
  setTheme: (theme) => set({ theme }),
  setAppearance: (appearance) =>
    set((() => {
      const normalized = normalizeGraphAppearance(appearance);
      return { appearance: normalized, customColors: normalized };
    })()),
  fetchConfig: async () => {
    const config = await window.ipcRenderer.invoke("get-global-config");
    if (config) {
      const appearance = normalizeGraphAppearance(config.appearance);
      set({
        theme: config.theme,
        appearance,
        customColors: appearance,
      });
      if (config.theme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  },
}));
