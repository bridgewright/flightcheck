"""Mint one operator-managed CBT access code (run from services/scorer)."""
from __future__ import annotations

import argparse
import hashlib
import secrets
from datetime import UTC, date, datetime, time

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def normalize_code(code: str) -> str:
    return code.strip().upper()


def generate_code() -> str:
    return "FC-CBT-" + "".join(secrets.choice(ALPHABET) for _ in range(8))


def parse_expires(value: str) -> str:
    try:
        if len(value) == 10:
            parsed = datetime.combine(date.fromisoformat(value), time(23, 59, 59), UTC)
        else:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC).isoformat()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("--expires must be an ISO date or datetime") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mint a closed-beta access code.")
    parser.add_argument("--label", required=True)
    parser.add_argument("--max-redemptions", required=True, type=int)
    parser.add_argument("--expires", required=True, type=parse_expires)
    parser.add_argument("--code")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if args.max_redemptions < 1:
        raise SystemExit("--max-redemptions must be positive")
    code = normalize_code(args.code or generate_code())
    if not code or len(code) > 64:
        raise SystemExit("code must be 1-64 characters after normalization")
    code_hash = hashlib.sha256(code.encode()).hexdigest()

    from scorer.api.db import create_supabase_client
    from scorer.env import load_env

    load_env()
    client = create_supabase_client()
    if (client.table("cbt_codes").select("id").eq("code_hash", code_hash)
            .execute().data):
        raise SystemExit("that code already exists")
    client.table("cbt_codes").insert({
        "code_hash": code_hash, "label": args.label,
        "max_redemptions": args.max_redemptions,
        "package_expires_at": args.expires,
    }).execute()
    print(f"Store it now; the plaintext code is shown only once: {code}")


if __name__ == "__main__":
    main()
