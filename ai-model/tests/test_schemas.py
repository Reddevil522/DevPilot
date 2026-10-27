"""Unit tests for Pydantic request and response schemas."""

import pytest
from pydantic import ValidationError
from app.schemas.chat import ChatMessage, ChatRequest, Role
from app.schemas.docs import DocRequest, DocType
from app.schemas.proposals import ChangeItem, ChangeProposal, OperationType


def test_change_item_path_sanitization():
    """Verify paths are sanitized to standard forward slashes."""
    item = ChangeItem(
        path=".\\src\\app\\test.ts",
        operation=OperationType.CREATE,
        content="const x = 1;"
    )
    assert item.path == "src/app/test.ts"


def test_change_item_path_traversal_blocked():
    """Verify directory traversal is strictly blocked in file proposals."""
    with pytest.raises(ValidationError):
        ChangeItem(
            path="../../etc/passwd",
            operation=OperationType.EDIT,
            content="evil"
        )


def test_change_item_secret_file_blocked():
    """Verify modification of .env or key files is prohibited."""
    with pytest.raises(ValidationError):
        ChangeItem(
            path=".env",
            operation=OperationType.EDIT,
            content="SECRET=leak"
        )

    with pytest.raises(ValidationError):
        ChangeItem(
            path="config/jwt.key",
            operation=OperationType.CREATE,
            content="key"
        )


def test_chat_request_validation():
    """Verify chat request requires non-empty message."""
    req = ChatRequest(
        message="Explain this function",
        history=[ChatMessage(role=Role.USER, content="Hello")],
        project_context="Project: Test"
    )
    assert req.message == "Explain this function"
    assert len(req.history) == 1

    with pytest.raises(ValidationError):
        ChatRequest(message="")


def test_doc_request_defaults():
    """Verify documentation request defaults to README."""
    req = DocRequest(project_name="DemoApp")
    assert req.doc_type == DocType.README
    assert req.project_name == "DemoApp"
