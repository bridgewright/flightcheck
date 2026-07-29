"""Gemini Developer API compatibility seam for pydantic response schemas.

Found live during release prep (Task 18): google-genai 2.14.0 converts a
pydantic model class passed as ``response_schema`` into a ``types.Schema``
that keeps ``additionalProperties`` (every scorer schema sets
``extra="forbid"``), and the Developer API's
``generation_config.response_schema`` proto rejects that field with
``400 INVALID_ARGUMENT``. The fake-client test gate can never see this;
it only appears on the live path.

The fix lives at the client seam (the ``GenAIClientLike`` protocol):
``make_client`` wraps the real ``genai.Client`` so any ``generate_content``
config that names a pydantic model class in ``response_schema`` sends it
through the public ``response_json_schema`` field instead. That field takes
raw JSON Schema, resolves ``$defs``/``$ref`` for nested models, and actually
enforces ``additionalProperties: false`` (verified live). Call sites keep
the documented ``response_schema=Model`` style, and the fake-client tests
keep asserting exactly that.
"""
from __future__ import annotations

from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

GEMINI_HTTP_TIMEOUT_MS = 480_000


def _is_model_class(schema: Any) -> bool:
    return isinstance(schema, type) and issubclass(schema, BaseModel)


def compat_config(config: Any) -> Any:
    """Move a pydantic-class ``response_schema`` to ``response_json_schema``.

    Dict and GenerateContentConfig configs are rebuilt (never mutated);
    every other config -- None, no schema, or an explicit ``types.Schema`` --
    passes through unchanged as the same object.
    """
    if isinstance(config, dict):
        schema = config.get("response_schema")
        if _is_model_class(schema):
            rebuilt = dict(config)
            del rebuilt["response_schema"]
            rebuilt["response_json_schema"] = schema.model_json_schema()
            return rebuilt
        return config
    if isinstance(config, types.GenerateContentConfig):
        schema = config.response_schema
        if _is_model_class(schema):
            return config.model_copy(update={
                "response_schema": None,
                "response_json_schema": schema.model_json_schema(),
            })
    return config


class _CompatModels:
    """GenAIModelsLike wrapper: rewrites the config, then delegates."""

    def __init__(self, inner: Any):
        self._inner = inner

    def generate_content(self, *, model: str, contents: Any,
                         config: Any = None) -> Any:
        return self._inner.generate_content(
            model=model, contents=contents, config=compat_config(config))


class CompatClient:
    """GenAIClientLike wrapper around a real (or fake) genai client."""

    def __init__(self, inner: Any):
        # Hold the client itself, not just .models/.files: genai.Client
        # closes its shared httpx client on garbage collection, so keeping
        # only the sub-objects alive kills every request mid-run.
        self._inner = inner
        self.models = _CompatModels(inner.models)
        self.files = inner.files


def make_client(api_key: str) -> CompatClient:
    """The one constructor live entrypoints use for a Gemini client."""
    return CompatClient(
        genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=GEMINI_HTTP_TIMEOUT_MS),
        )
    )
