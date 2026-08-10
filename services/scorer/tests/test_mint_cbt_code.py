from datetime import UTC, datetime

from mint_cbt_code import ALPHABET, generate_code, normalize_code, parse_expires


def test_the_cli_shares_the_endpoint_normalization():
    # The mint tool and POST /cbt/redeem must not be able to disagree about
    # what a code hashes to: a second copy of strip().upper() + sha256 is a
    # minted code that fails to match at redeem (house pattern:
    # test_purge_user.py, where the CLI delegates to the shared module).
    import mint_cbt_code

    from scorer.api.routers import cbt

    assert mint_cbt_code.normalize_code is cbt.normalize_code
    assert mint_cbt_code.hash_code is cbt.hash_code


def test_code_offline_helpers():
    assert normalize_code("  fc-cbt-abcd  ") == "FC-CBT-ABCD"
    generated = generate_code()
    assert generated.startswith("FC-CBT-")
    assert len(generated) == 15
    assert set(generated.removeprefix("FC-CBT-")) <= set(ALPHABET)


def test_bare_date_ends_at_utc_day_boundary():
    assert parse_expires("2026-08-31") == datetime(
        2026, 8, 31, 23, 59, 59, tzinfo=UTC).isoformat()
