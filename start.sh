#!/usr/bin/env bash
# Starts both the Python backend and React frontend in parallel.
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load nvm so node/npm are available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Load uv
export PATH="$HOME/.local/share/uv/bin:$HOME/snap/code/232/.local/share/../bin:$PATH"
source "$HOME/snap/code/232/.local/share/../bin/env" 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     Live Translation POC - EN ↔ DE      ║"
echo "╠══════════════════════════════════════════╣"
echo "║  Backend  →  http://localhost:8000       ║"
echo "║  Frontend →  http://localhost:3000       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Kill on Ctrl-C
cleanup() {
  echo ""
  echo "Stopping servers..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Start backend
cd "$ROOT/backend"
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
echo "  [backend]  PID $BACKEND_PID — http://localhost:8000"

# Brief pause so backend starts first
sleep 1

# Start frontend
cd "$ROOT/frontend"
npm run dev -- --port 3000 &
FRONTEND_PID=$!
echo "  [frontend] PID $FRONTEND_PID — http://localhost:3000"
echo ""
echo "Press Ctrl-C to stop both servers."
echo ""

wait
