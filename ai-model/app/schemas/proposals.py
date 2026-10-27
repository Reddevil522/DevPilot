"""File change proposal schemas.

Enforces structured file changes and validates paths against traversal, protected files,
and binary/sensitive files.
"""

from enum import Enum
import os
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


class OperationType(str, Enum):
    """Permitted file proposal operations."""
    CREATE = "create"
    EDIT = "edit"


# Blacklist of extensions and filenames that must never be modified by AI proposals
SENSITIVE_EXTENSIONS = (
    ".key", ".pem", ".cert", ".pfx", ".p12", ".crt", ".cer",
    ".token", ".secret", ".credential", ".env", ".npmrc", ".htpasswd",
)

BLOCKED_DIRECTORIES = (
    ".git", "node_modules", "dist", "build", ".venv", "__pycache__",
    ".idea", ".vscode", ".devpilot", ".cache", "coverage", "logs",
)

BINARY_EXTENSIONS = (
    ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".zip", ".tar",
    ".gz", ".7z", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf",
    ".pyc", ".pyo", ".weights", ".onnx",
)


class ChangeItem(BaseModel):
    """A proposed modification to a single relative file path."""
    path: str = Field(..., description="Relative file path within project.")
    operation: OperationType = Field(..., description="Operation: 'create' or 'edit'.")
    content: str = Field(..., description="Full content of the file.")
    original_content: Optional[str] = Field(default="", description="Original file content if editing.")
    original_hash: Optional[str] = Field(default="", description="SHA256 of original content.")
    explanation: Optional[str] = Field(default="", description="Explanation of changes.")
    assumptions: Optional[str] = Field(default="", description="Assumptions made for this specific file.")

    @field_validator("path")
    @classmethod
    def sanitize_path(cls, v: str) -> str:
        raw = v.strip().replace("\\", "/")
        if not raw:
            raise ValueError("File path cannot be empty.")

        # Check path traversal on raw input before any stripping
        segments = [s for s in raw.split("/") if s]
        if ".." in raw.split("/"):
            raise ValueError("Path traversal ('..') is not permitted.")
        if raw.startswith("/") or (len(raw) > 1 and raw[1] == ":"):
            raise ValueError("Absolute paths are not permitted.")

        # Safely remove leading './' prefix without stripping dot from dotfiles like .env
        clean = raw
        while clean.startswith("./"):
            clean = clean[2:]
        if clean.startswith("/"):
            clean = clean.lstrip("/")

        if not clean:
            raise ValueError("File path cannot be empty.")

        # Check for blocked directories
        parts = clean.split("/")
        for part in parts[:-1]:
            if part.lower() in BLOCKED_DIRECTORIES:
                raise ValueError(f"Operations inside '{part}' directory are prohibited.")

        # Check sensitive filenames and extensions
        base = parts[-1].lower()
        if base == ".env" or base.startswith(".env."):
            raise ValueError("Proposing modifications to sensitive environment files is prohibited.")

        if base.endswith(SENSITIVE_EXTENSIONS) or any(s in base for s in ("secret", "credential", "private_key")):
            raise ValueError(f"Proposing modifications to sensitive file '{base}' is prohibited.")

        if base.startswith(("id_rsa", "id_ed25519", "id_ecdsa")):
            raise ValueError("Proposing modifications to SSH/private keys is prohibited.")

        if base.endswith(BINARY_EXTENSIONS):
            raise ValueError(f"Binary file modification '{base}' is not supported.")

        return clean


class ChangeProposal(BaseModel):
    """Container for grouped file changes."""
    summary: str = Field(default="Proposed code changes", description="High-level summary.")
    explanation: Optional[str] = Field(default="", description="Detailed rationale for the proposal.")
    assumptions: Optional[str] = Field(default="", description="Assumptions made by the AI during generation.")
    changes: List[ChangeItem] = Field(default_factory=list, description="List of proposed file changes.")
