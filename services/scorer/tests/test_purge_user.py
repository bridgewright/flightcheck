"""Tests for tools/purge_user.py -- the operator-only account purge.

Since v0.6 the deletion logic itself lives in scorer.api.deletion and is
covered by tests/test_api_deletion.py; what is left here is the CLI, and
that is what these tests own: email -> auth user id resolution, the
dry-run default, and the refusal to run without an explicit identifier.

House pattern (test_backfill_transcripts.py): only the offline pieces are
tested. The Supabase/auth-admin wiring in main() is thin and exercised
manually (operator-run, never part of the app).
"""
from types import SimpleNamespace

import pytest

from purge_user import build_parser, match_user_id

# --- the shared module is the one implementation ------------------------------


def test_the_cli_delegates_to_the_shared_deletion_module():
    # The point of F-34's promotion: the endpoint and this script must not be
    # able to disagree about what "delete my account" means. If a second
    # implementation reappears here, this fails.
    import purge_user
    from scorer.api import deletion

    assert purge_user.collect_deletion_plan is deletion.collect_deletion_plan
    assert purge_user.execute_deletion is deletion.execute_deletion
    assert purge_user.describe_plan is deletion.describe_plan
    assert not hasattr(purge_user, "execute_purge")
    assert not hasattr(purge_user, "collect_purge_plan")


# --- match_user_id (pure) -----------------------------------------------------


def _user(user_id: str, email: str | None) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, email=email)


def test_match_user_id_matches_case_insensitively():
    users = [_user("u-1", "Someone@Example.com"), _user("u-2", "other@example.com")]
    assert match_user_id(users, "someone@example.COM") == "u-1"


def test_match_user_id_refuses_an_unknown_email():
    with pytest.raises(LookupError):
        match_user_id([_user("u-1", "a@example.com"), _user("u-2", None)],
                      "missing@example.com")


def test_match_user_id_refuses_an_empty_email():
    # --email "$EMAIL" with an unset variable must not resolve to an
    # email-less auth user -- that would purge an arbitrary wrong account.
    users = [_user("u-noemail", None), _user("u-2", "real@example.com")]
    with pytest.raises(LookupError, match="empty"):
        match_user_id(users, "")
    with pytest.raises(LookupError, match="empty"):
        match_user_id(users, "   ")


def test_match_user_id_refuses_an_ambiguous_email():
    users = [_user("u-1", "dup@example.com"), _user("u-2", "dup@example.com")]
    with pytest.raises(LookupError, match="matches 2"):
        match_user_id(users, "dup@example.com")


# --- the CLI contract ---------------------------------------------------------


def test_parser_refuses_to_run_without_an_identifier(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args([])
    assert "required" in capsys.readouterr().err


def test_parser_refuses_both_identifiers_at_once(capsys):
    with pytest.raises(SystemExit):
        build_parser().parse_args(
            ["--user-id", "u-1", "--email", "a@example.com"])
    assert "not allowed" in capsys.readouterr().err


def test_parser_defaults_to_dry_run():
    args = build_parser().parse_args(["--user-id", "u-1"])
    assert args.execute is False
