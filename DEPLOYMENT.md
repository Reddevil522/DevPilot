# DevPilot Production Deployment Guide & Architecture Audit

> **Target Platform:** Render Cloud Platform + MongoDB Atlas  
> **Repository:** `Reddevil522/DevPilot`  
> **Architecture Pattern:** Multi-tier decoupled microservices (Frontend SPA + Node.js API/WebSocket Gateway + Python AI Subsystem + Remote/Hosted LLM Inference)

---

## 1. Executive Summary & Architecture Audit

An inspection of the DevPilot codebase was performed across the Frontend, Backend, Python AI subsystem, and dependencies.

### Actual Service Topology (Verified from Code)

| Service Tier | Framework / Engine | Repository Directory | Hosting Type | External Dependencies |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Angular 18 (SPA, standalone components, Monaco Editor, xterm.js) | `Frontend/` | Static Site / CDN | Connects to Backend REST & WebSocket |
| **Backend** | Node.js, Express 5, WebSocket (`ws`), `node-pty`, `chokidar` | `Backend/` | Web Service (Node runtime) | MongoDB Atlas, Python AI Service |
| **AI Subsystem** | Python 3.10+, FastAPI, Uvicorn, Pydantic, HTTPX | `ai-model/` | Web Service (Python runtime) | Ollama REST API / Remote Inference Provider |
| **Database** | MongoDB Atlas (Mongoose ODM) | Managed Cloud | Managed DBaaS | Cloud-hosted MongoDB cluster |
| **Inference Engine** | Ollama with Qwen2.5-Coder (or Remote Hosted Provider) | External / Dedicated Host | GPU Instance / API | Self-hosted or hosted inference |

### Infrastructure Audit: Component Requirement Analysis

- **Redis:** **NOT REQUIRED** in the current architecture. Rate-limiting is handled in-memory (`express-rate-limit`), and active terminal PTY sessions are tracked in-process. Redis is only relevant if horizontally scaling multiple backend instances with sticky session sharing.
- **Qdrant (Vector DB):** **NOT REQUIRED** in the current codebase. No vector database dependencies exist in `Backend/package.json` or `ai-model/requirements.txt`.
- **Background Queues (Bull / Celery):** **NOT REQUIRED**. AI operations, chat streaming, code modification proposals, and file generation operate over synchronous HTTP requests and Server-Sent Events (SSE) streams directly between Express and FastAPI.
- **File Watching (`chokidar`):** Runs **in-process** inside the Node.js backend to broadcast filesystem events via SSE to the connected editor. Requires no external message broker.
- **Persistent Disk Storage:** **CRITICAL FOR REMOTE HOSTING**. Projects in DevPilot have a local directory path (`project.localPath`). When running in cloud containers (such as Render or Docker), container storage is **ephemeral** by default. Any files created or edited inside a project workspace will be lost if the container restarts or sleeps, unless a **Render Persistent Disk** is attached or projects are stored on a persistent volume.

---

## 2. Critical Ollama & Inference Constraint Analysis

### The Problem on 8 GB RAM Local Hardware
On an 8 GB RAM development machine, running an OS, browser, Angular compiler, Node backend, Python service, and a 3B/7B LLM simultaneously leads to severe CPU/RAM contention, swap thrashing, and OS memory allocation errors (`out of memory`, `CUDA out of memory`, or process kills).

### Local Development vs. Production Cloud Reality
1. **Loopback Isolation:** `localhost` / `127.0.0.1` inside a Render Linux container refers strictly to the isolated container itself. It **cannot** connect to `localhost:11434` running on your physical Windows computer without a dedicated tunneling mechanism.
2. **Container Resource Limits:** Free and low-tier cloud web services (e.g., Render 512 MB – 2 GB RAM) **cannot run Ollama or load LLM weights**. The model will be immediately terminated by the Linux OOM-killer.

### Production Inference Architecture Options

```
   ┌────────────────────────────────────────────────────────┐
   │             RECOMMENDED INFERENCE OPTIONS               │
   └────────────────────────────────────────────────────────┘

 [Option A: Remote GPU Cloud]      [Option B: Secure Tunnel]     [Option C: Hosted API Proxy]
┌───────────────────────────┐    ┌───────────────────────────┐  ┌───────────────────────────┐
│ RunPod / Vast.ai / Modal  │    │ Dedicated Home Server     │  │ OpenAI-Compatible API     │
│ • RTX 3090/4090 / A10G    │    │ • 16GB+ RAM / NVIDIA GPU  │  │ • Groq / Together / DeepSeek│
│ • Ollama / vLLM + Caddy   │    │ • Cloudflare Tunnel       │  │ • Ultra-low latency       │
│ • HTTP Basic Auth/Bearer  │    │ • Tailscale Funnel / Auth │  │ • Zero server RAM cost    │
└─────────────▲─────────────┘    └─────────────▲─────────────┘  └─────────────▲─────────────┘
              │                                │                              │
              └─────────────────┬──────────────┴──────────────────────────────┘
                                │ (OLLAMA_BASE_URL)
                     ┌──────────┴──────────┐
                     │ Render Python AI    │
                     │ Service (FastAPI)   │
                     └─────────────────────┘
```

#### Option A: Dedicated Remote Cloud Host (RunPod, Vast.ai, Modal, AWS EC2 g4dn)
- **Setup:** Deploy Ollama or vLLM on an on-demand GPU instance with at least 8 GB VRAM.
- **Security:** Ollama has **no native authentication**. You MUST place Ollama behind a reverse proxy (e.g. Caddy or Nginx) requiring HTTP Basic Authentication or a Bearer token:
  ```caddy
  # Example Caddyfile for remote Ollama
  ai.yourdomain.com {
      reverse_proxy localhost:11434
      basicauth {
          devpilot $2a$14$encrypted_hash_here
      }
  }
  ```

#### Option B: Always-On Dedicated Machine with Secure Tunnel
- **Setup:** Run Ollama on a secondary machine with 16 GB+ RAM or a discrete GPU.
- **Network Exposure:** Use **Cloudflare Tunnel** with Cloudflare Access (Service Tokens) or **Tailscale Funnel**. Never forward raw port 11434 directly through your router without authentication.

#### Option C: Hosted Inference Provider
- Point `OLLAMA_BASE_URL` to an OpenAI/Ollama-compatible endpoint hosted by providers such as Groq, Together AI, or Fireworks AI serving `Qwen/Qwen2.5-Coder-32B-Instruct` or `Qwen2.5-Coder-7B-Instruct`.

#### Graceful Offline Handling (Already Configured)
If the inference provider is unreachable or times out, the DevPilot backend catches `AI_SERVICE_UNREACHABLE` and `OLLAMA_TIMEOUT` errors gracefully. The IDE, Monaco Editor, file management, terminal, and project workspaces remain 100% operational, and an informative status message is presented to the user.

---

## 3. Production Environment Variables Reference

### Backend (`Backend/`)

| Variable | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `NODE_ENV` | **Yes** | `production` | Enables production security optimizations and cookie behaviors. |
| `PORT` | **Yes** | `10000` (Render) / `5000` | Port on which the Express HTTP and WebSocket server listens. |
| `MONGODB_URI` | **Yes** | `mongodb+srv://user:pass@cluster.mongodb.net/devpilot` | MongoDB Atlas database connection string. |
| `FRONTEND_URL` | **Yes** | `https://devpilot-frontend.onrender.com` | Deployed Frontend origin for CORS policy. |
| `CORS_ALLOWED_ORIGINS` | No | `https://devpilot-frontend.onrender.com,http://localhost:4200` | Comma-separated list of allowed CORS origins. |
| `COOKIE_SAME_SITE` | **Yes** | `none` (production) / `lax` (local) | Cookie SameSite policy (`none` required for cross-domain HTTPS). |
| `COOKIE_SECURE` | **Yes** | `true` (production) / `false` (local) | Controls Secure flag on JWT authentication cookies. |
| `JWT_ACCESS_SECRET` | **Yes** | *(64-char random hex string)* | Secret for signing short-lived access tokens. |
| `JWT_REFRESH_SECRET` | **Yes** | *(64-char random hex string)* | Secret for signing long-lived refresh tokens. |
| `JWT_ACCESS_EXPIRES_IN` | No | `15m` | Lifetime of access tokens. |
| `JWT_REFRESH_EXPIRES_IN` | No | `7d` | Lifetime of refresh tokens. |
| `PYTHON_AI_URL` | **Yes** | `https://devpilot-ai.onrender.com` | Full URL of deployed Python AI service. |
| `AI_PROVIDER` | No | `python` | AI adapter selector. |
| `AI_TIMEOUT_SECONDS` | No | `120` | Timeout threshold for AI completions. |
| `OLLAMA_MODEL` | No | `qwen2.5-coder:3b` | Target code intelligence model tag. |
| `OLLAMA_TIMEOUT_SECONDS`| No | `120` | Timeout for inference requests. |
| `PROJECTS_STORAGE_DIR` | No | `/var/data/devpilot/projects` | Mount point for persistent workspace storage on Linux. |
| `EMAIL_HOST` | No | `smtp.sendgrid.net` | SMTP server for account verification and password reset. |
| `EMAIL_PORT` | No | `587` | SMTP port. |
| `EMAIL_USER` | No | *(SMTP username)* | SMTP credentials. |
| `EMAIL_PASSWORD` | No | *(SMTP password)* | SMTP credentials. |

### Python AI Subsystem (`ai-model/`)

| Variable | Required | Default / Example | Purpose |
| :--- | :---: | :--- | :--- |
| `AI_HOST` | No | `0.0.0.0` | Bind host interface for FastAPI/Uvicorn. |
| `PORT` or `AI_PORT` | **Yes** | `10000` (Render) / `8001` | Listening port for Python service. |
| `DEBUG` | No | `false` | Enables FastAPI auto-reload and Swagger docs (`/docs`). |
| `LOG_LEVEL` | No | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`). |
| `OLLAMA_BASE_URL` | **Yes** | `https://remote-ai.example.com` | Remote Ollama or inference API base URL. |
| `OLLAMA_MODEL` | No | `qwen2.5-coder:3b` | Default model tag. |
| `OLLAMA_TIMEOUT_SECONDS`| No | `120` | Maximum wait time for LLM generation. |
| `OLLAMA_KEEP_ALIVE` | No | `10m` | Time to keep model resident in remote GPU/VRAM. |
| `MAX_CONTEXT_TOKENS` | No | `8192` | Context window size ceiling. |
| `MAX_OUTPUT_TOKENS` | No | `4096` | Output token generation ceiling. |
| `DEFAULT_NUM_CTX` | No | `2048` | Memory-efficient context window for lightweight tasks. |
| `MAX_CONCURRENT_INFERENCES` | No | `1` | Concurrency limiter to protect inference host memory. |
| `TEMPERATURE` | No | `0.2` | Sampling temperature for deterministic code output. |
| `CORS_ORIGINS` | No | `https://devpilot-backend.onrender.com` | Allowed origins for cross-service calls. |

### Frontend (`Frontend/`)

| Setting / Variable | Location | Default / Example | Purpose |
| :--- | :--- | :--- | :--- |
| `apiUrl` | `src/environments/environment.prod.ts` | `https://devpilot-backend.onrender.com/api` | Base URL for REST endpoints. |
| `wsUrl` | `src/environments/environment.prod.ts` | `wss://devpilot-backend.onrender.com/api/terminal/ws` | Secure WebSocket URL for the terminal. |
| `window.__DEVPILOT_CONFIG__` | `public/assets/config.js` | *(Optional runtime injection)* | Allows changing endpoints without rebuilding. |

---

## 4. Render Step-by-Step Deployment Guide

Deploying DevPilot on Render can be achieved in two ways:
- **Method 1 (Recommended):** Automated deployment via `render.yaml` Blueprint.
- **Method 2:** Manual configuration via the Render Web Dashboard.

---

### Method 1: Automated Blueprint Deployment

1. **Push your repository** to GitHub (`git push origin main`).
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** in the top navigation bar and select **Blueprint**.
4. Connect your GitHub repository (`Reddevil522/DevPilot`).
5. Render detects the root `render.yaml` and displays the 3 services:
   - `devpilot-frontend` (Static Site)
   - `devpilot-backend` (Node Web Service)
   - `devpilot-ai` (Python Web Service)
6. Provide the required parameters prompted by the dashboard:
   - `MONGODB_URI`: Your MongoDB Atlas connection string.
   - `OLLAMA_BASE_URL`: Your remote authenticated inference URL (or placeholder if configuring inference later).
7. Click **Apply**. Render will build and deploy all three services in parallel.

---

### Method 2: Manual Dashboard Configuration

If configuring services individually, use the following exact settings:

#### Service 1: Python AI Service (`devpilot-ai`)
- **Service Type:** Web Service
- **Runtime:** Python 3
- **Root Directory:** `ai-model`
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- **Health Check Path:** `/health`
- **Environment Variables:**
  - `AI_HOST` = `0.0.0.0`
  - `DEBUG` = `false`
  - `LOG_LEVEL` = `INFO`
  - `OLLAMA_BASE_URL` = `https://your-remote-gpu-host.com`
  - `OLLAMA_MODEL` = `qwen2.5-coder:3b`
  - `OLLAMA_TIMEOUT_SECONDS` = `120`

#### Service 2: Node.js Backend (`devpilot-backend`)
- **Service Type:** Web Service
- **Runtime:** Node
- **Root Directory:** `Backend`
- **Build Command:** `npm install`
- **Start Command:** `node src/server.js`
- **Health Check Path:** `/health`
- **Environment Variables:**
  - `NODE_ENV` = `production`
  - `MONGODB_URI` = *(Your MongoDB Atlas URI)*
  - `FRONTEND_URL` = `https://<your-frontend-service-name>.onrender.com`
  - `CORS_ALLOWED_ORIGINS` = `https://<your-frontend-service-name>.onrender.com`
  - `COOKIE_SAME_SITE` = `none`
  - `COOKIE_SECURE` = `true`
  - `JWT_ACCESS_SECRET` = *(Generate with `openssl rand -hex 32`)*
  - `JWT_REFRESH_SECRET` = *(Generate with `openssl rand -hex 32`)*
  - `PYTHON_AI_URL` = `https://<your-ai-service-name>.onrender.com`
  - `AI_PROVIDER` = `python`

#### Service 3: Angular Frontend (`devpilot-frontend`)
- **Service Type:** Static Site
- **Root Directory:** `Frontend`
- **Build Command:** `npm install && npm run build`
- **Publish Directory:** `dist/devpilot/browser`
- **Redirects / Rewrites (Under Settings):**
  - **Type:** Rewrite
  - **Source:** `/*`
  - **Destination:** `/index.html`

---

## 5. MongoDB Atlas Setup Guide

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com/).
2. Create a Free Shared Cluster (M0) or Dedicated Cluster.
3. In **Network Access**, click **Add IP Address**:
   - For Render cloud access, choose **Allow Access From Anywhere (`0.0.0.0/0`)** since Render uses dynamic outbound IP addresses.
4. In **Database Access**, create a database user:
   - Built-in role: `readWriteAnyDatabase` or specific access to `devpilot`.
   - Store username and password securely.
5. In **Database Deployments**, click **Connect** -> **Drivers** -> **Node.js**:
   - Connection string format:
     ```
     mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/devpilot?retryWrites=true&w=majority&appName=DevPilot
     ```
6. Add this string as `MONGODB_URI` in Render.

---

---

## 6. Architecture & Platform Considerations for Web IDE

### Integrated Terminal & PTY on Linux Containers
- The integrated terminal utilizes `node-pty`, which compiles a native C++ PTY bridge.
- On Windows local development, `node-pty` launches `powershell.exe`.
- On Linux (Render), `node-pty` automatically falls back to `/bin/bash` or `/bin/sh`.
- **Key Understanding:** In production, commands executed in the terminal execute **inside the Render Linux container**, not on the user's laptop.
- In `Backend/src/controllers/project.controller.js`, the native Windows GUI folder browser (`FolderBrowserDialog` via PowerShell) is automatically bypassed on non-Windows systems, returning a clean notification to input workspace paths manually.

### Deploying Frontend to Vercel (Recommended Architecture)
Deploying the Angular frontend to **Vercel** while hosting the backend on **Render** gives you instant CDN page loads and automatic preview deployments.

#### Vercel Configuration Files:
- [Frontend/vercel.json](file:///d:/COLLAGE%20CLASSES/SEM%20-%2003/Minor%20Project/DevPilot/Frontend/vercel.json): Pre-configured for Angular SPA rewrites (`/(.*)` -> `/index.html`), caching headers, and output directory `dist/devpilot/browser`.
- [vercel.json](file:///d:/COLLAGE%20CLASSES/SEM%20-%2003/Minor%20Project/DevPilot/vercel.json): Root fallback if importing the repo directly without editing Root Directory.

#### Vercel Dashboard Settings:
1. Go to [vercel.com/new](https://vercel.com/new) and import your `DevPilot` repository.
2. In the **Project Settings**:
   - **Framework Preset:** `Angular`
   - **Root Directory:** Click Edit and select `Frontend`
   - **Build Command:** `npm run build` *(runs auto-sync `node scripts/set-env.js && ng build`)*
   - **Output Directory:** `dist/devpilot/browser`
3. In **Environment Variables**, add:
   - `DEVPILOT_API_URL`: `https://devpilot-backend.onrender.com/api` (replace with your Render backend URL)
   - `DEVPILOT_WS_URL`: `wss://devpilot-backend.onrender.com/api/terminal/ws`
4. Click **Deploy**.

#### Backend CORS Configuration for Vercel:
In your Render backend service, set `CORS_ALLOWED_ORIGINS` to accept both production and preview deployments:
```env
CORS_ALLOWED_ORIGINS=https://your-project.vercel.app,https://*.vercel.app
```
*(The backend's wildcard matcher automatically handles Vercel git-branch preview URLs like `https://devpilot-git-main-username.vercel.app`)*.

---

## 7. Deployment Readiness Checklist

Run through this checklist prior to marking production deployment ready:

- [x] **Monaco Editor Assets:** Verified Monaco workers and minified assets are copied to `dist/devpilot/browser/assets/monaco` during Angular production build.
- [x] **Environment Separation:** `environment.ts` and `environment.prod.ts` configured and replaced in `angular.json` under `fileReplacements`.
- [x] **Zero Hardcoded Localhost in Frontend:** All API services (`auth.service.ts`, `ai.service.ts`, `project.service.ts`, `file-system.service.ts`, `terminal.service.ts`) consume `environment.apiUrl` and `environment.wsUrl`.
- [x] **SPA Routing Rewrite Rule:** Configured in `render.yaml` (`/*` -> `/index.html`) to ensure Angular router handles page reloads without 404s.
- [x] **Health Check Endpoints:**
  - Backend: `GET /health` and `GET /api/health` return HTTP 200 with database connectivity status and process uptime.
  - Python AI: `GET /health` and `GET /api/health/live` return HTTP 200 with process health and Ollama status.
- [x] **Reverse Proxy Trust:** `app.set('trust proxy', 1)` enabled in `app.js` to correctly propagate HTTPS headers and client IPs from Render's reverse proxy.
- [x] **Cross-Origin Cookie Security:** Authentication cookies configured with `SameSite=None; Secure=true` in production to support cross-domain API calls with credentials.
- [x] **Host Interface Binding:**
  - Node.js server binds to `'0.0.0.0'`.
  - Python FastAPI service supports `0.0.0.0` and Render's dynamic `$PORT`.
- [x] **Non-Windows Desktop Guard:** Native Windows PowerShell directory picker safely handled on Linux platforms without crashing or hanging.
- [x] **Mongoose Defensive Registration:** All models guarded with `mongoose.models.X || mongoose.model('X', ...)` to prevent duplicate model compilation.
- [x] **Frontend Production Build Verified:** Build succeeds with bundle size 444 kB, well within warning and error budgets.
- [x] **Python Unit Test Suite Verified:** All 64 tests pass cleanly with `pytest`.
- [x] **Zero Secret Leakage:** `.env` files ignored by `.gitignore`; `.env.example` templates created for all tiers.
