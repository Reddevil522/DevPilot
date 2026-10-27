"""Ollama LLM Provider Implementation.

Communicates with local Ollama daemon via its REST API (http://localhost:11434).
Handles chat completions, health and model availability probes, timeouts, and resource control.
Reuses pooled HTTP clients across requests to minimize connection latency.
"""

import asyncio
import json
import time
from typing import Any, AsyncGenerator, Dict, List, Optional
import httpx
from app.core.config import get_settings
from app.core.errors import (
    DevPilotAIException,
    MalformedProviderResponseError,
    ModelNotFoundError,
    OllamaConnectionError,
    OllamaTimeoutError,
    ServiceBusyError,
)
from app.core.logging import get_logger
from app.providers.base import BaseLLMProvider

logger = get_logger("ollama_provider")


class OllamaProvider(BaseLLMProvider):
    """Client adapter for local Ollama instance with connection pooling and concurrency control."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: Optional[int] = None,
        keep_alive: Optional[str] = None,
        client: Optional[httpx.AsyncClient] = None,
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.default_model = default_model or settings.ollama_model
        self.timeout = timeout or settings.ollama_timeout_seconds
        self.keep_alive = keep_alive or settings.ollama_keep_alive
        # Concurrency semaphore to prevent parallel inference thrashing system memory (e.g., 8 GB RAM)
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_inferences)
        self._client: Optional[httpx.AsyncClient] = client

    async def get_client(self) -> httpx.AsyncClient:
        """Returns reusable pooled HTTP client with keep-alive connections."""
        try:
            current_loop = asyncio.get_running_loop()
        except RuntimeError:
            current_loop = None

        if (
            self._client is None
            or self._client.is_closed
            or (current_loop is not None and getattr(self, "_loop", None) is not current_loop)
        ):
            if self._client is not None and not self._client.is_closed:
                try:
                    await self._client.aclose()
                except Exception:
                    pass
            limits = httpx.Limits(max_keepalive_connections=10, max_connections=20)
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(float(self.timeout), connect=5.0),
                limits=limits,
            )
            self._loop = current_loop
        return self._client

    async def close(self) -> None:
        """Closes the underlying HTTP client session."""
        if self._client is not None and not self._client.is_closed:
            try:
                await self._client.aclose()
            except Exception:
                pass
            self._client = None
            self._loop = None

    async def __aenter__(self) -> "OllamaProvider":
        await self.get_client()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self.close()

    def _matches_model(self, target: str, available_models: List[str]) -> bool:
        """Determines if a target model tag matches any installed Ollama model."""
        target_clean = target.strip().lower()
        for m in available_models:
            m_clean = m.strip().lower()
            # Strip registry/namespace prefix if present (e.g. library/qwen2.5-coder:3b)
            m_base = m_clean.split("/")[-1]
            if m_base == target_clean or m_clean == target_clean:
                return True
            # If target has no tag, match :latest or any tag prefix
            if ":" not in target_clean:
                if m_base == f"{target_clean}:latest" or m_base.startswith(f"{target_clean}:"):
                    return True
            # If target has :latest, match base name without tag
            if target_clean.endswith(":latest"):
                base_without_tag = target_clean[:-7]
                if m_base == base_without_tag or m_base.split(":")[0] == base_without_tag:
                    return True
        return False

    async def check_health(self) -> Dict[str, Any]:
        """Probes local Ollama daemon and inspects available models."""
        url = f"{self.base_url}/api/tags"
        start_time = time.perf_counter()
        try:
            client = await self.get_client()
            res = await client.get(url, timeout=3.0)
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            if res.status_code == 200:
                data = res.json()
                models = [m.get("name", "") for m in (data.get("models") or []) if isinstance(m, dict)]
                model_found = self._matches_model(self.default_model, models)

                if model_found:
                    msg = f"Ollama is online and configured model '{self.default_model}' is ready."
                else:
                    msg = (
                        f"Ollama is online, but configured model '{self.default_model}' is not installed. "
                        f"Run 'ollama pull {self.default_model}' in your terminal."
                    )

                logger.debug(f"Ollama health probe ok | model_available={model_found} | elapsed_ms={elapsed_ms:.2f}")

                return {
                    "reachable": True,
                    "base_url": self.base_url,
                    "model_configured": self.default_model,
                    "model_available": model_found,
                    "available_models": models,
                    "available_models_count": len(models),
                    "message": msg,
                    "error": None,
                }

            logger.warning(f"Ollama health probe returned HTTP {res.status_code} | elapsed_ms={elapsed_ms:.2f}")
            return {
                "reachable": False,
                "base_url": self.base_url,
                "model_configured": self.default_model,
                "model_available": False,
                "available_models": [],
                "available_models_count": 0,
                "message": f"Ollama returned HTTP {res.status_code}.",
                "error": f"HTTP {res.status_code}",
            }
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.debug(f"Ollama health probe unreachable | elapsed_ms={elapsed_ms:.2f} | error={e}")
            return {
                "reachable": False,
                "base_url": self.base_url,
                "model_configured": self.default_model,
                "model_available": False,
                "available_models": [],
                "available_models_count": 0,
                "message": f"Unable to reach local Ollama daemon at {self.base_url}. Ensure Ollama is running.",
                "error": "Connection refused",
            }
        except httpx.TimeoutException:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.debug(f"Ollama health probe timeout after 3.0s | elapsed_ms={elapsed_ms:.2f}")
            return {
                "reachable": False,
                "base_url": self.base_url,
                "model_configured": self.default_model,
                "model_available": False,
                "available_models": [],
                "available_models_count": 0,
                "message": f"Ollama health probe timed out after 3.0s at {self.base_url}.",
                "error": "Probe timeout",
            }
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            logger.debug(f"Ollama health probe unexpected failure | elapsed_ms={elapsed_ms:.2f} | error={e}")
            return {
                "reachable": False,
                "base_url": self.base_url,
                "model_configured": self.default_model,
                "model_available": False,
                "available_models": [],
                "available_models_count": 0,
                "message": f"Ollama probe failed: {e}",
                "error": str(e),
            }

    async def list_available_models(self) -> List[str]:
        """Lists model tags currently available in the local Ollama instance."""
        url = f"{self.base_url}/api/tags"
        try:
            client = await self.get_client()
            res = await client.get(url, timeout=5.0)
            if res.status_code == 200:
                data = res.json()
                return [m.get("name", "") for m in (data.get("models") or []) if isinstance(m, dict)]
            raise OllamaConnectionError(f"Ollama returned HTTP {res.status_code}: {res.text}")
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise OllamaConnectionError(f"Unable to connect to Ollama at {self.base_url}. Ensure Ollama is running locally.")
        except httpx.TimeoutException:
            raise OllamaTimeoutError(5)

    async def check_model_availability(self, model_name: str) -> bool:
        """Checks whether a specific model tag is currently available locally."""
        models = await self.list_available_models()
        return self._matches_model(model_name, models)

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
        """Sends chat messages to Ollama /api/chat and validates inference response."""
        target_model = model or self.default_model
        settings = get_settings()
        temp = temperature if temperature is not None else settings.temperature

        # Memory safety for 8 GB RAM: cap context and output tokens to configured maximums
        if max_tokens is not None:
            num_predict = min(max_tokens, settings.max_output_tokens)
        else:
            num_predict = settings.max_output_tokens

        if context_size is not None:
            num_ctx = min(context_size, settings.max_context_tokens)
        else:
            num_ctx = settings.default_num_ctx

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        payload = {
            "model": target_model,
            "messages": formatted_messages,
            "stream": False,
            "keep_alive": self.keep_alive,
            "options": {
                "temperature": temp,
                "num_predict": num_predict,
                "num_ctx": num_ctx,
            },
        }

        url = f"{self.base_url}/api/chat"

        # Check if client already disconnected before waiting for semaphore
        if raw_request is not None and hasattr(raw_request, "is_disconnected") and await raw_request.is_disconnected():
            logger.info(f"Client disconnected before waiting for inference | model={target_model}")
            raise asyncio.CancelledError("Client disconnected before waiting for inference")

        acquired = False
        start_time = time.perf_counter()
        try:
            # Concurrency safety: acquire semaphore with timeout to avoid queuing unbounded parallel requests
            try:
                await asyncio.wait_for(self._semaphore.acquire(), timeout=5.0)
                acquired = True
            except asyncio.TimeoutError:
                logger.warning(
                    f"Inference request rejected | category=SERVICE_BUSY | model={target_model} | concurrency_limit={settings.max_concurrent_inferences}"
                )
                raise ServiceBusyError(
                    "Local AI inference service is currently busy processing another request. "
                    "DevPilot restricts concurrent inference to protect system memory (8 GB RAM)."
                )

            # Check if client disconnected while waiting in concurrency queue
            if raw_request is not None and hasattr(raw_request, "is_disconnected") and await raw_request.is_disconnected():
                logger.info(f"Client disconnected while waiting in concurrency queue | model={target_model}")
                raise asyncio.CancelledError("Client disconnected while waiting for inference slot")

            client = await self.get_client()
            res = await client.post(url, json=payload, timeout=float(self.timeout))

            if res.status_code == 404:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    f"Ollama model not found | category=MODEL_NOT_FOUND | model={target_model} | elapsed_ms={duration_ms:.2f}"
                )
                raise ModelNotFoundError(target_model)

            if res.status_code != 200:
                body_text = res.text.lower()
                duration_ms = (time.perf_counter() - start_time) * 1000
                if "not found" in body_text and ("model" in body_text or target_model.lower() in body_text):
                    logger.error(
                        f"Ollama model not found | category=MODEL_NOT_FOUND | model={target_model} | elapsed_ms={duration_ms:.2f}"
                    )
                    raise ModelNotFoundError(target_model)
                logger.error(
                    f"Ollama HTTP error | category=OLLAMA_ERROR | status={res.status_code} | model={target_model} | elapsed_ms={duration_ms:.2f}"
                )
                raise OllamaConnectionError(f"Ollama returned HTTP {res.status_code}: {res.text}")

            try:
                data = res.json()
            except Exception as json_err:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    f"Ollama returned non-JSON | category=MALFORMED_RESPONSE | model={target_model} | elapsed_ms={duration_ms:.2f} | error={json_err}"
                )
                raise MalformedProviderResponseError(
                    f"Ollama returned invalid JSON response: {json_err}",
                    details={"status_code": res.status_code, "raw_response": res.text[:200]},
                )

            if not isinstance(data, dict):
                raise MalformedProviderResponseError(
                    "Ollama response must be a JSON object.",
                    details={"received_type": type(data).__name__},
                )

            msg = data.get("message")
            if not isinstance(msg, dict):
                raise MalformedProviderResponseError(
                    "Ollama response missing expected 'message' object.",
                    details={"keys_received": list(data.keys())},
                )

            content = msg.get("content")
            if content is None or not isinstance(content, str):
                raise MalformedProviderResponseError(
                    "Ollama response missing valid 'message.content' string.",
                    details={"message_keys": list(msg.keys())},
                )

            duration_ms = (time.perf_counter() - start_time) * 1000
            eval_count = data.get("eval_count")
            finish_reason = data.get("done_reason", "stop")
            logger.info(
                f"Ollama inference completed | model={target_model} | elapsed_ms={duration_ms:.2f} | "
                f"eval_count={eval_count} | finish_reason={finish_reason}"
            )

            return {
                "content": content,
                "model": data.get("model", target_model),
                "finish_reason": finish_reason,
                "done": data.get("done", True),
                "total_duration": data.get("total_duration"),
                "eval_count": eval_count,
            }

        except asyncio.CancelledError:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(
                f"Ollama inference cancelled | model={target_model} | elapsed_ms={duration_ms:.2f}"
            )
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                f"Ollama connection error | category=OLLAMA_UNREACHABLE | model={target_model} | "
                f"elapsed_ms={duration_ms:.2f} | error={e}"
            )
            raise OllamaConnectionError(
                f"Unable to connect to Ollama at {self.base_url}. Ensure Ollama is running locally."
            )
        except httpx.TimeoutException:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                f"Ollama inference timed out | category=OLLAMA_TIMEOUT | model={target_model} | "
                f"elapsed_ms={duration_ms:.2f} | limit={self.timeout}s"
            )
            raise OllamaTimeoutError(self.timeout)
        finally:
            if acquired:
                self._semaphore.release()

    async def generate_chat_stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        model: Optional[str] = None,
        context_size: Optional[int] = None,
        raw_request: Optional[Any] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Streams chat tokens from Ollama /api/chat as they are generated with TTFT optimization."""
        target_model = model or self.default_model
        settings = get_settings()
        temp = temperature if temperature is not None else settings.temperature

        # Memory safety for 8 GB RAM: cap context and output tokens
        if max_tokens is not None:
            num_predict = min(max_tokens, settings.max_output_tokens)
        else:
            num_predict = settings.max_output_tokens

        if context_size is not None:
            num_ctx = min(context_size, settings.max_context_tokens)
        else:
            num_ctx = settings.default_num_ctx

        formatted_messages = []
        if system_prompt:
            formatted_messages.append({"role": "system", "content": system_prompt})
        formatted_messages.extend(messages)

        payload = {
            "model": target_model,
            "messages": formatted_messages,
            "stream": True,
            "keep_alive": self.keep_alive,
            "options": {
                "temperature": temp,
                "num_predict": num_predict,
                "num_ctx": num_ctx,
            },
        }

        url = f"{self.base_url}/api/chat"

        # Check if client disconnected before waiting for semaphore
        if raw_request is not None and hasattr(raw_request, "is_disconnected") and await raw_request.is_disconnected():
            logger.info(f"Client disconnected before waiting for stream inference | model={target_model}")
            raise asyncio.CancelledError("Client disconnected before waiting for inference")

        acquired = False
        start_time = time.perf_counter()
        first_token_time = None
        eval_count = 0
        try:
            try:
                await asyncio.wait_for(self._semaphore.acquire(), timeout=5.0)
                acquired = True
            except asyncio.TimeoutError:
                logger.warning(
                    f"Inference stream rejected | category=SERVICE_BUSY | model={target_model} | concurrency_limit={settings.max_concurrent_inferences}"
                )
                raise ServiceBusyError(
                    "Local AI inference service is currently busy processing another request. "
                    "DevPilot restricts concurrent inference to protect system memory (8 GB RAM)."
                )

            if raw_request is not None and hasattr(raw_request, "is_disconnected") and await raw_request.is_disconnected():
                logger.info(f"Client disconnected while waiting in concurrency queue for stream | model={target_model}")
                raise asyncio.CancelledError("Client disconnected while waiting for inference slot")

            client = await self.get_client()

            async with client.stream("POST", url, json=payload, timeout=float(self.timeout)) as response:
                if response.status_code == 404:
                    raise ModelNotFoundError(target_model)
                if response.status_code != 200:
                    error_text = await response.aread()
                    raise OllamaConnectionError(f"Ollama returned HTTP {response.status_code}: {error_text.decode('utf-8', errors='ignore')}")

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    # Check client disconnection during stream
                    if raw_request is not None and hasattr(raw_request, "is_disconnected") and await raw_request.is_disconnected():
                        logger.info(f"Client disconnected during active stream | model={target_model}")
                        break

                    try:
                        chunk = json.loads(line)
                    except Exception:
                        continue

                    if first_token_time is None:
                        first_token_time = (time.perf_counter() - start_time) * 1000
                        logger.debug(f"Stream TTFT: {first_token_time:.2f}ms | model={target_model}")

                    delta = chunk.get("message", {}).get("content", "")
                    if delta:
                        yield {"type": "chunk", "content": delta}

                    if chunk.get("done"):
                        eval_count = chunk.get("eval_count", 0)
                        total_dur = chunk.get("total_duration")
                        finish_reason = chunk.get("done_reason", "stop")
                        duration_ms = (time.perf_counter() - start_time) * 1000
                        logger.info(
                            f"Ollama stream completed | model={target_model} | elapsed_ms={duration_ms:.2f} | "
                            f"ttft_ms={first_token_time:.2f} | eval_count={eval_count} | finish_reason={finish_reason}"
                        )
                        yield {
                            "type": "done",
                            "finish_reason": finish_reason,
                            "eval_count": eval_count,
                            "total_duration": total_dur,
                            "ttft_ms": first_token_time,
                        }
                        break
        except asyncio.CancelledError:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.info(f"Ollama stream cancelled | model={target_model} | elapsed_ms={duration_ms:.2f}")
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            logger.error(f"Ollama stream connection error | model={target_model} | error={e}")
            raise OllamaConnectionError(f"Unable to connect to Ollama at {self.base_url}. Ensure Ollama is running locally.")
        except httpx.TimeoutException:
            logger.error(f"Ollama stream timed out | model={target_model} | limit={self.timeout}s")
            raise OllamaTimeoutError(self.timeout)
        finally:
            if acquired:
                self._semaphore.release()


_shared_provider: Optional["OllamaProvider"] = None


def get_ollama_provider() -> "OllamaProvider":
    """Returns singleton OllamaProvider instance to ensure pooled HTTP client reuse and global concurrency limits."""
    global _shared_provider
    if _shared_provider is None:
        _shared_provider = OllamaProvider()
    return _shared_provider


def reset_ollama_provider() -> None:
    """Resets the singleton provider (useful for testing or reconfiguration)."""
    global _shared_provider
    _shared_provider = None

