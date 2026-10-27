#!/usr/bin/env bash
# ==============================================================================
# DevPilot AI - Start FastAPI Service (Linux/macOS)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

if [ ! -f ".venv/bin/activate" ]; then
    echo "[ERROR] Virtual environment not found. Please run scripts/setup_env.sh first."
    exit 1
fi

source .venv/bin/activate

python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
