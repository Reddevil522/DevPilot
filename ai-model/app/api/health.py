"""Health Check Endpoints.

Provides /health and /api/health endpoints for liveness, readiness, and monitoring.
Sanitized: never exposes filesystem paths, internal secrets, or environment keys.
Separately assesses Python process health, Ollama daemon reachability, and model availability.
"""

import time
from fastapi import APIRouter, status
from app.core.config import get_settings
from app.providers.ollama_provider import get_ollama_provider
from app.schemas.health import HealthResponse, OllamaStatus

router = APIRouter(tags=["Health"])
START_TIME = time.time()
provider = get_ollama_provider()


@router.get(
    "/health/live",
    status_code=status.HTTP_200_OK,
    summary="Python Process Liveness Check",
    description="Returns immediate 200 OK verifying the Python service process is running without probing Ollama.",
)
@router.get(
    "/api/health/live",
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def get_process_liveness():
    """Returns pure Python process liveness status."""
    return {
        "status": "ok",
        "service": "devpilot-ai",
        "version": "1.0.0",
        "uptime_seconds": round(time.time() - START_TIME, 2),
    }


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Service Health & Ollama Status",
    description="Returns the operational status of DevPilot AI and local Ollama connectivity."
)
@router.get(
    "/api/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
async def get_health() -> HealthResponse:
    """Returns sanitized health metrics with separate Ollama and model readiness."""
    uptime = time.time() - START_TIME
    ollama_info = await provider.check_health()

    is_reachable = ollama_info.get("reachable", False)
    is_model_available = ollama_info.get("model_available", False)

    # A healthy Python process must not automatically report that Ollama is ready.
    # Overall service status is 'ok' only if Ollama is reachable AND the configured model is installed.
    status_str = "ok" if (is_reachable and is_model_available) else "degraded"

    return HealthResponse(
        status=status_str,
        service="devpilot-ai",
        version="1.0.0",
        uptime_seconds=round(uptime, 2),
        ollama=OllamaStatus(
            reachable=is_reachable,
            model_configured=ollama_info.get("model_configured", get_settings().ollama_model),
            model_available=is_model_available,
            available_models_count=ollama_info.get("available_models_count"),
            message=ollama_info.get("message"),
        )
    )
