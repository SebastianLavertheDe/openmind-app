from __future__ import annotations

import json
import os
import re
import ssl
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, request


RETRY_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class AIProvider:
    name: str
    base_url: str
    model: str
    api_key: str
    kind: str
    proxy_url: str = ""
    proxy_policy: str = "system"
    tls_policy: str = "verify"

    def as_legacy_tuple(self) -> tuple[str, str, str, str]:
        return self.name, self.base_url, self.model, self.api_key

    def __getitem__(self, key: str) -> str:
        return getattr(self, key)


class AIProviderError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        response_text: str = "",
    ):
        super().__init__(message)
        self.status_code = status_code
        self.response_text = response_text


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def extract_json_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()
    if re.search(r"<think>", text, flags=re.IGNORECASE):
        last_brace_end = text.rfind("}")
        if last_brace_end >= 0:
            depth = 0
            pos = last_brace_end
            while pos >= 0:
                if text[pos] == "}":
                    depth += 1
                elif text[pos] == "{":
                    depth -= 1
                    if depth == 0:
                        return text[pos : last_brace_end + 1].strip()
                pos -= 1
        return ""
    for pattern in (r"```json\s*([\s\S]*?)\s*```", r"```\s*([\s\S]*?)\s*```"):
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip()
    if "{" in text and "}" in text:
        return text[text.find("{") : text.rfind("}") + 1].strip()
    return text.strip()


def parse_json_object(text: str) -> dict[str, Any]:
    payload = json.loads(extract_json_text(text))
    if not isinstance(payload, dict):
        raise ValueError("AI response JSON must be an object")
    return payload


def resolve_provider() -> AIProvider:
    # The desktop Broker injects one selected Provider Profile through this
    # neutral namespace. This must take precedence so a Skill cannot silently
    # select another configured API key or read another Skill's .env file.
    bound = _resolve_bound_provider()
    if bound is not None:
        return bound

    yaml_provider = _resolve_yaml_provider()
    if yaml_provider is not None:
        return yaml_provider

    raise ValueError(
        "No AI provider configured. Configure config/providers.yaml "
        "(default provider) or run via openmind-app (OPENMIND_PROVIDER_*)."
    )


def build_providers() -> list[AIProvider]:
    bound = _resolve_bound_provider()
    if bound is not None:
        return [bound]
    yaml_provider = _resolve_yaml_provider()
    if yaml_provider is not None:
        return [yaml_provider]

    raise ValueError(
        "No AI provider configured. Configure config/providers.yaml "
        "(default provider) or run via openmind-app (OPENMIND_PROVIDER_*)."
    )


def _resolve_bound_provider() -> AIProvider | None:
    """Resolve the Provider Profile bridge injected by ExecutionBroker.

    The API key is intentionally not accepted as a normal run input; it is
    only expected in the minimal process environment assembled after consent.
    Returning ``None`` keeps the legacy CLI fallback usable for development,
    while production manifests always provide the neutral variables.
    """
    api_key = os.getenv("OPENMIND_PROVIDER_API_KEY", "").strip()
    if not api_key:
        if os.getenv("OPENMIND_MANAGED_RUN", "").strip() == "1":
            raise ValueError("Managed Run requires a bound Provider Profile Credential.")
        return None
    base_url = os.getenv("OPENMIND_PROVIDER_BASE_URL", "").strip()
    model = os.getenv("OPENMIND_PROVIDER_MODEL", "").strip()
    protocol = os.getenv("OPENMIND_PROVIDER_PROTOCOL", "provider-native").strip().lower()
    if not base_url or not model:
        raise ValueError("Bound Provider Profile must provide base URL and model")
    if protocol == "anthropic-messages":
        kind = "anthropic"
    elif protocol == "openai-responses":
        kind = "responses"
    else:
        kind = "chat"
    return AIProvider(
        name="bound-profile",
        base_url=base_url,
        model=model,
        api_key=api_key,
        kind=kind,
        proxy_url=os.getenv("OPENMIND_PROVIDER_PROXY_URL", "").strip(),
        proxy_policy=os.getenv("OPENMIND_PROVIDER_PROXY_POLICY", "system").strip().lower(),
        tls_policy=os.getenv("OPENMIND_PROVIDER_TLS_POLICY", "verify").strip().lower(),
    )


def _providers_yaml_path() -> Path | None:
    """Read only an explicitly bound provider file, never a parent repository."""
    env_path = os.getenv("OPENMIND_PROVIDERS_FILE", "").strip()
    candidate = Path(env_path).expanduser() if env_path else None
    return candidate if candidate and candidate.is_file() else None


def _resolve_yaml_provider() -> AIProvider | None:
    """Resolve the default provider from ``config/providers.yaml``.

    The desktop Broker injects ``OPENMIND_PROVIDER_*`` directly, so this matters
    only for crontab-driven runs (which read the same YAML file). The result is
    field-compatible with the bound provider so both execution paths behave
    identically. Returns ``None`` when no file/config is present so the legacy
    per-provider env fallback remains usable for development.
    """
    yaml_path = _providers_yaml_path()
    if yaml_path is None:
        return None
    try:
        import yaml  # PyYAML
    except ImportError:
        return None
    try:
        with open(yaml_path, "r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle)
    except OSError:
        return None
    if not isinstance(document, dict):
        return None
    providers = document.get("providers")
    if not isinstance(providers, list) or not providers:
        return None
    default_id = document.get("default")
    selected: dict[str, Any] | None = None
    if default_id:
        for entry in providers:
            if isinstance(entry, dict) and entry.get("id") == default_id and entry.get("enabled", True):
                selected = entry
                break
    if selected is None:
        for entry in providers:
            if isinstance(entry, dict) and entry.get("enabled", True):
                selected = entry
                break
    if selected is None:
        return None
    api_key = str(selected.get("apiKey", "")).strip()
    base_url = str(selected.get("baseUrl", "")).strip()
    model = str(selected.get("model", "")).strip()
    protocol = str(selected.get("protocol", "openai-chat")).strip().lower()
    if not api_key or not base_url or not model:
        return None
    if protocol == "anthropic-messages":
        kind = "anthropic"
        endpoint = base_url.rstrip("/") + "/messages"
    elif protocol == "openai-responses":
        kind = "responses"
        endpoint = base_url.rstrip("/") + "/responses"
    else:
        kind = "chat"
        endpoint = base_url.rstrip("/") + "/chat/completions"
    return AIProvider(
        name=str(selected.get("id", "yaml-provider")),
        base_url=endpoint,
        model=model,
        api_key=api_key,
        kind=kind,
        proxy_url=str(selected.get("proxyUrl", "")).strip(),
        proxy_policy=str(selected.get("proxyPolicy", "system")).strip().lower(),
        tls_policy=str(selected.get("tlsPolicy", "verify")).strip().lower(),
    )


def build_legacy_provider_tuples() -> list[tuple[str, str, str, str]]:
    return [item.as_legacy_tuple() for item in build_providers()]


def call_chat_completion(
    base_url: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    *,
    temperature: float = 0.2,
    max_tokens: int = 100000,
    timeout: int = 240,
    retries: int = 3,
    response_format_json: bool = True,
) -> str:
    kind = _infer_kind(base_url)
    prompt = f"{system_prompt}\n\n{user_prompt}" if system_prompt else user_prompt
    provider = AIProvider(
        name="custom",
        base_url=base_url,
        model=model,
        api_key=api_key,
        kind=kind,
    )
    return call_provider_text(
        provider,
        prompt,
        system_prompt=system_prompt if kind == "chat" else "",
        user_prompt=user_prompt if kind == "chat" else "",
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        retries=retries,
        response_format_json=response_format_json,
    )


def call_provider_text(
    provider: AIProvider,
    prompt: str,
    *,
    system_prompt: str = "",
    user_prompt: str = "",
    temperature: float = 0.2,
    max_tokens: int = 4000,
    timeout: int = 240,
    retries: int = 3,
    response_format_json: bool = True,
) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            payload, headers = _build_request(
                provider,
                prompt,
                system_prompt,
                user_prompt,
                temperature,
                max_tokens,
                response_format_json,
            )
            req = request.Request(
                provider.base_url,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with _open_provider(provider, req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            text = _extract_text(provider.kind, data)
            if text:
                return text
            raise AIProviderError(f"{provider.kind} API returned empty content")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            if exc.code in RETRY_STATUS_CODES and attempt < retries:
                time.sleep(2 * attempt)
                continue
            raise AIProviderError(
                f"AI API HTTP {exc.code}: {detail[:400]}",
                status_code=exc.code,
                response_text=detail,
            ) from exc
        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(2 * attempt)
                continue
            if isinstance(exc, AIProviderError):
                raise
            raise AIProviderError(f"AI API request failed: {exc}") from exc
    raise AIProviderError(f"AI API request failed after retries: {last_error}")


def _open_provider(provider: AIProvider, req: request.Request, *, timeout: int):
    if provider.proxy_policy == "explicit":
        if not provider.proxy_url:
            raise AIProviderError("显式代理策略尚未配置代理地址。")
        proxy_handler = request.ProxyHandler({"http": provider.proxy_url, "https": provider.proxy_url})
    elif provider.proxy_policy == "disabled":
        proxy_handler = request.ProxyHandler({})
    else:
        proxy_handler = request.ProxyHandler()
    handlers: list[Any] = [proxy_handler]
    if provider.tls_policy == "allow-insecure":
        context = ssl._create_unverified_context()
        handlers.append(request.HTTPSHandler(context=context))
    return request.build_opener(*handlers).open(req, timeout=timeout)


def _infer_kind(base_url: str) -> str:
    if "/anthropic/" in base_url:
        return "anthropic"
    if "/responses" in base_url:
        return "responses"
    return "chat"


def _build_request(
    provider: AIProvider,
    prompt: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    response_format_json: bool,
) -> tuple[dict[str, Any], dict[str, str]]:
    if provider.kind == "anthropic":
        payload = {
            "model": provider.model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        }
        if provider.name == "deepseek" or "deepseek.com" in provider.base_url:
            payload["thinking"] = {"type": "disabled"}
        return (
            payload,
            {
                "x-api-key": provider.api_key,
                "Authorization": f"Bearer {provider.api_key}",
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    if provider.kind == "responses":
        return (
            {
                "model": provider.model,
                "input": [
                    {
                        "role": "user",
                        "content": [{"type": "input_text", "text": prompt}],
                    }
                ],
                "thinking": {"type": "disabled"},
            },
            {
                "Authorization": f"Bearer {provider.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_prompt})
    else:
        messages.append({"role": "user", "content": prompt})
    payload: dict[str, Any] = {
        "model": provider.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    if response_format_json:
        payload["response_format"] = {"type": "json_object"}
    return (
        payload,
        {
            "Authorization": f"Bearer {provider.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )


def _extract_text(kind: str, data: dict[str, Any]) -> str:
    if kind == "anthropic":
        return "".join(
            block.get("text", "")
            for block in data.get("content", [])
            if block.get("type") == "text"
        ).strip()

    if kind == "responses":
        if data.get("output_text"):
            return str(data.get("output_text", "")).strip()
        text = ""
        for item in data.get("output", []):
            if item.get("type") != "message":
                continue
            for block in item.get("content", []):
                if block.get("type") == "output_text":
                    text += block.get("text", "")
        return text.strip()

    return data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
