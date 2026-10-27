"""Structured AI Operations Endpoints.

Provides dedicated endpoints for:
- Explain code
- Generate code
- Debug errors
- Suggest fixes
- Review code
- Suggest tests
- Generate documentation proposals
"""

from fastapi import APIRouter, HTTPException, Path, Request, status
from app.schemas.chat import ChatRequest, ChatResponse
from app.schemas.context import AIOperationType
from app.schemas.docs import DocRequest, DocResponse
from app.services.chat_service import ChatService
from app.services.doc_service import DocService

router = APIRouter(tags=["Operations"])
chat_service = ChatService()
doc_service = DocService()


@router.post(
    "/api/operations/{operation}",
    response_model=ChatResponse,
    status_code=status.HTTP_200_OK,
    summary="Execute Structured AI Operation",
    description="Executes a specialized AI operation (explain, generate, debug, fix, review, document, test) with project context."
)
async def execute_operation(
    request: ChatRequest,
    http_request: Request,
    operation: AIOperationType = Path(..., description="Target AI operation"),
) -> ChatResponse:
    """Executes a specialized project-aware operation."""
    request.operation = operation
    return await chat_service.process_chat(request, raw_request=http_request)


@router.post(
    "/api/docs/generate",
    response_model=DocResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate Documentation Proposal",
    description="Generates README or technical documentation as a structured proposal for user review."
)
async def generate_docs(request: DocRequest) -> DocResponse:
    """Generates project documentation proposal."""
    return await doc_service.generate_documentation(request)
