"""Documentation generation schemas."""

from enum import Enum
from typing import Dict, Optional
from pydantic import BaseModel, Field
from app.schemas.proposals import ChangeProposal


class DocType(str, Enum):
    """Supported documentation types."""
    README = "readme"
    API = "api"
    CODE = "code"
    ARCHITECTURE = "architecture"
    DEPLOYMENT = "deployment"


class DocRequest(BaseModel):
    """Incoming request to generate project documentation."""
    project_name: str = Field(..., description="Name of the DevPilot project.")
    technology: Optional[str] = Field(default="", description="Project technology stack.")
    doc_type: DocType = Field(default=DocType.README, description="Type of documentation requested.")
    project_tree: Optional[str] = Field(default="", description="Sanitized directory tree.")
    key_files: Optional[Dict[str, str]] = Field(default_factory=dict, description="Key files mapped to content.")
    model: Optional[str] = Field(None, description="Model override.")


class DocResponse(BaseModel):
    """Outgoing generated documentation response returning documentation as a proposal for review."""
    doc_type: DocType = Field(..., description="Type of documentation generated.")
    content: str = Field(..., description="Generated documentation in Markdown.")
    proposal: Optional[ChangeProposal] = Field(None, description="Structured proposal to review before saving.")
    model: str = Field(..., description="Model that produced the documentation.")
