#!/usr/bin/env bash
# Rebuild the app icon (icon.png master + icon.icns) from build/icon.svg.
# Requires: rsvg-convert + iconutil (macOS). Run via `pnpm run icon`.
set -euo pipefail
cd "$(dirname "$0")"

SVG=icon.svg
ICONSET=icon.iconset

command -v rsvg-convert >/dev/null || { echo "need rsvg-convert (brew install librsvg)"; exit 1; }
command -v iconutil >/dev/null    || { echo "need iconutil (macOS only)"; exit 1; }

rm -rf "$ICONSET"; mkdir -p "$ICONSET"

# 1024px master — also used for the dev dock icon (app.dock.setIcon in main).
rsvg-convert -w 1024 -h 1024 "$SVG" -o icon.png

for s in 16 32 64 128 256 512 1024; do
  rsvg-convert -w "$s" -h "$s" "$SVG" -o "$ICONSET/icon_${s}x${s}.png"
done

# @2x retina variants per Apple's iconset naming spec
cp "$ICONSET/icon_32x32.png"     "$ICONSET/icon_16x16@2x.png"
cp "$ICONSET/icon_64x64.png"     "$ICONSET/icon_32x32@2x.png"
cp "$ICONSET/icon_256x256.png"   "$ICONSET/icon_128x128@2x.png"
cp "$ICONSET/icon_512x512.png"   "$ICONSET/icon_256x256@2x.png"
cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
# the bare 64 and 1024 aren't part of the iconset spec
rm "$ICONSET/icon_64x64.png" "$ICONSET/icon_1024x1024.png"

iconutil -c icns "$ICONSET" -o icon.icns
rm -rf "$ICONSET"

echo "built build/icon.icns + build/icon.png from build/icon.svg"
