"""DevPilot AI - Error Definitions and Exception Handlers.

Provides standard exception types and FastAPI handlers ensuring unified JSON errors.
"""

from typing import Any, Dict, Optional
from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from app.core.logging import get_logger

logger = get_logger("errors")


class DevPilotAIException(Exception):
    """Base exception class for DevPilot AI errors."""

    def __init__(
        self,
        message: str,
        code: str = "AI_SERVICE_ERROR",
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.details = details or {}


class OllamaConnectionError(DevPilotAIException):
    """Raised when Ollama cannot be reached."""

    def __init__(self, message: str = "Unable to connect to Ollama. Ensure Ollama is running locally."):
        super().__init__(
            message=message,
            code="OLLAMA_UNREACHABLE",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class OllamaTimeoutError(DevPilotAIException):
    """Raised when Ollama inference times out."""

    def __init__(self, timeout_seconds: int):
        super().__init__(
            message=f"Ollama inference timed out after {timeout_seconds} seconds.",
            code="OLLAMA_TIMEOUT",
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            details={"timeout_seconds": timeout_seconds},
        )


class ModelNotFoundError(DevPilotAIException):
    """Raised when the requested model is not pulled in Ollama."""

    def __init__(self, model_name: str):
        super().__init__(
            message=f"Model '{model_name}' is not available in local Ollama. Run 'ollama pull {model_name}'.",
            code="MODEL_NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
            details={"model": model_name},
        )


class InvalidProposalError(DevPilotAIException):
    """Raised when AI file proposal JSON fails schema validation."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            code="INVALID_PROPOSAL",
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            details=details,
        )


class MalformedProviderResponseError(DevPilotAIException):
    """Raised when Ollama returns an unparseable, malformed, or empty payload."""

    def __init__(
        self,
        message: str = "Received a malformed response from Ollama.",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            message=message,
            code="MALFORMED_PROVIDER_RESPONSE",
            status_code=status.HTTP_502_BAD_GATEWAY,
            details=details,
        )


class ServiceBusyError(DevPilotAIException):
    """Raised when local inference capacity is saturated to protect memory on 8 GB systems."""

    def __init__(
        self,
        message: str = "Local AI inference is busy processing another request. Please retry shortly.",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            message=message,
            code="SERVICE_BUSY",
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            details=details,
        )


async def devpilot_exception_handler(request: Request, exc: DevPilotAIException) -> JSONResponse:
    """Handles all custom DevPilotAIException subclasses."""
    logger.warning(f"Handled error [{exc.code}] on {request.url.path}: {exc.message}")
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "code": exc.code,
            "message": exc.message,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details if exc.details else None,
            },
        },
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Handles FastAPI / Pydantic request validation errors."""
    errors = exc.errors()
    simplified_errors = []
    for err in errors:
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        simplified_errors.append(f"{loc}: {err.get('msg')}")

    message = "; ".join(simplified_errors) if simplified_errors else "Request validation failed."
    logger.warning(f"Validation error on {request.url.path}: {message}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "code": "VALIDATION_ERROR",
            "message": message,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": message,
                "details": {"validation_errors": errors},
            },
        },
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Fallback handler for unhandled exceptions (logs stack trace safely)."""
    logger.error(f"Unhandled exception on {request.url.path}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "code": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected error occurred in the DevPilot AI service.",
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "An unexpected error occurred in the DevPilot AI service.",
            },
        },
    )
