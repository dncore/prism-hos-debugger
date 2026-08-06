#!/bin/bash
# prism-hos-debugger — development server (CLI mode)
# Starts prism backend and opens browser to Web UI.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT"
echo "Starting prism (CLI mode) — http://localhost:8900"
prism start
