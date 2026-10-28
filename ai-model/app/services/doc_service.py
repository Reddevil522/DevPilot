"""Documentation Generation Service.

Produces comprehensive documentation (README, API, Architecture, Proposals, Reports, Notes)
as structured file-change proposals for user review before committing to disk.
"""

import re
import time
from typing import List, Optional
from app.context.context_builder import ContextBuilder
from app.core.config import get_settings
from app.core.errors import DevPilotAIException
from app.core.logging import get_logger
from app.prompts.docs import build_document_prompt
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
    DocType.PROPOSAL: "docs/PROPOSAL.md",
    DocType.REPORT: "docs/REPORT.md",
    DocType.MEETING_NOTES: "docs/MEETING_NOTES.md",
    DocType.STUDY_NOTES: "docs/STUDY_NOTES.md",
    DocType.BUSINESS: "docs/BUSINESS_SPEC.md",
    DocType.CUSTOM: "docs/DOCUMENTATION.md",
}


class DocService:
    """Generates project documentation wrapped as structured change proposals."""

    def __init__(self, provider: Optional[OllamaProvider] = None):
        self.provider = provider or OllamaProvider()

    def _normalize_markdown(self, text: str) -> str:
        """Strips accidental outer markdown code fence wrappers produced by the LLM."""
        cleaned = text.strip()
        # If the LLM returned ```markdown ... ``` wrapping the entire text
        pattern = r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$"
        match = re.match(pattern, cleaned, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return cleaned

    def _extract_sections(self, text: str) -> List[str]:
        """Extracts H2 section titles from the markdown content."""
        matches = re.finditer(r"^##\s+(.+)$", text, flags=re.MULTILINE)
        return [m.group(1).strip() for m in matches]

    async def generate_documentation(self, request: DocRequest) -> DocResponse:
        """Generates documentation proposal matching requested DocType or revision instructions."""
        start_time = time.time()
        settings = get_settings()
        target_model = request.model or settings.ollama_model

        # Assemble project context only if requested and available
        context_str = ""
        if request.include_project_context and (request.project_tree or request.key_files):
            related_files = []
            for path, content in (request.key_files or {}).items():
                related_files.append(FileContextItem(path=path, content=content))

            payload = ProjectContextPayload(
                project_name=request.project_name or "Project",
                technology=request.technology or "",
                tree_summary=request.project_tree or "",
                related_files=related_files,
            )
            context_str = ContextBuilder.build_context_string(payload=payload)

        # Build focused, structured prompt
        user_prompt, system_prompt, max_tokens, num_ctx = build_document_prompt(
            request=request,
            context_str=context_str
        )

        messages = [{"role": "user", "content": user_prompt}]

        inference_result = await self.provider.generate_chat(
            messages=messages,
            system_prompt=system_prompt,
            temperature=0.2,
            max_tokens=max_tokens,
            context_size=num_ctx,
            model=target_model,
        )

        raw_content = inference_result.get("content", "").strip()
        normalized_content = self._normalize_markdown(raw_content)

        if not normalized_content:
            logger.error("Ollama returned empty documentation content.")
            raise DevPilotAIException(
                message="AI model returned empty documentation content. Please provide more detailed instructions or topic.",
                code="EMPTY_INFERENCE_OUTPUT",
                status_code=502,
            )

        generation_time_ms = int((time.time() - start_time) * 1000)
        word_count = len(normalized_content.split())
        sections = self._extract_sections(normalized_content)

        # Determine target file path
        target_path = DOC_PATHS.get(request.doc_type, "README.md")
        if request.title and any(request.title.endswith(ext) for ext in [".md", ".markdown", ".txt"]):
            target_path = request.title

        resolved_title = request.title or (
            "README.md" if request.doc_type == DocType.README
            else f"{request.doc_type.value.replace('_', ' ').title()}"
        )

        proposal = ChangeProposal(
            summary=f"Generate {request.doc_type.value.upper()} documentation",
            explanation=f"Generated structured documentation proposal for {target_path}",
            assumptions="Based on project directory structure, key files, and instructions.",
            changes=[
                ChangeItem(
                    path=target_path,
                    operation=OperationType.CREATE if not request.current_content else OperationType.EDIT,
                    content=normalized_content,
                    explanation=f"Full {request.doc_type.value} documentation content.",
                )
            ],
        )

        return DocResponse(
            doc_type=request.doc_type,
            content=normalized_content,
            proposal=proposal,
            model=inference_result.get("model", target_model),
            title=resolved_title,
            word_count=word_count,
            generation_time_ms=generation_time_ms,
            sections=sections,
        )
