"""Six-session package simulation over a governed rubric (F-94 + F-09).

The F-83 review precedent: package-lifetime claims are verified by walking
the package, not by trusting per-session tests to compose. A governed
rubric (one indirect peripheral dimension beside realistic direct ones)
runs sessions 1..6 through the real mint route with evolving scored
history in which the indirect dimension is ALWAYS the lowest score --
exactly the shape that produced the production failure DECISIONS 077
closes. Across all six sessions:

* the indirect dimension is never minted a main question;
* the weakest-first emphasis (first question) and the pressure-probe
  target never land on it;
* no question text repeats verbatim anywhere in the package;
* the carry-over drills block appears exactly when a prior scored report
  exists, carrying the MOST RECENT report's drills only (DECISIONS 078);
* the instructions stay well-formed: every section present and ordered,
  no template artifacts, and the carry-over block in the calm register.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    BarsAnchor,
    DeliveryMetrics,
    DimensionScore,
    QuestionSpec,
    Rubric,
    RubricDimension,
    SessionReport,
    SourceCitation,
)

TOKEN = "test-worker-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}

INDIRECT_KEY = "ai-safety-and-mission-alignment"
LOWEST_DIRECT_CONTENT = "stakeholder-alignment"

SECTION_ORDER = (
    "# PERSONA",
    "# LANGUAGE",
    "# OPENING",
    "# RULES",
    "# ACTIVE LISTENING",
    "# PAUSES AND SILENCE",
    "# QUESTION SEQUENCE",
    "# PRESSURE MOMENT",
    "# WARMTH",
    "# PACING",
    "# CONFIDENTIALITY",
)


@pytest.fixture(autouse=True)
def _worker_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    monkeypatch.setenv("SCORER_CORPUS_DIR", str(tmp_path / "corpus-cache"))


def _dim(key: str, name: str, channel: str, weight: float,
         probing_mode: str = "direct") -> RubricDimension:
    return RubricDimension(
        key=key, name=name, weight=weight, channel=channel,
        anchors=[
            BarsAnchor(score=1, behavior=f"No sign of {name.lower()}."),
            BarsAnchor(score=3, behavior=f"Some {name.lower()}, thin detail."),
            BarsAnchor(score=5, behavior=f"Consistent, specific {name.lower()}."),
        ],
        signals=[f"{name}: named specifics"],
        citations=[SourceCitation(
            url="https://example.com/guide",
            title="Example guide",
            snippet=f"Interviewers probe {name.lower()}.",
        )],
        probing_mode=probing_mode,
    )


def _governed_rubric() -> Rubric:
    """The compile post-pass output shape: peripheral dim indirect, capped."""
    return Rubric(
        role_title="Forward Deployed Product Manager",
        company="Meridian Flow",
        dimensions=[
            _dim("deployment-ownership", "Deployment ownership",
                 "content", 0.30),
            _dim(LOWEST_DIRECT_CONTENT, "Stakeholder Alignment",
                 "content", 0.25),
            _dim(INDIRECT_KEY, "AI Safety and Mission Alignment",
                 "content", 0.10, probing_mode="indirect"),
            _dim("field-discovery", "Field discovery", "content", 0.15),
            _dim("pacing-control", "Pacing control", "delivery", 0.20),
        ],
        question_bank=[
            QuestionSpec(
                dimension_key="deployment-ownership",
                question="Walk me through a rollout you owned end to end.",
                probes=["What was the measurable outcome?"],
                source="research-sweep",
            ),
            QuestionSpec(
                dimension_key="deployment-ownership",
                question="Tell me about a deployment that nearly failed.",
                probes=["What did you change afterwards?"],
                source="research-sweep",
            ),
        ],
        research_summary="Synthetic governed rubric for the simulation.",
    )


def _report(session_id: str, session_index: int) -> SessionReport:
    """Evolving history: the indirect dimension is ALWAYS the lowest score."""
    scores = {
        INDIRECT_KEY: 2.0 + 0.05 * session_index,        # always the floor
        LOWEST_DIRECT_CONTENT: 2.8 + 0.1 * session_index,  # lowest DIRECT
        "deployment-ownership": 3.6,
        "field-discovery": 3.9,
        "pacing-control": 4.0,
    }
    return SessionReport(
        session_id=session_id,
        verdict="approaching",
        overall_score=3.2,
        dimension_scores=[
            DimensionScore(
                dimension_key=key, score=value,
                evidence_quotes=["we cut churn by 12 percent"],
                rationale="One concrete example with thin detail.")
            for key, value in scores.items()
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=148.0, wpm_timeline=[150.0, 146.0], silence_events=[],
            filler_count=6, filler_rate_per_min=1.4, f0_variance=812.5,
            avg_response_latency_s=1.1),
        delivery_observations=[],
        strengths=["Quantifies outcomes without prompting."],
        gaps=["Long pauses before pressure answers."],
        next_drills=[
            f"Session {session_index} drill: open with the outcome, "
            "then the method.",
        ],
        limits_note=("Scores reflect agreement with the rubric, "
                     "not an admission prediction."),
    )


def _drill_line(session_index: int) -> str:
    return (f"- Session {session_index} drill: open with the outcome, "
            "then the method.")


def test_six_governed_sessions_never_surface_the_indirect_dimension():
    db = FakeDatabase()
    package = ready_package(db, paid_at="2026-08-10T00:00:00+00:00")
    db.set_package_rubric(package.id, _governed_rubric(), status="ready")
    client = TestClient(create_app(db, FakeStorage(), FakeGenAI([])))

    main_questions: list[str] = []
    pressure_questions: list[str] = []
    for index in range(1, 7):
        body = client.post("/api/sessions", json={"package_id": package.id},
                           headers=AUTH).json()
        assert body["index"] == index
        plan = db.get_session(body["session_id"]).session_plan
        instructions = body["interviewer_instructions"]

        # -- The indirect dimension is never minted a main question, and
        # every direct dimension is still covered.
        minted = [q.dimension_key for q in plan.question_sequence]
        assert INDIRECT_KEY not in minted, index
        assert set(minted) == {
            "deployment-ownership", LOWEST_DIRECT_CONTENT,
            "field-discovery", "pacing-control"}, index

        # -- Focus protection (D6): the weakest-first emphasis and the
        # pressure target land on the lowest DIRECT dimension, never on
        # the indirect one -- even though it is always the lowest score.
        assert plan.pressure_probe.dimension_key != INDIRECT_KEY, index
        if index == 1:
            assert plan.focus == "baseline"
            assert plan.pressure_probe.dimension_key == "deployment-ownership"
        else:
            assert plan.focus == "targeted"
            assert minted[0] == LOWEST_DIRECT_CONTENT, index
            assert (plan.pressure_probe.dimension_key
                    == LOWEST_DIRECT_CONTENT), index

        # -- The dimension never leaks into the rendered instructions:
        # not in the opening area list, not as a question, not at all.
        assert "ai safety" not in instructions.lower(), index
        assert "mission alignment" not in instructions.lower(), index

        # -- Carry-over (DECISIONS 078): the block appears exactly when a
        # prior scored report exists, with the most recent drills only.
        if index == 1:
            assert "# CARRY-OVER" not in instructions
        else:
            assert instructions.count("# CARRY-OVER") == 1, index
            assert _drill_line(index - 1) in instructions, index
            for stale in range(1, index - 1):
                assert _drill_line(stale) not in instructions, (index, stale)
            block = instructions[instructions.index("# CARRY-OVER"):
                                 instructions.index("# PRESSURE MOMENT")]
            assert "!" not in block, index  # calm register

        # -- Well-formed instructions: every section present, in order,
        # with no template artifacts or unrendered values.
        positions = [instructions.index(header) for header in SECTION_ORDER]
        assert positions == sorted(positions), index
        assert "{name}" not in instructions and "None" not in instructions
        for number in range(1, len(minted) + 1):
            assert f"\n{number}. " in instructions, (index, number)

        main_questions.extend(q.question for q in plan.question_sequence)
        pressure_questions.append(plan.pressure_probe.question)
        db.save_report(body["session_id"], _report(body["session_id"], index))

        # -- The read path rebuilds instructions AFTER this session's report
        # is written: its own drills must never leak into its own session
        # (the report is written after the interview it scores), while the
        # previous session's drills still carry over.
        reread = client.get(f"/api/sessions/{body['session_id']}",
                            headers=AUTH).json()["interviewer_instructions"]
        assert _drill_line(index) not in reread, index
        if index == 1:
            assert "# CARRY-OVER" not in reread
        else:
            assert _drill_line(index - 1) in reread, index

    # -- No verbatim repeats anywhere in the package: 6 sessions x 4 main
    # questions, plus 6 pressure probes, all distinct.
    all_questions = main_questions + pressure_questions
    assert len(all_questions) == 30
    assert len(set(all_questions)) == 30
