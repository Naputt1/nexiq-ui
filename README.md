# nexiq-ui

`nexiq-ui` is the desktop app for exploring React component graphs, project structure, snapshots, and git-aware analysis views powered by nexiq.

## Key Features

- Guided project setup flow for opening and configuring a codebase to analyse.
- Interactive graph exploration for component relationships and dependency paths.
- Snapshot and view generation support for storing and revisiting analysis output.
- Git-focused panels for history, change trees, and diff-driven inspection.
- Project and global settings screens for tuning how analysis runs locally.
- Extension-backed views that can surface custom detail panels and tasks.

## How It Fits With `nexiq`

`nexiq-ui` is the desktop frontend for the `nexiq` monorepo.

- The Electron main process starts or connects to the backend server from the sibling `nexiq` repository.
- The renderer loads shared contracts and the extension SDK outputs from `../nexiq/packages/...`.
- The backend communicates with the app over WebSocket while the UI handles project selection, graph rendering, and local state.

In practice, local UI development expects the `nexiq` repo to be checked out as a sibling directory and its required packages to be built.

## Quick Start

### Requirements

- Node.js
- `pnpm`
- A sibling checkout of `nexiq` at `../nexiq`

### Install

```bash
cd nexiq-ui
pnpm install
```

### Prepare The Backend Dependencies

Because this app resolves local package outputs from the sibling `nexiq` repository, build the backend packages before running the UI:

```bash
cd ../nexiq
pnpm install
pnpm --filter=@nexiq/shared build
pnpm --filter=@nexiq/extension-sdk build
pnpm --filter=@nexiq/cli build
```

### Run The App

```bash
cd ../nexiq-ui
pnpm dev
```

## Main Scripts

- `pnpm dev` starts the Vite and Electron development workflow.
- `pnpm build` builds the renderer and Electron bundles, then packages the app with `electron-builder`.
- `pnpm build:vite` builds the renderer and Electron entrypoints without packaging.
- `pnpm preview` previews the built Vite app.
- `pnpm typecheck` runs the TypeScript build checks.
- `pnpm lint` runs ESLint.
- `pnpm test` runs the Vitest suite.
- `pnpm test:e2e` runs the Playwright end-to-end suite.
- `pnpm test:coverage` builds with coverage instrumentation, runs e2e coverage, and merges results.

## Architecture

- Electron main process manages windows, local persistence, snapshot databases, and backend process coordination.
- React renderer provides the graph UI, settings pages, setup flow, and extension-driven panels.
- The backend server from `nexiq` provides project analysis and runtime data over WebSocket.

This split keeps analysis logic in the core monorepo while the desktop app focuses on visual exploration and workflow.

## Development Notes

- The app depends on local file-based packages from the sibling `nexiq` repo, including `@nexiq/shared` and `@nexiq/extension-sdk`.
- If the backend server bundle is not found automatically, the app supports pointing at a built server via `REACT_MAP_SERVER_PATH`.
- Production packaging uses the repository's `build-electron.sh` script and `electron-builder`.
- The renderer stack is Vite, React, Tailwind, and Electron, with Vitest for unit tests and Playwright for e2e coverage.
