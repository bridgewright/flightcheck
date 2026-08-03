"""Tests for scorer.api.db -- row models, database protocol, and the fake."""
from types import SimpleNamespace

import pytest

from fakes import FakeDatabase
from scorer.api.db import (
    SESSION_COLUMNS,
    Database,
    PackageRow,
    SessionRow,
    SupabaseDatabase,
    create_supabase_client,
)
from scorer.schemas import (
    CandidateProfile,
    DeliveryMetrics,
    DimensionScore,
    Rubric,
    SessionPlan,
    SessionReport,
    TranscriptSegment,
)

CITATION = {
    "url": "https://example.com/interview-guide",
    "title": "Example interview guide",
    "snippet": "Interviewers probe for specifics with follow-up questions.",
}


def _dim(key: str, channel: str, weight: float) -> dict:
    return {
        "key": key,
        "name": key.replace("-", " ").title(),
        "weight": weight,
        "channel": channel,
        "anchors": [
            {"score": 1, "behavior": "Vague claims, no example."},
            {"score": 3, "behavior": "One example, thin detail."},
            {"score": 5, "behavior": "Specific and quantified."},
        ],
        "signals": ["named specifics"],
        "citations": [CITATION],
    }


def _rubric() -> Rubric:
    return Rubric.model_validate({
        "role_title": "Forward Deployed Product Manager",
        "company": "ExampleCo",
        "dimensions": [
            _dim("structured-answers", "content", 0.5),
            _dim("pacing-control", "delivery", 0.5),
        ],
        "question_bank": [{
            "dimension_key": "structured-answers",
            "question": "Walk me through a project you led end to end.",
            "probes": ["What was your specific role?"],
            "source": "generated",
        }],
        "research_summary": "Synthetic rubric for db tests.",
    })


def _question(key: str) -> dict:
    return {
        "dimension_key": key,
        "question": f"Tell me about {key.replace('-', ' ')}.",
        "probes": ["Give a concrete example."],
        "source": "generated",
    }


def _plan() -> SessionPlan:
    return SessionPlan.model_validate({
        "session_index": 1,
        "focus": "baseline",
        "question_sequence": [
            _question("structured-answers"),
            _question("pacing-control"),
        ],
        "pressure_probe": _question("structured-answers"),
        "time_budget_minutes": 20,
    })


def _profile() -> CandidateProfile:
    return CandidateProfile.model_validate({
        "name": "Alex Example",
        "headline": "Senior Product Analyst",
        "years_experience": "4+ years",
        "roles": ["Senior Product Analyst, ExampleCorp"],
        "skills": ["SQL", "Python"],
        "achievements": ["Cut dashboard load time 40%"],
    })


def _report(session_id: str) -> SessionReport:
    return SessionReport(
        session_id=session_id,
        verdict="ready",
        overall_score=4.2,
        dimension_scores=[
            DimensionScore(
                dimension_key="structured-answers", score=4.5,
                evidence_quotes=["we cut churn by 12 percent"],
                rationale="Quantified outcome, close to the score-5 anchor."),
            DimensionScore(
                dimension_key="pacing-control", score=3.9,
                evidence_quotes=["04:12"],
                rationale="Steady pace; one long silence observed at 04:12."),
        ],
        delivery_metrics=DeliveryMetrics(
            wpm_overall=148.0, wpm_timeline=[150.0, 146.0], silence_events=[],
            filler_count=6, filler_rate_per_min=1.4, f0_variance=812.5,
            avg_response_latency_s=1.1),
        delivery_observations=[],
        strengths=["Quantifies outcomes without prompting."],
        gaps=["Long pauses before pressure answers."],
        next_drills=["Drill: 90-second answer with a stated structure up front."],
        limits_note=("Scores reflect agreement with the rubric, "
                     "not an admission prediction."),
    )


def _segments() -> list[TranscriptSegment]:
    return [
        TranscriptSegment(start_s=0.0, end_s=1.8, speaker="interviewer",
                          text="Walk me through a project you led end to end."),
        TranscriptSegment(start_s=3.6, end_s=7.6, speaker="candidate",
                          text="Um, I led the churn dashboard rollout."),
    ]


def test_fake_database_satisfies_protocol():
    assert isinstance(FakeDatabase(), Database)


def test_create_package_returns_compiling_row_with_deterministic_ids():
    db = FakeDatabase()
    row = db.create_package("We are hiring a Senior Product Analyst.", None)
    assert isinstance(row, PackageRow)
    assert row.status == "compiling"
    assert row.candidate_profile is None and row.rubric is None
    assert (row.id, row.access_token) == ("pkg-1", "tok-1")


def test_ids_and_tokens_increment_deterministically():
    db = FakeDatabase()
    a = db.create_package("jd a", None)
    b = db.create_package("jd b", "https://jobs.example.com/b")
    assert (a.id, a.access_token) == ("pkg-1", "tok-1")
    assert (b.id, b.access_token) == ("pkg-2", "tok-2")
    assert db.jd_urls[b.id] == "https://jobs.example.com/b"


def test_fake_create_package_stores_user_id():
    # Packages are born bound (auth-gated /new): the creating account's id
    # rides the insert; omitting it keeps the legacy unbound shape.
    db = FakeDatabase()
    unbound = db.create_package("jd text", None)
    bound = db.create_package("jd text", None, user_id="user-1")
    assert unbound.user_id is None
    assert bound.user_id == "user-1"
    assert db.list_packages_by_user("user-1") == [bound]


def test_get_package_by_token_and_missing_lookups_raise_keyerror():
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    assert db.get_package(row.id) == row
    assert db.get_package_by_token(row.access_token) == row
    with pytest.raises(KeyError):
        db.get_package("missing-id")
    with pytest.raises(KeyError):
        db.get_package_by_token("missing-token")


def test_set_profile_then_rubric_updates_row():
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    db.set_package_profile(row.id, _profile())
    db.set_package_rubric(row.id, _rubric(), "ready")
    updated = db.get_package(row.id)
    assert updated.candidate_profile.name == "Alex Example"
    assert updated.rubric.role_title == "Forward Deployed Product Manager"
    assert updated.status == "ready"


def test_set_package_rubric_none_marks_failed_without_rubric_write():
    # rubric=None is the failed-compile path: status update only, no rubric
    # write (pinned in the interface registry; Task 12's except-handler
    # calls exactly this).
    db = FakeDatabase()
    row = db.create_package("jd text", None)
    db.set_package_rubric(row.id, None, "failed")
    updated = db.get_package(row.id)
    assert updated.status == "failed"
    assert updated.rubric is None


def test_create_session_starts_planned():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    assert isinstance(session, SessionRow)
    assert session.id == "sess-1"
    assert session.status == "planned"
    assert session.index == 1
    assert session.session_plan.focus == "baseline"
    assert db.get_session(session.id) == session


def test_create_session_unknown_package_raises_keyerror():
    with pytest.raises(KeyError):
        FakeDatabase().create_session("missing-package", 1, _plan())


def test_fake_list_sessions_orders_by_index_and_filters_by_package():
    db = FakeDatabase()
    a = db.create_package("jd a", None)
    b = db.create_package("jd b", None)
    second = db.create_session(a.id, 2, _plan())
    first = db.create_session(a.id, 1, _plan())
    assert db.list_sessions(a.id) == [first, second]
    assert db.list_sessions(b.id) == []
    # A filter, not a lookup: an unknown package id is [] -- never KeyError.
    assert db.list_sessions("missing-package") == []


def test_set_session_status_keeps_audio_path_unless_given():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    db.set_session_status(session.id, "scoring",
                          audio_path="packages/p1/session-1.webm")
    db.set_session_status(session.id, "failed")
    updated = db.get_session(session.id)
    assert updated.status == "failed"
    assert updated.audio_path == "packages/p1/session-1.webm"


def test_save_report_stores_report_and_marks_scored():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    report = _report(session.id)
    db.save_report(session.id, report)
    updated = db.get_session(session.id)
    assert updated.report == report
    assert updated.status == "scored"


def test_fake_transcript_round_trip_and_none_when_unset():
    # None = the session exists but has no stored transcript (the honest
    # pre-batch state); a stored transcript round-trips unchanged.
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    assert db.get_transcript(session.id) is None
    db.save_transcript(session.id, _segments())
    assert db.get_transcript(session.id) == _segments()


def test_fake_transcript_unknown_session_raises_keyerror():
    # Registry-pinned: unknown ids raise KeyError in every implementation --
    # "no transcript" (None) and "no session" (KeyError) stay distinct.
    db = FakeDatabase()
    with pytest.raises(KeyError):
        db.save_transcript("missing-sess", _segments())
    with pytest.raises(KeyError):
        db.get_transcript("missing-sess")


def test_fake_set_scoring_stage_updates_row_and_records_writes():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    assert session.scoring_stage is None
    db.set_scoring_stage(session.id, "transcribe")
    assert db.get_session(session.id).scoring_stage == "transcribe"
    assert db.stage_writes == [(session.id, "transcribe")]
    with pytest.raises(KeyError):
        db.set_scoring_stage("missing-sess", "download")
    assert db.stage_writes == [(session.id, "transcribe")]   # no phantom write


def test_fake_terminal_status_writes_clear_scoring_stage():
    db = FakeDatabase()
    package = db.create_package("jd text", None)
    session = db.create_session(package.id, 1, _plan())
    db.set_scoring_stage(session.id, "download")
    # A non-terminal status write keeps the in-progress marker...
    db.set_session_status(session.id, "scoring")
    assert db.get_session(session.id).scoring_stage == "download"
    # ...while "failed", "scored", "insufficient", and save_report all clear it.
    db.set_session_status(session.id, "failed")
    assert db.get_session(session.id).scoring_stage is None
    db.set_scoring_stage(session.id, "compile")
    db.set_session_status(session.id, "scored")
    assert db.get_session(session.id).scoring_stage is None
    db.set_scoring_stage(session.id, "compile")
    db.set_session_status(session.id, "insufficient")
    assert db.get_session(session.id).scoring_stage is None
    db.set_scoring_stage(session.id, "compile")
    db.save_report(session.id, _report(session.id))
    assert db.get_session(session.id).scoring_stage is None


class StubTable:
    """Chainable PostgREST-style recorder replaying canned result rows."""

    def __init__(self, call: dict, results: list, log: list):
        self._call = call
        self._results = results
        self._log = log

    def insert(self, payload):
        self._call["insert"] = payload
        return self

    def update(self, payload):
        self._call["update"] = payload
        return self

    def select(self, columns):
        self._call["select"] = columns
        return self

    def eq(self, column, value):
        self._call.setdefault("eq", []).append((column, value))
        return self

    def order(self, column, desc=False):
        self._call["order"] = (column, desc)
        return self

    def limit(self, count):
        self._call["limit"] = count
        return self

    def execute(self):
        self._log.append(self._call)
        return SimpleNamespace(data=self._results.pop(0))


class StubSupabase:
    """Just enough of supabase-py's client for row-mapping tests (no network)."""

    def __init__(self, results: list):
        self.results = list(results)
        self.log: list[dict] = []

    def table(self, name: str) -> StubTable:
        return StubTable({"table": name}, self.results, self.log)


def _package_data(**overrides) -> dict:
    data = {
        "id": "11111111-1111-1111-1111-111111111111",
        "created_at": "2026-07-26T00:00:00+00:00",
        "access_token": "tok_abc",
        "status": "compiling",
        "jd_text": "jd text",
        "jd_url": None,
        "candidate_profile": None,
        "rubric": None,
    }
    data.update(overrides)
    return data


def test_create_supabase_client_reads_env_credentials(monkeypatch):
    calls = {}
    monkeypatch.setattr("scorer.api.db.load_env",
                        lambda: calls.setdefault("loaded", True))
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key-fake")
    monkeypatch.setattr("scorer.api.db.create_client",
                        lambda url, key: SimpleNamespace(url=url, key=key))
    client = create_supabase_client()
    assert calls == {"loaded": True}
    assert (client.url, client.key) == ("https://example.supabase.co",
                                        "service-role-key-fake")


def test_supabase_create_package_inserts_and_maps():
    stub = StubSupabase([[_package_data()]])
    row = SupabaseDatabase(stub).create_package(
        "jd text", "https://jobs.example.com/a")
    call = stub.log[0]
    assert call["table"] == "packages"
    payload = call["insert"]
    assert payload["status"] == "compiling"
    assert payload["jd_text"] == "jd text"
    assert payload["jd_url"] == "https://jobs.example.com/a"
    assert len(payload["access_token"]) >= 32
    assert row.id == "11111111-1111-1111-1111-111111111111"
    assert row.status == "compiling"


def test_supabase_create_package_inserts_user_id():
    stub = StubSupabase([[_package_data(user_id="user-1")]])
    row = SupabaseDatabase(stub).create_package("jd text", None, user_id="user-1")
    assert stub.log[0]["insert"]["user_id"] == "user-1"
    assert row.user_id == "user-1"


def test_supabase_create_package_defaults_user_id_to_null():
    stub = StubSupabase([[_package_data()]])
    SupabaseDatabase(stub).create_package("jd text", None)
    assert stub.log[0]["insert"]["user_id"] is None


def test_supabase_get_package_maps_jsonb_to_models():
    data = _package_data(
        status="ready",
        candidate_profile=_profile().model_dump(mode="json"),
        rubric=_rubric().model_dump(mode="json"),
    )
    stub = StubSupabase([[data]])
    row = SupabaseDatabase(stub).get_package(data["id"])
    assert isinstance(row.candidate_profile, CandidateProfile)
    assert isinstance(row.rubric, Rubric)
    assert row.rubric.dimensions[1].channel == "delivery"
    assert stub.log[0]["select"] == "*"
    assert stub.log[0]["eq"] == [("id", data["id"])]


def test_supabase_get_package_by_token_filters_on_token():
    stub = StubSupabase([[_package_data()]])
    SupabaseDatabase(stub).get_package_by_token("tok_abc")
    assert stub.log[0]["eq"] == [("access_token", "tok_abc")]


def test_supabase_rubric_reuse_filters_on_the_owning_account():
    data = _package_data(status="ready", user_id="user-1",
                         rubric=_rubric().model_dump(mode="json"))
    stub = StubSupabase([[data]])
    found = SupabaseDatabase(stub).find_ready_rubric_by_jd("jd text", "user-1")
    assert found is not None
    assert ("user_id", "user-1") in stub.log[0]["eq"]


def test_supabase_rubric_reuse_without_an_owner_never_queries():
    # user_id=None must not reach PostgREST: eq("user_id", None) filters on
    # NULL and would match every unowned row, which is the leak itself.
    stub = StubSupabase([])
    assert SupabaseDatabase(stub).find_ready_rubric_by_jd("jd text", None) is None
    assert stub.log == []


def test_supabase_missing_package_raises_keyerror():
    stub = StubSupabase([[]])
    with pytest.raises(KeyError):
        SupabaseDatabase(stub).get_package("missing-id")


def test_supabase_set_package_rubric_updates_jsonb_and_status():
    stub = StubSupabase([[_package_data()]])
    SupabaseDatabase(stub).set_package_rubric("pkg-1", _rubric(), "ready")
    call = stub.log[0]
    assert call["table"] == "packages"
    assert call["update"]["status"] == "ready"
    assert call["update"]["rubric"] == _rubric().model_dump(mode="json")
    assert call["eq"] == [("id", "pkg-1")]


def test_supabase_set_package_rubric_none_updates_status_only():
    # The failed-compile path: the update payload must not contain a
    # "rubric" key at all -- a failure handler never overwrites stored data.
    # The stub returns one matched row (non-empty data) so this exercises
    # the no-exception path; the zero-row -> KeyError path is covered
    # separately below.
    stub = StubSupabase([[_package_data(status="failed")]])
    SupabaseDatabase(stub).set_package_rubric("pkg-1", None, "failed")
    call = stub.log[0]
    assert call["table"] == "packages"
    assert call["update"] == {"status": "failed"}
    assert call["eq"] == [("id", "pkg-1")]


def test_supabase_set_session_status_omits_audio_path_when_none():
    stub = StubSupabase([[{"id": "sess-1"}]])
    SupabaseDatabase(stub).set_session_status("sess-1", "scoring")
    assert stub.log[0]["table"] == "sessions"
    assert stub.log[0]["update"] == {"status": "scoring"}
    assert stub.log[0]["eq"] == [("id", "sess-1")]


def test_supabase_set_scoring_stage_updates_column():
    stub = StubSupabase([[{"id": "sess-1"}]])
    SupabaseDatabase(stub).set_scoring_stage("sess-1", "transcribe")
    assert stub.log[0]["table"] == "sessions"
    assert stub.log[0]["update"] == {"scoring_stage": "transcribe"}
    assert stub.log[0]["eq"] == [("id", "sess-1")]


def test_supabase_terminal_status_clears_scoring_stage_in_same_update():
    # Clearing rides the SAME update as the terminal status write so a
    # finished row can never be observed with a stale in-progress stage
    # (house rule pinned by save_report's report+status single update).
    stub = StubSupabase([[{"id": "sess-1"}], [{"id": "sess-1"}], [{"id": "sess-1"}]])
    db = SupabaseDatabase(stub)
    db.set_session_status("sess-1", "failed")
    db.set_session_status("sess-1", "scored")
    db.set_session_status("sess-1", "insufficient")
    assert stub.log[0]["update"] == {"status": "failed", "scoring_stage": None}
    assert stub.log[1]["update"] == {"status": "scored", "scoring_stage": None}
    assert stub.log[2]["update"] == {"status": "insufficient", "scoring_stage": None}


@pytest.mark.parametrize("call", [
    lambda db: db.set_package_profile("missing-pkg", _profile()),
    lambda db: db.set_package_rubric("missing-pkg", _rubric(), "ready"),
    lambda db: db.set_package_rubric("missing-pkg", None, "failed"),
    lambda db: db.set_session_status("missing-sess", "scoring"),
    lambda db: db.set_scoring_stage("missing-sess", "download"),
    lambda db: db.save_report("missing-sess", _report("missing-sess")),
])
def test_supabase_mutators_raise_keyerror_when_update_matches_no_rows(call):
    # Registry-pinned: missing ids raise KeyError in EVERY Database
    # implementation, mutators included -- an update matching zero rows
    # must not be a silent no-op (must match FakeDatabase's semantics).
    stub = StubSupabase([[]])
    with pytest.raises(KeyError):
        call(SupabaseDatabase(stub))


def test_supabase_list_sessions_filters_and_orders_by_index():
    def _session_data(session_id: str, index: int) -> dict:
        return {
            "id": session_id,
            "package_id": "11111111-1111-1111-1111-111111111111",
            "index": index,
            "status": "planned",
            "session_plan": _plan().model_dump(mode="json"),
            "audio_path": None,
            "report": None,
        }

    stub = StubSupabase([
        [_session_data("sess-b", 2), _session_data("sess-a", 1)],
        [],
    ])
    db = SupabaseDatabase(stub)
    rows = db.list_sessions("11111111-1111-1111-1111-111111111111")
    assert [(r.id, r.index) for r in rows] == [("sess-a", 1), ("sess-b", 2)]
    assert stub.log[0]["table"] == "sessions"
    assert stub.log[0]["select"] == SESSION_COLUMNS
    assert stub.log[0]["eq"] == [
        ("package_id", "11111111-1111-1111-1111-111111111111")
    ]
    assert db.list_sessions("no-sessions-package") == []


def test_session_columns_cover_every_row_field_except_transcript():
    # Transcripts run 25-60KB per session; the hot session reads
    # (get_session, list_sessions) fetch an explicit column list that never
    # includes the transcript column. get_transcript is its only reader.
    assert set(SESSION_COLUMNS.split(",")) == {
        "id", "package_id", "index", "status", "scoring_stage",
        "session_plan", "audio_path", "report", "created_at",
    }


def test_supabase_session_reads_never_select_the_transcript_column():
    session_data = {
        "id": "22222222-2222-2222-2222-222222222222",
        "package_id": "11111111-1111-1111-1111-111111111111",
        "index": 1,
        "status": "planned",
        "session_plan": _plan().model_dump(mode="json"),
        "audio_path": None,
        "report": None,
        "created_at": "2026-07-26T00:00:00+00:00",
    }
    stub = StubSupabase([[session_data], [session_data]])
    db = SupabaseDatabase(stub)
    db.get_session(session_data["id"])
    db.list_sessions(session_data["package_id"])
    assert stub.log[0]["select"] == SESSION_COLUMNS
    assert stub.log[1]["select"] == SESSION_COLUMNS


def test_supabase_save_transcript_updates_jsonb():
    stub = StubSupabase([[{"id": "sess-1"}]])
    SupabaseDatabase(stub).save_transcript("sess-1", _segments())
    call = stub.log[0]
    assert call["table"] == "sessions"
    assert call["update"] == {
        "transcript": [seg.model_dump(mode="json") for seg in _segments()]
    }
    assert call["eq"] == [("id", "sess-1")]


def test_supabase_get_transcript_selects_only_the_transcript_column():
    stored = [seg.model_dump(mode="json") for seg in _segments()]
    stub = StubSupabase([[{"transcript": stored}]])
    segments = SupabaseDatabase(stub).get_transcript("sess-1")
    assert segments == _segments()
    assert stub.log[0]["table"] == "sessions"
    assert stub.log[0]["select"] == "transcript"
    assert stub.log[0]["eq"] == [("id", "sess-1")]


def test_supabase_get_transcript_none_when_column_is_null():
    stub = StubSupabase([[{"transcript": None}]])
    assert SupabaseDatabase(stub).get_transcript("sess-1") is None


def test_supabase_transcript_missing_session_raises_keyerror():
    stub = StubSupabase([[], []])
    db = SupabaseDatabase(stub)
    with pytest.raises(KeyError):
        db.get_transcript("missing-sess")
    with pytest.raises(KeyError):
        db.save_transcript("missing-sess", _segments())


def test_supabase_session_round_trip_and_report_marks_scored():
    session_data = {
        "id": "22222222-2222-2222-2222-222222222222",
        "package_id": "11111111-1111-1111-1111-111111111111",
        "index": 1,
        "status": "planned",
        "session_plan": _plan().model_dump(mode="json"),
        "audio_path": None,
        "report": None,
        "created_at": "2026-07-26T00:00:00+00:00",
    }
    stub = StubSupabase([[session_data], [session_data]])
    db = SupabaseDatabase(stub)
    row = db.create_session(session_data["package_id"], 1, _plan())
    insert = stub.log[0]["insert"]
    assert stub.log[0]["table"] == "sessions"
    assert insert["status"] == "planned"
    assert insert["index"] == 1
    assert insert["session_plan"] == _plan().model_dump(mode="json")
    assert row.session_plan.focus == "baseline"
    db.save_report(row.id, _report(row.id))
    save = stub.log[1]
    assert save["update"]["status"] == "scored"
    assert save["update"]["report"]["verdict"] == "ready"
    assert save["update"]["scoring_stage"] is None   # cleared in the same update
    assert save["eq"] == [("id", row.id)]
