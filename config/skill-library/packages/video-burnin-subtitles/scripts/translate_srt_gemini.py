#!/usr/bin/env python3
import os
import sys
import textwrap
import re
import json
import ssl
import time
from dataclasses import dataclass
from urllib import error, request


RETRY_STATUS_CODES = {429, 500, 502, 503, 504}


@dataclass(frozen=True)
class Provider:
    api_key: str
    base_url: str
    model: str
    protocol: str
    proxy_url: str = ""
    proxy_policy: str = "system"
    tls_policy: str = "verify"


def resolve_provider() -> Provider:
    api_key = os.getenv("OPENMIND_PROVIDER_API_KEY", "").strip()
    base_url = os.getenv("OPENMIND_PROVIDER_BASE_URL", "").strip()
    model = os.getenv("OPENMIND_PROVIDER_MODEL", "").strip()
    if not api_key or not base_url or not model:
        raise ValueError(
            "Managed Run requires OPENMIND_PROVIDER_API_KEY, "
            "OPENMIND_PROVIDER_BASE_URL and OPENMIND_PROVIDER_MODEL."
        )
    return Provider(
        api_key=api_key,
        base_url=base_url,
        model=model,
        protocol=os.getenv("OPENMIND_PROVIDER_PROTOCOL", "provider-native").strip().lower(),
        proxy_url=os.getenv("OPENMIND_PROVIDER_PROXY_URL", "").strip(),
        proxy_policy=os.getenv("OPENMIND_PROVIDER_PROXY_POLICY", "system").strip().lower(),
        tls_policy=os.getenv("OPENMIND_PROVIDER_TLS_POLICY", "verify").strip().lower(),
    )


def resolve_endpoint(provider: Provider) -> str:
    suffix = {
        "openai-chat": "chat/completions",
        "openai-responses": "responses",
        "anthropic-messages": "messages",
    }.get(provider.protocol, "")
    base = provider.base_url.rstrip("/")
    if not suffix or base.endswith(f"/{suffix}"):
        return base
    return f"{base}/{suffix}"


def call_provider_text(provider: Provider, prompt: str, retries: int = 3) -> str:
    last_error = ""
    endpoint = resolve_endpoint(provider)
    for attempt in range(1, retries + 1):
        try:
            payload, headers = build_request(provider, prompt)
            req = request.Request(
                endpoint,
                data=json.dumps(payload).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with open_provider(provider, req) as response:
                data = json.loads(response.read().decode("utf-8"))
            text = extract_text(provider.protocol, data)
            if text:
                return text
            raise RuntimeError("Provider returned empty content")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            last_error = f"HTTP {exc.code}: {detail[:400]}"
            if exc.code not in RETRY_STATUS_CODES or attempt >= retries:
                raise RuntimeError(f"Subtitle translation failed: {last_error}") from exc
        except Exception as exc:
            last_error = str(exc)
            if attempt >= retries:
                raise RuntimeError(f"Subtitle translation failed: {last_error}") from exc
        time.sleep(2 * attempt)
    raise RuntimeError(f"Subtitle translation failed after retries: {last_error}")


def build_request(provider: Provider, prompt: str):
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if provider.protocol == "anthropic-messages":
        headers["x-api-key"] = provider.api_key
        headers["anthropic-version"] = "2023-06-01"
        return {
            "model": provider.model,
            "max_tokens": 8192,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": prompt}],
        }, headers
    if provider.protocol == "openai-responses":
        headers["Authorization"] = f"Bearer {provider.api_key}"
        return {
            "model": provider.model,
            "max_output_tokens": 8192,
            "input": [{
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }],
        }, headers
    headers["Authorization"] = f"Bearer {provider.api_key}"
    return {
        "model": provider.model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 8192,
        "temperature": 0.2,
        "stream": False,
    }, headers


def open_provider(provider: Provider, req: request.Request):
    if provider.proxy_policy == "explicit":
        if not provider.proxy_url:
            raise RuntimeError("Explicit provider proxy policy requires OPENMIND_PROVIDER_PROXY_URL.")
        proxy_handler = request.ProxyHandler({"http": provider.proxy_url, "https": provider.proxy_url})
    elif provider.proxy_policy == "disabled":
        proxy_handler = request.ProxyHandler({})
    else:
        proxy_handler = request.ProxyHandler()
    handlers = [proxy_handler]
    if provider.tls_policy == "allow-insecure":
        handlers.append(request.HTTPSHandler(context=ssl._create_unverified_context()))
    return request.build_opener(*handlers).open(req, timeout=120)


def extract_text(protocol: str, data: dict) -> str:
    if protocol == "anthropic-messages":
        return "".join(
            str(block.get("text", ""))
            for block in data.get("content", [])
            if isinstance(block, dict) and block.get("type") == "text"
        ).strip()
    if protocol == "openai-responses":
        if data.get("output_text"):
            return str(data["output_text"]).strip()
        parts = []
        for item in data.get("output", []):
            if not isinstance(item, dict) or item.get("type") != "message":
                continue
            for block in item.get("content", []):
                if isinstance(block, dict) and block.get("type") == "output_text":
                    parts.append(str(block.get("text", "")))
        return "".join(parts).strip()
    choices = data.get("choices", [])
    if not choices or not isinstance(choices[0], dict):
        return ""
    content = choices[0].get("message", {}).get("content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") in {"text", "output_text"}
        ).strip()
    return ""


def read_srt(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def write_srt(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def clean_srt(srt: str) -> str:
    # Remove HTML tags and common non-dialogue lines (music, sound cues)
    srt = re.sub(r"<[^>]+>", "", srt)
    # Remove obvious channel tags
    srt = re.sub(r"(?im)^.*(MING PAO TORONTO|明报多伦多).*$", "", srt)
    cleaned_blocks = []
    for block in srt.split("\n\n"):
        lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
        if len(lines) < 3:
            continue
        idx, timecode, *text_lines = lines
        kept = []
        for ln in text_lines:
            if re.fullmatch(r"[\[\(].*?[\]\)]", ln):
                continue
            if re.search(r"^[♪]+|[♪]+$", ln):
                continue
            if re.search(r"\\b(music|bgm|sound|sfx|applause|laughs?)\\b", ln, re.I):
                continue
            kept.append(ln)
        if not kept:
            continue
        cleaned_blocks.append("\n".join([idx, timecode] + kept))
    return "\n\n".join(cleaned_blocks)


def call_gemini(provider: Provider, prompt: str, retries: int = 3) -> str:
    return call_provider_text(provider, prompt, retries=retries)


def chunk_text(text: str, max_chars: int = 12000):
    # Split by blank lines (SRT blocks) to preserve structure
    blocks = text.split("\n\n")
    current = []
    size = 0
    for b in blocks:
        if not b.strip():
            continue
        if size + len(b) + 2 > max_chars and current:
            yield "\n\n".join(current)
            current = [b]
            size = len(b)
        else:
            current.append(b)
            size += len(b) + 2
    if current:
        yield "\n\n".join(current)


def main():
    if len(sys.argv) != 4:
        print("Usage: translate_srt_gemini.py <input.srt> <output.srt> <target_lang>")
        sys.exit(1)

    input_path, output_path, target_lang = sys.argv[1:4]
    try:
        provider = resolve_provider()
    except ValueError as exc:
        print(str(exc))
        sys.exit(1)

    srt = clean_srt(read_srt(input_path))

    translated_parts = []
    for chunk in chunk_text(srt):
        prompt = textwrap.dedent(
            f"""
            You are translating subtitle files. Translate the subtitle text to {target_lang}.
            Preserve all SRT numbering and timecodes exactly. Only translate subtitle lines.
            Return valid SRT with the same structure.

            SRT:
            {chunk}
            """
        ).strip()
        translated_parts.append(call_gemini(provider, prompt))

    translated = "\n\n".join(p.strip() for p in translated_parts)
    # Remove Chinese full stops as requested
    translated = translated.replace("。", "")
    # Remove any remaining channel tags after translation
    translated = re.sub(r"(?im)^.*(MING PAO TORONTO|明报多伦多).*$", "", translated)
    # Strip markdown code fences if the model added them
    translated = re.sub(r"(?im)^```.*$", "", translated)
    # Collapse extra blank lines
    translated = re.sub(r"\\n{3,}", "\n\n", translated).strip()
    write_srt(output_path, translated + "\n")
    print(output_path)


if __name__ == "__main__":
    main()
