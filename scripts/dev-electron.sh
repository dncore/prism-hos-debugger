#!/bin/bash
# prism-hos-debugger — development Electron app
# Starts Electron with tray icon and embedded Web UI.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT/desktop"
echo "Starting prism (Electron mode)..."
npm start
