#!/bin/bash
# prism-hos-debugger — development desktop app
# Starts Tauri with tray icon and embedded Web UI.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT/desktop-tauri"
echo "Starting prism (Tauri dev mode)..."
npm run dev
