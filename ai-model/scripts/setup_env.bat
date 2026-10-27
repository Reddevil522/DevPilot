@echo off
REM ==============================================================================
REM DevPilot AI - Virtual Environment Setup Script (Windows)
REM ==============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0\.."

echo [DevPilot AI] Checking Python installation...
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python is not installed or not in PATH. Please install Python 3.10+
    exit /b 1
)

python --version

if not exist ".venv" (
    echo [DevPilot AI] Creating dedicated virtual environment in .venv...
    python -m venv .venv
    if %ERRORLEVEL% NEQ 0 (
        echo [ERROR] Failed to create virtual environment.
        exit /b 1
    )
    echo [DevPilot AI] Virtual environment created successfully.
) else (
    echo [DevPilot AI] Virtual environment .venv already exists.
)

echo [DevPilot AI] Activating virtual environment...
call .venv\Scripts\activate.bat

echo [DevPilot AI] Upgrading pip...
python -m pip install --upgrade pip

echo [DevPilot AI] Installing requirements...
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies.
    exit /b 1
)

if not exist ".env" (
    echo [DevPilot AI] Creating .env from .env.example...
    copy .env.example .env
)

echo.
echo ==============================================================================
echo [SUCCESS] DevPilot AI Python environment is ready!
echo Activate environment:  ai-model\.venv\Scripts\activate.bat
echo Start service:         uvicorn app.main:app --host 127.0.0.1 --port 8001
echo ==============================================================================
