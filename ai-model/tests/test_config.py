"""Unit tests for configuration loading and validation."""

import pytest
from pydantic import ValidationError
from app.core.config import Settings


def test_default_settings():
    """Verify standard default configuration parameters."""
    settings = Settings(_env_file=None)
    assert settings.ai_host == "127.0.0.1"
    assert settings.ai_port == 8001
    assert settings.ollama_base_url == "http://127.0.0.1:11434"
    assert settings.ollama_model == "qwen2.5-coder:3b"
    assert settings.ollama_timeout_seconds == 120
    assert settings.ollama_keep_alive == "10m"
    assert settings.temperature == 0.2
    assert settings.max_context_tokens == 8192
    assert settings.max_output_tokens == 4096
    assert settings.max_concurrent_inferences == 1


def test_url_normalization():
    """Verify trailing slashes are cleanly stripped from Ollama URL."""
    settings = Settings(OLLAMA_BASE_URL="http://192.168.1.50:11434///")
    assert settings.ollama_base_url == "http://192.168.1.50:11434"


def test_invalid_url_scheme():
    """Verify URLs without http:// or https:// are rejected."""
    with pytest.raises(ValidationError):
        Settings(OLLAMA_BASE_URL="ftp://localhost:11434")


def test_invalid_port():
    """Verify out-of-range ports are rejected."""
    with pytest.raises(ValidationError):
        Settings(AI_PORT=99999)

    with pytest.raises(ValidationError):
        Settings(AI_PORT=0)


def test_invalid_timeout():
    """Verify non-positive timeouts are rejected."""
    with pytest.raises(ValidationError):
        Settings(OLLAMA_TIMEOUT_SECONDS=0)

    with pytest.raises(ValidationError):
        Settings(OLLAMA_TIMEOUT_SECONDS=-10)


def test_invalid_tokens_and_concurrency():
    """Verify invalid token limits and concurrency counts are rejected."""
    with pytest.raises(ValidationError):
        Settings(MAX_CONTEXT_TOKENS=0)

    with pytest.raises(ValidationError):
        Settings(MAX_OUTPUT_TOKENS=0)

    with pytest.raises(ValidationError):
        Settings(MAX_CONCURRENT_INFERENCES=0)


def test_invalid_temperature():
    """Verify temperature outside [0.0, 2.0] is rejected."""
    with pytest.raises(ValidationError):
        Settings(TEMPERATURE=-0.1)

    with pytest.raises(ValidationError):
        Settings(TEMPERATURE=2.5)


def test_invalid_keep_alive():
    """Verify empty keep-alive strings are rejected."""
    with pytest.raises(ValidationError):
        Settings(OLLAMA_KEEP_ALIVE="")

    with pytest.raises(ValidationError):
        Settings(OLLAMA_KEEP_ALIVE="   ")

