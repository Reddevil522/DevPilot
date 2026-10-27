"""Chat request and response schemas."""

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field
from app.schemas.context import AIOperationType, ProjectContextPayload
from app.schemas.proposals import ChangeProposal


class Role(str, Enum):
    """Message sender role."""
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessage(BaseModel):
    """Single conversation turn."""
    id: Optional[str] = Field(None, description="Message identifier.")
    role: Role = Field(..., description="Role of the sender.")
    content: str = Field(..., description="Text content.")
    timestamp: Optional[datetime] = Field(default_factory=lambda: datetime.now(timezone.utc), description="Message timestamp.")
    proposal: Optional[ChangeProposal] = Field(None, description="Structured proposal if present.")


class ChatRequest(BaseModel):
    """Incoming chat request from DevPilot Node.js backend."""
    message: str = Field(..., min_length=1, max_length=50000, description="User instruction or question.")
    operation: AIOperationType = Field(default=AIOperationType.CHAT, description="Target AI operation.")
    history: List[ChatMessage] = Field(default_factory=list, description="Prior conversation messages.")
    context_data: Optional[ProjectContextPayload] = Field(None, description="Structured project context provided by backend.")
    project_context: Optional[str] = Field(default="", max_length=100000, description="Pre-rendered or legacy string context.")
    model: Optional[str] = Field(None, description="Override model name.")
    temperature: Optional[float] = Field(None, ge=0.0, le=2.0, description="Optional temperature override.")
    max_tokens: Optional[int] = Field(None, ge=1, le=32768, description="Optional maximum output tokens override (num_predict).")
    context_size: Optional[int] = Field(None, ge=512, le=32768, description="Optional context window size override (num_ctx).")


class ChatResponse(BaseModel):
    """Outgoing response to DevPilot Node.js backend."""
    content: str = Field(..., description="Conversational Markdown response.")
    operation: AIOperationType = Field(default=AIOperationType.CHAT, description="Operation executed.")
    proposal: Optional[ChangeProposal] = Field(None, description="Structured changes to review.")
    model: str = Field(..., description="Model that produced the inference.")
    finish_reason: Optional[str] = Field("stop", description="Generation completion reason.")
    eval_count: Optional[int] = Field(None, description="Tokens evaluated by Ollama.")
    total_duration_ms: Optional[float] = Field(None, description="Total inference duration in milliseconds.")
