@echo off
REM ==============================================================================
REM DevPilot AI - Start FastAPI Service (Windows)
REM ==============================================================================

cd /d "%~dp0\.."

if not exist ".venv\Scripts\activate.bat" (
    echo [ERROR] Virtual environment not found. Please run scripts\setup_env.bat first.
    exit /b 1
)

call .venv\Scripts\activate.bat

python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
