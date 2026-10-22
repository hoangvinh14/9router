#!/usr/bin/env bash

set -euo pipefail

REPO=/home/gmo/projects/9router
CHECK=/tmp/9router-phase3-check-261022
DEPS=/tmp/9router-phase3-deps-261022
BUILD=/tmp/9router-phase3-build-261022

test -d "$REPO"
rm -rf "$CHECK" "$DEPS" "$BUILD"
mkdir -p "$CHECK" "$DEPS" "$BUILD"

echo "[1/4] Checking external access..."
curl -fsSL --retry 3 --connect-timeout 10 --max-time 30 \
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap' \
  -o "$CHECK/inter.css"

grep -oE 'https://fonts.gstatic.com/[^)]+' "$CHECK/inter.css" |
  sort -u |
  while read -r url; do
    curl -fsSL --retry 3 --connect-timeout 10 --max-time 30 \
      "$url" -o /dev/null
  done

curl -fsSI --connect-timeout 10 --max-time 30 \
  https://registry.npmjs.org/next

echo "[2/4] Installing dependencies in disposable staging..."
cp "$REPO/package.json" "$DEPS/package.json"

npm install \
  --prefix "$DEPS" \
  --ignore-scripts \
  --include=optional \
  --no-audit \
  --no-fund \
  --registry=https://registry.npmjs.org/

echo "[3/4] Preparing disposable source tree..."
rsync -a \
  --exclude='.*' \
  --exclude='node_modules' \
  --exclude='plans' \
  --exclude='tmp' \
  "$REPO"/ "$BUILD"/

ln -s "$DEPS/node_modules" "$BUILD/node_modules"

echo "[4/4] Building..."
cd "$BUILD"

NEXT_DIST_DIR=phase3-dist-261022 \
NEXT_TELEMETRY_DISABLED=1 \
NEXT_PHASE=phase-production-build \
MODEL_CATALOG_SYNC=off \
DISABLE_BACKGROUND_TOKEN_REFRESH=true \
NODE_ENV=production \
DATA_DIR="$BUILD/data" \
NODE_OPTIONS=--max-old-space-size=6144 \
timeout --signal=TERM --kill-after=30s 900s \
npm run build 2>&1 | tee build.log

test -f "$BUILD/phase3-dist-261022/BUILD_ID"
test -f "$BUILD/phase3-dist-261022/standalone/server.js"
test -f "$BUILD/phase3-dist-261022/standalone/custom-server.js"

echo
echo "BUILD PASS"
echo "Artifact: $BUILD/phase3-dist-261022/standalone"
