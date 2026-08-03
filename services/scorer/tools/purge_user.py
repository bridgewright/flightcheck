"""Purge one account's data -- the operator side of the deletion policy.

Manual operator tool, never part of the app or the gates. Since v0.6 the
customer can delete their own account from /settings (F-34); this script is
what remains for the cases self-serve cannot reach -- a customer who has
lost access to their mailbox, a support request that arrives by another
route, or a cleanup the operator has to make from the outside.

It deliberately does NOT own the deletion logic any more. Both paths call
scorer.api.deletion, so "delete my account" cannot come to mean two
different things depending on who clicked. What lives here is only the CLI:
resolving an email to an auth user id, the dry-run default, and the
Supabase wiring.

Safety: dry run is the DEFAULT and prints the full plan; --execute is the
explicit destructive switch; the tool refuses to run without exactly one of
--user-id / --email. The auth.users row is deleted afterwards in the
Supabase dashboard (admin-scoped, one click); this tool owns the product
data, exactly as the endpoint does.

Usage (from services/scorer, env from .env):
    uv run python tools/purge_user.py --email person@example.com   # dry run
    uv run python tools/purge_user.py --user-id UUID --execute
"""
from __future__ import annotations

import argparse
from collections.abc import Iterable
from typing import Any

from scorer.api.deletion import (
    RecordingsNotDeleted,
    collect_deletion_plan,
    describe_plan,
    execute_deletion,
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
    from scorer.api.storage import SupabaseStorage
    from scorer.env import load_env

    load_env()
    client = create_supabase_client()
    user_id = args.user_id or match_user_id(_iter_all_users(client), args.email)
    db = SupabaseDatabase(client)
    storage = SupabaseStorage(client)
    plan = collect_deletion_plan(db, user_id)
    print(describe_plan(plan))
    if plan.is_empty:
        return
    if not args.execute:
        print("Dry run: nothing deleted. Pass --execute to delete.")
        return
    try:
        outcome = execute_deletion(db, storage, plan)
    except RecordingsNotDeleted as err:
        # Recordings first, rows second, abort on failure: the account is
        # untouched and the plan above is still exactly what a rerun will
        # do. Print the keys -- unlike the HTTP path, the operator is the
        # one who has to go look at them.
        print(f"ABORTED: {err}")
        for path in err.paths:
            print(f"    {path}")
        print("Nothing was deleted. Fix storage access and rerun.")
        raise SystemExit(1) from err
    print(f"Purged user {user_id}: {outcome.orders_deleted} order(s), "
          f"{outcome.sessions_deleted} session(s), "
          f"{outcome.packages_deleted} package(s), "
          f"{outcome.recordings_deleted} recording(s). "
          "Delete the auth.users row in the Supabase dashboard to finish.")


if __name__ == "__main__":
    main()
