"""Tests for tests/fakes.py -- FakeGenAI canned-client behavior."""
from concurrent.futures import ThreadPoolExecutor

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


def test_keyed_texts_dispatch_by_prompt_marker_not_call_order():
    # Parallel judge calls pop in no fixed order, so keyed replies dispatch on
    # the marker (the rubric dimension key) found in the prompt instead.
    fake = FakeGenAI(keyed_texts={"dim-a": ["a1", "a2"], "dim-b": ["b1"]})
    rb = fake.models.generate_content(model="m", contents="Dimension key: dim-b")
    ra1 = fake.models.generate_content(model="m", contents="Dimension key: dim-a")
    ra2 = fake.models.generate_content(model="m", contents="scoring dim-a again")
    assert (rb.text, ra1.text, ra2.text) == ("b1", "a1", "a2")
    # Keyed replies never carry grounding metadata.
    assert rb.candidates[0].grounding_metadata is None


def test_keyed_texts_exhaustion_raises_index_error():
    # Same pinned failure behavior as the ordered script, but per key.
    fake = FakeGenAI(keyed_texts={"dim-a": ["only"]})
    fake.models.generate_content(model="m", contents="dim-a")
    with pytest.raises(IndexError):
        fake.models.generate_content(model="m", contents="dim-a")


def test_prompt_without_keyed_marker_falls_back_to_ordered_texts():
    # Mixed scripts: unkeyed calls (transcribe, delivery judge) keep popping
    # the ordered queue while keyed calls are served by marker.
    fake = FakeGenAI(["plain"], keyed_texts={"dim-a": ["keyed"]})
    plain = fake.models.generate_content(model="m", contents="no marker here")
    keyed = fake.models.generate_content(model="m", contents="dim-a prompt")
    assert (plain.text, keyed.text) == ("plain", "keyed")


def test_prompt_matching_multiple_keyed_markers_raises():
    fake = FakeGenAI(keyed_texts={"dim-a": ["a"], "dim-b": ["b"]})
    with pytest.raises(ValueError, match="dim-a"):
        fake.models.generate_content(model="m", contents="dim-a and dim-b")


def test_keyed_matching_reads_str_parts_of_list_contents():
    # File-based calls pass [file_handle, prompt]; only str parts are matched.
    fake = FakeGenAI(keyed_texts={"dim-a": ["keyed"]})
    handle = fake.files.upload(file="/tmp/clip.wav")
    response = fake.models.generate_content(model="m", contents=[handle, "dim-a prompt"])
    assert response.text == "keyed"


def test_generate_content_is_thread_safe_under_concurrent_calls():
    # Parallel judge calls pop concurrently: every canned reply must be served
    # exactly once and every call recorded (no lost updates, no duplicates).
    texts = [f"reply-{i}" for i in range(32)]
    fake = FakeGenAI(texts)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(
            lambda i: fake.models.generate_content(model="m", contents=f"call-{i}").text,
            range(32),
        ))
    assert sorted(results) == sorted(texts)
    assert len(fake.calls) == 32


def test_files_upload_returns_non_str_handle_and_records():
    fake = FakeGenAI([])
    handle = fake.files.upload(file="/tmp/clip.wav")
    assert not isinstance(handle, str)
    assert handle.name == "files/fake-0"
    assert fake.files.uploads == ["/tmp/clip.wav"]


def test_fake_satisfies_genai_client_protocol():
    assert isinstance(FakeGenAI([]), GenAIClientLike)


def test_scripted_exception_is_raised_and_recorded():
    boom = RuntimeError("scripted failure")
    fake = FakeGenAI(keyed_texts={"marker-a": [boom, "after"]})
    with pytest.raises(RuntimeError, match="scripted failure"):
        fake.models.generate_content(model="m", contents="marker-a prompt")
    assert len(fake.calls) == 1  # the failed call is still recorded
    ok = fake.models.generate_content(model="m", contents="marker-a prompt")
    assert ok.text == "after"
