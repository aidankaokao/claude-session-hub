#!/usr/bin/env bash
# Regenerates docs/screenshots/*.png from fictional demo sessions (never your real ones).
# Needs Google Chrome; network access for Three.js from jsDelivr.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
HUB_PORT=4396
CDP_PORT=9333
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

pids=()
cleanup() {
  for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done
  # placeholder `sleep` processes standing in for Claude Code sessions
  for f in "$WORK"/config/sessions/*.json; do kill "$(basename "$f" .json)" 2>/dev/null || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

info=$(node "$ROOT/scripts/demo/setup.mjs" "$WORK/config")
waiting_sid=$(printf '%s' "$info" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).find(x=>x.waiting).id))')

CLAUDE_CONFIG_DIR="$WORK/config" CLAUDE_HUB_PORT=$HUB_PORT CLAUDE_HUB_NOTIFY=0 node "$ROOT/server/index.mjs" >"$WORK/hub.log" 2>&1 &
pids+=($!)
"$CHROME" --headless=new --remote-debugging-port=$CDP_PORT --user-data-dir="$WORK/chrome" --no-first-run \
  --use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars about:blank >"$WORK/chrome.log" 2>&1 &
pids+=($!)
sleep 3

mkdir -p "$ROOT/docs/screenshots"
HERO="${HERO:--200,-85,-30}" node "$ROOT/scripts/demo/shoot.mjs" $CDP_PORT $HUB_PORT "$ROOT/docs/screenshots" "$waiting_sid"
