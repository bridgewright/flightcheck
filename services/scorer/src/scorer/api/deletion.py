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
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

from scorer.api.db import Database
from scorer.api.storage import Storage


@dataclass(frozen=True)
class DeletionPlan:
    """Everything the deletion would remove, collected before touching it.

    Frozen and explicit: execution deletes exactly these ids, never a
    filter, so the blast radius is fixed at collection time and printable.
    """

    user_id: str
    package_ids: list[str] = field(default_factory=list)
    session_ids: list[str] = field(default_factory=list)
    order_ids: list[str] = field(default_factory=list)
    recording_paths: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.package_ids or self.session_ids or self.order_ids
                    or self.recording_paths)


@dataclass(frozen=True)
class DeletionOutcome:
    """What a completed deletion actually accounted for.

    Row counts are rows that existed and went away; a retry over an
    already-deleted account reports zeros, which is the truth.

    recordings_deleted counts objects CONFIRMED GONE rather than objects
    this particular call removed. The storage protocol cannot distinguish
    "I deleted it" from "it was already absent", and inventing that
    distinction would be a number we did not measure.
    """

    packages_deleted: int = 0
    sessions_deleted: int = 0
    orders_deleted: int = 0
    recordings_deleted: int = 0

    @property
    def total(self) -> int:
        return (self.packages_deleted + self.sessions_deleted
                + self.orders_deleted + self.recordings_deleted)


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
    for package in packages:
        for session in db.list_sessions(package.id):
            session_ids.append(session.id)
            if session.audio_path:
                recording_paths.append(session.audio_path)
    orders = db.list_orders_for_user(user_id)
    return DeletionPlan(
        user_id=user_id,
        package_ids=[package.id for package in packages],
        session_ids=session_ids,
        order_ids=[order.id for order in orders if order.id is not None],
        recording_paths=recording_paths,
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
        ("recording", plan.recording_paths),
    ):
        lines.append(f"  {len(items)} {label}(s)")
        lines.extend(f"    {item}" for item in items)
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
    if plan.recording_paths:
        failed = storage.remove_recordings(plan.recording_paths)
        if failed:
            raise RecordingsNotDeleted(failed)
        recordings_deleted = len(plan.recording_paths)

    # Child-first: orders and sessions reference the packages, so the
    # packages go last. Reports and transcripts are columns on sessions and
    # leave with them.
    orders_deleted = db.delete_rows("order", plan.order_ids)
    sessions_deleted = db.delete_rows("session", plan.session_ids)
    packages_deleted = db.delete_rows("package", plan.package_ids)

    return DeletionOutcome(
        packages_deleted=packages_deleted,
        sessions_deleted=sessions_deleted,
        orders_deleted=orders_deleted,
        recordings_deleted=recordings_deleted,
    )
