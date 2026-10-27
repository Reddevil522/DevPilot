"""DevPilot AI - Configuration Management.

Loads, validates, and exposes settings using Pydantic Settings.
Environment variables can be provided in an .env file or the OS environment.
"""

from functools import lru_cache
from typing import Literal
from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings with runtime validation."""

    # --- HTTP Server Settings ---
    ai_host: str = Field(
        default="127.0.0.1",
        validation_alias=AliasChoices("HOST", "AI_HOST"),
        description="Host interface for the DevPilot AI FastAPI service."
    )
    ai_port: int = Field(
        default=8001,
        validation_alias=AliasChoices("PORT", "AI_PORT"),
        description="Port for the DevPilot AI service."
    )
    debug: bool = Field(
        default=False,
        validation_alias="DEBUG",
        description="Enable debug mode."
    )
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = Field(
        default="INFO",
        validation_alias="LOG_LEVEL",
        description="Logging level."
    )

    # --- Local Ollama Provider Settings ---
    ollama_base_url: str = Field(
        default="http://127.0.0.1:11434",
        validation_alias="OLLAMA_BASE_URL",
        description="Base URL of the local Ollama instance."
    )
    ollama_model: str = Field(
        default="qwen2.5-coder:3b",
        validation_alias="OLLAMA_MODEL",
        description="Default Ollama model name to use for code tasks."
    )
    ollama_timeout_seconds: int = Field(
        default=120,
        validation_alias="OLLAMA_TIMEOUT_SECONDS",
        description="Timeout in seconds for Ollama inference requests."
    )
    ollama_keep_alive: str = Field(
        default="10m",
        validation_alias="OLLAMA_KEEP_ALIVE",
        description="Duration to keep the model loaded in Ollama memory (e.g. 5m, 10m, 15m, 1h)."
    )

    # --- Generation & Context Limits ---
    max_context_tokens: int = Field(
        default=8192,
        validation_alias="MAX_CONTEXT_TOKENS",
        description="Maximum tokens allowed in context window."
    )
    max_output_tokens: int = Field(
        default=4096,
        validation_alias="MAX_OUTPUT_TOKENS",
        description="Maximum output tokens for generated inference."
    )
    default_num_ctx: int = Field(
        default=2048,
        validation_alias="DEFAULT_NUM_CTX",
        description="Default context window size (num_ctx) for memory efficiency on 8 GB RAM."
    )
    chat_max_tokens: int = Field(
        default=384,
        validation_alias="CHAT_MAX_TOKENS",
        description="Default max output tokens for conversational chat."
    )
    explain_max_tokens: int = Field(
        default=512,
        validation_alias="EXPLAIN_MAX_TOKENS",
        description="Default max output tokens for explanation requests."
    )
    debug_max_tokens: int = Field(
        default=768,
        validation_alias="DEBUG_MAX_TOKENS",
        description="Default max output tokens for debugging and review tasks."
    )
    code_gen_max_tokens: int = Field(
        default=1536,
        validation_alias="CODE_GEN_MAX_TOKENS",
        description="Default max output tokens for code generation, test creation, and docs."
    )
    max_concurrent_inferences: int = Field(
        default=1,
        validation_alias="MAX_CONCURRENT_INFERENCES",
        description="Concurrency limit for local inference to protect system memory (e.g., 8 GB RAM)."
    )
    temperature: float = Field(
        default=0.2,
        validation_alias="TEMPERATURE",
        description="Sampling temperature for code generation."
    )

    def get_token_budget_for_operation(self, operation: str) -> int:
        """Returns task-specific max token budget based on operation category."""
        op = (operation or "chat").lower()
        if op == "chat":
            return self.chat_max_tokens
        elif op in ("explain", "explain_code"):
            return self.explain_max_tokens
        elif op in ("debug", "fix", "review"):
            return self.debug_max_tokens
        elif op in ("generate", "generate_code", "test", "document"):
            return self.code_gen_max_tokens
        return self.chat_max_tokens

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore"
    )

    @field_validator("ollama_base_url")
    @classmethod
    def validate_ollama_base_url(cls, v: str) -> str:
        url = v.strip().rstrip("/")
        if not (url.startswith("http://") or url.startswith("https://")):
            raise ValueError("OLLAMA_BASE_URL must start with http:// or https://")
        return url

    @field_validator("ai_port")
    @classmethod
    def validate_port(cls, v: int) -> int:
        if not (1 <= v <= 65535):
            raise ValueError("AI_PORT must be between 1 and 65535")
        return v

    @field_validator("ollama_timeout_seconds")
    @classmethod
    def validate_timeout(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("OLLAMA_TIMEOUT_SECONDS must be greater than 0")
        return v

    @field_validator("ollama_keep_alive")
    @classmethod
    def validate_keep_alive(cls, v: str) -> str:
        val = v.strip()
        if not val:
            raise ValueError("OLLAMA_KEEP_ALIVE cannot be empty")
        return val

    @field_validator("max_context_tokens")
    @classmethod
    def validate_max_context_tokens(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_CONTEXT_TOKENS must be greater than 0")
        return v

    @field_validator("max_output_tokens")
    @classmethod
    def validate_max_output_tokens(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_OUTPUT_TOKENS must be greater than 0")
        return v

    @field_validator("default_num_ctx")
    @classmethod
    def validate_default_num_ctx(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("DEFAULT_NUM_CTX must be greater than 0")
        return v

    @field_validator("chat_max_tokens", "explain_max_tokens", "debug_max_tokens", "code_gen_max_tokens")
    @classmethod
    def validate_task_token_budgets(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Task token budget must be greater than 0")
        return v

    @field_validator("max_concurrent_inferences")
    @classmethod
    def validate_max_concurrent_inferences(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("MAX_CONCURRENT_INFERENCES must be greater than 0")
        return v

    @field_validator("temperature")
    @classmethod
    def validate_temperature(cls, v: float) -> float:
        if not (0.0 <= v <= 2.0):
            raise ValueError("TEMPERATURE must be between 0.0 and 2.0")
        return v


@lru_cache()
def get_settings() -> Settings:
    """Returns cached application settings singleton."""
    return Settings()
