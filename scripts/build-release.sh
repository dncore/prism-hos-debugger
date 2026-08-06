#!/bin/bash
# prism-hos-debugger — release build
# Produces a standalone macOS .dmg with embedded backend.
# Output: desktop-tauri/src-tauri/target/release/bundle/macos/Prism*.dmg
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

VERSION="${1:-$(git -C "$ROOT" describe --tags --always 2>/dev/null || echo 'dev')}"
echo "Building prism v${VERSION}..."

# ── 1. Build Web UI ──────────────────────────────────────────
echo "==> 1/4 Building Web UI..."
cd "$ROOT/webui"
npm run build

# ── 2. Build Python backend as standalone binary ─────────────
echo "==> 2/4 Building Python backend (PyInstaller)..."
cd "$ROOT/packaging"
bash build.sh

# ── 3. Copy backend binary into Tauri resources ──────────────
echo "==> 3/4 Preparing Tauri resources..."
mkdir -p "$ROOT/desktop-tauri/src-tauri/binaries"
cp "$ROOT/packaging/dist/prism" "$ROOT/desktop-tauri/src-tauri/binaries/prism"

# ── 4. Build Tauri .dmg ──────────────────────────────────────
echo "==> 4/4 Building Tauri app..."
cd "$ROOT/desktop-tauri"
npm run build

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "Release artifacts:"
find "$ROOT/desktop-tauri/src-tauri/target/release/bundle" -name "*.dmg" -exec ls -lh {} \; 2>/dev/null || echo "(check target/release/bundle/)"
echo ""
echo "Upload the .dmg to GitHub Releases."
