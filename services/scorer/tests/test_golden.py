import json

import httpx
import pytest
import yaml

from fakes import FakeGenAI
from scorer.config import load_product_config
from scorer.evals_l1.golden import (
    TripletDoc,
    TripletGenerationError,
    generate_goldens,
    generate_triplet,
    judge_discrimination,
)
from scorer.schemas import (
    BarsAnchor,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SourceCitation,
)


def _dim(key: str, name: str, channel: str, weight: float) -> RubricDimension:
    lowered = name.lower()
    return RubricDimension(
        key=key,
        name=name,
        weight=weight,
        channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"Fails to show {lowered}: vague claims, no example."),
            BarsAnchor(score=3, behavior=f"Shows some {lowered}: one example, thin detail."),
            BarsAnchor(score=5, behavior=f"Consistently shows {lowered}: specific, quantified."),
        ],
        signals=[f"{name}: named specifics", f"{name}: measurable outcomes"],
        citations=[
            SourceCitation(
                url="https://example.com/interview-guide",
                title="Example interview guide",
                snippet=f"Interviewers probe {lowered} with follow-up questions.",
            )
        ],
    )


def _make_rubric() -> Rubric:
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="ExampleCo",
        dimensions=[
            _dim("structured-answers", "Structured answers", "content", 0.3),
            _dim("quantified-impact", "Quantified impact", "content", 0.25),
            _dim("role-knowledge", "Role knowledge", "content", 0.15),
            _dim("pacing-control", "Pacing control", "delivery", 0.15),
            _dim("composure", "Composure", "delivery", 0.15),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="structured-answers",
                question="Walk me through a project you led end to end.",
                probes=["What was your specific role?"],
                source="generated",
            ),
            QuestionSpec(
                dimension_key="quantified-impact",
                question="Tell me about a result of yours that you can quantify.",
                probes=["What was the baseline before your change?"],
                source="generated",
            ),
            QuestionSpec(
                dimension_key="role-knowledge",
                question="What does a forward deployed PM own day to day?",
                probes=["Who are your counterparts?"],
                source="generated",
            ),
        ],
        research_summary="Synthetic rubric used only by layer-1 eval tests.",
    )


def _canned_openai_client(payload: dict) -> tuple[httpx.Client, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = {"choices": [{"message": {"content": json.dumps(payload)}}]}
        return httpx.Response(200, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler)), seen


def test_generate_triplet_calls_openai_chat_completions(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric = _make_rubric()
    dimension = rubric.dimensions[0]
    client, seen = _canned_openai_client(
        {"strong": "Strong answer.", "borderline": "Borderline answer.", "weak": "Weak answer."}
    )

    doc = generate_triplet(rubric, dimension, client)

    assert doc == TripletDoc(
        dimension_key="structured-answers",
        question="Walk me through a project you led end to end.",
        strong="Strong answer.",
        borderline="Borderline answer.",
        weak="Weak answer.",
    )
    (request,) = seen
    assert str(request.url) == "https://api.openai.com/v1/chat/completions"
    assert request.headers["Authorization"] == "Bearer test-key"
    body = json.loads(request.content)
    assert body["model"] == load_product_config().models.triplet_generator
    assert body["response_format"] == {"type": "json_object"}
    prompt = body["messages"][0]["content"]
    assert dimension.name in prompt
    assert doc.question in prompt
    for anchor in dimension.anchors:
        assert anchor.behavior in prompt
    assert "120-200 words" in prompt


def test_generate_triplet_requires_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    rubric = _make_rubric()
    client, _seen = _canned_openai_client({"strong": "s", "borderline": "b", "weak": "w"})
    with pytest.raises(TripletGenerationError, match="OPENAI_API_KEY"):
        generate_triplet(rubric, rubric.dimensions[0], client)


def test_generate_triplet_requires_question_in_bank(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric = _make_rubric()
    delivery_dim = rubric.dimensions[3]  # pacing-control has no question in the bank
    client, _seen = _canned_openai_client({"strong": "s", "borderline": "b", "weak": "w"})
    with pytest.raises(TripletGenerationError, match="pacing-control"):
        generate_triplet(rubric, delivery_dim, client)


def test_generate_triplet_wraps_http_errors(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric = _make_rubric()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "rate limited"})

    client = httpx.Client(transport=httpx.MockTransport(handler))

    with pytest.raises(TripletGenerationError, match="OpenAI request failed"):
        generate_triplet(rubric, rubric.dimensions[0], client)


def test_generate_goldens_writes_triplets_sheets_and_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric_path = tmp_path / "rubric.json"
    rubric_path.write_text(_make_rubric().model_dump_json())
    out_dir = tmp_path / "suite"
    client, seen = _canned_openai_client(
        {
            "strong": "Strong answer with a quantified outcome.",
            "borderline": "Borderline answer with one thin example.",
            "weak": "Weak answer with vague claims.",
        }
    )

    written = generate_goldens(
        rubric_path, out_dir, top_n_dims=2, sets_per_dim=1, client_openai=client
    )

    # Top-2 content dimensions by weight; delivery dimensions are never selected.
    assert [p.name for p in written] == [
        "structured-answers-1.json",
        "quantified-impact-1.json",
    ]
    assert len(seen) == 2

    doc = TripletDoc.model_validate_json(
        (out_dir / "triplets" / "structured-answers-1.json").read_text()
    )
    sheet = yaml.safe_load((out_dir / "manual" / "structured-answers-1.yaml").read_text())
    key = yaml.safe_load((out_dir / "manual" / "keys" / "structured-answers-1.yaml").read_text())

    assert sheet["dimension"] == "structured-answers"
    assert sheet["question"] == doc.question
    assert sheet["ranking"] == []
    assert sheet["notes"] == ""
    assert sorted(sheet["answers"]) == ["A", "B", "C"]
    assert sorted(key["key"].values()) == ["borderline", "strong", "weak"]
    # The key decodes the blind sheet exactly: label -> variant -> original answer text.
    decoded = {label: getattr(doc, variant) for label, variant in key["key"].items()}
    assert decoded == sheet["answers"]


def test_blind_sheet_shuffle_is_deterministic(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    rubric_path = tmp_path / "rubric.json"
    rubric_path.write_text(_make_rubric().model_dump_json())
    payload = {"strong": "Strong.", "borderline": "Borderline.", "weak": "Weak."}
    client_a, _ = _canned_openai_client(payload)
    client_b, _ = _canned_openai_client(payload)

    generate_goldens(rubric_path, tmp_path / "run-a", top_n_dims=1, client_openai=client_a)
    generate_goldens(rubric_path, tmp_path / "run-b", top_n_dims=1, client_openai=client_b)

    name = "structured-answers-1.yaml"
    assert (tmp_path / "run-a" / "manual" / name).read_text() == (
        tmp_path / "run-b" / "manual" / name
    ).read_text()
    assert (tmp_path / "run-a" / "manual" / "keys" / name).read_text() == (
        tmp_path / "run-b" / "manual" / "keys" / name
    ).read_text()


def _judge_doc(key: str, score: float) -> dict:
    return {
        "dimension_key": key,
        "score": score,
        "evidence_quotes": [],
        "rationale": "Matches the anchor language for this level.",
    }


def _judge_replies(target_score: float) -> list[str]:
    # Nine replies (3 content dims x 3 samples) per judged answer. The focused
    # dimension calls run concurrently and pop the ordered script in no fixed
    # order, so every reply carries all three dimensions' scores and is valid
    # for whichever call pops it (score_content keeps only the score for the
    # dimension it asked about).
    docs = [
        _judge_doc("structured-answers", target_score),
        _judge_doc("quantified-impact", 3.0),
        _judge_doc("role-knowledge", 3.0),
    ]
    return [json.dumps({"scores": docs})] * 9


def _write_triplet(triplets_dir) -> TripletDoc:
    doc = TripletDoc(
        dimension_key="structured-answers",
        question="Walk me through a project you led end to end.",
        strong="Strong answer with a crisp arc and a quantified outcome.",
        borderline="Borderline answer with one example and thin detail.",
        weak="Weak answer with vague claims and no example.",
    )
    triplets_dir.mkdir(parents=True, exist_ok=True)
    (triplets_dir / "structured-answers-1.json").write_text(doc.model_dump_json(indent=2))
    return doc


def test_judge_discrimination_counts_strict_ordering(tmp_path):
    doc = _write_triplet(tmp_path / "triplets")
    fake = FakeGenAI(
        [*_judge_replies(4.5), *_judge_replies(3.0), *_judge_replies(1.5)]
    )

    result = judge_discrimination(tmp_path / "triplets", _make_rubric(), fake)

    assert result == {"trials": 1, "correct": 1, "accuracy": 1.0, "failures": []}
    # Answers are judged in the documented strong -> borderline -> weak order,
    # three focused dimension calls x three samples per answer.
    assert len(fake.calls) == 27
    assert doc.strong in fake.calls[0]["contents"]
    assert doc.borderline in fake.calls[9]["contents"]
    assert doc.weak in fake.calls[18]["contents"]


def test_judge_discrimination_records_ordering_failures(tmp_path):
    _write_triplet(tmp_path / "triplets")
    fake = FakeGenAI(
        [*_judge_replies(4.0), *_judge_replies(4.0), *_judge_replies(1.5)]
    )

    result = judge_discrimination(tmp_path / "triplets", _make_rubric(), fake)

    assert result["trials"] == 1
    assert result["correct"] == 0
    assert result["accuracy"] == 0.0
    (failure,) = result["failures"]
    assert failure["triplet"] == "structured-answers-1"
    assert failure["scores"] == {"strong": 4.0, "borderline": 4.0, "weak": 1.5}
    assert "strictly" in failure["reason"]


def _judge_reply_wrong_dimension() -> str:
    # Answers the focused structured-answers call with a different key --
    # score_content raises ContentJudgeError for the dimension it asked about.
    scores = [
        {
            "dimension_key": "quantified-impact",
            "score": 3.0,
            "evidence_quotes": [],
            "rationale": "One example, thin detail.",
        },
    ]
    return json.dumps({"scores": scores})


def test_judge_discrimination_records_content_judge_error_with_partial_scores(tmp_path):
    doc = _write_triplet(tmp_path / "triplets")
    # "strong" scores cleanly; "borderline" answers its structured-answers
    # focused call with the wrong dimension on the first call AND on the
    # judge's one per-dimension retry, so ContentJudgeError surfaces -- the
    # judge is never called for "weak" and scores stays partial (strong only).
    # Replies are keyed by dimension: the focused calls run concurrently, and
    # only the keyed script keeps the wrong-dimension replies landing on
    # structured-answers deterministically.
    fake = FakeGenAI(keyed_texts={
        "structured-answers": (
            [json.dumps({"scores": [_judge_doc("structured-answers", 4.5)]})] * 3
            + [_judge_reply_wrong_dimension()] * 2
        ),
        "quantified-impact": (
            [json.dumps({"scores": [_judge_doc("quantified-impact", 3.0)]})] * 6
        ),
        "role-knowledge": (
            [json.dumps({"scores": [_judge_doc("role-knowledge", 3.0)]})] * 6
        ),
    })

    result = judge_discrimination(tmp_path / "triplets", _make_rubric(), fake)

    assert result["trials"] == 1
    assert result["correct"] == 0
    assert result["accuracy"] == 0.0
    # strong: 3 structured-answers calls. borderline: the failed first draw
    # plus the spent retry, and no more -- then ContentJudgeError surfaces.
    structured_calls = [
        c for c in fake.calls if "Dimension key: structured-answers\n" in c["contents"]
    ]
    assert len(structured_calls) == 5
    # Sibling dimensions may have 0-3 borderline calls each in flight when the
    # failure lands (executor scheduling), but "weak" is never judged: strong's
    # 9 calls, borderline's 2 failures, and at most 3 per sibling.
    assert 11 <= len(fake.calls) <= 17
    assert all(doc.weak not in call["contents"] for call in fake.calls)
    (failure,) = result["failures"]
    assert failure["triplet"] == "structured-answers-1"
    assert failure["scores"] == {"strong": 4.5}
    assert "ContentJudgeError" in failure["reason"]


def _make_rubric_with_dimension_channel(key: str, channel: str) -> Rubric:
    rubric = _make_rubric()
    dims = [
        d.model_copy(update={"channel": channel}) if d.key == key else d
        for d in rubric.dimensions
    ]
    return Rubric(
        role_title=rubric.role_title,
        company=rubric.company,
        dimensions=dims,
        question_bank=rubric.question_bank,
        research_summary=rubric.research_summary,
    )


def test_judge_discrimination_records_missing_target_dimension(tmp_path):
    _write_triplet(tmp_path / "triplets")  # triplet targets "structured-answers"
    # Relabel the triplet's target dimension as delivery-channel: score_content
    # never scores it, so the judge output can never contain it.
    rubric = _make_rubric_with_dimension_channel("structured-answers", "delivery")
    # Both remaining content dimensions' concurrent calls pop identical
    # replies carrying both scores, so pop order never matters.
    reply = json.dumps({"scores": [
        _judge_doc("quantified-impact", 3.0),
        _judge_doc("role-knowledge", 3.0),
    ]})
    fake = FakeGenAI([reply] * 6)

    result = judge_discrimination(tmp_path / "triplets", rubric, fake)

    assert result["trials"] == 1
    assert result["correct"] == 0
    assert len(fake.calls) == 6
    (failure,) = result["failures"]
    assert failure["triplet"] == "structured-answers-1"
    assert failure["scores"] == {}
    assert "structured-answers" in failure["reason"]
    assert "missing from judge output" in failure["reason"]
