"""F-74 study routes: the refusals, the read-time status, and the live join.

Three endpoints with three different jobs, and each one has a rule that no
schema can express.

POST is a chokepoint. It refuses in a fixed order -- unknown package, expired
window, rate limit, a build already running, nothing worth building from --
and every one of those refusals carries a machine-readable `code` the web
action maps to a sentence a customer reads. A refusal that answers the right
status with the wrong code is a silent regression: the page falls through to
its generic "did not start" copy and the customer is told nothing.

GET computes `status` and `stale` AT READ TIME rather than storing them
(DECISIONS 050). That is the design's load-bearing simplification -- there is
no reaper flipping abandoned "generating" rows to "failed", so the read has to
do it -- and it is exactly the part a test has to hold, because a row that
says "generating" forever looks identical in the database to one that is.

GET bookmarks is never generated and never stored: it joins paraphrases to
marks on every read, so unmarking something makes it leave the study page with
no write of our own.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from factories import ready_package
from fakes import FakeDatabase, FakeGenAI, FakeStorage
from scorer.api.app import create_app
from scorer.schemas import (
    DeliveryMetrics,
    DimensionScore,
    InsightExpression,
    ParaphraseItem,
    ParaphraseMark,
    SessionInsights,
    SessionParaphrases,
    SessionReport,
)
from scorer.sessionplan.planner import plan_baseline_session

AUTH = {"Authorization": "Bearer test-worker-token"}

# Substrings of the insight material below, so the generator's verbatim check
# keeps the answers instead of dropping them.
QUOTE = "I led the churn dashboard rollout"


def _client(monkeypatch, db: FakeDatabase,
            client: FakeGenAI | None = None) -> TestClient:
    monkeypatch.setenv("WORKER_API_TOKEN", "test-worker-token")
    return TestClient(create_app(db, FakeStorage(), client or FakeGenAI([])))


def _report(session_id: str, *, eligibility: str = "scored") -> SessionReport:
    return SessionReport(
        session_id=session_id,
        verdict="approaching",
        eligibility=eligibility,
        overall_score=3.2,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=3.2,
                evidence_quotes=[QUOTE],
                rationale="One clear example, thin surrounding detail."),
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=138.0, wpm_timeline=[137.0], silence_events=[],
            filler_count=3, filler_rate_per_min=1.1, f0_variance=650.0,
            avg_response_latency_s=1.2),
        delivery_observations=[],
        strengths=["Names outcomes without prompting."],
        gaps=["Answers stay at the summary level."],
        next_drills=["Add one quantified detail per answer."],
        limits_note="Scores reflect rubric agreement, not an admission "
                    "prediction.",
    )


def _insights(session_id: str) -> SessionInsights:
    return SessionInsights(
        generated_at="2026-08-08T00:00:00+00:00",
        did_well=["Opened with the outcome."],
        did_poorly=["Left the metric unnamed."],
        must_keep=[InsightExpression(
            turn_index=2, said_verbatim=QUOTE,
            better=f"{QUOTE}, cutting handle time 18%",
            why="The number is the part an interviewer remembers.")],
        must_answer=[],
    )


def _scored_session(db: FakeDatabase, package, *, index: int,
                    eligibility: str = "scored", with_insights: bool = True):
    """A session carrying a report -- the only kind study material is built from."""
    row = db.create_session(package.id, index, plan_baseline_session(package.rubric))
    db.save_report(row.id, _report(row.id, eligibility=eligibility))
    if with_insights:
        db.save_session_insights(row.id, _insights(row.id))
    return row


def _doc_json(*, session_ids: tuple[str, ...],
              dimension_key: str = "structured-answers",
              quote: str = QUOTE) -> str:
    """A model reply that survives the generator's own post-validation."""
    return json.dumps({
        "schema_version": 1,
        "source_session_ids": list(session_ids),
        "summary": {
            "core_problems": [
                {"title": "Answers stay abstract",
                 "description": "Examples arrive without the number behind them.",
                 "dimension_keys": [dimension_key]},
                {"title": "Pacing drifts late",
                 "description": "The last third of each answer speeds up.",
                 "dimension_keys": ["pacing-control"]},
            ],
            "improvement_strategy": [
                "Name the metric in the first sentence.",
                "Rehearse the close at half speed.",
                "Cut every answer to ninety seconds.",
            ],
            "priority_expressions": ["cutting handle time 18%"],
        },
        "jd_core_answers": [{
            "question": "Walk me through a project you led end to end.",
            "dimension_key": dimension_key,
            "model_answer": "Open with the outcome, then the mechanism.",
            "based_on_quotes": [quote],
        }],
    })


# --- auth ----------------------------------------------------------------


@pytest.mark.parametrize("method,path", [
    ("post", "/api/packages/pkg-1/study"),
    ("get", "/api/packages/pkg-1/study"),
    ("get", "/api/packages/pkg-1/bookmarks"),
])
def test_every_study_route_requires_the_worker_token(monkeypatch, method, path):
    # Study material is the most personal artifact this product holds: it
    # quotes the customer verbatim. No route here is public, and none takes a
    # capability token the way a shared report does.
    client = _client(monkeypatch, FakeDatabase())
    assert getattr(client, method)(path).status_code == 401


# --- POST refusals, in the order the route applies them -------------------


def test_post_unknown_package_is_404(monkeypatch):
    client = _client(monkeypatch, FakeDatabase())
    assert client.post("/api/packages/nope/study", headers=AUTH).status_code == 404


def test_post_refuses_an_expired_package_with_the_shared_code(monkeypatch):
    # Mirrors the sessions router: an ended paid window starts nothing new.
    # Reads stay open -- GET below is deliberately not gated on expiry.
    db = FakeDatabase()
    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    package = ready_package(db, expires_at=past)
    _scored_session(db, package, index=1)
    client = _client(monkeypatch, db)

    response = client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    assert response.status_code == 410
    assert response.json()["code"] == "package-expired"


def test_post_lets_a_package_with_no_expiry_through(monkeypatch):
    # expires_at is None for trial and unpaid packages, and None must never
    # read as "expired" -- that would refuse every package before payment.
    db = FakeDatabase()
    package = ready_package(db, expires_at=None)
    session = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))

    assert client.post(f"/api/packages/{package.id}/study",
                       headers=AUTH).status_code == 202


def test_post_rate_limits_per_account(monkeypatch):
    # study_per_window = 6 in config/product.toml, keyed on the account so one
    # user cannot spend another's budget.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    replies = [_doc_json(session_ids=(session.id,)) for _ in range(7)]
    client = _client(monkeypatch, db, FakeGenAI(replies))

    seen = [client.post(f"/api/packages/{package.id}/study", headers=AUTH).status_code
            for _ in range(7)]

    assert seen[:6] == [202] * 6
    assert seen[6] == 429


def test_post_refuses_while_a_fresh_build_is_running(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    _scored_session(db, package, index=1)
    db.begin_study_generation(package.id)
    client = _client(monkeypatch, db)

    response = client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    assert response.status_code == 409
    assert response.json()["code"] == "study-generating"


def test_post_accepts_again_once_a_running_build_has_gone_stale(monkeypatch):
    # The other half of having no reaper: a worker that died mid-build leaves
    # a "generating" row forever, and without this the customer could never
    # start another one. The staleness window is the only thing that frees it.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    stale_after = 600.0  # limits.study_generating_stale_after_s
    db.now_iso = (datetime.now(UTC)
                  - timedelta(seconds=stale_after + 60)).isoformat()
    db.begin_study_generation(package.id)
    db.now_iso = None
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))

    assert client.post(f"/api/packages/{package.id}/study",
                       headers=AUTH).status_code == 202


def test_post_refuses_a_package_with_nothing_to_build_from(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    # A planned session that was never scored carries no report and no
    # evidence; building from it would produce a document about nothing.
    db.create_session(package.id, 1, plan_baseline_session(package.rubric))
    client = _client(monkeypatch, db)

    response = client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    assert response.status_code == 409
    assert response.json()["code"] == "no-scored-sessions"


def test_post_counts_a_limited_session_as_something_to_build_from(monkeypatch):
    # F-04 "limited" is a real 10-15 minute session with a real report. It is
    # thinner evidence, not absent evidence, and the study route consumes it
    # exactly like a full one.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1, eligibility="limited")
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))

    assert client.post(f"/api/packages/{package.id}/study",
                       headers=AUTH).status_code == 202


def test_post_starts_the_build_and_reports_generating(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))

    response = client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    assert response.status_code == 202
    assert response.json() == {"package_id": package.id, "status": "generating"}
    # TestClient drains background tasks before returning, so the row here is
    # the finished one -- which is also the proof the task was enqueued at all.
    assert db.get_study(package.id).status == "ready"
    assert db.get_study(package.id).doc.source_session_ids == [session.id]


# --- GET status, computed at read time ------------------------------------


def test_get_unknown_package_is_404(monkeypatch):
    client = _client(monkeypatch, FakeDatabase())
    assert client.get("/api/packages/nope/study", headers=AUTH).status_code == 404


def test_get_reports_none_before_anything_is_built(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body == {"package_id": package.id, "status": "none", "stale": False,
                    "generated_at": None, "doc": None}


def test_get_reports_a_fresh_build_as_generating(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    db.begin_study_generation(package.id)
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["status"] == "generating"
    assert body["stale"] is False


def test_a_generating_row_older_than_the_window_reads_as_failed(monkeypatch):
    # The transition this design turns on. Nothing writes "failed" here: the
    # row still says "generating" in the database, and the read decides. A
    # customer whose worker died sees a retry button instead of a spinner
    # that never resolves.
    db = FakeDatabase()
    package = ready_package(db)
    db.now_iso = (datetime.now(UTC) - timedelta(seconds=660)).isoformat()
    db.begin_study_generation(package.id)
    db.now_iso = None
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["status"] == "failed"
    assert db.get_study(package.id).status == "generating"   # no write happened


def test_get_reports_a_failed_row_as_failed(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    db.fail_study_generation(package.id)
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["status"] == "failed"


def test_a_document_built_from_the_current_sessions_is_not_stale(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["status"] == "ready"
    assert body["stale"] is False
    assert body["generated_at"] is not None


def test_a_new_scored_session_makes_the_document_stale(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    first = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(first.id,))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)
    _scored_session(db, package, index=2)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["stale"] is True
    # Stale content is still true content -- the document survives the flag.
    assert body["doc"] is not None


def test_a_deleted_session_makes_the_document_stale(monkeypatch):
    # The direction a "did the count grow?" check would miss. The customer
    # deleted a session; the guide still quotes it, so it must be rebuildable.
    db = FakeDatabase()
    package = ready_package(db)
    first = _scored_session(db, package, index=1)
    second = _scored_session(db, package, index=2)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(first.id, second.id))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)
    assert client.get(f"/api/packages/{package.id}/study",
                      headers=AUTH).json()["stale"] is False

    db.delete_rows("session", [second.id])

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()
    assert body["stale"] is True


def test_a_swapped_session_of_the_same_count_is_stale(monkeypatch):
    # One deleted, one added: the count is unchanged and the evidence is not.
    # This is why the comparison is a set difference and not a length.
    db = FakeDatabase()
    package = ready_package(db)
    first = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(first.id,))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    db.delete_rows("session", [first.id])
    _scored_session(db, package, index=2)

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()
    assert body["stale"] is True


def test_staleness_ignores_sessions_that_were_never_scored(monkeypatch):
    # A planned session is not evidence, so starting one must not tell the
    # customer their guide is out of date.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)

    db.create_session(package.id, 2, plan_baseline_session(package.rubric))

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()
    assert body["stale"] is False


def test_an_expired_package_can_still_read_its_study_material(monkeypatch):
    # Expiry ends new work, never access to what was already paid for.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    client = _client(monkeypatch, db,
                     FakeGenAI([_doc_json(session_ids=(session.id,))]))
    client.post(f"/api/packages/{package.id}/study", headers=AUTH)
    db.packages[package.id] = db.packages[package.id].model_copy(
        update={"expires_at": (datetime.now(UTC) - timedelta(days=1)).isoformat()})

    body = client.get(f"/api/packages/{package.id}/study", headers=AUTH).json()

    assert body["status"] == "ready"
    assert body["doc"] is not None


# --- GET bookmarks: a join, never a stored document -----------------------


def _paraphrases(*turn_indices: int) -> SessionParaphrases:
    return SessionParaphrases(
        generated_at="2026-08-08T00:00:00+00:00",
        turn_count=max(turn_indices, default=0) + 1,
        items=[ParaphraseItem(
            turn_index=index, verdict="improve",
            source_quote=f"what I said at turn {index}",
            suggestion=f"a stronger turn {index}",
            why="Names the outcome first.") for index in turn_indices],
    )


def test_bookmarks_unknown_package_is_404(monkeypatch):
    client = _client(monkeypatch, FakeDatabase())
    assert client.get("/api/packages/nope/bookmarks",
                      headers=AUTH).status_code == 404


def test_bookmarks_returns_only_the_marked_turns(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    db.save_session_paraphrases(session.id, _paraphrases(1, 2, 3))
    db.set_paraphrase_mark(session.id, 2, ParaphraseMark(bookmarked=True))
    db.set_paraphrase_mark(session.id, 3, ParaphraseMark(reaction="up"))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert body["package_id"] == package.id
    assert len(body["sessions"]) == 1
    entry = body["sessions"][0]
    assert entry["session_id"] == session.id
    assert entry["session_index"] == 1
    # Turn 3 has a mark, but a thumbs-up is not a bookmark.
    assert [item["turn_index"] for item in entry["items"]] == [2]
    assert entry["items"][0]["source_quote"] == "what I said at turn 2"


def test_a_bookmark_on_a_turn_with_no_paraphrase_is_ignored(monkeypatch):
    # Marks are keyed by turn index and stored independently of the
    # paraphrase document. A mark can outlive the item it pointed at (the
    # paraphrases were regenerated shorter), and a dangling key must not
    # invent an entry -- there is no verbatim quote to show for it.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    db.save_session_paraphrases(session.id, _paraphrases(1))
    db.set_paraphrase_mark(session.id, 1, ParaphraseMark(bookmarked=True))
    db.set_paraphrase_mark(session.id, 9, ParaphraseMark(bookmarked=True))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert [item["turn_index"] for item in body["sessions"][0]["items"]] == [1]


def test_sessions_with_no_bookmarks_are_omitted(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    marked = _scored_session(db, package, index=1)
    unmarked = _scored_session(db, package, index=2)
    db.save_session_paraphrases(marked.id, _paraphrases(1))
    db.set_paraphrase_mark(marked.id, 1, ParaphraseMark(bookmarked=True))
    db.save_session_paraphrases(unmarked.id, _paraphrases(1, 2))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert [entry["session_id"] for entry in body["sessions"]] == [marked.id]


def test_a_session_with_no_paraphrases_at_all_is_omitted(monkeypatch):
    # T4 writes paraphrases; until it has run for a session there is no
    # document, and this route degrades to "nothing saved yet" rather than
    # failing the whole page.
    db = FakeDatabase()
    package = ready_package(db)
    _scored_session(db, package, index=1)
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert body == {"package_id": package.id, "sessions": []}


def test_bookmarks_are_grouped_by_session_in_ascending_index(monkeypatch):
    db = FakeDatabase()
    package = ready_package(db)
    first = _scored_session(db, package, index=1)
    second = _scored_session(db, package, index=2)
    for session in (first, second):
        db.save_session_paraphrases(session.id, _paraphrases(1))
        db.set_paraphrase_mark(session.id, 1, ParaphraseMark(bookmarked=True))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert [entry["session_index"] for entry in body["sessions"]] == [1, 2]


def test_unmarking_removes_a_bookmark_from_the_next_read(monkeypatch):
    # The point of joining at read time: no write of ours is involved in
    # taking something back off the study page.
    db = FakeDatabase()
    package = ready_package(db)
    session = _scored_session(db, package, index=1)
    db.save_session_paraphrases(session.id, _paraphrases(1))
    db.set_paraphrase_mark(session.id, 1, ParaphraseMark(bookmarked=True))
    client = _client(monkeypatch, db)
    assert client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()["sessions"] != []

    db.set_paraphrase_mark(session.id, 1, ParaphraseMark(bookmarked=False))

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()
    assert body["sessions"] == []


def test_bookmarks_survive_a_session_that_was_never_scored(monkeypatch):
    # A planned session has no paraphrases; the loop must skip it rather than
    # raise on the missing document and take the whole join down.
    db = FakeDatabase()
    package = ready_package(db)
    scored = _scored_session(db, package, index=1)
    db.create_session(package.id, 2, plan_baseline_session(package.rubric))
    db.save_session_paraphrases(scored.id, _paraphrases(1))
    db.set_paraphrase_mark(scored.id, 1, ParaphraseMark(bookmarked=True))
    client = _client(monkeypatch, db)

    body = client.get(f"/api/packages/{package.id}/bookmarks",
                      headers=AUTH).json()

    assert [entry["session_id"] for entry in body["sessions"]] == [scored.id]
