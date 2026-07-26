"""Tests for the Gemini Developer API response-schema compatibility seam.

The live API rejects the ``additionalProperties`` field that google-genai
2.14.0 forwards for pydantic models with ``extra="forbid"``; the compat
seam must therefore re-route pydantic classes through
``response_json_schema`` while leaving every other config untouched.
"""
from __future__ import annotations

from google.genai import types
from pydantic import BaseModel, ConfigDict

from fakes import FakeGenAI
from scorer.genai_compat import CompatClient, compat_config
from scorer.schemas import GenAIClientLike


class _Doc(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str
    tags: list[str]


def test_dict_config_reroutes_model_class() -> None:
    config = {"response_mime_type": "application/json", "response_schema": _Doc}
    rebuilt = compat_config(config)
    assert rebuilt["response_json_schema"] == _Doc.model_json_schema()
    assert "response_schema" not in rebuilt
    assert rebuilt["response_mime_type"] == "application/json"
    # The caller's dict is never mutated.
    assert config["response_schema"] is _Doc
    assert "response_json_schema" not in config


def test_generate_content_config_reroutes_model_class() -> None:
    config = types.GenerateContentConfig(
        response_mime_type="application/json", response_schema=_Doc)
    rebuilt = compat_config(config)
    assert rebuilt.response_schema is None
    assert rebuilt.response_json_schema == _Doc.model_json_schema()
    assert rebuilt.response_mime_type == "application/json"
    # The original config object is never mutated.
    assert config.response_schema is _Doc


def test_configs_without_a_model_class_pass_through_as_same_object() -> None:
    grounded = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())])
    explicit = {"response_schema": types.Schema(type="OBJECT")}
    assert compat_config(None) is None
    assert compat_config(grounded) is grounded
    assert compat_config(explicit) is explicit


def test_compat_client_rewrites_config_and_delegates(tmp_path) -> None:
    fake = FakeGenAI(canned_texts=['{"note": "n", "tags": []}'])
    client = CompatClient(fake)
    assert isinstance(client, GenAIClientLike)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="hi",
        config={"response_mime_type": "application/json",
                "response_schema": _Doc},
    )
    assert response.text == '{"note": "n", "tags": []}'
    call = fake.calls[0]
    assert call["model"] == "gemini-2.5-flash"
    assert call["config"]["response_json_schema"] == _Doc.model_json_schema()
    assert "response_schema" not in call["config"]

    wav = tmp_path / "clip.wav"
    wav.write_bytes(b"RIFF")
    handle = client.files.upload(file=wav)
    assert handle.name == "files/fake-0"
    assert fake.files.uploads == [wav]
