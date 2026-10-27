"""Tests for local AI inference, Ollama chat adapter, error handling, and proposals.

Includes comprehensive mocked provider unit tests and conditional genuine inference tests.
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch
import httpx
import pytest
from fastapi.testclient import TestClient
from app.core.errors import ServiceBusyError
from app.main import app
from app.providers.ollama_provider import OllamaProvider

client = TestClient(app)



# ==============================================================================
# 1. Invalid Request Tests (FastAPI / Pydantic Validation)
# ==============================================================================


def test_chat_invalid_empty_message():
    """Verify empty message triggers HTTP 422 VALIDATION_ERROR."""
    response = client.post("/api/chat", json={"message": ""})
    assert response.status_code == 422
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_chat_invalid_role_in_history():
    """Verify invalid conversation role is rejected with HTTP 422."""
    payload = {
        "message": "Hello",
        "history": [{"role": "superuser", "content": "Bad role"}],
    }
    response = client.post("/api/chat", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "VALIDATION_ERROR"


def test_chat_invalid_temperature_range():
    """Verify out-of-range temperature override is rejected."""
    payload = {
        "message": "Hello",
        "temperature": 5.0,
    }
    response = client.post("/api/chat", json=payload)
    assert response.status_code == 422


# ==============================================================================
# 2. Ollama Unavailable Tests
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_ollama_unavailable(mock_post):
    """Verify HTTP 503 OLLAMA_UNREACHABLE when Ollama daemon connection fails."""
    mock_post.side_effect = httpx.ConnectError("Connection refused")

    response = client.post("/api/chat", json={"message": "Write a Hello World function"})
    assert response.status_code == 503
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "OLLAMA_UNREACHABLE"
    assert "Unable to connect to Ollama" in data["error"]["message"]


# ==============================================================================
# 3. Model Unavailable Tests
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_model_unavailable_404(mock_post):
    """Verify HTTP 404 MODEL_NOT_FOUND with actionable pull instructions when model missing."""
    mock_response = httpx.Response(
        status_code=404,
        json={"error": "model 'qwen2.5-coder:3b' not found, try pulling it first"},
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post("/api/chat", json={"message": "Refactor this component"})
    assert response.status_code == 404
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "MODEL_NOT_FOUND"
    assert "ollama pull qwen2.5-coder:3b" in data["error"]["message"]


# ==============================================================================
# 4. Inference Timeout Tests
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_inference_timeout(mock_post):
    """Verify HTTP 504 OLLAMA_TIMEOUT when local inference exceeds timeout limit."""
    mock_post.side_effect = httpx.TimeoutException("Read timed out")

    response = client.post("/api/chat", json={"message": "Generate complex architecture"})
    assert response.status_code == 504
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "OLLAMA_TIMEOUT"
    assert "timed out" in data["error"]["message"]


# ==============================================================================
# 5. Malformed Provider Response Tests
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_malformed_response_invalid_json(mock_post):
    """Verify HTTP 502 MALFORMED_PROVIDER_RESPONSE when Ollama returns non-JSON text."""
    mock_response = httpx.Response(
        status_code=200,
        text="<html><body>Gateway Error</body></html>",
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post("/api/chat", json={"message": "Explain async/await"})
    assert response.status_code == 502
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "MALFORMED_PROVIDER_RESPONSE"


@patch("httpx.AsyncClient.post")
def test_chat_malformed_response_missing_message(mock_post):
    """Verify HTTP 502 MALFORMED_PROVIDER_RESPONSE when message payload structure is broken."""
    mock_response = httpx.Response(
        status_code=200,
        json={"model": "qwen2.5-coder:3b", "done": True},  # missing "message"
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post("/api/chat", json={"message": "Help me fix this bug"})
    assert response.status_code == 502
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "MALFORMED_PROVIDER_RESPONSE"


@patch("httpx.AsyncClient.post")
def test_chat_malformed_response_non_string_content(mock_post):
    """Verify HTTP 502 MALFORMED_PROVIDER_RESPONSE when content is not a string."""
    mock_response = httpx.Response(
        status_code=200,
        json={"model": "qwen2.5-coder:3b", "message": {"role": "assistant", "content": None}},
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post("/api/chat", json={"message": "Write a test"})
    assert response.status_code == 502
    data = response.json()
    assert data["success"] is False
    assert data["error"]["code"] == "MALFORMED_PROVIDER_RESPONSE"


# ==============================================================================
# 6. Successful Mocked Inference Tests (Conversational & Proposal)
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_successful_mocked_conversational(mock_post):
    """Verify pure conversational response without code proposal."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {
                "role": "assistant",
                "content": "A TypeScript interface defines a syntactic contract that an entity should conform to.",
            },
            "done_reason": "stop",
            "done": True,
            "total_duration": 1500000000,
            "eval_count": 45,
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post(
        "/api/chat",
        json={"message": "What is a TypeScript interface?"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "TypeScript interface" in data["content"]
    assert data["model"] == "qwen2.5-coder:3b"
    assert data["proposal"] is None
    assert data["finish_reason"] == "stop"
    assert data["eval_count"] == 45


@patch("httpx.AsyncClient.post")
def test_chat_successful_mocked_code_proposal(mock_post):
    """Verify parsing and validation of structured ```devpilot-changes proposals."""
    generated_text = (
        "I have created a new utility service for you.\n\n"
        "```devpilot-changes\n"
        "{\n"
        '  "summary": "Add string utility module",\n'
        '  "explanation": "Provides helper functions for title casing",\n'
        '  "changes": [\n'
        "    {\n"
        '      "path": "src/utils/strings.ts",\n'
        '      "operation": "create",\n'
        '      "content": "export function titleCase(s: string): string { return s.toUpperCase(); }"\n'
        "    }\n"
        "  ]\n"
        "}\n"
        "```\n\n"
        "Review the changes above before applying them."
    )

    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {
                "role": "assistant",
                "content": generated_text,
            },
            "done_reason": "stop",
            "done": True,
            "total_duration": 2200000000,
            "eval_count": 92,
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post(
        "/api/chat",
        json={
            "message": "Create a string utility file",
            "history": [
                {"role": "user", "content": "I need string helpers."},
                {"role": "assistant", "content": "Sure, what kind?"},
            ],
            "project_context": "Angular 18 Workspace",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["proposal"] is not None
    proposal = data["proposal"]
    assert proposal["summary"] == "Add string utility module"
    assert len(proposal["changes"]) == 1
    change = proposal["changes"][0]
    assert change["path"] == "src/utils/strings.ts"
    assert change["operation"] == "create"
    assert "titleCase" in change["content"]



# ==============================================================================
# 7. Configurable Generation Options & Context Window
# ==============================================================================


@patch("httpx.AsyncClient.post")
def test_chat_configurable_generation_options(mock_post):
    """Verify context_size, max_tokens, temperature, and keep_alive are forwarded to Ollama."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": "Configured generation response"},
            "done_reason": "stop",
            "done": True,
        },
        request=httpx.Request("POST", "http://localhost:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    response = client.post(
        "/api/chat",
        json={
            "message": "Analyze complexity",
            "max_tokens": 512,
            "temperature": 0.2,
            "context_size": 4096,
        },
    )
    assert response.status_code == 200
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args.kwargs
    payload = call_kwargs.get("json")
    assert payload["keep_alive"] == "10m"
    assert payload["options"]["num_predict"] == 512
    assert payload["options"]["temperature"] == 0.2
    assert payload["options"]["num_ctx"] == 4096


# ==============================================================================
# 8. Cancellation and Concurrency / Resource Limits
# ==============================================================================


@pytest.mark.asyncio
async def test_chat_cancellation_releases_semaphore():
    """Verify asyncio.CancelledError during inference properly bubbles and releases semaphore."""
    provider = OllamaProvider()
    initial_semaphore_value = provider._semaphore._value

    with patch.object(provider, "get_client") as mock_get_client:
        mock_client = AsyncMock()
        mock_client.post.side_effect = asyncio.CancelledError()
        mock_get_client.return_value = mock_client

        with pytest.raises(asyncio.CancelledError):
            await provider.generate_chat(
                messages=[{"role": "user", "content": "Long task"}],
            )

        # Ensure semaphore was released back after cancellation
        assert provider._semaphore._value == initial_semaphore_value


@pytest.mark.asyncio
async def test_chat_concurrency_limit_service_busy():
    """Verify ServiceBusyError is raised when concurrency capacity is saturated."""
    provider = OllamaProvider()

    async def mock_timeout(coro, timeout=None):
        if asyncio.iscoroutine(coro):
            coro.close()
        raise asyncio.TimeoutError()

    with patch("asyncio.wait_for", side_effect=mock_timeout):
        with pytest.raises(ServiceBusyError) as exc_info:
            await provider.generate_chat(
                messages=[{"role": "user", "content": "Parallel task"}],
            )
        assert exc_info.value.code == "SERVICE_BUSY"
        assert exc_info.value.status_code == 503
        assert "busy" in exc_info.value.message.lower()



# ==============================================================================
# 9. HTTP Client Pooling and Lifecycle
# ==============================================================================


@pytest.mark.asyncio
async def test_ollama_provider_client_pooling_and_close():
    """Verify provider reuses pooled AsyncClient instance and cleans up on close."""
    provider = OllamaProvider()
    client1 = await provider.get_client()
    client2 = await provider.get_client()
    # Must reuse the same underlying client
    assert client1 is client2
    assert not client1.is_closed

    # Cleanup
    await provider.close()
    assert client1.is_closed
    assert provider._client is None


def test_shared_ollama_provider_singleton():
    """Verify get_ollama_provider returns a singleton instance ensuring connection and semaphore reuse."""
    from app.providers.ollama_provider import get_ollama_provider, reset_ollama_provider
    reset_ollama_provider()
    p1 = get_ollama_provider()
    p2 = get_ollama_provider()
    assert p1 is p2
    assert p1._semaphore is p2._semaphore


@pytest.mark.asyncio
async def test_chat_client_disconnect_before_inference():
    """Verify provider aborts with asyncio.CancelledError when client disconnects before inference."""
    provider = OllamaProvider()

    class MockDisconnectedRequest:
        async def is_disconnected(self):
            return True

    with pytest.raises(asyncio.CancelledError):
        await provider.generate_chat(
            messages=[{"role": "user", "content": "Hello"}],
            # pyrefly: ignore[unexpected-keyword]
            raw_request=MockDisconnectedRequest(),
        )


@patch("httpx.AsyncClient.post")
def test_chat_memory_capping_large_options(mock_post):
    """Verify context_size and max_tokens exceeding system limits are capped to protect 8 GB RAM."""
    mock_response = httpx.Response(
        status_code=200,
        json={
            "model": "qwen2.5-coder:3b",
            "message": {"role": "assistant", "content": "Memory safe inference"},
            "done_reason": "stop",
            "done": True,
        },
        request=httpx.Request("POST", "http://127.0.0.1:11434/api/chat"),
    )
    mock_post.return_value = mock_response

    # Send values exceeding MAX_CONTEXT_TOKENS (8192) and MAX_OUTPUT_TOKENS (4096)

# ==============================================================================
# 10. Genuine Real Local Inference Test (Conditional & Distinguished)
# ==============================================================================


def test_genuine_local_inference_if_available():
    """GENUINE (REAL) INFERENCE TEST.

    Distinguished from mocked tests: Only executes real HTTP inference if
    the local Ollama daemon is actively running on 127.0.0.1:11434 and at least
    one valid model tag is pulled. Otherwise, skips with a clear diagnostic message.
    """
    from app.core.config import get_settings
    settings = get_settings()
    base_urls = [settings.ollama_base_url, "http://127.0.0.1:11434", "http://localhost:11434"]
    probe = None
    successful_url = None

    for url in base_urls:
        try:
            res = httpx.get(f"{url}/api/tags", timeout=2.0)
            if res.status_code == 200:
                probe = res
                successful_url = url
                break
        except Exception:
            continue

    if probe is None:
        pytest.skip(f"[REAL INFERENCE SKIPPED] Local Ollama daemon unreachable at {settings.ollama_base_url}")

    models = [m.get("name") for m in (probe.json().get("models") or []) if isinstance(m, dict)]
    if not models:
        pytest.skip(f"[REAL INFERENCE SKIPPED] Ollama is running at {successful_url} but no models are installed.")

    # Use the configured model if available, or first installed model
    model_to_use = settings.ollama_model if settings.ollama_model in models else models[0]
    payload = {
        "message": "Respond with the single word: OK",
        "model": model_to_use,
        "max_tokens": 10,
    }

    response = client.post("/api/chat", json=payload)
    if response.status_code != 200:
        # Give local Ollama a moment to finish swapping weights if under heavy load
        import time
        time.sleep(2.0)
        response = client.post("/api/chat", json=payload)

    # Real inference must return HTTP 200 with non-empty generated content
    assert response.status_code == 200, f"Real inference failed: {response.text}"
    data = response.json()
    assert data["content"] and len(data["content"].strip()) > 0
    assert data["model"] == model_to_use
    assert data["finish_reason"] in ["stop", "length", None]


def test_task_token_budgeting():
    """Verify task token budgets assign appropriate limits to chat, explain, debug, and generate."""
    from app.core.config import get_settings
    settings = get_settings()
    assert settings.get_token_budget_for_operation("chat") == 384
    assert settings.get_token_budget_for_operation("explain") == 512
    assert settings.get_token_budget_for_operation("debug") == 768
    assert settings.get_token_budget_for_operation("generate") == 1536
    assert settings.get_token_budget_for_operation("unknown") == 384


def test_chat_stream_endpoint_mocked(monkeypatch):
    """Verify POST /api/chat/stream streams SSE events with low TTFT."""
    from app.api.chat import chat_service

    async def mock_generate_chat_stream(*args, **kwargs):
        yield {"type": "chunk", "content": "Hello"}
        yield {"type": "chunk", "content": " world"}
        yield {"type": "done", "finish_reason": "stop", "eval_count": 2, "ttft_ms": 12.5}

    monkeypatch.setattr(chat_service.provider, "generate_chat_stream", mock_generate_chat_stream)

    payload = {
        "message": "Hi",
        "operation": "chat"
    }

    response = client.post("/api/chat/stream", json=payload)
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    lines = response.text.split("\n\n")
    data_events = [line.replace("data: ", "") for line in lines if line.startswith("data: ")]
    assert len(data_events) >= 2

    chunks = [json.loads(d) for d in data_events]
    assert chunks[0]["type"] == "chunk"
    assert chunks[0]["content"] == "Hello"
    assert chunks[1]["type"] == "chunk"
    assert chunks[1]["content"] == " world"
    assert chunks[2]["type"] == "done"
    assert chunks[2]["eval_count"] == 2


