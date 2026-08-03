# docs/metrics/

**Last reviewed: 2026-08-03, at the `v0.5.0` tag.** This directory is the doc
of record for real-user numbers; if the date on that line is older than the
newest release in `CHANGELOG.md`, treat everything below as unverified. Silent
staleness here is a demonstrated failure mode, not a hypothetical one — see the
note at the bottom.

**v0.1 through v0.5 all ship with zero external users.** Every session that
exists — including the one behind the public sample report — was run by the
developer (N=1), so no usage, retention, or unit-economics numbers exist, and
none are claimed anywhere in this repo. This file is the only thing in this
directory. That is the state of the evidence, not an oversight.

**Exactly one $49 order exists, and it is the operator's own.** v0.5 opened
real payments (Polar hosted checkout, a signature-verified `order.paid`
webhook). The single row in the `orders` table was placed by the project owner
on 2026-08-03, against the live product, to prove checkout → webhook →
provisioning end to end, and then **self-refunded, with the receipt kept**. It
is evidence that the payment path works, and it took a real delivery to get
there: every live `order.paid` returned 403 against a verifier that passed its
own locally signed tests, fixed at `84e3434`. It is **not a sale, not revenue,
and not evidence of demand.** flightcheck has zero external paying customers.
The PRD's paid-packages target excludes operator verification orders for
exactly this reason, so this order cannot satisfy it.

## What becomes measurable, and when

Nothing below can be reported today, because reporting it needs users and there
are none. The instrumentation is F-13 (real-usage metrics), scheduled for v0.6.
The metrics originally promised for v0.2 slipped with the payments timeline
(DECISIONS #008); payments have now shipped and the metrics have not.

| Number | State at the v0.5 tag |
| --- | --- |
| Sessions run · completion rate | The fields a rate needs exist — `sessions.status` (`scored` / `insufficient` / `failed`) over the sessions that opened a room (`sessions.secret_mints`) — and nothing computes it. Computed today it would be a self-test statistic |
| First-response latency, p50 | Not instrumented at all. The only latency the product records is `avg_response_latency_s` in the delivery channel, which times the *candidate's* side of a turn and is a mean — it cannot stand in for the PRD's interviewer-side p50 target |
| Package burn-through (of 6 sessions) | The counters exist (`packages.total_sessions`, session rows per package); the only package ever unlocked by a payment is the operator's verification one |
| Verdict distribution | Needs sessions from more than one person before a distribution means anything |
| Per-session unit cost | Still not metered. The v0.1 notes promised it for v0.2 and it has not landed in v0.2, v0.3, v0.4 or v0.5; F-13 does not cover it either. The PRD carries published unit economics at v1.0 |

When numbers do exist they get committed here with the sample size stated next
to every one of them, following the rule the eval reports already follow:
numbers of record land with their provenance and caveats and are never
paraphrased (`evals/reports/`). Small samples say that they are small.

---

*Rewritten 2026-08-03 for v0.5.0. The previous version was written for the v0.2
audit on 2026-08-01 and then left untouched through the v0.3, v0.4 and v0.5
work, so at the v0.5 release audit the one page whose whole job is to say what
is true about users still read "v0.1 and v0.2 both ship with zero external
users" and still described payments as pending. The claim it made happened to
still be true; the file had no way to know that, which is the actual problem.
Hence the dated review line at the top.*
