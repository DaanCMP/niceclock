#!/bin/bash
# Start niceclock container and open both display windows.
# Run once after reboot, or add to Login Items on the Mac.
#
# Usage:
#   ./scripts/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Starting niceclock container..."
docker compose up -d --build

echo "Waiting for server..."
for i in {1..30}; do
  if curl -sf http://localhost:8080/api/time >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

"$SCRIPT_DIR/launch-displays.sh"
