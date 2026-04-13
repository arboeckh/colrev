#!/usr/bin/env bash
# Launch two Electron instances with separate user data directories.
# Usage:  ./dev-duo.sh        (start both)
#         ./dev-duo.sh stop   (kill both)

PIDS_FILE="/tmp/colrev-duo-pids"

stop() {
  if [[ -f "$PIDS_FILE" ]]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null && echo "Killed PID $pid"
    done < "$PIDS_FILE"
    rm "$PIDS_FILE"
  else
    echo "No running instances found."
  fi
}

if [[ "${1:-}" == "stop" ]]; then
  stop
  exit 0
fi

# Kill any previous run first
stop 2>/dev/null

cd "$(dirname "$0")" || exit 1

echo "Starting Alice..."
COLREV_USER=alice npm run dev &
echo $! >> "$PIDS_FILE"

echo "Starting Bob..."
COLREV_USER=bob npm run dev &
echo $! >> "$PIDS_FILE"

echo ""
echo "Both instances launched."
echo "  Stop with:  ./dev-duo.sh stop"
echo "  Or press Ctrl-C here."

# If user hits Ctrl-C, clean up both
trap stop EXIT
wait
