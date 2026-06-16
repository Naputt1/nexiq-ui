import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { HashRouter } from "react-router-dom";

const root = createRoot(document.getElementById("root")!);

const init = async () => {
  if (import.meta.env.DEV) {
    const { scan } = await import("react-scan");
    scan({
      enabled: true,
    });

    const { TanStackDevtools } = await import("@tanstack/react-devtools");
    const { hotkeysDevtoolsPlugin } =
      await import("@tanstack/react-hotkeys-devtools");
    const {
      AppStatePluginComponent,
      GraphProfilerPluginComponent,
      GraphStatePluginComponent,
      WorkerStatePluginComponent,
    } = await import("./devtools");

    root.render(
      <StrictMode>
        <HashRouter>
          <App />
          <TanStackDevtools
            plugins={[
              {
                name: "App State",
                render: <AppStatePluginComponent />,
              },
              {
                name: "Graph State",
                render: <GraphStatePluginComponent />,
              },
              {
                name: "Graph Profiler",
                render: <GraphProfilerPluginComponent />,
              },
              {
                name: "Worker Registry",
                render: <WorkerStatePluginComponent />,
              },
              hotkeysDevtoolsPlugin(),
            ]}
          />
        </HashRouter>
      </StrictMode>,
    );
  } else {
    root.render(
      <StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </StrictMode>,
    );
  }
};

init();

// Use contextBridge
if (window.ipcRenderer) {
  window.ipcRenderer.on("main-process-message", (message: string) => {
    console.log(message);
  });
}
