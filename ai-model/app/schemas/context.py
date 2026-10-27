"""Project context schemas for DevPilot AI.

Defines validated payloads passed by the trusted Node.js backend gateway,
including project metadata, file contents, selected snippets, and error diagnostics.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class AIOperationType(str, Enum):
    """Supported structured AI operations."""
    CHAT = "chat"
    EXPLAIN = "explain"
    GENERATE = "generate"
    DEBUG = "debug"
    FIX = "fix"
    REVIEW = "review"
    DOCUMENT = "document"
    TEST = "test"


class FileContextItem(BaseModel):
    """Single file context provided by the trusted backend."""
    path: str = Field(..., description="Relative file path within project.")
    content: str = Field(..., description="File text content.")
    is_active: bool = Field(default=False, description="Whether this is the user's active editor file.")
    original_hash: Optional[str] = Field(default="", description="SHA256 hash of the original file content.")

    @field_validator("path")
    @classmethod
    def sanitize_path(cls, v: str) -> str:
        clean = v.strip().replace("\\", "/")
        if ".." in clean.split("/"):
            raise ValueError("Path traversal is not permitted.")
        if clean.startswith("/") or (len(clean) > 1 and clean[1] == ":"):
            raise ValueError("Absolute paths are not permitted.")
        while clean.startswith("./"):
            clean = clean[2:]
        if clean.startswith("/"):
            clean = clean[1:]
        return clean


class ProjectContextPayload(BaseModel):
    """Structured project context passed by the trusted Node.js backend."""
    project_id: Optional[str] = Field(None, description="Authorized project identifier.")
    project_name: Optional[str] = Field(None, description="Project display name.")
    technology: Optional[str] = Field(None, description="Primary framework or language stack.")
    tree_summary: Optional[str] = Field(None, description="Filtered directory tree string.")
    authorized_files: List[str] = Field(default_factory=list, description="Whitelist of authorized relative paths.")
    active_file: Optional[FileContextItem] = Field(None, description="Currently active file in editor.")
    related_files: List[FileContextItem] = Field(default_factory=list, description="Relevant related project files.")
    selected_code: Optional[str] = Field(None, max_length=10000, description="User highlighted code snippet.")
    error_context: Optional[str] = Field(None, max_length=15000, description="Compiler, terminal, or runtime error diagnostics.")
