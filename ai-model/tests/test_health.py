"""Tests for health endpoint and Ollama status inspection."""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_root_endpoint():
    """Verify root endpoint returns basic service descriptor."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "DevPilot AI Service"
    assert data["status"] == "online"


def test_health_endpoint():
    """Verify /health returns HTTP 200 and sanitized metrics."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()

    assert data["service"] == "devpilot-ai"
    assert data["version"] == "1.0.0"
    assert "status" in data
    assert "uptime_seconds" in data
    assert "ollama" in data

    ollama = data["ollama"]
    assert "reachable" in ollama
    assert "model_configured" in ollama
    assert ollama["model_configured"] == "qwen2.5-coder:3b"

    # Verify no sensitive filesystem paths or keys leaked
    raw_text = response.text.lower()
    assert "c:\\" not in raw_text
    assert "/home/" not in raw_text
    assert "password" not in raw_text
    assert "secret" not in raw_text


def test_api_health_alias():
    """Verify /api/health returns identical schema."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["service"] == "devpilot-ai"


def test_process_liveness_endpoint():
    """Verify /health/live and /api/health/live return immediate process status without Ollama probe."""
    for path in ["/health/live", "/api/health/live"]:
        response = client.get(path)
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "devpilot-ai"
        assert "uptime_seconds" in data


def test_ollama_status_endpoint():
    """Verify dedicated /api/ollama/status endpoint returns valid schema."""
    response = client.get("/api/ollama/status")
    assert response.status_code == 200
    data = response.json()
    assert "reachable" in data
    assert "base_url" in data
    assert "model_configured" in data
    assert "model_available" in data
    assert "available_models" in data
    assert "available_models_count" in data
    assert "message" in data


@patch("app.api.health.provider.check_health")
def test_health_status_when_ollama_ready(mock_check_health):
    """Verify health returns status 'ok' when Ollama is reachable and model is available."""
    mock_check_health.return_value = {
        "reachable": True,
        "model_configured": "qwen2.5-coder:3b",
        "model_available": True,
        "available_models_count": 1,
        "models": ["qwen2.5-coder:3b"],
        "message": "Ready"
    }
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["ollama"]["reachable"] is True
    assert data["ollama"]["model_available"] is True


@patch("app.api.health.provider.check_health")
def test_health_status_when_model_missing(mock_check_health):
    """Verify health returns status 'degraded' when Ollama is reachable but model is missing."""
    mock_check_health.return_value = {
        "reachable": True,
        "model_configured": "qwen2.5-coder:3b",
        "model_available": False,
        "available_models_count": 0,
        "models": [],
        "message": "Model not installed"
    }
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "degraded"
    assert data["ollama"]["reachable"] is True
    assert data["ollama"]["model_available"] is False


@patch("app.api.health.provider.check_health")
def test_health_status_when_ollama_down(mock_check_health):
    """Verify health returns status 'degraded' when Ollama daemon is completely unreachable."""
    mock_check_health.return_value = {
        "reachable": False,
        "model_configured": "qwen2.5-coder:7b",
        "model_available": False,
        "available_models_count": 0,
        "models": [],
        "message": "Connection refused"
    }
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "degraded"
    assert data["ollama"]["reachable"] is False


@patch("app.api.ollama.provider.list_available_models")
def test_ollama_models_endpoint_success(mock_list):
    """Verify /api/ollama/models returns list of installed model tags."""
    mock_list.return_value = ["qwen2.5-coder:3b", "llama3.2:3b"]
    response = client.get("/api/ollama/models")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert "qwen2.5-coder:3b" in data

