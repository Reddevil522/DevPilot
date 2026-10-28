"""Tests for structured AI operations (explain, generate, debug, fix, review, document, test)."""

from unittest.mock import patch
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.context import AIOperationType
from app.schemas.docs import DocType

client = TestClient(app)


# ==============================================================================
# 1. Code Explanation Operation
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_operation_explain(mock_post):
    """Verify 'explain' operation returns detailed architectural markdown without proposals."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {
                "role": "assistant",
                "content": "### Component Breakdown\n1. `ngOnInit` loads initial data.\n2. `submit` validates form state.",
            },
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {
        "message": "Explain how this component works",
        "operation": "explain",
        "context_data": {
            "project_name": "DemoApp",
            "active_file": {
                "path": "src/app/login.component.ts",
                "content": "export class LoginComponent { ngOnInit() {} }",
            },
        },
    }

    response = client.post("/api/operations/explain", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "Component Breakdown" in data["content"]
    assert data["operation"] == "explain"
    assert data["proposal"] is None


# ==============================================================================
# 2. Code Generation Operation
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_operation_generate(mock_post):
    """Verify 'generate' operation produces a structured create proposal."""
    generated_text = (
        "Here is the generated service:\n\n"
        "```devpilot-changes\n"
        "{\n"
        '  "summary": "Create NotificationService",\n'
        '  "explanation": "Provides toast notifications across Angular components",\n'
        '  "assumptions": "Injectable in root",\n'
        '  "changes": [\n'
        "    {\n"
        '      "path": "src/app/notification.service.ts",\n'
        '      "operation": "create",\n'
        '      "content": "import { Injectable } from \'@angular/core\';\\n@Injectable({ providedIn: \'root\' })\\nexport class NotificationService {}"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```"
    )
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": generated_text},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {
        "message": "Create a notification service",
        "operation": "generate",
    }
    response = client.post("/api/operations/generate", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["proposal"] is not None
    assert data["proposal"]["summary"] == "Create NotificationService"
    assert data["proposal"]["changes"][0]["path"] == "src/app/notification.service.ts"
    assert data["proposal"]["changes"][0]["operation"] == "create"


# ==============================================================================
# 3. Debug & Fix Operations
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_operation_debug(mock_post):
    """Verify 'debug' operation analyzes compiler errors and pinpoints root cause."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {
                "role": "assistant",
                "content": "### Bug Diagnosis\nThe error `NullReferenceException` is caused by `user.profile` being undefined on line 42.",
            },
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {
        "message": "Why is this failing?",
        "operation": "debug",
        "context_data": {
            "error_context": "TypeError: Cannot read properties of undefined (reading 'profile') at line 42",
            "active_file": {
                "path": "src/app/user.ts",
                "content": "function getUser() { return user.profile.name; }",
            },
        },
    }
    response = client.post("/api/operations/debug", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "Bug Diagnosis" in data["content"]
    assert data["operation"] == "debug"


@patch("httpx.AsyncClient.post")
def test_operation_fix(mock_post):
    """Verify 'fix' operation produces an edit proposal fixing the diagnosed bug."""
    fix_text = (
        "Here is the fix with optional chaining:\n\n"
        "```devpilot-changes\n"
        "{\n"
        '  "summary": "Fix null access in getUser",\n'
        '  "explanation": "Added optional chaining to prevent crash when profile is null",\n'
        '  "changes": [\n'
        "    {\n"
        '      "path": "src/app/user.ts",\n'
        '      "operation": "edit",\n'
        '      "content": "function getUser() { return user?.profile?.name ?? \'\'; }"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```"
    )
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": fix_text},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {
        "message": "Fix the null pointer error",
        "operation": "fix",
    }
    response = client.post("/api/operations/fix", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["proposal"] is not None
    assert data["proposal"]["changes"][0]["operation"] == "edit"
    assert "user?.profile?.name" in data["proposal"]["changes"][0]["content"]


# ==============================================================================
# 4. Code Review & Test Generation Operations
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_operation_review(mock_post):
    """Verify 'review' operation provides security and quality findings."""
    review_text = (
        "### Code Quality & Security Audit\n"
        "- **High**: Unsanitized input used in SQL query.\n"
        "- **Medium**: Missing error handler on async promise."
    )
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": review_text},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {"message": "Review my auth controller", "operation": "review"}
    response = client.post("/api/operations/review", json=payload)
    assert response.status_code == 200
    assert "Security Audit" in response.json()["content"]


@patch("httpx.AsyncClient.post")
def test_operation_test(mock_post):
    """Verify 'test' operation suggests unit test suite in a proposal."""
    test_text = (
        "Here are unit tests for your utility:\n\n"
        "```devpilot-changes\n"
        "{\n"
        '  "summary": "Add math utility tests",\n'
        '  "changes": [\n'
        "    {\n"
        '      "path": "src/utils/math.spec.ts",\n'
        '      "operation": "create",\n'
        '      "content": "describe(\'Math\', () => { it(\'adds\', () => { expect(1+1).toBe(2); }); });"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```"
    )
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": test_text},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    payload = {"message": "Generate unit tests", "operation": "test"}
    response = client.post("/api/operations/test", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["proposal"] is not None
    assert data["proposal"]["changes"][0]["path"] == "src/utils/math.spec.ts"


# ==============================================================================
# 5. Documentation Proposal Endpoint (README / API)
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_docs_generate_as_proposal(mock_post):
    """Verify /api/docs/generate returns documentation as a proposal, not auto-overwritten."""
    doc_markdown = "# DevPilot Demo App\n\nFull-stack MEAN application."
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": doc_markdown},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    doc_req = {
        "project_name": "DevPilot",
        "technology": "MEAN Stack",
        "doc_type": "readme",
        "project_tree": "src/\npackage.json",
        "key_files": {
            "package.json": '{"name": "devpilot"}'
        },
    }

    response = client.post("/api/docs/generate", json=doc_req)
    assert response.status_code == 200
    data = response.json()
    assert data["doc_type"] == "readme"
    assert "DevPilot Demo App" in data["content"]
    assert data["proposal"] is not None
    assert data["proposal"]["changes"][0]["path"] == "README.md"
    assert data["proposal"]["changes"][0]["operation"] == "create"
    assert "# DevPilot Demo App" in data["proposal"]["changes"][0]["content"]


@patch("httpx.AsyncClient.post")
def test_docs_revise_as_proposal(mock_post):
    """Verify /api/docs/generate handles revisions and marks operation as EDIT."""
    revised_markdown = "# DevPilot Demo App\n\nUpdated with Docker and Architecture sections."
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": revised_markdown},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    doc_req = {
        "project_name": "DevPilot",
        "doc_type": "readme",
        "title": "README.md",
        "current_content": "# DevPilot Demo App\n\nInitial version.",
        "revision_instruction": "Add Docker setup and Architecture sections.",
    }

    response = client.post("/api/docs/generate", json=doc_req)
    assert response.status_code == 200
    data = response.json()
    assert data["doc_type"] == "readme"
    assert "Updated with Docker" in data["content"]
    assert data["proposal"] is not None
    assert data["proposal"]["changes"][0]["operation"] == "edit"
    assert data["title"] == "README.md"


@patch("httpx.AsyncClient.post")
def test_docs_generate_with_instructions_audience_tone(mock_post):
    """Verify /api/docs/generate handles instructions, audience, tone, length."""
    doc_markdown = "# API Specification\n\n## Overview\n\nREST API.\n\n## Endpoints\n\nGET /users."
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": doc_markdown},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    doc_req = {
        "project_name": "DevPilot",
        "doc_type": "api",
        "title": "API Specification",
        "instructions": "Document user endpoints in detail",
        "audience": "external developers",
        "tone": "technical",
        "length": "medium",
    }

    response = client.post("/api/docs/generate", json=doc_req)
    assert response.status_code == 200
    data = response.json()
    assert data["doc_type"] == "api"
    assert data["title"] == "API Specification"
    assert data["word_count"] > 0
    assert "Overview" in data["sections"]
    assert "Endpoints" in data["sections"]
    assert data["proposal"]["changes"][0]["path"] == "docs/API.md"


@patch("httpx.AsyncClient.post")
def test_docs_generate_normalizes_outer_markdown_fences(mock_post):
    """Verify /api/docs/generate strips accidental outer ```markdown ... ``` fences."""
    raw_wrapped = "```markdown\n# Wrapped Document\n\n## Introduction\n\nContent here.\n```"
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": raw_wrapped},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    doc_req = {
        "project_name": "DevPilot",
        "doc_type": "meeting_notes",
        "title": "Weekly Sync",
    }

    response = client.post("/api/docs/generate", json=doc_req)
    assert response.status_code == 200
    data = response.json()
    assert not data["content"].startswith("```")
    assert not data["content"].endswith("```")
    assert data["content"].startswith("# Wrapped Document")
    assert data["proposal"]["changes"][0]["path"] == "docs/MEETING_NOTES.md"


@patch("httpx.AsyncClient.post")
def test_docs_generate_empty_output_handled(mock_post):
    """Verify /api/docs/generate returns 502 when Ollama outputs empty content."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": "   "},
            "done_reason": "stop",
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    doc_req = {
        "project_name": "DevPilot",
        "doc_type": "readme",
    }

    response = client.post("/api/docs/generate", json=doc_req)
    assert response.status_code == 502
    data = response.json()
    assert data["code"] == "EMPTY_INFERENCE_OUTPUT"


# ==============================================================================
# 6. Invalid Operation Parameter Validation
# ==============================================================================


def test_invalid_operation_rejected():
    """Verify invalid operation name triggers 422."""
    payload = {"message": "Do something unsupported"}
    response = client.post("/api/operations/invalid_op", json=payload)
    assert response.status_code == 422
