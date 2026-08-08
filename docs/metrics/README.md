# docs/metrics/

**Last reviewed: 2026-08-08, at the `v0.12.0` tag.** This directory is the doc
of record for real-user numbers; if the date on that line is older than the
newest release in `CHANGELOG.md`, treat everything below as unverified. Silent
staleness here is a demonstrated failure mode, not a hypothetical one — see the
note at the bottom.

**v0.1 through v0.12 all ship with zero external users.** Every session that
exists — including the one behind the public sample report, and the sessions
this cycle's release notes call "the customer's" (the operator in the customer
seat, disclosed there) — was run by the developer (N=1), so no usage,
retention, or unit-economics numbers exist, and none are claimed anywhere in
this repo. This file is the only thing in this directory. That is the state of
the evidence, not an oversight.

**One synthetic session exists in the production database, and any report
generated from it must exclude synthetic rows.** On 2026-08-08 the operator
inserted a fabricated second session (scored 3.87, no audio) so the
two-session product surfaces could be exercised before a real second session
existed. It is test data wearing a session's shape. Until the row is deleted,
any usage report run against production must subtract operator-inserted
synthetic rows before publishing — `tools/usage_report.py` does not yet know
how to do this on its own, so the rule lives here, in the doc of record, not
in a private note.

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

## What v0.6 changed: measurable, not measured

Until v0.6 the three PRD success metrics could only be read by querying the
database by hand. They now come off an endpoint, and a script renders them
into a dated report in this directory:

```
GET /api/metrics/usage                      # worker, bearer-authed

cd services/scorer                           # the tool resolves from here
uv run python tools/usage_report.py --worker-url https://<worker>
```

**There is still no dated report here, and that is deliberate.** A report
generated today would say N=1 and "self-test", which the paragraphs above
already say. The first one lands with the first external pilot.

## What the report is required to say

The rule this directory has always followed — sample size next to every
number, and plain words when the sample is the operator rather than customers
— is now enforced by the generator rather than by whoever runs it:

- every rate prints the counts it was computed from;
- the number of distinct accounts is in the first line of the summary;
- a one-account sample gets an explicit "these are self-test numbers, not
  customer usage" banner, derived from the data, above the first table;
- a metric the product does not instrument is printed as **not instrumented**
  with the reason, never as a dash a reader may fill in.

That last rule costs one of the three PRD metrics today. The PRD defines
first-response latency as "user stops → interviewer speaks" and names
`DeliveryMetrics.avg_response_latency_s` as its source, but that field
measures the opposite direction — interviewer segment end → candidate segment
start, i.e. how fast the *candidate* answers. It is a real number, so it is
reported under its own name; the PRD's metric stays unreported until the
session room measures it.

Scoring latency is sampled in the worker process (there is no column for it,
and no migration through v0.7 adds one), so its p50 always ships with its
sample size and a note that it resets when the worker restarts.

## State of each number at this tag

One row changed since v0.7: first-response latency's DESIGNED wait moved.
DECISIONS 055 cut the client debounce from 1.2 s to 0.6 s (2026-08-08), so
the deliberate floor before the interviewer may speak dropped from ~2.1 s to
~1.5 s of required quiet. Still not instrumented — the number below is what
the code intends, not a measurement — but the PRD's ≤ 800 ms target is now
contradicted by ~1.5 s of design rather than ~2.1 s.

| Number | State at the v0.12 tag |
| --- | --- |
| Sessions run · completion rate | **Computed, and withheld for want of a sample.** `compute_usage` derives it from `sessions.status` (`scored` + `insufficient`) over the sessions that opened a room (`sessions.secret_mints`), the endpoint serves it, and the report renders it against the ≥ 85% target with its counts beside it. Nothing is missing except users: run today it is a self-test statistic |
| First-response latency, p50 | **Not instrumented, on purpose, and published as such.** The only latency the product records is `avg_response_latency_s` in the delivery channel, which times the *candidate's* side of a turn and is a mean — so it cannot stand in for the PRD's interviewer-side p50. The endpoint returns `None` for this metric with that reason attached, and the report prints "not instrumented" rather than a dash |
| Package burn-through (of 6 sessions) | **Computed, and withheld for the same reason.** The counters exist (`packages.total_sessions`, session rows per package) and `compute_usage` turns them into a mean and a ratio; every package that exists is the operator's, so there is nothing to average across |
| Verdict distribution | Needs sessions from more than one person before a distribution means anything. No instrument, and none is needed until there is a second person |
| Per-session unit cost | Still not metered. The v0.1 notes promised it for v0.2 and it has not landed in v0.2, v0.3, v0.4, v0.5, v0.6 or v0.7; F-13 did not cover it either. The PRD carries published unit economics at v1.0 |

When numbers do exist they get committed here with the sample size stated
next to every one of them, following the rule the eval reports already follow:
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

*Reviewed again 2026-08-04 for v0.6.0 and v0.7.0, and the review line at the
top is the reason this happened at all rather than at the next audit. The
failure it caught was not the one it was built for: the v0.6 work updated the
middle of this page and left the header, the version enumeration and the state
table stamped for v0.5, so a single page asserted both that an endpoint now
computes the completion rate and, thirty-five lines later, that nothing
computes it. Staleness is not the only way a doc of record goes wrong — a
half-updated page is worse, because the fresh half makes the stale half look
checked. Both halves now carry the same tag, and the state table says which
numbers have an instrument and which have a sample, because those stopped
being the same question at v0.6.*
