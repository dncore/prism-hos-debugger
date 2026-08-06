#!/bin/bash
# prism-hos-debugger — project setup
# Installs all dependencies and prepares for development.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> 1/4 Installing Python dependencies..."
cd "$ROOT"
pip install -e ".[dev]" --only-binary=:all: 2>/dev/null || pip install -e ".[dev]"

echo "==> 2/4 Installing Web UI dependencies..."
cd "$ROOT/webui"
npm install

echo "==> 3/4 Building Web UI..."
npm run build

echo "==> 4/4 Installing Electron dependencies..."
cd "$ROOT/desktop"
npm install

echo ""
echo "Setup complete. Start with:"
echo "  CLI mode:    scripts/dev.sh"
echo "  Electron:    scripts/dev-electron.sh"
echo ""
echo "Read the docs: scripts/README.md"
