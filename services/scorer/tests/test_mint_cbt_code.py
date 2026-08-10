from datetime import UTC, datetime

from mint_cbt_code import ALPHABET, generate_code, normalize_code, parse_expires


def test_code_offline_helpers():
    assert normalize_code("  fc-cbt-abcd  ") == "FC-CBT-ABCD"
    generated = generate_code()
    assert generated.startswith("FC-CBT-")
    assert len(generated) == 15
    assert set(generated.removeprefix("FC-CBT-")) <= set(ALPHABET)


def test_bare_date_ends_at_utc_day_boundary():
    assert parse_expires("2026-08-31") == datetime(
        2026, 8, 31, 23, 59, 59, tzinfo=UTC).isoformat()
