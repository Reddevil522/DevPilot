"""DevPilot AI - API Routes Module."""

from fastapi import APIRouter
from app.api.chat import router as chat_router
from app.api.health import router as health_router
from app.api.ollama import router as ollama_router
from app.api.operations import router as operations_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(ollama_router)
api_router.include_router(chat_router)
api_router.include_router(operations_router)

__all__ = ["api_router"]
