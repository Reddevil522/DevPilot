# DevPilot AI Python Subsystem (`ai-model/`)

Dedicated local AI inference and code intelligence subsystem for DevPilot, powered by [FastAPI](https://fastapi.tiangolo.com/), [Ollama](https://ollama.com/), and [Qwen2.5-Coder](https://github.com/QwenLM/Qwen2.5-Coder).

---

## 1. Architecture & Responsibilities

In the DevPilot architecture, the Python subsystem handles AI orchestration and inference only:

```
Angular (Port 4200) ──► Node.js/Express (Port 5000) ──► Python AI (Port 8001) ──► Ollama (Port 11434)
```

- **Node.js**: Retains complete authority over authentication, project authorization, MongoDB persistence, and trusted filesystem operations.
- **Python Subsystem (`ai-model/`)**: Receives sanitized prompts and context from Node.js, validates requests, communicates with local Ollama, enforces structured code proposal schemas, and returns validated responses.
- **Security Constraint**: This service runs strictly on `127.0.0.1:8001`. It has zero direct disk write access to user workspaces and no shell/terminal access.

---

## 2. Prerequisites

1. **Python 3.10+** (Tested on Python 3.13)
2. **Ollama**: Download and install from [ollama.com](https://ollama.com)
   - Start Ollama daemon (runs on `http://localhost:11434` by default)
   - Pull the recommended coding model:
     ```bash
     ollama pull qwen2.5-coder:7b
     ```

---

## 3. Windows Setup & Installation

### Option A: Automated Setup Script
Run the included setup script from the `ai-model/` directory:
```cmd
cd "ai-model"
scripts\setup_env.bat
```

### Option B: Manual Setup
1. **Navigate to the subsystem folder**:
   ```cmd
   cd "d:\COLLAGE CLASSES\SEM - 03\Minor Project\DevPilot\ai-model"
   ```

2. **Create a dedicated virtual environment**:
   ```cmd
   python -m venv .venv
   ```

3. **Activate the virtual environment**:
   - Windows Command Prompt:
     ```cmd
     .venv\Scripts\activate.bat
     ```
   - Windows PowerShell:
     ```powershell
     .\.venv\Scripts\Activate.ps1
     ```

4. **Upgrade pip and install dependencies**:
   ```cmd
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

5. **Configure environment settings**:
   ```cmd
   copy .env.example .env
   ```

---

## 4. Configuration Settings

Settings are managed via `app/core/config.py` using `pydantic-settings`:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AI_HOST` | `127.0.0.1` | Local IP address for the service |
| `AI_PORT` | `8001` | Port for the FastAPI server |
| `DEBUG` | `false` | Enables reload mode and Swagger UI at `/docs` |
| `LOG_LEVEL` | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Endpoint of the local Ollama daemon |
| `OLLAMA_MODEL` | `qwen2.5-coder:3b` | Default coding model tag in Ollama |
| `OLLAMA_TIMEOUT_SECONDS` | `120` | Maximum time allowed for local inference |
| `MAX_CONTEXT_TOKENS` | `8192` | Token safety budget for project context |
| `MAX_OUTPUT_TOKENS` | `4096` | Output token ceiling for local generation |
| `MAX_CONCURRENT_INFERENCES`| `1` | Concurrency limit to prevent memory thrashing on 8 GB RAM |
| `TEMPERATURE` | `0.2` | Sampling temperature for code generation |

---

## 5. Running the Service

### Using the Run Script (Windows)
```cmd
scripts\run_service.bat
```

### Using Uvicorn Directly
Ensure the `.venv` is activated:
```cmd
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

Service URLs:
- **Base URL**: `http://127.0.0.1:8001/`
- **Health Check**: `http://127.0.0.1:8001/health` (and `/api/health`)
- **Ollama Status Check**: `http://127.0.0.1:8001/api/ollama/status`
- **AI Chat & Code Proposals**: `POST http://127.0.0.1:8001/api/chat`
- **Structured AI Operations**: `POST http://127.0.0.1:8001/api/operations/{operation}` (`explain`, `generate`, `debug`, `fix`, `review`, `test`)
- **Documentation Proposals**: `POST http://127.0.0.1:8001/api/docs/generate`
- **Swagger Documentation**: `http://127.0.0.1:8001/docs` (when `DEBUG=true`)

---

## 6. Running Tests

Run the unit and integration tests using pytest:
```cmd
pytest -v
```

Test coverage includes 52 test cases across 7 test suites:
- `test_config.py`: Environment validation, port boundaries, URL sanitization, resource boundaries
- `test_context.py`: Prioritization, budget limits, sensitive file exclusion (`.env`, `.key`), binary exclusion, untrusted wrapping
- `test_health.py`: Health endpoint schema validation, separate Ollama readiness, and data leak prevention
- `test_inference.py`: Ollama unreachable (503), Model missing (404), timeout handling (504), malformed provider responses (502), validation errors (422), structured proposals
- `test_operations.py`: Structured operation execution (`explain`, `generate`, `debug`, `fix`, `review`, `test`, `document`)
- `test_proposals.py`: Path traversal blocking, absolute path blocking, protected file rejection, authorization whitelisting
- `test_schemas.py`: Request and proposal validation

---

## 7. Roadmap & Phase Overview

- **Phase 1 (Complete)**: Full repository audit and architecture plan.
- **Phase 2 (Complete)**: Project layout, FastAPI application, configuration, validation schemas, unit tests, and health endpoint.
- **Phase 3 (Complete)**: Real local inference orchestration with Ollama & Qwen2.5-Coder adapter, memory protection, and failure isolation.
- **Phase 4 (Complete)**: Project-aware coding AI, prioritized context construction with sensitive exclusion, structured operations (`explain`, `generate`, `debug`, `fix`, `review`, `test`, `document`), and non-destructive file proposal generation.
- **Phase 5 (Next)**: Connect terminal error context and live compiler diagnostics.
- **Phase 6**: Comprehensive end-to-end integration and acceptance testing.
