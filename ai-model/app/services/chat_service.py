"""DevPilot AI - Chat and Inference Orchestration Service.

Coordinates project context assembly, operation-specific system prompts,
Ollama inference execution, and proposal validation.
"""

import json
import re
from typing import Any, AsyncGenerator, Optional, Tuple
from app.context.context_builder import ContextBuilder
from app.core.config import get_settings
from app.core.logging import get_logger
from app.prompts.operations import get_operation_system_prompt
from app.providers.ollama_provider import OllamaProvider, get_ollama_provider
from app.schemas.chat import ChatRequest, ChatResponse
from app.schemas.context import AIOperationType
from app.schemas.proposals import ChangeProposal

logger = get_logger("chat_service")


class ChatService:
    """Orchestrates AI chat completions, operations, and code proposal parsing."""

    def __init__(self, provider: Optional[OllamaProvider] = None):
        self.provider = provider or get_ollama_provider()

    @staticmethod
    def extract_proposal(
        content: str,
        authorized_files: Optional[list] = None,
    ) -> Tuple[str, Optional[ChangeProposal]]:
        """Parses and validates ```devpilot-changes JSON blocks in LLM output."""
        pattern = r"```devpilot-changes\s*([\s\S]*?)\s*```"
        match = re.search(pattern, content)
        if not match:
            return content, None

        json_str = match.group(1).strip()
        try:
            parsed = json.loads(json_str)
        except Exception as e:
            logger.warning(f"Failed to parse devpilot-changes JSON block: {e}")
            return content, None

        if not isinstance(parsed, dict) or "changes" not in parsed:
            return content, None

        try:
            proposal = ChangeProposal.model_validate(parsed)

            # If authorized_files whitelist is provided, verify proposed files stay in scope
            if authorized_files:
                auth_set = {f.replace("\\", "/").lstrip("./") for f in authorized_files}
                for change in proposal.changes:
                    clean_path = change.path.replace("\\", "/").lstrip("./")
                    # If edit operation, path must be in authorized set
                    if change.operation.value == "edit" and clean_path not in auth_set:
                        logger.warning(f"Rejecting proposal for unauthorized file: {clean_path}")
                        return content, None

            return content, proposal
        except Exception as e:
            logger.warning(f"devpilot-changes failed schema validation: {e}")
            return content, None

    async def process_chat(
        self,
        request: ChatRequest,
        raw_request: Optional[Any] = None,
    ) -> ChatResponse:
        """Processes a project-aware chat or operation request through Ollama."""
        settings = get_settings()
        target_model = request.model or settings.ollama_model

        # Limit conversation history to recent turns (last 10) to reduce prompt evaluation overhead
        messages = []
        for turn in request.history[-10:]:
            messages.append({"role": turn.role.value, "content": turn.content})

        # Build prioritized, sanitized context string
        context_str = ContextBuilder.build_context_string(
            payload=request.context_data,
            raw_context=request.project_context,
        )

        user_content = request.message
        if context_str:
            user_content = f"{context_str}\n\n=== USER INSTRUCTION / QUESTION ===\n{request.message}"

        messages.append({"role": "user", "content": user_content})

        # Select operation-tailored system prompt
        system_prompt = get_operation_system_prompt(request.operation)

        # Enforce task-specific token budget and context size
        max_tokens = request.max_tokens or settings.get_token_budget_for_operation(request.operation.value)
        context_size = request.context_size or settings.default_num_ctx

        # Execute inference through Ollama
        inference_result = await self.provider.generate_chat(
            messages=messages,
            system_prompt=system_prompt,
            temperature=request.temperature,
            max_tokens=max_tokens,
            model=target_model,
            context_size=context_size,
            # pyrefly: ignore[unexpected-keyword]
            raw_request=raw_request,
        )

        raw_content = inference_result.get("content", "")
        auth_files = request.context_data.authorized_files if request.context_data else None
        clean_content, proposal = self.extract_proposal(raw_content, authorized_files=auth_files)

        duration_ms = None
        if inference_result.get("total_duration"):
            duration_ms = round(inference_result["total_duration"] / 1_000_000, 2)

        return ChatResponse(
            content=clean_content,
            operation=request.operation,
            proposal=proposal,
            model=inference_result.get("model", target_model),
            finish_reason=inference_result.get("finish_reason", "stop"),
            eval_count=inference_result.get("eval_count"),
            total_duration_ms=duration_ms,
        )

    async def process_chat_stream(
        self,
        request: ChatRequest,
        raw_request: Optional[Any] = None,
    ) -> AsyncGenerator[str, None]:
        """Processes a chat request as an SSE stream with progressive token emission."""
        settings = get_settings()
        target_model = request.model or settings.ollama_model

        # Limit conversation history to recent turns (last 10)
        messages = []
        for turn in request.history[-10:]:
            messages.append({"role": turn.role.value, "content": turn.content})

        # Build prioritized, sanitized context string
        context_str = ContextBuilder.build_context_string(
            payload=request.context_data,
            raw_context=request.project_context,
        )

        user_content = request.message
        if context_str:
            user_content = f"{context_str}\n\n=== USER INSTRUCTION / QUESTION ===\n{request.message}"

        messages.append({"role": "user", "content": user_content})

        system_prompt = get_operation_system_prompt(request.operation)
        max_tokens = request.max_tokens or settings.get_token_budget_for_operation(request.operation.value)
        context_size = request.context_size or settings.default_num_ctx

        accumulated_content = []
        auth_files = request.context_data.authorized_files if request.context_data else None

        async for event in self.provider.generate_chat_stream(
            messages=messages,
            system_prompt=system_prompt,
            temperature=request.temperature,
            max_tokens=max_tokens,
            model=target_model,
            context_size=context_size,
            raw_request=raw_request,
        ):
            event_type = event.get("type")
            if event_type == "chunk":
                delta = event.get("content", "")
                accumulated_content.append(delta)
                yield f"data: {json.dumps({'type': 'chunk', 'content': delta})}\n\n"
            elif event_type == "done":
                full_text = "".join(accumulated_content)
                clean_content, proposal = self.extract_proposal(full_text, authorized_files=auth_files)
                if proposal is not None:
                    yield f"data: {json.dumps({'type': 'proposal', 'proposal': proposal.model_dump()})}\n\n"
                yield f"data: {json.dumps({'type': 'done', 'model': target_model, 'eval_count': event.get('eval_count'), 'finish_reason': event.get('finish_reason', 'stop'), 'ttft_ms': event.get('ttft_ms')})}\n\n"
