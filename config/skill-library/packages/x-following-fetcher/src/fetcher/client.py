from __future__ import annotations

import json
import os
import shlex
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

from ..config import AppConfig


class FetchError(RuntimeError):
    """Raised when timeline fetching fails."""


@dataclass(slots=True)
class TimelineResponse:
    payload: dict[str, Any]
    label: str = "timeline"


@dataclass(slots=True)
class ManagedTimelineRequest:
    label: str
    url: str
    method: str
    headers: dict[str, str]
    params: dict[str, Any]
    json_body: Any = None
    data: str | bytes | None = None


def _looks_like_legacy_curl(raw: str) -> bool:
    head = raw.lstrip()[:8].lower()
    return head.startswith("curl ") or head.startswith("curl\t") or head.startswith("curl'")


def _parse_legacy_curl_command(raw: str, default_label: str) -> list[ManagedTimelineRequest]:
    """Parse local cron curl.txt into a requests-compatible credential.

    Never shell-executes the command. Desktop managed credentials still use
    structured JSON via ``X_FETCHER_CREDENTIAL_JSON``.
    """
    command = raw.replace("\\\n", " ").replace("\\\r\n", " ")
    try:
        args = shlex.split(command)
    except ValueError as exc:
        raise FetchError(f"legacy curl credential is invalid: {exc}") from exc
    if not args or args[0] != "curl":
        raise FetchError("legacy curl credential must start with curl")

    url = ""
    method = "GET"
    headers: dict[str, str] = {}
    json_body: Any = None
    data: str | bytes | None = None
    index = 1
    while index < len(args):
        arg = args[index]
        if arg in {"-H", "--header"} and index + 1 < len(args):
            header = args[index + 1]
            if ":" in header:
                key, value = header.split(":", 1)
                headers[key.strip()] = value.strip()
            index += 2
            continue
        if arg in {"-b", "--cookie"} and index + 1 < len(args):
            headers["Cookie"] = args[index + 1]
            index += 2
            continue
        if arg in {"--data-raw", "--data", "-d", "--data-binary"} and index + 1 < len(args):
            method = "POST"
            payload = args[index + 1]
            try:
                json_body = json.loads(payload)
                data = None
            except json.JSONDecodeError:
                json_body = None
                data = payload
            index += 2
            continue
        if arg in {"-X", "--request"} and index + 1 < len(args):
            method = str(args[index + 1]).strip().upper()
            index += 2
            continue
        if arg.startswith("-"):
            # Skip unknown flags; consume a value when the next token is not a flag.
            if index + 1 < len(args) and not args[index + 1].startswith("-"):
                index += 2
            else:
                index += 1
            continue
        if not url:
            url = arg
        index += 1

    if not url:
        raise FetchError("legacy curl credential is missing URL")
    if method not in {"GET", "POST"}:
        raise FetchError(f"legacy curl credential has unsupported method: {method}")

    return [ManagedTimelineRequest(
        label=default_label,
        url=url,
        method=method,
        headers=headers,
        params={},
        json_body=json_body,
        data=data,
    )]


def _read_json_credential(raw: str) -> list[ManagedTimelineRequest]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise FetchError(f"X managed credential JSON is invalid: {exc}") from exc
    if not isinstance(parsed, dict):
        raise FetchError("X managed credential must be a JSON object")

    records = parsed.get("requests", [parsed])
    if not isinstance(records, list) or not records:
        raise FetchError("X managed credential requests must be a non-empty array")

    requests_out: list[ManagedTimelineRequest] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise FetchError(f"X managed credential request {index} must be an object")
        url = str(record.get("url", "")).strip()
        if not url:
            raise FetchError(f"X managed credential request {index} is missing url")
        method = str(record.get("method", "POST")).strip().upper()
        if method not in {"GET", "POST"}:
            raise FetchError(f"X managed credential request {index} has unsupported method: {method}")
        raw_headers = record.get("headers", {})
        if not isinstance(raw_headers, dict):
            raise FetchError(f"X managed credential request {index} headers must be an object")
        headers = {str(key): str(value) for key, value in raw_headers.items()}
        raw_params = record.get("params", {})
        if not isinstance(raw_params, dict):
            raise FetchError(f"X managed credential request {index} params must be an object")
        json_body = record.get("json")
        data = record.get("data")
        if data is not None and not isinstance(data, (str, bytes)):
            raise FetchError(f"X managed credential request {index} data must be string or bytes")
        requests_out.append(ManagedTimelineRequest(
            label=str(record.get("label", f"timeline-{index + 1}")),
            url=url,
            method=method,
            headers=headers,
            params=raw_params,
            json_body=json_body,
            data=data,
        ))
    return requests_out


def _read_managed_credential(credential_file: Path | None) -> list[ManagedTimelineRequest]:
    if credential_file is not None:
        if not credential_file.exists():
            raise FetchError(f"X credential file not found: {credential_file}")
        raw = credential_file.read_text(encoding="utf-8").strip()
        default_label = credential_file.stem
    else:
        raw = os.environ.get("X_FETCHER_CREDENTIAL_JSON", "").strip()
        default_label = "managed-credential"
    if not raw:
        raise FetchError("X managed credential JSON is missing")

    # Local/cron curl.txt: parse into structured requests. Env-managed
    # credentials must remain JSON so shell payloads stay rejected.
    if _looks_like_legacy_curl(raw):
        if credential_file is None:
            raise FetchError("X managed credential JSON is invalid: Expecting value: line 1 column 1 (char 0)")
        return _parse_legacy_curl_command(raw, default_label)

    return _read_json_credential(raw)


def _replace_count_in_body(body: Any, count: int) -> Any:
    if not isinstance(body, dict):
        return body
    updated = json.loads(json.dumps(body, ensure_ascii=False))
    variables = updated.get("variables")
    if isinstance(variables, dict):
        variables["count"] = count
    return updated


def _extract_json(stdout: str) -> dict[str, Any]:
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise FetchError(f"invalid JSON response: {exc}") from exc

    if not isinstance(payload, dict):
        raise FetchError("unexpected response type")

    if payload.get("errors"):
        raise FetchError(f"timeline API returned errors: {payload['errors']}")

    return payload


def fetch_timelines(config: AppConfig, credential_file: Path | None = None) -> list[TimelineResponse]:
    if config.compat is None:
        raise FetchError("missing compat config")

    managed_requests = _read_managed_credential(credential_file)
    responses: list[TimelineResponse] = []
    for managed in managed_requests:
        json_body = _replace_count_in_body(managed.json_body, config.fetch.count)
        last_error: Exception | None = None
        for attempt in range(1, config.fetch.max_retries + 1):
            try:
                response = requests.request(
                    method=managed.method,
                    url=managed.url,
                    headers=managed.headers,
                    params=managed.params,
                    json=json_body,
                    data=managed.data,
                    timeout=config.fetch.timeout_seconds,
                )
                response.raise_for_status()
                responses.append(TimelineResponse(payload=_extract_json(response.text), label=managed.label))
                break
            except requests.Timeout:
                last_error = FetchError(
                    f"request timed out after {config.fetch.timeout_seconds}s (attempt {attempt}/{config.fetch.max_retries})"
                )
            except requests.RequestException as exc:
                last_error = FetchError(str(exc))
        else:
            raise FetchError(str(last_error or "timeline fetch failed without details"))

    return responses


def fetch_timeline(config: AppConfig, credential_file: Path | None = None) -> TimelineResponse:
    responses = fetch_timelines(config, credential_file)
    if not responses:
        raise FetchError("timeline fetch returned no responses")
    return responses[0]
