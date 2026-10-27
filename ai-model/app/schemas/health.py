"""Health check response schemas.

Exposes service health status safely without revealing internal disk paths or credentials.
"""

from datetime import datetime, timezone
from typing import List, Optional
from pydantic import BaseModel, Field


class OllamaStatus(BaseModel):
    """Safe status overview of the connected local Ollama instance."""
    reachable: bool = Field(..., description="Whether local Ollama instance responded.")
    model_configured: str = Field(..., description="Configured code model name.")
    model_available: Optional[bool] = Field(None, description="Whether configured model is pulled.")
    available_models_count: Optional[int] = Field(None, description="Total models available locally.")
    message: Optional[str] = Field(None, description="Actionable message regarding Ollama availability.")


class HealthResponse(BaseModel):
    """Sanitized service health response."""
    status: str = Field(..., description="Overall health status: 'ok' or 'degraded'.")
    service: str = Field(default="devpilot-ai", description="Service identifier.")
    version: str = Field(default="1.0.0", description="Application version.")
    uptime_seconds: float = Field(..., description="Seconds since service start.")
    ollama: OllamaStatus = Field(..., description="Local Ollama inference status.")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC timestamp.")


class OllamaDetailResponse(BaseModel):
    """Detailed status response specifically for Ollama daemon and model readiness."""
    reachable: bool = Field(..., description="Whether local Ollama daemon responded.")
    base_url: str = Field(..., description="Sanitized base URL queried for Ollama.")
    model_configured: str = Field(..., description="Configured default model name.")
    model_available: bool = Field(..., description="Whether configured model is downloaded and ready.")
    available_models: List[str] = Field(default_factory=list, description="Locally pulled models.")
    available_models_count: int = Field(default=0, description="Total count of locally pulled models.")
    message: str = Field(..., description="Actionable status message or install guidance.")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="UTC timestamp.")
