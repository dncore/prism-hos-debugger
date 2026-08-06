#!/bin/bash
# prism-hos-debugger — release build
# Produces a standalone macOS .dmg with embedded backend.
# Output: desktop/dist/Prism-*.dmg
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

# ── 3. Copy backend binary into Electron resources ───────────
echo "==> 3/4 Preparing Electron resources..."
mkdir -p "$ROOT/desktop/resources/prism-backend"
cp "$ROOT/packaging/dist/prism" "$ROOT/desktop/resources/prism-backend/prism"

# ── 4. Build Electron .dmg ────────────────────────────────────
echo "==> 4/4 Building Electron app..."
cd "$ROOT/desktop"
npx electron-builder --mac

# ── Done ──────────────────────────────────────────────────────
echo ""
echo "Release artifacts:"
ls -lh "$ROOT/desktop/dist/"*.dmg "$ROOT/desktop/dist/"*.zip 2>/dev/null || echo "(check desktop/dist/)"
echo ""
echo "Upload the .dmg to GitHub Releases."
