"""Account deletion: one implementation, two callers.

F-34 makes deletion self-serve. Until v0.6 it was an operator script
(tools/purge_user.py) reached by emailing support; now DELETE /api/account
does the same work on the customer's own click. Those two paths must never
disagree about what "delete my account" means, so the logic lives here and
both call it: the endpoint through api/routers/account.py, the operator
through the CLI, which keeps its dry-run default on top of the same plan.

Only rows attributed to the user_id are removed. A package that was never
claimed by an account (user_id null, token-only access) has no owner to
match and is deliberately left alone.


Ordering, and why it is the way it is
-------------------------------------
Blobs first, rows second, and a blob that will not delete aborts the run
BEFORE a single row is removed.

The session rows are the only index to the recordings bucket. Delete rows
first and a failed object removal leaves recordings nobody can ever locate
again -- a privacy promise broken silently, discoverable by no one, fixable
only by a bucket-wide audit. Delete blobs first and the same failure leaves
the account fully intact: nothing is half-removed, the user still has their
data and their account, the plan can be recomputed identically, and a retry
converges. The user sees an honest "that did not work, nothing was deleted"
instead of being stranded in a half-account.

Both halves are idempotent -- an object or row that is already gone counts
as done, not as an error -- which is what makes that retry safe. This is
also why the self-serve endpoint runs the deletion BEFORE the web layer
removes the auth user: as long as the sign-in record exists, the customer
can come back and try again.


Recordings the rows do not know about
-------------------------------------
sessions.audio_path is not a complete index of the bucket. The browser PUTs
the blob to its storage key first and only then calls /complete, which is
the write that puts the key on the row (apps/web/components/SessionRoom.tsx
uploads, apps/web/app/api/sessions/[id]/route.ts completes). Every way that
second call can fail -- the worker unreachable, the oversize refusal, the
tab closing in between -- leaves a real customer recording in the bucket
with no row pointing at it. Deleting only what the rows name would leave
those behind forever while /settings promises "every recording, deleted
from private storage".

So the plan also derives the key each session WOULD have used and sweeps
it. The key is a registry contract, not a guess: migration 001 states the
convention and apps/web/lib/realtime.ts recordingStoragePath() is the one
place that mints it. Sweeping a key that was never written costs nothing --
absent is the end state we asked for -- but it is deliberately NOT counted
in the outcome, because a swept key we cannot prove existed is not a
recording we can claim to have deleted.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from scorer.api.db import Database
from scorer.api.storage import Storage


def recording_key(package_id: str, session_index: int) -> str:
    """The recordings-bucket key one session's audio is uploaded to.

    A registry contract rather than a convention: migration 001 documents
    the shape, apps/web/lib/realtime.ts recordingStoragePath() is the only
    place that mints it, and Storage.download_recording reads it back. It is
    derivable from the session row alone, which is what lets deletion reach
    a recording whose /complete call never landed to record it.
    """
    return f"packages/{package_id}/session-{session_index}.webm"


@dataclass(frozen=True)
class DeletionPlan:
    """Everything the deletion would remove, collected before touching it.

    Frozen and explicit: execution deletes exactly these ids, never a
    filter, so the blast radius is fixed at collection time and printable.

    The two recording lists are kept apart on purpose. recording_paths are
    the keys the session rows actually name -- known to exist, and the only
    ones the outcome counts. orphan_recording_paths are keys derived from
    (package, index) that no row names: they are swept because an upload
    whose /complete call failed lives at exactly one of them, and they are
    never counted because "absent" and "removed" are indistinguishable here.
    """

    user_id: str
    package_ids: list[str] = field(default_factory=list)
    session_ids: list[str] = field(default_factory=list)
    order_ids: list[str] = field(default_factory=list)
    feedback_ids: list[str] = field(default_factory=list)
    study_ids: list[str] = field(default_factory=list)
    recording_paths: list[str] = field(default_factory=list)
    orphan_recording_paths: list[str] = field(default_factory=list)

    @property
    def storage_keys(self) -> list[str]:
        """Every key the sweep removes: named first, then derived."""
        return [*self.recording_paths, *self.orphan_recording_paths]

    @property
    def is_empty(self) -> bool:
        return not (self.package_ids or self.session_ids or self.order_ids
                    or self.feedback_ids or self.study_ids
                    or self.recording_paths or self.orphan_recording_paths)


@dataclass(frozen=True)
class DeletionOutcome:
    """What a completed deletion actually accounted for.

    Row counts are rows that existed and went away; a retry over an
    already-deleted account reports zeros, which is the truth.

    recordings_deleted counts objects CONFIRMED GONE rather than objects
    this particular call removed. The storage protocol cannot distinguish
    "I deleted it" from "it was already absent", and inventing that
    distinction would be a number we did not measure. For the same reason
    it counts only the keys the session rows named: the derived keys swept
    alongside them may never have held anything, so counting them would
    inflate the number the customer is shown.
    """

    packages_deleted: int = 0
    sessions_deleted: int = 0
    orders_deleted: int = 0
    feedback_deleted: int = 0
    recordings_deleted: int = 0

    @property
    def total(self) -> int:
        return (self.packages_deleted + self.sessions_deleted
                + self.orders_deleted + self.feedback_deleted
                + self.recordings_deleted)


class RecordingsNotDeleted(Exception):
    """Storage would not release some recordings, so NO rows were touched.

    Carries the failed keys for the operator path. The HTTP layer must not
    put them in a response body -- they embed package ids -- but it must
    tell the caller plainly that nothing was deleted and the account is
    unchanged.
    """

    def __init__(self, paths: Iterable[str]):
        self.paths = list(paths)
        super().__init__(
            f"{len(self.paths)} recording object(s) could not be deleted; "
            "no rows were removed")


def collect_deletion_plan(db: Database, user_id: str) -> DeletionPlan:
    """Walk the user's packages -> sessions -> recordings, plus their orders.

    Read-only, so it is safe to call at any time: it is what --dry-run
    prints and what the endpoint computes before deciding anything.
    """
    packages = db.list_packages_by_user(user_id)
    session_ids: list[str] = []
    recording_paths: list[str] = []
    derived_keys: list[str] = []
    for package in packages:
        for session in db.list_sessions(package.id):
            session_ids.append(session.id)
            if session.audio_path:
                recording_paths.append(session.audio_path)
            # Derived for EVERY session, including the ones that already
            # name a key: a row whose audio_path somehow differs from the
            # contract key still had its blob uploaded to the contract key.
            derived_keys.append(recording_key(package.id, session.index))
    named = set(recording_paths)
    # dict.fromkeys de-duplicates while keeping order, so the plan a dry run
    # printed is byte-identical to the one execution acts on.
    orphan_paths = [key for key in dict.fromkeys(derived_keys)
                    if key not in named]
    orders = db.list_orders_for_user(user_id)
    feedback = db.list_feedback_for_user(user_id)
    return DeletionPlan(
        user_id=user_id,
        package_ids=[package.id for package in packages],
        session_ids=session_ids,
        order_ids=[order.id for order in orders if order.id is not None],
        feedback_ids=[row.id for row in feedback if row.id is not None],
        # Idempotent sweep: absent rows are already the desired end state.
        study_ids=[package.id for package in packages],
        recording_paths=recording_paths,
        orphan_recording_paths=orphan_paths,
    )


def collect_package_deletion_plan(db: Database, user_id: str,
                                  package_id: str) -> DeletionPlan:
    """One package the user owns, and everything under it.

    The same walk `collect_deletion_plan` does, narrowed to one package, so
    the two paths cannot drift about what a package contains. Two deliberate
    differences from account deletion:

    * **Orders are not touched.** An order is the record that money moved. A
      customer removing one package must not delete a receipt they may need
      for a refund, an expense claim, or a dispute, and the operator must not
      lose the books because a test package was tidied away. The order row
      keeps pointing at a package id that no longer resolves, which is what a
      receipt for a deleted thing looks like.
    * **A package that is not theirs raises PermissionError** rather than
      returning an empty plan, so a caller cannot report "deleted" about
      something it never had the right to read.
    """
    package = db.get_package(package_id)
    if package.user_id is None or package.user_id != user_id:
        raise PermissionError(package_id)

    session_ids: list[str] = []
    recording_paths: list[str] = []
    derived_keys: list[str] = []
    for session in db.list_sessions(package.id):
        session_ids.append(session.id)
        if session.audio_path:
            recording_paths.append(session.audio_path)
        derived_keys.append(recording_key(package.id, session.index))
    named = set(recording_paths)
    orphan_paths = [key for key in dict.fromkeys(derived_keys)
                    if key not in named]
    return DeletionPlan(
        user_id=user_id,
        package_ids=[package.id],
        session_ids=session_ids,
        order_ids=[],
        study_ids=[package.id],
        recording_paths=recording_paths,
        orphan_recording_paths=orphan_paths,
    )


def describe_plan(plan: DeletionPlan) -> str:
    """The dry-run report: every id and path the deletion would remove."""
    if plan.is_empty:
        return f"Nothing to delete for user {plan.user_id}."
    lines = [f"Would delete for user {plan.user_id}:"]
    for label, items in (
        ("package", plan.package_ids),
        ("session", plan.session_ids),
        ("order", plan.order_ids),
        ("feedback", plan.feedback_ids),
        ("recording", plan.recording_paths),
    ):
        lines.append(f"  {len(items)} {label}(s)")
        lines.extend(f"    {item}" for item in items)
    # Labelled as a sweep, not as findings: these keys are derived from the
    # session rows, so the operator must not read the count as "this many
    # orphaned recordings exist".
    lines.append(f"  {len(plan.orphan_recording_paths)} derived recording "
                 "key(s) also swept (may hold nothing)")
    lines.extend(f"    {item}" for item in plan.orphan_recording_paths)
    return "\n".join(lines)


def execute_deletion(db: Database, storage: Storage,
                     plan: DeletionPlan) -> DeletionOutcome:
    """Delete the plan. Raises RecordingsNotDeleted before touching any row.

    See the module docstring for why the order is blobs-then-rows and why a
    storage failure aborts rather than continues.
    """
    if plan.is_empty:
        return DeletionOutcome()

    recordings_deleted = 0
    keys = plan.storage_keys
    if keys:
        # One call for named and derived keys together: they are the same
        # abort decision, and splitting them would open a window where the
        # named half is gone and the rows that index it are still there.
        failed = storage.remove_recordings(keys)
        if failed:
            raise RecordingsNotDeleted(failed)
        recordings_deleted = len(plan.recording_paths)

    # Child-first: orders and sessions reference the packages, so the
    # packages go last. Reports and transcripts are columns on sessions and
    # leave with them.
    orders_deleted = db.delete_rows("order", plan.order_ids)
    sessions_deleted = db.delete_rows("session", plan.session_ids)
    feedback_deleted = db.delete_rows("feedback", plan.feedback_ids)
    db.delete_rows("study", plan.study_ids)
    packages_deleted = db.delete_rows("package", plan.package_ids)

    return DeletionOutcome(
        packages_deleted=packages_deleted,
        sessions_deleted=sessions_deleted,
        orders_deleted=orders_deleted,
        feedback_deleted=feedback_deleted,
        recordings_deleted=recordings_deleted,
    )
