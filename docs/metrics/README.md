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

## What v0.6 changed: measurable, not measured

Until v0.6 the three PRD success metrics could only be read by querying the
database by hand. They now come off an endpoint, and a script renders them
into a dated report in this directory:

```
GET /api/metrics/usage                      # worker, bearer-authed
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
and v0.6 adds no migration for one), so its p50 always ships with its sample
size and a note that it resets when the worker restarts.

## State of each number at this tag

| Number | State at the v0.5 tag |
| --- | --- |
| Sessions run · completion rate | The fields a rate needs exist — `sessions.status` (`scored` / `insufficient` / `failed`) over the sessions that opened a room (`sessions.secret_mints`) — and nothing computes it. Computed today it would be a self-test statistic |
| First-response latency, p50 | Not instrumented at all. The only latency the product records is `avg_response_latency_s` in the delivery channel, which times the *candidate's* side of a turn and is a mean — it cannot stand in for the PRD's interviewer-side p50 target |
| Package burn-through (of 6 sessions) | The counters exist (`packages.total_sessions`, session rows per package); the only package ever unlocked by a payment is the operator's verification one |
| Verdict distribution | Needs sessions from more than one person before a distribution means anything |
| Per-session unit cost | Still not metered. The v0.1 notes promised it for v0.2 and it has not landed in v0.2, v0.3, v0.4 or v0.5; F-13 does not cover it either. The PRD carries published unit economics at v1.0 |

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
