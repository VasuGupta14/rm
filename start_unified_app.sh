#!/usr/bin/env bash
# ==============================================================================
# AgriTwin – Universal Linux / macOS Launcher
# Works across Ubuntu, Debian, Fedora, Arch, Alpine, and macOS
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Resolve backend and frontend folders (supports both standard names and symlinks)
if [ -d "$SCRIPT_DIR/Adaptive Irrigation Twin" ]; then
    BACKEND_DIR="$SCRIPT_DIR/Adaptive Irrigation Twin"
else
    BACKEND_DIR="$SCRIPT_DIR/agritwin-backend"
fi

if [ -d "$SCRIPT_DIR/AgriTwin – Smart Irrigation" ]; then
    FRONTEND_DIR="$SCRIPT_DIR/AgriTwin – Smart Irrigation"
else
    FRONTEND_DIR="$SCRIPT_DIR/agritwin-frontend"
fi

echo "=========================================================="
echo " Starting AgriTwin – Unified Smart Irrigation Twin"
echo " Platform: $(uname -s) ($(uname -m))"
echo " Backend:  http://127.0.0.1:8768"
echo " Frontend: http://localhost:8443"
echo "=========================================================="

# 1. Detect Python 3
if command -v python3 >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
else
    echo "Error: Python 3 was not found. Please install python3 (e.g., sudo apt install python3)."
    exit 1
fi

# 2. Detect Node.js and Package Manager
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js was not found. Please install Node.js (v18+) to run the frontend."
    exit 1
fi

if command -v npm >/dev/null 2>&1; then
    PKG_CMD="npm"
elif command -v pnpm >/dev/null 2>&1; then
    PKG_CMD="pnpm"
elif command -v yarn >/dev/null 2>&1; then
    PKG_CMD="yarn"
else
    echo "Error: No package manager (npm, pnpm, yarn) found."
    exit 1
fi

# 3. Check and install frontend dependencies if missing
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "[!] node_modules not found. Installing frontend dependencies with $PKG_CMD..."
    (cd "$FRONTEND_DIR" && $PKG_CMD install)
fi

# 4. Start Python Simulation Backend
echo "[1/2] Starting Python simulation & calibration engine on port 8768..."
cd "$BACKEND_DIR"
"$PYTHON_CMD" local_server.py &
BACKEND_PID=$!

# Trap signals for clean shutdown of both processes
cleanup() {
    echo ""
    echo "Stopping AgriTwin services..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Allow backend port to bind
sleep 2

# 5. Start React + Vite Frontend Dev Server
echo "[2/2] Starting AgriTwin Frontend on port 8443..."
cd "$FRONTEND_DIR"
$PKG_CMD run dev &
FRONTEND_PID=$!

echo ""
echo "=========================================================="
echo " AgriTwin is now running!"
echo " Open your browser to: http://localhost:8443"
echo " Press Ctrl+C to stop both servers."
echo "=========================================================="

wait
