"""Per-JD research sweep: query construction (grounded calls arrive next cycle)."""
from __future__ import annotations


def build_queries(role_title: str, company: str | None) -> list[str]:
    """Up to 4 sweep queries; company-scoped ones are skipped when company is None."""
    queries: list[str] = []
    if company is not None:
        queries.append(f"{company} {role_title} interview questions site:glassdoor.com")
        queries.append(f"{company} {role_title} interview experience reddit")
    queries.append(f"{role_title} interview blind teamblind")
    queries.append(f"{role_title} interview what interviewers look for")
    return queries
