# RETRO — honest retrospectives

What actually happened, including the failures. Entries are dated and written
after the work, from recorded runs and review ledgers — not reconstructed to
look clean. Companion doc: [PLAYBOOK.md](PLAYBOOK.md) (the reusable patterns
these lessons produced) and [DECISIONS.md](DECISIONS.md) (the decision log).

---

## 2026-07-25 — Rejecting the cascade before building it

The obvious v0.1 architecture was an STT → LLM → TTS cascade: mature tooling,
one text model, easy transcripts. We rejected it before writing product code,
and the reasoning is worth keeping honest: it was not a quality tradeoff we
optimized, it was a capability boundary we almost missed. STT is *designed*
to produce clean text — it deletes fillers, hesitations, and prosody. A
cascade therefore cannot score delivery at all; the signal this product sells
is destroyed before any model sees it (DECISIONS.md #001).

The near-miss: the cascade's advantages are all visible up front
(tooling, cost, debuggability) while the disqualifier only shows up once you
ask "what does the scoring model actually receive?" We caught it in design
review, not in a failed build — cheap this time. The standing rule it left
behind: for any pipeline, write down what information each stage *removes*,
not just what it adds. Repo-wide consequence: "Native speech-to-speech only"
is CLAUDE.md non-negotiable #2, and the scoring channel reads raw audio
(`services/scorer/src/scorer/delivery/judge.py`).

## 2026-07-26 — The eval gate worked: judge accuracy 0.0 → 0.33 plateau → redesign → 1.0

The layer-1 rubric-discrimination gate exists to answer "would an expert
agree with this judge?" On the first measured run against the golden
triplets, the shipped judge scored **0.0** — it separated weak answers but
scored strong and borderline identically at 5.0. My own human blind-rank had
separated all three variants, so per the suite protocol
(`evals/suites/rubric_discrimination/README.md`: trust the human), the judge
was wrong, not the data.

The uncomfortable part worth recording: **prompt engineering did not fix
it.** Three prompt-only iterations (calibration language → a mechanical
score-5 checklist cap → BARS anchor-first procedure with temperature 0 and a
fixed seed) measured 0.33 → 0.0 → 0.33. A plateau, not progress. Diagnostic
rationales exposed two real mechanisms:

1. **Coverage scoring** — the judge mapped category name-checks onto the
   score-5 anchor's category list and read straight past the candidate's own
   hedges ("informal evaluation", "basic redaction").
2. **Irreducible single-call noise** — batched all-dimension scoring created
   a halo that pushed the responsive dimension to the 5.0 ceiling, and single
   calls flipped 3.5 ↔ 5.0 across runs *at temperature 0 with a fixed seed* —
   noise larger than the true strong/borderline separation (~0.3).

The fix was a redesign, not a prompt tweak
(`services/scorer/src/scorer/content/judge.py`, commit `ddf6f92`): one
focused call per content dimension, anchor-first + precision scoring rules,
and a mean of three seeded samples per dimension. Result: **1.0 on three
consecutive runs**, with the eval data, metric definition, and committed 0.8
baseline untouched throughout. Numbers of record:
[evals/reports/2026-07-26-v01-gate.md](evals/reports/2026-07-26-v01-gate.md).

Stated plainly, twice, so it can't be over-read: **N=3 triplets.** 1.0/3 on
consecutive runs is a real signal that the redesign fixed the failure
mechanism; it is not a large-sample accuracy claim. Growing N is v0.2 work.

Related lesson from the same release prep: the network-free fake-client test
gate (271 tests green) is structurally blind to live-API contract failures.
Two shipped only because release prep ran the real API: the Developer API
rejecting pydantic `extra="forbid"` schemas via `additionalProperties`
(fixed at a client seam, `services/scorer/src/scorer/genai_compat.py`,
commit `ccd5f36`) and the SDK closing its shared httpx client on GC mid-run
(commit `4a2dcf2`). Fakes prove your logic; only live calls prove the
contract. The evals gate — which does hit the live API — is the standing
mitigation, and it is exactly where these surfaced.

## 2026-07-26 — Verification layering: what each layer caught (and missed)

v0.1 was built plan-first with layered verification: plan verification →
per-task TDD → an independent task-scoped review per task → a 3-lens
whole-branch final review before tag. The honest accounting of what each
layer caught, from the execution ledger:

**Task-scoped reviews caught ~6 defects inherited from the plan itself**,
i.e. faithfully implementing the brief would have shipped them. The two
Criticals:

- **A structurally dead DSP check (Task 14).** The brief's own fully-mocked
  tests could never exercise the DSP separability check against real audio —
  the check was dead on arrival and green. Caught only because the reviewer
  traced the data path instead of trusting the passing suite. Fixed in
  commit `ed6e76d` (real DSP windows in the check, gate exception
  containment, dead-branch removal).
- **An answer-key-leaking route (Task 17).** The brief mandated a
  `GET /api/sessions/[id]` web proxy; as specified it shipped unauthenticated
  *and* was dead code, exposing `session_plan` and
  `interviewer_instructions` — the interview's answer key — to anyone with a
  session id. Ruling: security governs over plan fidelity; the route was
  removed entirely and a vitest tripwire pins it dead
  (`apps/web/tests/sessions-route.test.ts`).

The other plan-inherited catches, briefly: a plan-internal contradiction
where the plan's own pinned test violated the plan's binding registry
contract (Task 2 — the test was the bug); the report-language lint flagging
candidates' verbatim quotes as forbidden phrasing (Task 11 — two rework
rounds, including a cross-dimension masking hole found on re-review); and
two plan-silent security gaps where state-changing routes shipped without
the package-token capability check (Task 16).

**What task-scoped review missed — and why the final review exists:** the
3-lens whole-branch review found a *sibling* of the Task 17 Critical one
directory over: a dead `GET /api/packages/[token]` route returning the full
package row including the question bank. It survived because no task-scoped
review ever looked at both routes together. Same class, same fix (delete +
tripwire), different layer. The final review also caught cross-cutting
issues no single task could see: the Vercel request-body limit versus real
recording sizes (fixed with signed-URL direct uploads), SSRF on the JD
fetch, and unmetered re-scoring. All fixed before tag in the release wave.

The takeaway we're keeping: each verification layer catches a class the
previous one structurally cannot — mocked tests can't see dead checks,
task-scoped review can't see cross-route symmetry, and nothing but a live
run sees provider-contract drift. None of the layers is decorative; the
ledger shows each one earning its cost on this branch. The standing risk is
equally honest: every layer above per-task TDD found real Criticals, which
means single-layer verification would have shipped them.
