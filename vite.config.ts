import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import electron from "vite-plugin-electron/simple";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { builtinModules } from "node:module";
import { devtools } from "@tanstack/devtools-vite";
import istanbul from "vite-plugin-istanbul";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === "development" && devtools(),
    process.env.VITE_COVERAGE === "true" &&
      istanbul({
        include: "src/**/*.{ts,tsx}",
        exclude: ["node_modules", "test/**/*", "e2e/**/*"],
        extension: [".ts", ".tsx"],
        requireEnv: false,
        checkProd: false,
        forceBuildInstrument: true,
      }),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          build: {
            target: "node18",
            minify: false,
            assetsInlineLimit: 0,
            rollupOptions: {
              input: {
                main: path.resolve(__dirname, "electron/main.ts"),
                "graph-snapshot.worker": path.resolve(
                  __dirname,
                  "electron/graph-snapshot.worker.ts",
                ),
                "extension-worker-wrapper": path.resolve(
                  __dirname,
                  "electron/extension-worker-wrapper.ts",
                ),
              },
              output: {
                entryFileNames: "[name].js",
              },
              external: [
                "electron",
                "better-sqlite3",
                "@parcel/watcher",
                "@node-rs/xxhash",
                "@nexiq/extension-sdk",
                "@nexiq/component-extension",
                "@nexiq/git-extension",
                "@nexiq/shared",
                "fast-glob",
                "js-yaml",
                "simple-git",
                "tmp",
                "ws",
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`),
              ],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  optimizeDeps: {
    include: ["tslib"],
    exclude: [
      "@node-rs/xxhash",
      "@nexiq/extension-sdk",
      "@nexiq/component-extension",
      "@nexiq/git-extension",
      "@nexiq/shared",
      "fast-glob",
      "js-yaml",
      "better-sqlite3",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
