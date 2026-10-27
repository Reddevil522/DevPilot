#!/usr/bin/env bash
# ==============================================================================
# DevPilot AI - Virtual Environment Setup Script (Linux/macOS)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "[DevPilot AI] Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] python3 could not be found. Please install Python 3.10+"
    exit 1
fi

python3 --version

if [ ! -d ".venv" ]; then
    echo "[DevPilot AI] Creating dedicated virtual environment in .venv..."
    python3 -m venv .venv
    echo "[DevPilot AI] Virtual environment created successfully."
else
    echo "[DevPilot AI] Virtual environment .venv already exists."
fi

echo "[DevPilot AI] Activating virtual environment..."
source .venv/bin/activate

echo "[DevPilot AI] Upgrading pip..."
pip install --upgrade pip

echo "[DevPilot AI] Installing requirements..."
pip install -r requirements.txt

if [ ! -f ".env" ]; then
    echo "[DevPilot AI] Creating .env from .env.example..."
    cp .env.example .env
fi

echo ""
echo "=============================================================================="
echo "[SUCCESS] DevPilot AI Python environment is ready!"
echo "Activate environment:  source ai-model/.venv/bin/activate"
echo "Start service:         uvicorn app.main:app --host 127.0.0.1 --port 8001"
echo "=============================================================================="
