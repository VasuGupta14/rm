#!/usr/bin/env bash
# macOS / Linux launcher for Adaptive Irrigation Twin
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

export IRRIGATION_APP_PORT="${IRRIGATION_APP_PORT:-8768}"

echo "=========================================================="
echo " Starting Adaptive Irrigation Twin on macOS"
echo " Local URL: http://127.0.0.1:${IRRIGATION_APP_PORT}/index.html"
echo "=========================================================="

# Check for Python 3
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "Error: Python 3 was not found on your system."
    exit 1
fi

"$PYTHON_CMD" local_server.py

