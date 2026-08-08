import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    InsightAnswer,
    InsightExpression,
    ParaphraseItem,
    SessionInsights,
    SessionParaphrases,
)
from scorer.sessionplan.planner import plan_baseline_session

TOKEN = "coaching-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def db():
    db = FakeDatabase()
    package = ready_package(db)
    db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    return db


@pytest.fixture
def setup(monkeypatch, db):
    monkeypatch.setenv("WORKER_API_TOKEN", TOKEN)
    session_id = next(iter(db.sessions))
    return TestClient(create_app(db, FakeStorage(), FakeGenAI([]))), session_id


def test_get_defaults_and_patch_round_trip(setup):
    client, session_id = setup
    response = client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH)
    assert response.status_code == 200
    assert response.json()["marks"] == {"schema_version": 1, "marks": {}}
    mark = {"reaction": "up", "bookmarked": True, "flag": {
        "reason": "misheard", "note": "The company name was wrong",
    }}
    patched = client.patch(
        f"/api/sessions/{session_id}/coaching/marks",
        headers=AUTH,
        json={"turn_index": 2, "mark": mark},
    )
    assert patched.status_code == 200
    assert (
        client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH).json()["marks"]["marks"][
            "2"
        ]
        == mark
    )


def test_patch_accepts_the_deployed_client_shape_without_a_flag(setup):
    """A mark without a flag key is the shape every client sent before the
    flag existed; it must keep round-tripping, with flag reading null."""
    client, session_id = setup
    patched = client.patch(
        f"/api/sessions/{session_id}/coaching/marks",
        headers=AUTH,
        json={"turn_index": 0, "mark": {"reaction": None, "bookmarked": True}},
    )
    assert patched.status_code == 200
    saved = client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH)
    assert saved.json()["marks"]["marks"]["0"] == {
        "reaction": None,
        "bookmarked": True,
        "flag": None,
    }


@pytest.mark.parametrize("flag", [
    {"reason": "unknown", "note": "bad enum"},
    {"reason": "misheard", "note": "x" * 501},
    {"reason": "other", "note": ""},
    {"reason": "other", "note": "   "},
])
def test_patch_rejects_invalid_flags(setup, flag):
    client, session_id = setup
    response = client.patch(
        f"/api/sessions/{session_id}/coaching/marks",
        headers=AUTH,
        json={"turn_index": 0, "mark": {
            "reaction": None, "bookmarked": False, "flag": flag,
        }},
    )
    assert response.status_code == 422


def test_auth_not_found_and_bad_body(setup):
    client, session_id = setup
    assert client.get(f"/api/sessions/{session_id}/coaching").status_code == 401
    assert client.get("/api/sessions/missing/coaching", headers=AUTH).status_code == 404
    assert (
        client.patch(
            "/api/sessions/missing/coaching/marks",
            headers=AUTH,
            json={"turn_index": 0, "mark": {"reaction": None, "bookmarked": False}},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            f"/api/sessions/{session_id}/coaching/marks",
            headers=AUTH,
            json={"turn_index": -1, "mark": {"reaction": "sideways", "bookmarked": False}},
        ).status_code
        == 422
    )


def test_patch_refuses_without_a_bearer_token(setup):
    client, session_id = setup
    unauthorized = client.patch(
        f"/api/sessions/{session_id}/coaching/marks",
        json={"turn_index": 0, "mark": {"reaction": "up", "bookmarked": True}},
    )
    assert unauthorized.status_code == 401
    # The refusal is a refusal, not a silent no-op that reports 401 afterwards.
    assert client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH).json()["marks"] == {
        "schema_version": 1, "marks": {},
    }


@pytest.mark.parametrize("body", [
    {"turn_index": 0},                                       # mark missing
    {"mark": {"reaction": "up", "bookmarked": True}},        # turn_index missing
    {"turn_index": 0, "reaction": "up", "bookmarked": True}, # flattened, not nested
    {"turn_index": "two", "mark": {"reaction": "up", "bookmarked": True}},
    {"turn_index": 0, "mark": {"reaction": "up", "bookmarked": True}, "extra": 1},
])
def test_patch_rejects_shapes_that_are_not_the_nested_contract(setup, body):
    # The nested {turn_index, mark:{...}} shape is what the web worker sends;
    # a flattened body must be refused rather than half-read.
    client, session_id = setup
    response = client.patch(
        f"/api/sessions/{session_id}/coaching/marks", headers=AUTH, json=body
    )
    assert response.status_code == 422


def test_get_returns_the_saved_artifacts(setup, db):
    client, session_id = setup
    db.save_session_paraphrases(session_id, SessionParaphrases(
        generated_at="2026-08-05T00:00:00Z",
        turn_count=2,
        items=[ParaphraseItem(
            turn_index=0, verdict="improve", source_quote="grew revenue",
            suggestion="It grew revenue 12 percent.", why="Puts the number in the clause.",
        )],
    ))
    db.save_session_insights(session_id, SessionInsights(
        generated_at="2026-08-05T00:00:00Z",
        did_well=["Named a result."],
        did_poorly=["Buried the number."],
        must_keep=[InsightExpression(
            turn_index=0, said_verbatim="grew revenue", better="grew revenue 12 percent",
            why="Quantifies it.",
        )],
        must_answer=[InsightAnswer(
            question="By how much?", model_answer="Twelve percent.",
            based_on_quotes=["grew revenue"],
        )],
    ))

    payload = client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH).json()

    assert payload["session_id"] == session_id
    assert payload["paraphrases"]["turn_count"] == 2
    assert payload["paraphrases"]["items"][0]["source_quote"] == "grew revenue"
    assert payload["insights"]["must_answer"][0]["question"] == "By how much?"
    assert payload["marks"] == {"schema_version": 1, "marks": {}}


def test_a_session_with_no_coaching_yet_returns_nulls_but_never_a_null_marks_doc(setup):
    client, session_id = setup
    payload = client.get(f"/api/sessions/{session_id}/coaching", headers=AUTH).json()

    assert payload["paraphrases"] is None
    assert payload["insights"] is None
    assert payload["marks"] is not None
