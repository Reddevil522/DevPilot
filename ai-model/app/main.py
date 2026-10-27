"""DevPilot AI - FastAPI Application Entry Point.

Initializes FastAPI with lifespan management, structured logging, CORS,
exception handlers, and API routes.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from app.api import api_router
from app.core.config import get_settings
from app.core.errors import (
    DevPilotAIException,
    devpilot_exception_handler,
    generic_exception_handler,
    validation_exception_handler,
)
from app.core.logging import get_logger, setup_logging

settings = get_settings()
setup_logging(settings.log_level)
logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manages application startup and graceful shutdown."""
    logger.info("=" * 60)
    logger.info("DevPilot AI Service starting up...")
    logger.info(f"Target Host: {settings.ai_host}:{settings.ai_port}")
    logger.info(f"Configured Ollama URL: {settings.ollama_base_url}")
    logger.info(f"Configured Code Model: {settings.ollama_model}")
    logger.info(f"Configured Keep-Alive: {settings.ollama_keep_alive}")
    logger.info(f"Inference Timeout: {settings.ollama_timeout_seconds}s")
    logger.info("=" * 60)

    yield

    logger.info("DevPilot AI Service shutting down gracefully...")
    try:
        from app.providers.ollama_provider import get_ollama_provider
        await get_ollama_provider().close()
    except Exception as e:
        logger.debug(f"Provider close on shutdown: {e}")


def create_app() -> FastAPI:
    """Application factory for DevPilot AI FastAPI service."""
    app = FastAPI(
        title="DevPilot AI Service",
        description="Local AI code intelligence subsystem powered by Ollama and Qwen2.5-Coder.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url=None,
    )

    # Configure CORS for local DevPilot MEAN stack communication
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:4200",
            "http://127.0.0.1:4200",
            "http://localhost:5000",
            "http://127.0.0.1:5000",
        ],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    # Register Exception Handlers
    app.add_exception_handler(DevPilotAIException, devpilot_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, generic_exception_handler)

    # Register Routes
    app.include_router(api_router)

    @app.get("/", tags=["Root"])
    async def root():
        return {
            "name": "DevPilot AI Service",
            "version": "1.0.0",
            "status": "online",
            "docs": "/docs" if settings.debug else "disabled",
        }

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.ai_host,
        port=settings.ai_port,
        reload=settings.debug,
    )
