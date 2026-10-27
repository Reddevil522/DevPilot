"""Ollama Status and Model Management Endpoints.

Provides endpoints to inspect Ollama connectivity and configured-model availability separately
from general Python service health.
"""

from typing import List
from fastapi import APIRouter, status
from app.providers.ollama_provider import get_ollama_provider
from app.schemas.health import OllamaDetailResponse

router = APIRouter(tags=["Ollama"])
provider = get_ollama_provider()


@router.get(
    "/api/ollama/status",
    response_model=OllamaDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Ollama Connectivity & Model Availability",
    description="Inspects local Ollama server reachability and reports whether the configured model is ready."
)
@router.get(
    "/ollama/status",
    response_model=OllamaDetailResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
async def get_ollama_status() -> OllamaDetailResponse:
    """Returns detailed status of local Ollama daemon and configured model."""
    info = await provider.check_health()
    return OllamaDetailResponse(
        reachable=info.get("reachable", False),
        base_url=info.get("base_url", provider.base_url),
        model_configured=info.get("model_configured", provider.default_model),
        model_available=info.get("model_available", False),
        available_models=info.get("available_models", []),
        available_models_count=info.get("available_models_count", 0),
        message=info.get("message", ""),
    )


@router.get(
    "/api/ollama/models",
    response_model=List[str],
    status_code=status.HTTP_200_OK,
    summary="List Locally Installed Models",
    description="Lists all model tags pulled in the local Ollama instance."
)
async def list_models() -> List[str]:
    """Lists locally pulled models without pulling any new models."""
    return await provider.list_available_models()
