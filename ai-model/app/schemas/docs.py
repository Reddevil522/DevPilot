"""Documentation generation schemas."""

from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field
from app.schemas.proposals import ChangeProposal


class DocType(str, Enum):
    """Supported documentation types."""
    README = "readme"
    API = "api"
    CODE = "code"
    ARCHITECTURE = "architecture"
    DEPLOYMENT = "deployment"
    PROPOSAL = "proposal"
    REPORT = "report"
    MEETING_NOTES = "meeting_notes"
    STUDY_NOTES = "study_notes"
    BUSINESS = "business"
    CUSTOM = "custom"


class DocRequest(BaseModel):
    """Incoming request to generate project documentation."""
    project_name: Optional[str] = Field(default="Project", description="Name of the DevPilot project.")
    technology: Optional[str] = Field(default="", description="Project technology stack.")
    doc_type: DocType = Field(default=DocType.README, description="Type of documentation requested.")
    title: Optional[str] = Field(default=None, description="Optional custom document title.")
    instructions: Optional[str] = Field(default=None, description="Optional custom instructions, topic, or prompt.")
    source_content: Optional[str] = Field(default=None, description="Optional source code, meeting transcript, or reference content.")
    audience: Optional[str] = Field(default=None, description="Target audience (e.g. developers, stakeholders, internal team).")
    tone: Optional[str] = Field(default=None, description="Tone of the document (e.g. technical, formal, concise).")
    length: Optional[str] = Field(default=None, description="Desired document length (short, medium, comprehensive).")
    include_project_context: Optional[bool] = Field(default=True, description="Whether to include directory tree and key project files.")
    current_content: Optional[str] = Field(default=None, description="Existing document content for revision.")
    revision_instruction: Optional[str] = Field(default=None, description="Instructions describing changes to make.")
    project_tree: Optional[str] = Field(default="", description="Sanitized directory tree.")
    key_files: Optional[Dict[str, str]] = Field(default_factory=dict, description="Key files mapped to content.")
    model: Optional[str] = Field(None, description="Model override.")


class DocResponse(BaseModel):
    """Outgoing generated documentation response returning documentation as a proposal for review."""
    doc_type: DocType = Field(..., description="Type of documentation generated.")
    content: str = Field(..., description="Generated documentation in Markdown.")
    proposal: Optional[ChangeProposal] = Field(None, description="Structured proposal to review before saving.")
    model: str = Field(..., description="Model that produced the documentation.")
    title: Optional[str] = Field(default=None, description="Document title.")
    word_count: Optional[int] = Field(default=0, description="Word count of the generated document.")
    generation_time_ms: Optional[int] = Field(default=0, description="Inference time in milliseconds.")
    sections: Optional[List[str]] = Field(default_factory=list, description="Top-level section headers detected.")
