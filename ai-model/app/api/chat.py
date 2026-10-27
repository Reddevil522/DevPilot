"""Chat and Inference Endpoints.

Handles incoming chat requests from the trusted Node.js backend gateway,
validates payloads, executes local inference via Ollama, and returns structured responses.
"""

from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.chat_service import ChatService

router = APIRouter(tags=["Chat"])
chat_service = ChatService()


@router.post(
    "/api/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Local AI Code Intelligence & Chat",
    description="Executes local LLM inference via Ollama using Qwen2.5-Coder to answer queries and propose file changes."
)
@router.post(
    "/chat",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
async def chat(request: ChatRequest, http_request: Request) -> ChatResponse:
    """Processes chat instructions and returns conversational Markdown with optional change proposals."""
    return await chat_service.process_chat(request, raw_request=http_request)


@router.post(
    "/api/chat/stream",
    status_code=status.HTTP_200_OK,
    summary="Local AI Streaming Inference",
    description="Streams tokens progressively as Server-Sent Events (SSE) for low TTFT."
)
@router.post(
    "/chat/stream",
    status_code=status.HTTP_200_OK,
    include_in_schema=False
)
async def chat_stream(request: ChatRequest, http_request: Request) -> StreamingResponse:
    """Streams inference tokens progressively via SSE, lowering time-to-first-token to under 1.5s."""
    generator = chat_service.process_chat_stream(request, raw_request=http_request)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )
