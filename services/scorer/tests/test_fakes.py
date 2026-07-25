"""Tests for tests/fakes.py -- FakeGenAI canned-client behavior."""
import pytest
from google.genai import types

from fakes import FakeGenAI
from scorer.schemas import GenAIClientLike


def test_generate_content_pops_texts_in_order():
    fake = FakeGenAI(["first", "second"])
    r1 = fake.models.generate_content(model="m", contents="a", config=None)
    r2 = fake.models.generate_content(model="m", contents="b", config=None)
    assert (r1.text, r2.text) == ("first", "second")


def test_generate_content_records_call_kwargs_in_order():
    fake = FakeGenAI(["first", "second"])
    fake.models.generate_content(model="model-a", contents="hello", config="cfg-a")
    fake.models.generate_content(model="model-b", contents="world", config=None)
    assert fake.calls == [
        {"model": "model-a", "contents": "hello", "config": "cfg-a"},
        {"model": "model-b", "contents": "world", "config": None},
    ]


def test_config_is_recorded_exactly_as_passed():
    # Pinned surface: config is stored as the very object the caller passed,
    # never normalized -- consumer tests assert attributes/identity on it.
    config = types.GenerateContentConfig(response_mime_type="application/json")
    fake = FakeGenAI(["text"])
    fake.models.generate_content(model="m", contents="a", config=config)
    assert fake.calls[0]["config"] is config


def test_generate_content_raises_when_script_exhausted():
    fake = FakeGenAI(["only"])
    fake.models.generate_content(model="m", contents="a")
    with pytest.raises(IndexError):
        fake.models.generate_content(model="m", contents="b")


def test_grounding_defaults_to_none():
    fake = FakeGenAI(["text"])
    response = fake.models.generate_content(model="m", contents="a")
    assert response.candidates[0].grounding_metadata is None


def test_canned_grounding_dicts_become_google_genai_shapes():
    fake = FakeGenAI(
        ["grounded", "plain"],
        canned_grounding=[
            [{"url": "https://a.example.com", "title": "A", "snippet": "quoted a"}],
            None,
        ],
    )
    grounded = fake.models.generate_content(model="m", contents="q1")
    plain = fake.models.generate_content(model="m", contents="q2")
    metadata = grounded.candidates[0].grounding_metadata
    assert isinstance(metadata, types.GroundingMetadata)
    assert metadata.grounding_chunks[0].web.uri == "https://a.example.com"
    assert metadata.grounding_chunks[0].web.title == "A"
    support = metadata.grounding_supports[0]
    assert support.segment.text == "quoted a"
    assert support.grounding_chunk_indices == [0]
    assert plain.candidates[0].grounding_metadata is None


def test_prebuilt_grounding_objects_pass_through():
    metadata = types.GroundingMetadata(grounding_chunks=[], grounding_supports=[])
    fake = FakeGenAI(["text"], canned_grounding=[metadata])
    response = fake.models.generate_content(model="m", contents="a")
    assert response.candidates[0].grounding_metadata is metadata


def test_files_upload_returns_non_str_handle_and_records():
    fake = FakeGenAI([])
    handle = fake.files.upload(file="/tmp/clip.wav")
    assert not isinstance(handle, str)
    assert handle.name == "files/fake-0"
    assert fake.files.uploads == ["/tmp/clip.wav"]


def test_fake_satisfies_genai_client_protocol():
    assert isinstance(FakeGenAI([]), GenAIClientLike)
