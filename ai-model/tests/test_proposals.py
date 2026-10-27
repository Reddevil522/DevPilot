"""Unit tests for proposal schemas, path security, and authorization validation."""

import pytest
from pydantic import ValidationError
from app.schemas.proposals import ChangeItem, ChangeProposal, OperationType
from app.services.chat_service import ChatService


def test_valid_proposal_structure():
    """Verify structured change proposal with assumptions and explanation."""
    item = ChangeItem(
        path="src/app/hero.component.ts",
        operation=OperationType.CREATE,
        content="export class HeroComponent {}",
        explanation="Hero banner component",
        assumptions="Uses standard Angular 18 standalone component syntax.",
    )
    proposal = ChangeProposal(
        summary="Create Hero component",
        explanation="Implements landing banner",
        assumptions="No additional external styling library required.",
        changes=[item],
    )
    assert len(proposal.changes) == 1
    assert proposal.changes[0].path == "src/app/hero.component.ts"
    assert proposal.assumptions == "No additional external styling library required."


def test_proposal_path_traversal_rejection():
    """Verify relative traversal escapes are strictly blocked."""
    invalid_paths = [
        "../../etc/shadow",
        "src/../../outside.txt",
        "../parent.js",
        "..\\windows\\system32",
    ]
    for p in invalid_paths:
        with pytest.raises(ValidationError):
            ChangeItem(path=p, operation=OperationType.EDIT, content="data")


def test_proposal_absolute_path_rejection():
    """Verify absolute paths are strictly blocked."""
    invalid_paths = [
        "/etc/nginx/nginx.conf",
        "C:/Users/Admin/secrets.txt",
        "D:\\Windows\\test.js",
    ]
    for p in invalid_paths:
        with pytest.raises(ValidationError):
            ChangeItem(path=p, operation=OperationType.CREATE, content="data")


def test_proposal_sensitive_file_rejection():
    """Verify proposals cannot touch .env, keys, or credentials."""
    sensitive_paths = [
        ".env",
        ".env.local",
        "auth/id_rsa",
        "config/jwt.key",
        "certs/server.crt",
        "secrets/token.secret",
        "credentials.json",
    ]
    for p in sensitive_paths:
        with pytest.raises(ValidationError):
            ChangeItem(path=p, operation=OperationType.EDIT, content="leak")


def test_proposal_blocked_directories_rejection():
    """Verify proposals cannot touch protected directories."""
    blocked_paths = [
        "node_modules/express/index.js",
        ".git/hooks/pre-commit",
        ".venv/Scripts/python.exe",
        "dist/bundle.js",
    ]
    for p in blocked_paths:
        with pytest.raises(ValidationError):
            ChangeItem(path=p, operation=OperationType.CREATE, content="code")


def test_proposal_binary_extension_rejection():
    """Verify proposals cannot create or modify binary files."""
    binary_paths = [
        "assets/image.png",
        "bin/tool.exe",
        "data.zip",
        "model.weights",
    ]
    for p in binary_paths:
        with pytest.raises(ValidationError):
            ChangeItem(path=p, operation=OperationType.CREATE, content="raw")


def test_proposal_authorized_files_enforcement():
    """Verify proposal editing a file outside authorized list is rejected."""
    raw_response = (
        "Here is the change:\n"
        "```devpilot-changes\n"
        "{\n"
        '  "summary": "Edit unauthorized file",\n'
        '  "changes": [\n'
        "    {\n"
        '      "path": "src/unauthorized.ts",\n'
        '      "operation": "edit",\n'
        '      "content": "new code"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```"
    )
    # When authorized_files whitelist does not include src/unauthorized.ts
    authorized = ["src/allowed.ts", "package.json"]
    clean_text, proposal = ChatService.extract_proposal(raw_response, authorized_files=authorized)
    assert proposal is None, "Proposal modifying unauthorized file should be rejected"
