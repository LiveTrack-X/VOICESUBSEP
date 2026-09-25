"""Opt-in, bounded text requests to official Groq/xAI endpoints; no retries."""
from __future__ import annotations

import http.client
import json
import re
from contextlib import contextmanager

ENDPOINTS = {"groq": ("api.groq.com", "/openai/v1"), "xai": ("api.x.ai", "/v1")}
MAX_RESPONSE = 512 * 1024
MODEL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$")


def strict_json(text: str | bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key.")
            result[key] = value
        return result

    def constant(_value):
        raise ValueError("Non-finite JSON value.")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


def validate_cloud_request(provider: str, model: str, consent: bool):
    if provider not in ENDPOINTS or not MODEL_ID.fullmatch(model):
        raise ValueError("Select a valid cloud text provider and model ID.")
    if consent is not True:
        raise ValueError("Confirm transcript transmission and possible API charges before using cloud text generation.")


def _request(provider: str, key: str, path: str, body: dict | None = None) -> dict:
    if provider not in ENDPOINTS or path not in {"/models", "/chat/completions"}:
        raise ValueError("Unsupported cloud text operation.")
    if not isinstance(key, str) or not key or len(key) > 512 or any(ord(c) < 33 or ord(c) > 126 for c in key):
        raise ValueError("Register the provider API key for this session first.")
    host, prefix = ENDPOINTS[provider]
    connection = http.client.HTTPSConnection(host, timeout=180 if body is not None else 15)
    try:
        payload = json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8") if body is not None else None
        connection.request("POST" if body is not None else "GET", prefix + path, payload,
                           {"Content-Type": "application/json", "Authorization": "Bearer " + key,
                            "Accept-Encoding": "identity"})
        response = connection.getresponse()
        if response.status != 200:
            # Do not forward response bodies: they may echo prompts or credentials.
            if response.status in {401, 403}:
                raise ValueError("Cloud authentication or model access was rejected. Check the session key and account permissions.")
            if response.status == 429:
                raise ValueError("Cloud request limit or account quota reached. No automatic retry was made.")
            raise ValueError("Cloud text request was rejected. Check that the selected model supports chat and JSON output. No automatic retry was made.")
        data = response.read(MAX_RESPONSE + 1)
        if len(data) > MAX_RESPONSE:
            raise ValueError("Cloud text response exceeded the size limit.")
        if key.encode("utf-8") in data:
            raise ValueError("Cloud response included credential data and was discarded.")
        try:
            value = strict_json(data)
        except (ValueError, UnicodeError, RecursionError):
            raise ValueError("Cloud text returned invalid JSON.") from None
        if not isinstance(value, dict):
            raise ValueError("Cloud text returned an invalid response.")
        if key in json.dumps(value, ensure_ascii=False):
            raise ValueError("Cloud response included credential data and was discarded.")
        return value
    except (OSError, http.client.HTTPException):
        raise RuntimeError("Cloud text connection failed or timed out. No automatic retry was made.") from None
    finally:
        connection.close()


def list_models(provider: str, key: str) -> list[str]:
    value = _request(provider, key, "/models")
    rows = value.get("data")
    if not isinstance(rows, list) or len(rows) > 1000:
        raise ValueError("Cloud provider returned an invalid model list.")
    return sorted({row["id"] for row in rows if isinstance(row, dict)
                   and isinstance(row.get("id"), str) and MODEL_ID.fullmatch(row["id"])})


def chat_json(provider: str, key: str, *, model: str, messages: list[dict], schema: dict,
              consent: bool, max_tokens: int = 8192) -> str:
    validate_cloud_request(provider, model, consent)
    # JSON object mode has wider model support than json_schema; exact output
    # shape/source IDs/evidence are still validated by each application route.
    prompt = [{**messages[0], "content": messages[0]["content"] + "\nRequired JSON schema: " + json.dumps(schema)}, *messages[1:]]
    response = _request(provider, key, "/chat/completions", {
        "model": model, "messages": prompt, "stream": False,
        "response_format": {"type": "json_object"}, "temperature": 0,
        "max_completion_tokens": max_tokens, "tool_choice": "none",
    })
    choices = response.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict) or choices[0].get("finish_reason") != "stop":
        raise ValueError("Cloud text generation was incomplete. No result was applied.")
    message = choices[0].get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or message.get("tool_calls") or message.get("refusal"):
        raise ValueError("Cloud text returned no usable document text.")
    try:
        result = strict_json(content)
        if not isinstance(result, dict):
            raise ValueError()
        if key in json.dumps(result, ensure_ascii=False):
            raise ValueError()
    except (ValueError, UnicodeError, RecursionError):
        raise ValueError("Cloud text returned invalid JSON. No result was applied.") from None
    return content


@contextmanager
def session_key(http_request, provider: str, generation: str):
    state = getattr(getattr(http_request, "app", None), "state", None)
    credentials = getattr(state, "provider_credentials", None)
    if credentials is None:
        raise ValueError("Register the provider API key for this session first.")
    bound_key = credentials.bind_provider_key(provider, generation)
    # The same public registration ID accompanies every batch in one UI run.
    # A replacement cannot silently switch accounts, even between HTTP batches.
    yield bound_key()
    bound_key()  # Discard a response received after key replacement or deletion.
