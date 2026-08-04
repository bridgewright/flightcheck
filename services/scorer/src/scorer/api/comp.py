"""Comped accounts: full packages with no order behind them (F-53).

Why this exists
---------------
The operator has to run real sessions to record a demo, capture screenshots,
and verify anything that only exists once a session has been scored. Paying
oneself through Polar to do that would put fabricated revenue in the orders
table, and every number the public repo publishes about real usage reads that
table.

So a comp is its own thing: `packages.comped_at` (migration 008), never
`paid_at`. `effective_total_sessions` treats the two identically, because a
session is a session. Nothing that counts money looks at either this module or
that column.

Who gets it
-----------
An allowlist supplied by the environment, never by this repository. The one
account that needs it today is a private individual's address, and this
repository is public: `COMP_ACCOUNT_IDS` carries Supabase user ids, comma
separated. Ids rather than email addresses on purpose -- an id is already the
key every other table uses, and it is not a contact detail.

An empty or unset variable grants nothing, which is the state every deployment
starts in. There is no wildcard and no "all accounts from this domain": the
failure mode of a loose rule here is that the product is free by accident.
"""
from __future__ import annotations

import os

ENV_VAR = "COMP_ACCOUNT_IDS"


def comped_account_ids(raw: str | None = None) -> frozenset[str]:
    """The allowlist, parsed. Blank entries and stray whitespace are dropped."""
    if raw is None:
        raw = os.environ.get(ENV_VAR, "")
    return frozenset(entry.strip() for entry in raw.split(",") if entry.strip())


def is_comped_account(user_id: str | None, raw: str | None = None) -> bool:
    """Whether packages created by this account are comped at birth.

    An anonymous package (no user_id) is never comped: there would be no
    account to attribute the grant to, and a token-only package that arrived
    with six sessions would be six free sessions for anyone holding the link.
    """
    if user_id is None:
        return False
    return user_id in comped_account_ids(raw)
