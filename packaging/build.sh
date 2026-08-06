#!/bin/bash
# Build prism-hos-debugger as a macOS Apple Silicon .app bundle.
# Requirements: Python 3.11+, npm, PyInstaller
#
# Usage:
#   cd packaging && ./build.sh
#
# Output: packaging/dist/Prism.app

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> 1/4 Building Web UI..."
cd "$ROOT_DIR/webui"
npm install
npm run build

echo "==> 2/4 Installing PyInstaller..."
pip install pyinstaller 2>/dev/null || pip3 install pyinstaller

echo "==> 3/4 Generating icon..."
ICON_DIR="$ROOT_DIR/assets"
mkdir -p "$ICON_DIR"
if [ ! -f "$ICON_DIR/prism.icns" ]; then
  # Generate a minimal icon using sips (macOS built-in)
  TMP_ICON="/tmp/prism_icon_$$.png"
  python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([(128, 128), (896, 896)], radius=160, fill=(79, 70, 229))
draw.rounded_rectangle([(352, 256), (672, 576)], radius=48, fill=(255, 255, 255, 220))
draw.rectangle([(380, 420), (644, 468)], fill=(79, 70, 229))
img.save('$TMP_ICON')
" 2>/dev/null || {
    # Fallback: solid color square
    python3 -c "
from PIL import Image
img = Image.new('RGB', (1024, 1024), (79, 70, 229))
img.save('$TMP_ICON')
" 2>/dev/null || {
      echo "Warning: PIL not available, skipping icon generation"
    }
  }
  if [ -f "$TMP_ICON" ]; then
    mkdir -p /tmp/prism_iconset
    for size in 16 32 64 128 256 512; do
      sips -z $size $size "$TMP_ICON" --out "/tmp/prism_iconset/icon_${size}x${size}.png" 2>/dev/null || true
      sips -z $((size*2)) $((size*2)) "$TMP_ICON" --out "/tmp/prism_iconset/icon_${size}x${size}@2x.png" 2>/dev/null || true
    done
    iconutil -c icns /tmp/prism_iconset -o "$ICON_DIR/prism.icns" 2>/dev/null || true
    rm -rf /tmp/prism_iconset "$TMP_ICON"
  fi
fi

echo "==> 4/4 Building .app bundle..."
cd "$ROOT_DIR"
python3 -m PyInstaller \
  --distpath "$SCRIPT_DIR/dist" \
  --workpath "$SCRIPT_DIR/build" \
  --clean \
  --noconfirm \
  "$SCRIPT_DIR/prism.spec"

echo ""
echo "Done! Output: $SCRIPT_DIR/dist/Prism.app"
echo "Run: open $SCRIPT_DIR/dist"
echo ""
echo "The app starts without a terminal window. To see logs, launch from Terminal:"
echo "  $SCRIPT_DIR/dist/Prism.app/Contents/MacOS/prism"