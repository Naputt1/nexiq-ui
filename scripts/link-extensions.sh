#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
UI_ROOT="$( dirname "$SCRIPT_DIR" )"
MONOREPO_PATH="$UI_ROOT/../nexiq"

echo "=== Linking Extensions to UI Project ==="
cd "$UI_ROOT"

if [ ! -d "$MONOREPO_PATH" ]; then
    echo "Error: Monorepo folder not found at $MONOREPO_PATH"
    echo "Please ensure the 'nexiq' repository is a sibling of 'nexiq-ui'."
    exit 1
fi

# Install standard dependencies first
echo "Installing UI dependencies..."
pnpm install

echo "Linking local packages..."
pnpm link "$MONOREPO_PATH/packages/shared"
pnpm link "$MONOREPO_PATH/packages/extension-sdk"
pnpm link "$MONOREPO_PATH/packages/component-extension"
pnpm link "$MONOREPO_PATH/packages/file-extension"

echo ""
echo "=== Linking Complete! ==="
echo "Local extensions have been linked to node_modules."
