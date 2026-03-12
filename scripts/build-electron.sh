#!/bin/bash
set -e

# Ensure we are in the repo root directory
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "Cleaning up output directory..."
rm -rf "$REPO_ROOT/out-build"
mkdir -p "$REPO_ROOT/out-build"

echo "Building UI renderer and main..."
pnpm build:vite

echo "Deploying production dependencies to out-build..."
# If this is a standalone repo, we might just need pnpm install --prod in a copy
# But if it's still using workspace:* during dev, deploy --legacy is better.
# For a standalone repo, we can use:
# cp -r . out-build/ && cd out-build && pnpm install --prod
# However, pnpm deploy works for standalone packages too if there is a lockfile.

pnpm deploy --legacy "$REPO_ROOT/out-build"

echo "Copying build artifacts and config..."
cp -r "$REPO_ROOT/dist" "$REPO_ROOT/out-build/"
cp -r "$REPO_ROOT/dist-electron" "$REPO_ROOT/out-build/"
cp "$REPO_ROOT/electron-builder.json5" "$REPO_ROOT/out-build/"
cp "$REPO_ROOT/package.json" "$REPO_ROOT/out-build/package.json"

echo "Running electron-builder..."
cd "$REPO_ROOT/out-build"

# Use the electron-builder binary. 
# It should be in the root node_modules of the new repo.
"$REPO_ROOT/node_modules/.bin/electron-builder" "$@"
