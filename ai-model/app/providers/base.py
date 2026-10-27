"""Abstract Base LLM Provider Interface.

Defines the contract for LLM backends (Ollama, etc.).
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseLLMProvider(ABC):
    """Abstract interface for DevPilot AI language model providers."""

    @abstractmethod
    async def generate_chat(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        model: Optional[str] = None,
        context_size: Optional[int] = None,
        raw_request: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Generates a completion dictionary given conversation messages."""
        pass

    @abstractmethod
    async def check_health(self) -> Dict[str, Any]:
        """Checks connectivity to the inference backend and returns metadata."""
        pass

    @abstractmethod
    async def list_available_models(self) -> List[str]:
        """Returns the list of locally available model tags."""
        pass

    @abstractmethod
    async def check_model_availability(self, model_name: str) -> bool:
        """Checks if a specific model tag is available in local Ollama."""
        pass
