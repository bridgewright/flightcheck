"""v0.6 token-hygiene surface of scorer.api.db: the migration 006 columns.

The columns land here as a typed seam only. Nothing reads or writes them yet:
SESSION_COLUMNS deliberately stays unchanged in Phase 0, so a session read
still carries None for both and every existing row keeps working. Track C
(F-12) decides the mint-time expiry default and starts populating them.

A null access_token_expires_at means "no expiry" — today's behaviour, kept
exactly, so the migration cannot change how an existing session authorizes.
"""
from pathlib import Path

from scorer.api.db import SESSION_COLUMNS, SessionRow

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "docs" / "supabase" / "migrations" / "006_token_hygiene.sql"
)


def _session(**overrides) -> SessionRow:
    data = {
        "id": "sess-1", "package_id": "pkg-1", "index": 1, "status": "planned",
        "session_plan": None, "audio_path": None, "report": None,
    }
    data.update(overrides)
    return SessionRow.model_validate(data)


def test_session_row_token_columns_default_to_none():
    # Rows stored before migration 006 carry neither column; the model must
    # validate them via defaults, and a null expiry means "no expiry".
    row = _session()
    assert row.access_token_expires_at is None
    assert row.token_revoked_at is None


def test_session_row_accepts_the_token_columns():
    row = _session(
        access_token_expires_at="2026-08-04T00:00:00+00:00",
        token_revoked_at="2026-08-03T12:00:00+00:00",
    )
    assert row.access_token_expires_at == "2026-08-04T00:00:00+00:00"
    assert row.token_revoked_at == "2026-08-03T12:00:00+00:00"


def test_session_reads_select_the_token_columns():
    # Phase 0 shipped the seam and left this widening to whoever implemented
    # F-12; it landed at the merge, because the web guard and this column
    # list sat in two different tracks' zones. Without them selected the
    # guard is enforcement with no signal: a revocation written into the
    # database could never reach the code that honours it.
    columns = SESSION_COLUMNS.split(",")
    assert "access_token_expires_at" in columns
    assert "token_revoked_at" in columns


def test_migration_006_is_additive_and_idempotent():
    sql = MIGRATION.read_text().lower()
    assert "access_token_expires_at timestamptz" in sql
    assert "token_revoked_at timestamptz" in sql
    # Re-running a migration against a live database must be a no-op, and it
    # must never drop or rewrite an existing column.
    assert sql.count("add column if not exists") == sql.count("add column")
    assert "drop column" not in sql
    assert "not null" not in sql  # both columns are nullable on existing rows
