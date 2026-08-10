"""Shared fake clients for tests (house pattern: canned responses + a calls list).

Mirrors scorer/realtime_probe/fake.py: constructors take scripted responses,
every interaction is recorded for assertions, nothing touches the network.
Defined once here and reused by every task's tests (imported as
`from fakes import FakeGenAI` -- pytest puts tests/ on sys.path).
"""
from __future__ import annotations

import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from google.genai import types

from scorer.api.db import (
    PAID_TOTAL_SESSIONS,
    CbtCodeRow,
    CbtRedemptionRow,
    FeedbackRow,
    OrderRow,
    PackageRow,
    SessionRow,
    StudyRow,
    expires_at_from,
)
from scorer.schemas import (
    CandidateProfile,
    ParaphraseMark,
    ParaphraseMarks,
    Rubric,
    SessionInsights,
    SessionParaphrases,
    SessionPlan,
    SessionReport,
    StudyMaterials,
    TranscriptSegment,
)


class _FakeCandidate:
    def __init__(self, grounding_metadata: Any = None):
        self.grounding_metadata = grounding_metadata


class _FakeResponse:
    """Response stand-in: .text plus .candidates[0].grounding_metadata."""

    def __init__(self, text: str, grounding_metadata: Any = None):
        self.text = text
        self.candidates = [_FakeCandidate(grounding_metadata)]


class _FakeFileHandle:
    """Non-str stand-in for the types.File handle files.upload returns."""

    def __init__(self, index: int):
        self.name = f"files/fake-{index}"
        self.uri = f"https://fake.local/files/fake-{index}"


def _metadata_from(entries: list[dict[str, str]]) -> types.GroundingMetadata:
    """{url,title,snippet} dicts -> real google-genai grounding metadata shapes."""
    chunks = [
        types.GroundingChunk(
            web=types.GroundingChunkWeb(uri=entry["url"], title=entry["title"]))
        for entry in entries
    ]
    supports = [
        types.GroundingSupport(segment=types.Segment(text=entry["snippet"]),
                               grounding_chunk_indices=[i])
        for i, entry in enumerate(entries)
    ]
    return types.GroundingMetadata(grounding_chunks=chunks,
                                   grounding_supports=supports)


class _FakeModels:
    def __init__(self, owner: FakeGenAI):
        self._owner = owner

    def generate_content(self, *, model: str, contents: Any,
                         config: Any = None) -> _FakeResponse:
        owner = self._owner
        # One lock covers recording and dispatch: the content judge calls this
        # from a thread pool, and popping a script concurrently must never
        # lose, duplicate, or misrecord a reply.
        with owner.lock:
            # config is recorded exactly as passed -- never normalized (pinned).
            owner.calls.append({"model": model, "contents": contents, "config": config})
            keyed = owner.keyed_queue_for(contents)
            if keyed is not None:
                # Keyed replies never carry grounding metadata (no keyed
                # consumer reads it); IndexError when the key's script is
                # exhausted, mirroring the ordered queue's pinned behavior.
                reply = keyed.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return _FakeResponse(reply)
            # IndexError when the canned script is exhausted -- pinned behavior
            # that downstream failure-path tests (Task 12) rely on.
            item = owner.canned_texts.pop(0)
            if isinstance(item, Exception):
                raise item
            raw = owner.canned_grounding.pop(0) if owner.canned_grounding else None
            metadata = _metadata_from(raw) if isinstance(raw, list) else raw
            return _FakeResponse(item, metadata)


class _FakeFiles:
    def __init__(self):
        self.uploads: list[Any] = []

    def upload(self, *, file: Any) -> _FakeFileHandle:
        self.uploads.append(file)
        return _FakeFileHandle(len(self.uploads) - 1)


class FakeGenAI:
    """Canned google-genai client satisfying scorer.schemas.GenAIClientLike.

    Thread-safe: the content judge issues generate_content from a thread
    pool, so dispatch and call recording happen under one lock. Two dispatch
    modes, combinable:

    - canned_texts pop in order, one per models.generate_content call;
      IndexError once they are exhausted (failure-path tests rely on this).
    - keyed_texts maps a marker string (judge tests use the rubric dimension
      key) to that marker's own ordered reply script. A call whose prompt
      contains exactly one marker pops from that script (IndexError when it
      is exhausted, same pinned failure behavior); several markers in one
      prompt is ambiguous and raises ValueError; no marker falls back to
      canned_texts. Keying by what the prompt asks makes parallel judge
      tests order-independent: concurrent calls interleave freely without
      changing which reply each dimension receives. Keyed replies never
      carry grounding metadata.

    Scripted entries may be Exception instances, which are raised after the
    call is recorded instead of returned.

    canned_grounding is optional and parallel to canned_texts (keyed replies
    never consume it); each entry is None, a list of {url,title,snippet}
    dicts (converted to real types.GroundingMetadata), or a prebuilt
    metadata object passed through as-is. Every generate_content call
    appends {"model", "contents", "config"} to .calls with config stored
    exactly as passed (never normalized); every files.upload appends its
    file argument to .files.uploads and returns a non-str handle.
    """

    def __init__(self, canned_texts: list[str | Exception] | None = None,
                 canned_grounding: list[Any] | None = None,
                 keyed_texts: dict[str, list[str | Exception]] | None = None):
        self.canned_texts = list(canned_texts or [])
        self.canned_grounding = list(canned_grounding) if canned_grounding else []
        self.keyed_texts = {key: list(texts) for key, texts in (keyed_texts or {}).items()}
        self.calls: list[dict[str, Any]] = []
        self.lock = threading.Lock()
        self.models = _FakeModels(self)
        self.files = _FakeFiles()

    def keyed_queue_for(self, contents: Any) -> list[str | Exception] | None:
        """The keyed script matching the prompt's marker, or None for the ordered queue."""
        if not self.keyed_texts:
            return None
        parts = contents if isinstance(contents, list) else [contents]
        prompt = " ".join(part for part in parts if isinstance(part, str))
        matches = [key for key in self.keyed_texts if key in prompt]
        if len(matches) > 1:
            raise ValueError(
                f"prompt matches multiple keyed_texts markers: {sorted(matches)}"
            )
        return self.keyed_texts[matches[0]] if matches else None


class FakeDatabase:
    """In-memory Database implementation mirroring SupabaseDatabase semantics.

    Ids are deterministic -- pkg-N with matching tok-N, and sess-N -- so
    downstream tests (Task 12) can predict them (pinned surface). Rows are
    stored as the pydantic row models themselves; missing ids raise KeyError
    exactly like the Supabase adapter. PackageRow drops jd_url (per the
    interface registry), so it is kept in .jd_urls for assertions.
    """

    def __init__(self):
        self.packages: dict[str, PackageRow] = {}
        self.sessions: dict[str, SessionRow] = {}
        self.orders: dict[str, OrderRow] = {}
        self.cbt_codes: dict[str, CbtCodeRow] = {}
        self.cbt_redemptions: dict[str, CbtRedemptionRow] = {}
        self.jd_urls: dict[str, str | None] = {}
        # Transcript lives OFF the session row (mirrors the real adapter's
        # explicit column lists): session_id -> stored segments.
        self.transcripts: dict[str, list[TranscriptSegment]] = {}
        self.feedback: list[FeedbackRow] = []
        self.paraphrases: dict[str, SessionParaphrases] = {}
        self.insights: dict[str, SessionInsights] = {}
        self.marks: dict[str, ParaphraseMarks] = {}
        self.study: dict[str, StudyRow] = {}
        # Every successful set_scoring_stage call, in order, as
        # (session_id, stage) -- progression assertions read this.
        self.stage_writes: list[tuple[str, str]] = []
        # Every delete_rows call, in order, as (kind, ids) -- the v0.6
        # account-deletion tests assert on ORDER (child rows before their
        # package), which no amount of end-state checking can prove.
        self.deletes: list[tuple[str, list[str]]] = []
        # When set, used as "now" for updated_at touches and stale-row
        # cutoffs so v0.5 tests can run against a frozen clock; None means
        # real UTC now (mirrors production).
        self.now_iso: str | None = None
        self._package_seq = 0
        self._session_seq = 0
        self._order_seq = 0
        self._feedback_seq = 0
        self._cbt_redemption_seq = 0

    def _now(self) -> datetime:
        if self.now_iso is not None:
            return datetime.fromisoformat(self.now_iso)
        return datetime.now(UTC)

    def create_package(self, jd_text: str, jd_url: str | None,
                       user_id: str | None = None,
                       is_trial: bool = False) -> PackageRow:
        self._package_seq += 1
        row = PackageRow(
            id=f"pkg-{self._package_seq}",
            access_token=f"tok-{self._package_seq}",
            status="compiling",
            jd_text=jd_text,
            candidate_profile=None,
            rubric=None,
            user_id=user_id,
            total_sessions=6,
            is_trial=is_trial,
        )
        self.packages[row.id] = row
        self.jd_urls[row.id] = jd_url
        return row

    def create_quick_package(self, user_id: str, company: str,
                             role: str) -> PackageRow:
        self._package_seq += 1
        row = PackageRow(
            id=f"pkg-{self._package_seq}",
            access_token=f"tok-{self._package_seq}",
            status="ready",
            jd_text="",
            candidate_profile=None,
            rubric=None,
            user_id=user_id,
            kind="quick",
            quick_company=company,
            quick_role=role,
            total_sessions=1,
            is_trial=False,
        )
        self.packages[row.id] = row
        self.jd_urls[row.id] = None
        return row

    def get_package(self, package_id: str) -> PackageRow:
        return self.packages[package_id]

    def get_package_by_token(self, access_token: str) -> PackageRow:
        for row in self.packages.values():
            if row.access_token == access_token:
                return row
        raise KeyError(access_token)

    def list_packages_by_user(self, user_id: str) -> list[PackageRow]:
        return [
            row for row in reversed(list(self.packages.values()))
            if row.user_id == user_id
        ]

    def set_package_profile(self, package_id: str, profile: CandidateProfile) -> None:
        row = self.packages[package_id]
        self.packages[package_id] = row.model_copy(
            update={"candidate_profile": profile})

    def set_package_rubric(self, package_id: str, rubric: Rubric | None,
                           status: str) -> None:
        # rubric=None = failed compile: status update only, no rubric write.
        row = self.packages[package_id]
        update: dict[str, object] = {"status": status}
        if rubric is not None:
            update["rubric"] = rubric
        self.packages[package_id] = row.model_copy(update=update)

    def find_ready_rubric_by_jd(self, jd_text, user_id):
        # Mirrors SupabaseDatabase: reuse needs a concrete owner match, so an
        # unowned request matches nothing (not even other unowned rows).
        if user_id is None:
            return None
        for row in reversed(list(self.packages.values())):
            if (row.jd_text == jd_text and row.user_id == user_id
                    and row.status == "ready" and row.rubric is not None):
                return (row.candidate_profile, row.rubric)
        return None

    def create_session(self, package_id: str, index: int,
                       plan: SessionPlan) -> SessionRow:
        if package_id not in self.packages:
            raise KeyError(package_id)  # mirrors the FK constraint
        self._session_seq += 1
        row = SessionRow(
            id=f"sess-{self._session_seq}",
            package_id=package_id,
            index=index,
            status="planned",
            session_plan=plan,
            audio_path=None,
            report=None,
            created_at=f"2026-08-02T00:00:{self._session_seq:02d}+00:00",
        )
        self.sessions[row.id] = row
        return row

    def get_session(self, session_id: str) -> SessionRow:
        return self.sessions[session_id]

    def list_sessions(self, package_id: str) -> list[SessionRow]:
        # A filter, not a lookup: an unknown package_id yields [] (mirrors
        # PostgREST select-by-eq), never KeyError.
        return sorted(
            (row for row in self.sessions.values() if row.package_id == package_id),
            key=lambda row: row.index,
        )

    def set_session_status(self, session_id: str, status: str,
                           audio_path: str | None = None) -> None:
        row = self.sessions[session_id]
        update: dict[str, object] = {"status": status}
        if status in ("scored", "failed", "insufficient"):
            # Mirrors SupabaseDatabase: terminal status writes clear the
            # in-progress stage marker in the same write.
            update["scoring_stage"] = None
        if audio_path is not None:
            update["audio_path"] = audio_path
        self.sessions[session_id] = row.model_copy(update=update)

    def set_scoring_stage(self, session_id: str, stage: str) -> None:
        row = self.sessions[session_id]  # KeyError when absent (pinned)
        self.stage_writes.append((session_id, stage))
        self.sessions[session_id] = row.model_copy(update={"scoring_stage": stage})

    def save_report(self, session_id: str, report: SessionReport) -> None:
        row = self.sessions[session_id]
        self.sessions[session_id] = row.model_copy(
            update={"report": report, "status": "scored", "scoring_stage": None})

    def save_transcript(self, session_id: str,
                        segments: list[TranscriptSegment]) -> None:
        if session_id not in self.sessions:
            raise KeyError(session_id)   # mirrors the zero-row update
        self.transcripts[session_id] = list(segments)

    def get_transcript(self, session_id: str) -> list[TranscriptSegment] | None:
        if session_id not in self.sessions:
            raise KeyError(session_id)   # unknown session, not "no transcript"
        return self.transcripts.get(session_id)

    def insert_feedback(self, row: FeedbackRow) -> FeedbackRow:
        self._feedback_seq += 1
        stored = row.model_copy(update={"id": f"feedback-{self._feedback_seq}",
                                        "created_at": self._now().isoformat()})
        self.feedback.append(stored)
        return stored

    def list_feedback(self, status: str | None, limit: int) -> list[FeedbackRow]:
        rows = reversed(self.feedback)
        return [row for row in rows if status is None or row.status == status][:limit]

    def list_feedback_for_user(self, user_id: str) -> list[FeedbackRow]:
        return [row for row in reversed(self.feedback) if row.user_id == user_id]

    def set_feedback_status(self, feedback_id: str, status: str) -> None:
        for index, row in enumerate(self.feedback):
            if row.id == feedback_id:
                self.feedback[index] = row.model_copy(update={
                    "status": status, "updated_at": self._now().isoformat()})
                return
        raise KeyError(feedback_id)

    def _require_session(self, session_id: str) -> None:
        if session_id not in self.sessions:
            raise KeyError(session_id)

    def save_session_paraphrases(self, session_id: str, doc: SessionParaphrases) -> None:
        self._require_session(session_id)
        self.paraphrases[session_id] = doc

    def get_session_paraphrases(self, session_id: str) -> SessionParaphrases | None:
        self._require_session(session_id)
        return self.paraphrases.get(session_id)

    def save_session_insights(self, session_id: str, doc: SessionInsights) -> None:
        self._require_session(session_id)
        self.insights[session_id] = doc

    def get_session_insights(self, session_id: str) -> SessionInsights | None:
        self._require_session(session_id)
        return self.insights.get(session_id)

    def get_paraphrase_marks(self, session_id: str) -> ParaphraseMarks:
        self._require_session(session_id)
        return self.marks.get(session_id, ParaphraseMarks())

    def set_paraphrase_mark(self, session_id: str, turn_index: int,
                            mark: ParaphraseMark) -> ParaphraseMarks:
        doc = self.get_paraphrase_marks(session_id)
        updated = doc.model_copy(update={"marks": {**doc.marks, str(turn_index): mark}})
        self.marks[session_id] = updated
        return updated

    def get_study(self, package_id: str) -> StudyRow | None:
        return self.study.get(package_id)

    def begin_study_generation(self, package_id: str) -> None:
        old = self.study.get(package_id)
        update = {"id": package_id, "status": "generating",
                  "updated_at": self._now().isoformat()}
        self.study[package_id] = (
            StudyRow(**update) if old is None else old.model_copy(update=update)
        )

    def save_study_materials(self, package_id: str, doc: StudyMaterials,
                             generated_at: str) -> None:
        old = self.study.get(package_id, StudyRow(id=package_id, status="ready"))
        self.study[package_id] = old.model_copy(update={"status": "ready", "doc": doc,
            "generated_at": generated_at, "updated_at": self._now().isoformat()})

    def fail_study_generation(self, package_id: str) -> None:
        old = self.study.get(package_id, StudyRow(id=package_id, status="failed"))
        self.study[package_id] = old.model_copy(update={"status": "failed",
                                                        "updated_at": self._now().isoformat()})

    # ------------------------------------------------ v0.5 payments surface

    def insert_order(self, order: OrderRow) -> OrderRow:
        # Mirrors orders.polar_order_id UNIQUE: the real adapter raises
        # postgrest's error on a duplicate, the fake ValueError.
        for existing in self.orders.values():
            if existing.polar_order_id == order.polar_order_id:
                raise ValueError(
                    f"duplicate polar_order_id: {order.polar_order_id!r}")
        self._order_seq += 1
        stored = order.model_copy(update={
            "id": f"order-{self._order_seq}",
            "created_at": f"2026-08-03T00:00:{self._order_seq:02d}+00:00",
        })
        self.orders[stored.id] = stored
        return stored

    def find_order_by_polar_id(self, polar_order_id: str) -> OrderRow | None:
        for row in self.orders.values():
            if row.polar_order_id == polar_order_id:
                return row
        return None

    def list_orders_for_user(self, user_id: str) -> list[OrderRow]:
        return [
            row for row in reversed(list(self.orders.values()))
            if row.user_id == user_id
        ]

    def set_package_paid(self, package_id: str, order_id: str,
                         paid_at: str) -> None:
        row = self.packages[package_id]
        if row.paid_at is not None:
            return  # first write wins (mirrors SupabaseDatabase)
        self.packages[package_id] = row.model_copy(update={
            "paid_at": paid_at,
            "expires_at": expires_at_from(paid_at),
            "order_id": order_id,
            "total_sessions": PAID_TOTAL_SESSIONS,
            "updated_at": self._now().isoformat(),
        })

    def set_package_comped(self, package_id: str, comped_at: str) -> None:
        row = self.packages[package_id]
        if row.comped_at is not None:
            return  # first write wins (mirrors SupabaseDatabase)
        self.packages[package_id] = row.model_copy(update={
            "comped_at": comped_at,
            "total_sessions": PAID_TOTAL_SESSIONS,
            "updated_at": self._now().isoformat(),
        })

    def find_cbt_code_by_hash(self, code_hash: str) -> CbtCodeRow | None:
        return next((row for row in self.cbt_codes.values()
                     if row.code_hash == code_hash), None)

    def get_cbt_code(self, code_id: str) -> CbtCodeRow:
        return self.cbt_codes[code_id]

    def count_cbt_redemptions(self, code_id: str) -> int:
        return sum(row.code_id == code_id for row in self.cbt_redemptions.values())

    def get_cbt_redemption_by_user(self, user_id: str) -> CbtRedemptionRow | None:
        return next((row for row in self.cbt_redemptions.values()
                     if row.user_id == user_id), None)

    def insert_cbt_redemption(self, code_id: str, user_id: str) -> CbtRedemptionRow:
        if self.get_cbt_redemption_by_user(user_id) is not None:
            raise ValueError(user_id)
        self._cbt_redemption_seq += 1
        row = CbtRedemptionRow(id=f"cbt-red-{self._cbt_redemption_seq}",
                               code_id=code_id, user_id=user_id,
                               redeemed_at=self._now().isoformat())
        self.cbt_redemptions[row.id] = row
        return row

    def increment_cbt_packages_granted(self, redemption_id: str) -> None:
        row = self.cbt_redemptions[redemption_id]
        self.cbt_redemptions[redemption_id] = row.model_copy(
            update={"packages_granted": row.packages_granted + 1})

    def set_package_cbt(self, package_id: str, comped_at: str,
                        expires_at: str, cbt_code_id: str) -> None:
        row = self.packages[package_id]
        self.packages[package_id] = row.model_copy(update={
            "comped_at": comped_at, "expires_at": expires_at,
            "cbt_code_id": cbt_code_id, "total_sessions": PAID_TOTAL_SESSIONS,
            "updated_at": self._now().isoformat(),
        })

    def touch_updated_at(self, kind: Literal["package", "session"],
                         id: str) -> None:
        if kind not in ("package", "session"):
            raise ValueError(f"unknown touch kind: {kind!r}")
        stamp = self._now().isoformat()
        if kind == "package":
            self.packages[id] = self.packages[id].model_copy(
                update={"updated_at": stamp})
        else:
            self.sessions[id] = self.sessions[id].model_copy(
                update={"updated_at": stamp})

    def increment_secret_mints(self, session_id: str) -> int:
        row = self.sessions[session_id]
        count = row.secret_mints + 1
        self.sessions[session_id] = row.model_copy(
            update={"secret_mints": count})
        return count

    def touch_session_heartbeat(self, session_id: str) -> None:
        row = self.sessions[session_id]
        if row.status != "planned":
            raise KeyError(session_id)
        self.sessions[session_id] = row.model_copy(update={
            "last_heartbeat_at": self._now().isoformat(),
        })

    def reclaim_session(self, session_id: str, older_than_s: float) -> bool:
        row = self.sessions[session_id]
        cutoff = self._now() - timedelta(seconds=older_than_s)
        if (row.status != "planned" or row.last_heartbeat_at is None
                or datetime.fromisoformat(row.last_heartbeat_at) >= cutoff):
            return False
        self.sessions[session_id] = row.model_copy(update={"status": "abandoned"})
        return True

    def rearm_session(self, session_id: str) -> None:
        # Mirrors SupabaseDatabase: attempt-scoped clocks reset in the same
        # write, updated_at deliberately untouched.
        row = self.sessions[session_id]
        self.sessions[session_id] = row.model_copy(update={
            "status": "planned",
            "secret_mints": 0,
            "last_heartbeat_at": None,
        })

    def list_stale_packages(self, status: str,
                            older_than_s: float) -> list[PackageRow]:
        cutoff = self._now() - timedelta(seconds=older_than_s)
        return [
            row for row in self.packages.values()
            if row.status == status and row.updated_at is not None
            and datetime.fromisoformat(row.updated_at) < cutoff
        ]

    def list_stale_sessions(self, status: str,
                            older_than_s: float) -> list[SessionRow]:
        cutoff = self._now() - timedelta(seconds=older_than_s)
        return [
            row for row in self.sessions.values()
            if row.status == status and row.updated_at is not None
            and datetime.fromisoformat(row.updated_at) < cutoff
        ]

    def reset_package_for_compile(self, package_id: str) -> None:
        row = self.packages[package_id]
        self.packages[package_id] = row.model_copy(update={
            "status": "compiling",
            "updated_at": self._now().isoformat(),
        })

    # ------------------------------------------------ v0.6 account deletion

    def delete_rows(self, kind: str, ids: list[str]) -> int:
        # Mirrors SupabaseDatabase: unknown kind raises before anything is
        # touched, an empty list is a no-op that is not even recorded, and
        # ids that are already gone count as 0 rather than KeyError.
        stores = {"package": self.packages, "session": self.sessions,
                  "order": self.orders, "study": self.study,
                  "cbt_redemption": self.cbt_redemptions}
        if kind == "feedback":
            if not ids:
                return 0
            self.deletes.append((kind, list(ids)))
            known = {row.id for row in self.feedback}
            self.feedback = [row for row in self.feedback if row.id not in ids]
            return len(known.intersection(ids))
        if kind not in stores:
            raise ValueError(f"unknown delete kind: {kind!r}")
        if not ids:
            return 0
        self.deletes.append((kind, list(ids)))
        store = stores[kind]
        deleted = 0
        for row_id in ids:
            if store.pop(row_id, None) is not None:
                deleted += 1
                if kind == "session":
                    # Transcripts live on the session row in Postgres, so
                    # they cannot outlive it here either.
                    self.transcripts.pop(row_id, None)
                    self.paraphrases.pop(row_id, None)
                    self.insights.pop(row_id, None)
                    self.marks.pop(row_id, None)
        return deleted
    # -------------------------------------------------- v0.6 usage metrics

    def list_recent_packages(self, limit: int) -> list[PackageRow]:
        # Insertion order stands in for created_at (ids are sequential),
        # mirroring the adapter's newest-first contract.
        return list(reversed(list(self.packages.values())))[:limit]

    def list_recent_sessions(self, limit: int) -> list[SessionRow]:
        return list(reversed(list(self.sessions.values())))[:limit]


class FakeStorage:
    """In-memory Storage: canned recording bytes and corpus texts (pinned).

    recordings maps storage_path -> raw audio bytes written out on download;
    corpus maps a bucket-relative path -> file text written out on
    sync_corpus (nested paths like "fewshot/example.json" land in
    subdirectories, mirroring SupabaseStorage's fewshot/ pass).

    remove_failures is the deletion tests' failure injector: any requested
    path in that set survives and comes back in the failed list. The real
    adapter fails a whole batch at once, so this fake is deliberately MORE
    granular than production -- it can produce the partial state the
    protocol permits, which is the state api/deletion.py must survive.
    """

    def __init__(self, recordings: dict[str, bytes] | None = None,
                 corpus: dict[str, str] | None = None):
        self.recordings: dict[str, bytes] = dict(recordings or {})
        self.corpus: dict[str, str] = dict(corpus or {})
        self.remove_failures: set[str] = set()
        self.remove_calls: list[list[str]] = []   # every batch, as requested
        self.removed: list[str] = []              # every key actually gone

    def download_recording(self, storage_path: str, dest_dir: Path) -> Path:
        data = self.recordings[storage_path]  # KeyError when absent (pinned)
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / Path(storage_path).name
        dest.write_bytes(data)
        return dest

    def sync_corpus(self, dest_dir: Path) -> Path:
        dest_dir = Path(dest_dir)
        dest_dir.mkdir(parents=True, exist_ok=True)
        for name, text in self.corpus.items():
            target = dest_dir / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        return dest_dir

    def remove_recordings(self, paths: list[str]) -> list[str]:
        paths = list(paths)
        self.remove_calls.append(paths)
        failed = []
        for path in paths:
            if path in self.remove_failures:
                failed.append(path)
                continue
            # Absent is the end state, not an error (pinned contract): a
            # retry of a half-finished deletion must report the missing key
            # as done rather than as a failure.
            if self.recordings.pop(path, None) is not None:
                self.removed.append(path)
        return failed
