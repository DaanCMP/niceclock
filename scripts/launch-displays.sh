#!/bin/bash
# Opens niceclock fullscreen on two displays (macOS + Google Chrome).
# Adjust DISPLAY_* geometry to match your monitor layout and resolution.
#
# Usage (after docker compose up -d):
#   ./scripts/launch-displays.sh
#
# One-time setup:
#   chmod +x scripts/launch-displays.sh

set -euo pipefail

BASE_URL="${NICE_CLOCK_URL:-http://localhost:8080}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at $CHROME"
  echo "Install Chrome or set CHROME to your browser path."
  exit 1
fi

# Left display — default 1920x1080 at origin
LEFT_X="${DISPLAY_1_X:-0}"
LEFT_Y="${DISPLAY_1_Y:-0}"
LEFT_W="${DISPLAY_1_WIDTH:-1920}"
LEFT_H="${DISPLAY_1_HEIGHT:-1080}"

# Right display — default second 1920x1080 monitor to the right
RIGHT_X="${DISPLAY_2_X:-1920}"
RIGHT_Y="${DISPLAY_2_Y:-0}"
RIGHT_W="${DISPLAY_2_WIDTH:-1920}"
RIGHT_H="${DISPLAY_2_HEIGHT:-1080}"

launch() {
  local url="$1"
  local x="$2"
  local y="$3"
  local w="$4"
  local h="$5"

  "$CHROME" \
    --app="$url" \
    --window-position="$x,$y" \
    --window-size="$w,$h" \
    --no-first-run \
    --disable-infobars \
    --disable-session-crashed-bubble \
    >/dev/null 2>&1 &
}

echo "Launching display 1: ${BASE_URL}/?display=1"
launch "${BASE_URL}/?display=1" "$LEFT_X" "$LEFT_Y" "$LEFT_W" "$LEFT_H"

sleep 1

echo "Launching display 2: ${BASE_URL}/?display=2"
launch "${BASE_URL}/?display=2" "$RIGHT_X" "$RIGHT_Y" "$RIGHT_W" "$RIGHT_H"

echo "Done. Press Cmd+Q in each Chrome window to quit."
