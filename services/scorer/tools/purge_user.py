"""Purge one account's data -- the operator side of the v0.5 deletion policy.

Manual operator tool, never part of the app or the gates. Deletion v0.5 is
a mailto intake on the web settings page plus this script: the customer
emails support, the operator runs this against the identifier in the
request. It removes every product row and blob tied to one user -- orders,
sessions (reports and transcripts are columns on the session row), the
packages themselves, and the recordings-bucket objects the sessions point
at. The auth.users row is deleted afterwards in the Supabase dashboard
(admin-scoped, one click); this tool owns the product data.

Only rows attributed to the user_id are purged: a package that was never
claimed by an account (user_id null, token-only access) has no owner to
match and is deliberately left alone.

Safety: dry run is the DEFAULT and prints the full plan; --execute is the
explicit destructive switch; the tool refuses to run without exactly one
of --user-id / --email.

Usage (from services/scorer, env from .env):
    uv run python tools/purge_user.py --email person@example.com   # dry run
    uv run python tools/purge_user.py --user-id UUID --execute
"""
from __future__ import annotations

import argparse
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from scorer.api.db import Database
from scorer.api.storage import RECORDINGS_BUCKET


@dataclass(frozen=True)
class PurgePlan:
    """Everything the purge would delete, collected before touching anything."""

    user_id: str
    package_ids: list[str] = field(default_factory=list)
    session_ids: list[str] = field(default_factory=list)
    order_ids: list[str] = field(default_factory=list)
    recording_paths: list[str] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.package_ids or self.session_ids or self.order_ids
                    or self.recording_paths)


def collect_purge_plan(db: Database, user_id: str) -> PurgePlan:
    """Walk the user's packages -> sessions -> recordings, plus their orders.

    Read-only over the Database protocol so it runs identically against the
    fakes; execution is a separate, explicitly destructive step.
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
    return PurgePlan(
        user_id=user_id,
        package_ids=[package.id for package in packages],
        session_ids=session_ids,
        order_ids=[order.id for order in orders if order.id is not None],
        recording_paths=recording_paths,
    )


def match_user_id(users: Iterable[Any], email: str) -> str:
    """The auth user id whose email matches (case-insensitive), or LookupError.

    Pure over anything with .id/.email so it is testable without the auth
    admin API; ambiguity is refused rather than guessed -- purging the wrong
    account is the one mistake this tool must never make.
    """
    wanted = email.strip().lower()
    if not wanted:
        # An unset shell variable (--email "$EMAIL") must not silently match
        # an email-less auth user -- refuse instead of guessing.
        raise LookupError("--email is empty; pass a real address or --user-id")
    matches = [
        user for user in users
        if (getattr(user, "email", None) or "").strip().lower() == wanted
    ]
    if not matches:
        raise LookupError(f"no auth user with email {email!r}")
    if len(matches) > 1:
        raise LookupError(
            f"email {email!r} matches {len(matches)} auth users; "
            "re-run with --user-id instead")
    return matches[0].id


def describe_plan(plan: PurgePlan) -> str:
    """The dry-run report: every id and path the purge would delete."""
    if plan.is_empty:
        return f"Nothing to purge for user {plan.user_id}."
    lines = [f"Would purge for user {plan.user_id}:"]
    for label, items in (
        ("package", plan.package_ids),
        ("session", plan.session_ids),
        ("order", plan.order_ids),
        ("recording", plan.recording_paths),
    ):
        lines.append(f"  {len(items)} {label}(s)")
        lines.extend(f"    {item}" for item in items)
    return "\n".join(lines)


def execute_purge(client: Any, plan: PurgePlan) -> None:
    """Delete the plan: recordings bucket objects first, then rows child-first.

    Recordings go first on purpose -- the session rows are the only index to
    the bucket paths, so if object removal fails midway the rerun can still
    find what is left. Rows then go child-first (orders, sessions, packages);
    reports and transcripts are columns on sessions and vanish with them.
    Every delete targets the plan's explicit id list, never a broad filter.
    """
    if plan.recording_paths:
        client.storage.from_(RECORDINGS_BUCKET).remove(plan.recording_paths)
    for table, ids in (
        ("orders", plan.order_ids),
        ("sessions", plan.session_ids),
        ("packages", plan.package_ids),
    ):
        if ids:
            client.table(table).delete().in_("id", ids).execute()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Purge every product row and recording tied to one "
                    "account. Dry run by default.")
    who = parser.add_mutually_exclusive_group(required=True)
    who.add_argument("--user-id", help="auth user id (uuid) to purge")
    who.add_argument("--email", help="account email to resolve via auth admin")
    parser.add_argument(
        "--execute", action="store_true",
        help="actually delete rows and recordings; without this flag the "
             "tool only prints what would be deleted")
    return parser


def _iter_all_users(client) -> list[Any]:
    """Every auth user, across admin API pages (thin wiring, manual-tested)."""
    users: list[Any] = []
    page = 1
    while True:
        batch = client.auth.admin.list_users(page=page, per_page=1000)
        if not batch:
            return users
        users.extend(batch)
        page += 1


def main() -> None:
    args = build_parser().parse_args()

    from scorer.api.db import SupabaseDatabase, create_supabase_client
    from scorer.env import load_env

    load_env()
    client = create_supabase_client()
    user_id = args.user_id or match_user_id(_iter_all_users(client), args.email)
    plan = collect_purge_plan(SupabaseDatabase(client), user_id)
    print(describe_plan(plan))
    if plan.is_empty:
        return
    if not args.execute:
        print("Dry run: nothing deleted. Pass --execute to delete.")
        return
    execute_purge(client, plan)
    print(f"Purged user {user_id}: {len(plan.order_ids)} order(s), "
          f"{len(plan.session_ids)} session(s), "
          f"{len(plan.package_ids)} package(s), "
          f"{len(plan.recording_paths)} recording(s). "
          "Delete the auth.users row in the Supabase dashboard to finish.")


if __name__ == "__main__":
    main()
