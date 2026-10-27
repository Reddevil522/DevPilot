"""Documentation Generation Service.

Produces comprehensive documentation (README, API, Architecture) as structured
file-change proposals for user review before committing to disk.
"""

from typing import Optional
from app.context.context_builder import ContextBuilder
from app.core.config import get_settings
from app.core.logging import get_logger
from app.prompts.coder import DEVPILOT_CODER_SYSTEM_PROMPT
from app.providers.ollama_provider import OllamaProvider
from app.schemas.context import FileContextItem, ProjectContextPayload
from app.schemas.docs import DocRequest, DocResponse, DocType
from app.schemas.proposals import ChangeItem, ChangeProposal, OperationType

logger = get_logger("doc_service")

DOC_PATHS = {
    DocType.README: "README.md",
    DocType.API: "docs/API.md",
    DocType.CODE: "docs/CODE_OVERVIEW.md",
    DocType.ARCHITECTURE: "docs/ARCHITECTURE.md",
    DocType.DEPLOYMENT: "docs/DEPLOYMENT.md",
}


class DocService:
    """Generates project documentation wrapped as structured change proposals."""

    def __init__(self, provider: Optional[OllamaProvider] = None):
        self.provider = provider or OllamaProvider()

    async def generate_documentation(self, request: DocRequest) -> DocResponse:
        """Generates documentation proposal matching requested DocType."""
        settings = get_settings()
        target_model = request.model or settings.ollama_model

        # Assemble key files into context payload
        related_files = []
        for path, content in (request.key_files or {}).items():
            related_files.append(FileContextItem(path=path, content=content))

        payload = ProjectContextPayload(
            project_name=request.project_name,
            technology=request.technology,
            tree_summary=request.project_tree,
            related_files=related_files,
        )

        context_str = ContextBuilder.build_context_string(payload=payload)

        prompt_instruction = (
            f"{context_str}\n\n"
            f"=== DOCUMENTATION TASK ===\n"
            f"Generate concise, high-quality {request.doc_type.value.upper()} documentation "
            f"for the project '{request.project_name}'.\n"
            f"Provide the complete Markdown document under 500 words with clear headers, overview, and usage."
        )

        messages = [{"role": "user", "content": prompt_instruction}]

        system_prompt = (
            f"{DEVPILOT_CODER_SYSTEM_PROMPT}\n\n"
            f"You are generating documentation for '{request.project_name}'. "
            f"Provide clear, concise Markdown documentation."
        )

        doc_token_budget = min(settings.code_gen_max_tokens, 1024)
        inference_result = await self.provider.generate_chat(
            messages=messages,
            system_prompt=system_prompt,
            temperature=0.2,
            max_tokens=doc_token_budget,
            model=target_model,
        )

        raw_content = inference_result.get("content", "").strip()

        # Wrap into structured proposal for review
        target_path = DOC_PATHS.get(request.doc_type, "README.md")
        proposal = ChangeProposal(
            summary=f"Generate {request.doc_type.value.upper()} documentation",
            explanation=f"Generated structured documentation proposal for {target_path}",
            assumptions="Based on project directory structure and provided key files.",
            changes=[
                ChangeItem(
                    path=target_path,
                    operation=OperationType.CREATE,
                    content=raw_content,
                    explanation=f"Full {request.doc_type.value} documentation content.",
                )
            ],
        )

        return DocResponse(
            doc_type=request.doc_type,
            content=raw_content,
            proposal=proposal,
            model=inference_result.get("model", target_model),
        )
