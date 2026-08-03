"""F-37: every outbound model call backs off transient failures.

The production audit found backoff on exactly ONE of the pipeline's model
call sites (the content judge). Transcription -- the most expensive step,
and the only one whose input cannot be re-created, because the 20-minute
interview it reads happened once -- had none, so a single 503 threw the
recording's value away.

Two kinds of test here, deliberately:

* a STRUCTURAL one that walks the AST of every production module and fails
  if any generate_content/upload call is not lexically inside a
  call_with_retry, so a new call site added later cannot quietly ship
  without backoff;
* a BEHAVIOURAL one per site, driving the real function with a scripted
  transient failure, because "it imports the helper" is not evidence that
  the call actually recovers.
"""
from __future__ import annotations

import ast
import json
from pathlib import Path

import httpx
import pytest
from google.genai import errors as genai_errors

import scorer.resilience as resilience_module
from fakes import FakeGenAI
from scorer.api.pipeline import _extract_jd_facts
from scorer.content.transcribe import transcribe_verbatim
from scorer.delivery.judge import judge_delivery
from scorer.intake.profile import build_profile
from scorer.research.sweep import run_sweep
from scorer.rubric.compiler import compile_rubric
from scorer.schemas import (
    CandidateProfile,
    DeliveryMetrics,
    ResearchFindings,
    RubricDimension,
)

SRC = Path(resilience_module.__file__).parent

_NETWORK_CALLS = {"generate_content", "upload"}

# The only two modules allowed to call the model without backoff, each for a
# stated reason. Everything else is DISCOVERED, not listed: a hand-written
# list of call sites cannot fail when a NEW module ships an unguarded call,
# which is the failure this suite exists to prevent.
EXEMPT = {
    # The compatibility wrapper IS the call being retried; retrying inside it
    # would multiply every caller's budget by itself.
    "genai_compat.py": "the client wrapper every retried call goes through",
    # An operator harness run once per release gate, by hand, with the output
    # in front of them -- not a customer's job on a worker thread.
    "bakeoff/discrimination.py": "offline eval harness, not the product path",
}


def _module_paths() -> list[str]:
    """Every module under src/scorer that makes a model call, discovered."""
    found = []
    for path in sorted(SRC.rglob("*.py")):
        relative = path.relative_to(SRC).as_posix()
        if relative in EXEMPT:
            continue
        if _model_calls(ast.parse(path.read_text())):
            found.append(relative)
    return found


PRODUCTION_LLM_MODULES = [
    "content/transcribe.py",
    "content/judge.py",
    "delivery/judge.py",
    "intake/profile.py",
    "rubric/compiler.py",
    "research/sweep.py",
    "api/pipeline.py",
]


def _model_calls(tree: ast.AST) -> list[ast.Call]:
    return [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in _NETWORK_CALLS
    ]


def _guarded_calls(tree: ast.AST) -> set[int]:
    """Ids of every model call lexically inside a call_with_retry argument."""
    guarded: set[int] = set()
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "call_with_retry"):
            for argument in [*node.args, *(kw.value for kw in node.keywords)]:
                guarded.update(id(call) for call in _model_calls(argument))
    return guarded


def test_every_model_call_in_the_tree_is_wrapped_in_backoff():
    """Discovered, not listed, so a NEW module cannot slip through.

    The listed-modules version of this test could not fail for a call site
    added in a file nobody had thought to list -- and this batch is adding
    exactly such a file. The population is now
    every module in the tree minus a two-entry allowlist with reasons.
    """
    unguarded = []
    for relative in _module_paths():
        tree = ast.parse((SRC / relative).read_text())
        guarded = _guarded_calls(tree)
        unguarded += [
            f"{relative}:{call.lineno} {call.func.attr}"  # type: ignore[union-attr]
            for call in _model_calls(tree) if id(call) not in guarded
        ]
    assert unguarded == [], (
        "these model calls would lose a customer's work to one transient "
        f"provider failure: {unguarded}. Wrap them in call_with_retry, or "
        f"add the module to EXEMPT with the reason it is not on the "
        "customer's path."
    )


def test_the_known_call_sites_are_all_still_present():
    """Pins the audited population so a call site cannot quietly disappear
    into a helper the discovery walk classifies differently."""
    assert set(PRODUCTION_LLM_MODULES) <= set(_module_paths())
    total = sum(
        len(_model_calls(ast.parse((SRC / relative).read_text())))
        for relative in PRODUCTION_LLM_MODULES
    )
    assert total == 11, (
        "production model call sites changed -- 9 generate_content plus 2 "
        "file uploads as of v0.6; confirm the new one backs off"
    )


# ------------------------------------------------------- behavioural checks


@pytest.fixture
def no_wait(monkeypatch):
    """Retry without real sleeping and without jitter noise."""
    monkeypatch.setattr(resilience_module, "_sleep", lambda _s: None)
    monkeypatch.setattr(resilience_module, "_jitter", lambda: 0.0)


def _api_error(code: int) -> genai_errors.APIError:
    return genai_errors.APIError(
        code, {"error": {"message": f"scripted {code}", "status": "SCRIPTED"}})


def _transcript_reply() -> str:
    return json.dumps({"segments": [
        {"start_s": 0.0, "end_s": 2.0, "speaker": "interviewer",
         "text": "Tell me about a launch."},
        {"start_s": 2.0, "end_s": 9.0, "speaker": "candidate",
         "text": "uh we shipped it in six weeks"},
    ]})


def test_transcription_survives_a_transient_failure(no_wait, tmp_path):
    audio = tmp_path / "session.wav"
    audio.write_bytes(b"not really a wav, never decoded here")
    fake = FakeGenAI(canned_texts=[_api_error(503), _transcript_reply()])

    segments = transcribe_verbatim(audio, fake)

    assert [seg.speaker for seg in segments] == ["interviewer", "candidate"]
    assert len(fake.calls) == 2, "the transcription call must be retried, not lost"


def test_transcription_upload_survives_a_transient_failure(no_wait, tmp_path):
    audio = tmp_path / "session.wav"
    audio.write_bytes(b"bytes")
    fake = FakeGenAI(canned_texts=[_transcript_reply()])
    failures = {"n": 0}
    real_upload = fake.files.upload

    def flaky_upload(*, file):
        failures["n"] += 1
        if failures["n"] == 1:
            raise httpx.ConnectError("connection reset mid-upload")
        return real_upload(file=file)

    fake.files.upload = flaky_upload

    transcribe_verbatim(audio, fake)

    assert failures["n"] == 2, "a dropped upload of the one recording must retry"


def test_profile_extraction_survives_a_transient_failure(no_wait):
    profile_json = json.dumps({
        "name": "Ada", "headline": "PM", "years_experience": "4+ years",
        "roles": ["PM"], "skills": ["discovery"], "achievements": [],
    })
    fake = FakeGenAI(canned_texts=[_api_error(429), profile_json])

    profile = build_profile("resume text", None, fake)

    assert profile.name == "Ada"
    assert len(fake.calls) == 2


def test_jd_fact_extraction_survives_a_transient_failure(no_wait):
    fake = FakeGenAI(canned_texts=[
        _api_error(500),
        json.dumps({"role_title": "Deployment Strategist", "company": "Acme"}),
    ])

    facts = _extract_jd_facts("a job description", fake)

    assert facts.role_title == "Deployment Strategist"
    assert len(fake.calls) == 2


def test_research_sweep_survives_a_transient_failure_on_a_grounded_call(no_wait):
    structured = json.dumps({
        "queries": [], "reported_questions": ["Tell me about a launch"],
        "probe_areas": ["scoping"], "evaluation_signals": ["specifics"],
        "citations": [],
    })
    fake = FakeGenAI(
        canned_texts=[_api_error(503), "prose one", "prose two", structured],
        canned_grounding=[None, None, None, None],
    )

    findings = run_sweep("jd text", "Deployment Strategist", None, fake)

    assert findings.reported_questions == ["Tell me about a launch"]
    assert len(fake.calls) == 4


def test_research_structuring_call_survives_a_transient_failure(no_wait):
    structured = json.dumps({
        "queries": [], "reported_questions": [], "probe_areas": [],
        "evaluation_signals": [], "citations": [],
    })
    fake = FakeGenAI(
        canned_texts=["prose one", "prose two", _api_error(429), structured],
        canned_grounding=[None, None, None, None],
    )

    run_sweep("jd text", "Deployment Strategist", None, fake)

    assert len(fake.calls) == 4


def _rubric_payload() -> dict:
    citation = {"url": "https://example.com/a", "title": "A", "snippet": "s"}
    anchors = [
        {"score": 1, "behavior": "vague"},
        {"score": 3, "behavior": "partly specific"},
        {"score": 5, "behavior": "fully specific"},
    ]
    return {
        "role_title": "Deployment Strategist",
        "company": None,
        "dimensions": [
            {"key": "structured-answers", "name": "Structured answers",
             "weight": 0.5, "channel": "content", "anchors": anchors,
             "signals": ["names the decision"], "citations": [citation]},
            {"key": "pacing-control", "name": "Pacing control",
             "weight": 0.5, "channel": "delivery", "anchors": anchors,
             "signals": ["steady rate"], "citations": [citation]},
        ],
        "question_bank": [],
        "research_summary": "Rewards specifics.",
    }


def _empty_profile() -> CandidateProfile:
    return CandidateProfile(name=None, headline=None, years_experience=None,
                            roles=[], skills=[], achievements=[])


def _empty_findings() -> ResearchFindings:
    return ResearchFindings(queries=[], reported_questions=[], probe_areas=[],
                            evaluation_signals=[], citations=[])


def test_rubric_compile_survives_a_transient_failure(no_wait):
    fake = FakeGenAI(canned_texts=[_api_error(503), json.dumps(_rubric_payload())])

    rubric = compile_rubric("jd", _empty_profile(), _empty_findings(), [], [], fake)

    assert rubric.role_title == "Deployment Strategist"
    assert len(fake.calls) == 2


def test_rubric_repair_retry_also_backs_off(no_wait):
    """The repair call is a second chance at an expensive compile; losing it
    to a 429 fails the whole package."""
    fake = FakeGenAI(canned_texts=[
        json.dumps({"role_title": "x"}),          # invalid -> triggers repair
        _api_error(429),                          # the repair call blips
        json.dumps(_rubric_payload()),
    ])

    rubric = compile_rubric("jd", _empty_profile(), _empty_findings(), [], [], fake)

    assert rubric.role_title == "Deployment Strategist"
    assert len(fake.calls) == 3


def _metrics() -> DeliveryMetrics:
    return DeliveryMetrics(
        wpm_overall=120.0, wpm_timeline=[120.0], silence_events=[],
        filler_count=1, filler_rate_per_min=1.0, f0_variance=None,
        avg_response_latency_s=None,
    )


def test_delivery_judge_survives_a_transient_failure(no_wait, monkeypatch, tmp_path):
    monkeypatch.setattr("scorer.delivery.judge.sf.info",
                        lambda _p: type("I", (), {"duration": 30.0})())
    audio = tmp_path / "session.wav"
    audio.write_bytes(b"bytes")
    delivery_dim = RubricDimension.model_validate(_rubric_payload()["dimensions"][1])
    reply = json.dumps({
        "scores": [{"dimension_key": "pacing-control", "score": 4.0,
                    "evidence_quotes": ["[00:10]"], "rationale": "steady"}],
        "observations": [],
    })
    fake = FakeGenAI(canned_texts=[_api_error(502), reply])

    scores, _observations = judge_delivery(audio, _metrics(), [delivery_dim], fake)

    assert scores[0].dimension_key == "pacing-control"
    assert len(fake.calls) == 2
