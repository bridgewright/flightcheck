# PLAYBOOK — reusable patterns from building flightcheck

Patterns that survived contact with real APIs, real audio, real money, real
eval numbers, and an adversarial review of the work that produced them.
Everything here is written from the shipped implementation through the v0.6
batch and the F-21 design pass — rubric compilation, raw-audio delivery
scoring, the paid product, operating it unattended, the parallel process that
builds them, and what two rounds of review found in that process. File paths
are real, numbers come from recorded runs, and anything unshipped is labeled
unshipped rather than planned. See [RETRO.md](RETRO.md) for the failures that
produced these patterns.

**Update note, 2026-08-04.** Chapters 4 and 5 are new, and the appendix gained
a third column rather than having its second one overwritten. Chapter 4 landed
first and moved the scope line to claim the v0.6 batch while the only v0.6
material in the file was a single paragraph; chapter 5 is that gap written
rather than the claim narrowed. The scope line has now been wrong three times,
every time by claiming a currency the chapters under it did not have — which
is the failure this file spends two chapters describing, committed by the file
that describes it.

**Update note, 2026-08-03.** Chapter 3 is new. Before it, no pattern had been
added here since 2026-07-26 — a full release arc and 170+ commits, including
everything payments and untrusted input taught. The v0.2 pass touched the scope
line above and an appendix heading, nothing else — and the scope line then
claimed a currency the file did not have.
The v0.5 release audit caught that; the appendix below now carries the
*status* of the v0.1 plans rather than their promises. (v0.3 and v0.4 were
internal milestones, never tagged, folded into v0.5.0.)

---

## Chapter 1 — Compiling expert-grade interview rubrics without fine-tuning

The problem: score interview answers at the standard of an experienced
interviewer for a specific role at a specific company — without training a
model, and provably (a gate, not vibes).

The shipped compile path is
`services/scorer/src/scorer/api/pipeline.py::compile_package`:
intake → grounded research sweep → BARS rubric compile → validation gate.
Five patterns make it work.

### 1.1 Ground every rubric in a per-JD research sweep, and enforce citations in code

`services/scorer/src/scorer/research/sweep.py` runs a two-step sweep per JD:

1. **Grounded prose calls** — one Gemini call per query with the
   `google_search` tool, harvesting citations from `grounding_metadata`.
2. **One structuring call** — the concatenated prose is structured with a
   pydantic `response_schema` (no tools).

Two hard-won constraints shaped this:

- The `google_search` tool and `response_schema` **cannot be combined** in a
  single `generate_content` call (measured during the W1 bake-off). Hence the
  two-step shape.
- The structuring model's own `citations`/`queries` fields are **discarded**;
  only citations harvested from grounding metadata survive. The model that
  formats the findings can never invent a source.

Downstream, `services/scorer/src/scorer/rubric/compiler.py` makes citation a
schema-level requirement: every rubric dimension must cite at least one
source (a research citation URL copied verbatim, or a private corpus doc as
`corpus://<doc_id>`), and pydantic validation on the `Rubric` model
(`services/scorer/src/scorer/schemas.py`) is the gate of record — a
citation-less dimension is a `ValidationError`, not a style issue.

**Caveat, first disclosed at v0.1 and still open at v0.5:** grounded-search
citations are captured at compile time as Google grounding *redirect* URLs,
which can expire. The citation title carries the publisher domain, so the
source stays identifiable. Resolving those redirects to durable publisher
URLs was written up as near-term work at v0.1 and has not been done —
`sweep.py` still stores the grounding chunk's `web.uri` verbatim.

### 1.2 BARS anchors: make the model score behavior, not impressions

Every dimension carries exactly three behaviorally-anchored rating-scale
(BARS) anchors — observable answer behavior for scores 1, 3, and 5,
question-independent by rule (`compiler.py`, `_RULES`). The content judge
(`services/scorer/src/scorer/content/judge.py`) then scores **anchor-first**:
compare the answer against the score-5 anchor, name any shortfall, and only
then assign a number. This is what broke the judge's "coverage scoring"
failure mode (see 1.4): impression scoring saturates; behavior-vs-anchor
comparison discriminates.

### 1.3 Show the compiler the output you accept, not just the task you want

Give a compile prompt two things a general model does not have: domain
evidence, and examples of output a human already signed off on. Load both
from outside the repo at run time, so raising quality is a data change rather
than a prompt edit — and so private material never becomes a commit. Cap the
examples (two is enough to fix format and bar; more crowds out the task
itself) and let the loader return empty rather than fail, so a checkout
without the private material still runs.

Implementation: `services/scorer/src/scorer/rubric/corpus.py` reads corpus
markdown and up to two few-shot `Rubric` JSON documents synced from a private
bucket; the format is documented in `services/scorer/corpus/README.md`. The
few-shots are human-corrected rubrics — compiled output a human reviewed and
fixed, fed back as format-and-quality references. The corpus content itself
is never committed (workspace confidentiality rule; the public repo carries
only the format README and one neutral example doc).

Honest scope note, restated 2026-08-03: the *mechanism* shipped in v0.1 and
the correction *loop* is still manual — an operator curates corrected rubrics
into the bucket by hand. The v0.1 text called automating that "v0.2 work"; it
did not ship in v0.2 and is not scheduled now. Read it as a habit that
depends on an operator, not as a flywheel.

### 1.4 The golden-triplet discrimination gate — and why it earned its keep

You cannot claim "expert-grade scoring" without a falsifiable check. Layer 1
(`services/scorer/src/scorer/evals_l1/golden.py`, suite in
`evals/suites/rubric_discrimination/`) works like this:

- For selected rubric dimensions, generate a question plus three synthetic
  answers: strong (score-5 behavior), borderline (3), weak (1).
- **Generator vendor != judge vendor** (OpenAI generates, Gemini judges) to
  block self-preference bias.
- A **human blind-ranks** shuffled A/B/C sheets (`manual/`, answer keys
  segregated in `manual/keys/`) before any judge run is trusted. Protocol
  rule: when human and judge disagree, trust the human and fix the judge.
- The judge must order all three strictly: strong > borderline > weak.
  Accuracy gates the release against `evals/baselines.json` (min 0.8) via
  `cd services/scorer && uv run scorer-evals`
  (`services/scorer/src/scorer/evals_l3/regression.py`) — the console script
  is declared in that project's `pyproject.toml`, so it does not resolve from
  the repo root.

This gate caught a real, invisible-in-production defect during release prep.
The measured iteration (full detail in
[evals/reports/2026-07-26-v01-gate.md](evals/reports/2026-07-26-v01-gate.md)
and [RETRO.md](RETRO.md)):

| Judge iteration | L1 accuracy |
| --- | --- |
| Original batched all-dimension judge | 0.0 |
| Prompt-only fixes (calibration language, checklist cap, anchor-first + temperature 0 + seed) | 0.33 → 0.0 → 0.33 (plateau) |
| Redesign: one focused call per dimension, anchor-first + precision rules, mean of 3 seeded samples | 1.0 on three consecutive runs |

The reusable lesson: batched multi-dimension scoring created a halo that
saturated the responsive dimension at 5.0, and single LLM calls were **not
reproducible even at temperature 0 with a fixed seed** — score flips larger
than the true strong/borderline separation. The fix is variance reduction of
the measured quantity (focused calls, sample mean), not moving the goalposts:
the eval data, metric definition, and committed 0.8 baseline were never
touched. Caveat stated wherever the number is claimed: N=3 triplets.

### 1.5 Validation-retry, not prayer

`compile_rubric` retries exactly once on `ValidationError`, appending the
validation error text so the model can repair its own output; a second
failure raises. Structured-output quality problems become typed, visible
failures (`RubricCompileError` → package status `failed`, surfaced honestly
in the UI) instead of malformed rubrics reaching users.

---

## Chapter 2 — Scoring delivery from raw audio

The problem: score *how* something was said — hesitation, fillers, pace,
hedging intonation — which transcription destroys before a text model ever
sees it (DECISIONS.md #001: native speech-to-speech only; the cascade was
rejected pre-build as a capability boundary, not a quality tradeoff).

### 2.1 Two layers: deterministic DSP as ground truth, audio-LLM as interpreter

- **Layer A — DSP, no LLM** (`services/scorer/src/scorer/delivery/dsp.py`):
  every number is reproducible from the audio samples and the transcript
  segmentation alone — WPM timeline, filler counts against a config lexicon,
  silence events >= 1s, response latency, f0 variance. This module is the
  delivery channel's ground truth by design.
- **Layer B — audio-native judge**
  (`services/scorer/src/scorer/delivery/judge.py`): one file-based Gemini
  call on the actual WAV, with the DSP metrics injected into the prompt as
  measured fact and the rubric's delivery BARS anchors verbatim. The judge
  adds what DSP cannot measure (what the silences *sound* like, trailing
  off, hedging intonation) and must cite **timestamped observations**.

Post-validation in code, not in the prompt: observations outside the real
audio duration are dropped (duration via `soundfile.info`), scores for
non-delivery dimensions are dropped, and when the judge contradicts the DSP
numbers the conflict is **flagged on the report**, never hidden.

### 2.2 Controlled-triplet validation with a real result

Layer 3 (`services/scorer/src/scorer/evals_l3/delivery_check.py`, clip
protocol in `evals/suites/delivery_discrimination/clips/README.md`) records
three takes of the *same answer* — fluent / filler-loaded / hesitant — so
content is held constant and only delivery varies. Two checks per triplet:

1. **DSP separability:** fluent must have strictly fewer silence events than
   hesitant.
2. **Judge discrimination:** the audio judge must score
   fluent > hesitant and fluent > filler, strictly.

v0.1 recorded result (2 triplets, committed in
[evals/reports/2026-07-26-v01-gate.md](evals/reports/2026-07-26-v01-gate.md)):
DSP separability 2/2, judge accuracy 1.0 against a 0.8 baseline. The earlier
W1 bake-off measured the same discrimination shape across vendors on
controlled clips: Gemini 0.92–1.00 ranking accuracy vs 0.50 for gpt-audio
(chance = 0.17), which is why Gemini scores and OpenAI interviews
(DECISIONS.md #002).

The voice clips themselves are gitignored (DECISIONS.md #005 — a public repo
is forever; biometric-adjacent data never enters it). Reproducibility comes
from the committed recording protocol, not committed audio.

### 2.3 Pattern summary

- Never let an LLM be the only measurement — pair it with a deterministic
  layer and flag disagreements instead of averaging them away.
- Validate LLM outputs against physical reality in code (timestamps within
  audio duration, quotes verified against the transcript in
  `content/judge.py` — fabricated quotes are dropped and flagged).
- Prove discrimination on controlled inputs where the ground truth is known
  by construction, before trusting any score on real inputs.
- Keep model IDs in config (`services/scorer/config/product.toml`) —
  providers drift, and the eval gate exists to catch drift before users do.

---

## Chapter 3 — Turning a pipeline into a paid product

The problem: once the thing takes money, accepts text written by strangers,
and is built by several agents at once, four assumptions break — that your own
test suite defines correctness, that spending model tokens is always the right
move, that input is data, and that a green branch is a green tree.

### 3.1 Verify a payment webhook against a real delivery, never against a fixture you signed

A fixture signed by your own code tests exactly one thing: that your verifier
agrees with your reading of the spec. It cannot tell you whether the provider
reads the spec the same way.

- **Do not treat a payment webhook as verified until a real delivery from the
  provider has been accepted in production.** A green unit suite is a
  prerequisite, not the evidence. If no customer has paid yet, place the
  order yourself and watch the delivery land.
- **When the live signature disagrees with the published spec, do not pick a
  side — accept any derivation of the same secret.** Compute the expected MAC
  under every plausible key derivation and accept a match on any of them.
  Security is unchanged, because every candidate key is a function of the one
  shared secret: a payload signed with a different secret matches nothing in
  any derivation, and a tampered body matches nothing either. Switching to
  the other single reading would only move the outage.
- **Fail closed on the way in.** No secret configured → refuse the request,
  never process it; an order you cannot resolve to exactly one entitlement →
  5xx, so the provider retries and the failure is visible in logs; a replay of
  a verified event → safe, because provisioning dedupes on the provider's
  order id rather than trusting delivery-once.
- **Reject stale timestamps in both directions.** An old capture must not
  replay, and a far-future stamp is only ever a forgery.

What this cost here: flightcheck implemented Standard Webhooks exactly as
published — secret is `whsec_` + base64 key bytes, signed content is
`{id}.{timestamp}.{body}` — and every real `order.paid` delivery returned 403
in production while a locally signed, spec-compliant payload verified green in
the test suite. Polar feeds the secret *string* to the HMAC; its documentation
base64-wraps it only to satisfy the standardwebhooks library, which decodes it
straight back. The fix (`84e3434`, `apps/web/lib/polar.ts`) hashes under all
three derivations — spec base64 bytes, the whole secret string, the
after-prefix string — and a test asserts that a *different* secret is rejected
under all three (`apps/web/lib/polar.test.ts`). Route behavior is in
`apps/web/app/api/webhooks/polar/route.ts`.

The delivery that exposed this was the project owner's own $49 order against
production, refunded afterwards; flightcheck has no external customers. Had
that order not been placed, the first person to find the bug would have been
the first person to pay.

### 3.2 Refuse to score what cannot be scored

The instinct when a session comes back thin is to score it anyway and hedge
the wording. Do the opposite: decide *before* spending whether the evidence
supports a verdict at all.

- **Gate model spend on evidence volume, measured from artifacts you already
  have.** Duration, candidate turns, candidate words — a pure function over
  the transcript and the recording length. No model call is needed to decide
  whether to make model calls.
- **Return a three-way verdict, not a boolean.** Below the floor: make
  **zero** judge calls, save no report, and end in a terminal state that
  preserves the user's session slot so the attempt is retriable. Above every
  floor but below a full-evidence bar: score, but stamp the report `limited`
  and say so on the report itself. (Ours prints one fixed sentence covering
  every near miss; naming which floor was the close one is the obvious next
  increment, not something the pattern already delivers.) Full
  evidence: score normally.
- **Keep every threshold in config, never in code.** You will move them once
  you have watched real sessions; that must be a configuration change, not a
  release.
- **Apply the same discipline upward: batch external-eval spend to release
  gates.** One run per gate with the result committed; a diagnostic re-run is
  an exception you justify, not a habit.

Implementation: `services/scorer/src/scorer/report/eligibility.py` (pure, no
I/O), thresholds under `[eligibility]` in
`services/scorer/config/product.toml`, called from
`services/scorer/src/scorer/api/pipeline.py` ahead of every judge call;
rationale in [DECISIONS.md](DECISIONS.md) #014. Honest limit: this gate has
unit tests (`services/scorer/tests/test_eligibility.py`) and no eval-gate
coverage — the release suites judge answers, they do not exercise the refusal
path.

The product argument and the cost argument are the same argument. A verdict
drawn from a few minutes of speech is noise sold as signal, and the person
paying for the verdict is the one who cannot tell.

### 3.3 Fence untrusted text first, then detect — and price the two detection errors differently

Injection *detection* is a research problem; fencing is an afternoon. Ship the
fence first, say plainly that it is a floor, and keep it underneath whatever
detector arrives later.

- **Wrap every user-controlled span in explicit markers**, preceded by one
  standing note that the enclosed text is data and that instructions appearing
  inside it are never followed.
- **Neutralize the marker characters inside the fence.** Otherwise a payload
  closes the fence from within and everything after it reads as prompt.
  Replace them with lookalike characters so the text stays readable to the
  model and to whoever debugs the prompt later.
- **Strip invisible carriers at intake** — zero-width and bidi controls, BOM,
  soft hyphen, HTML comments and tags. That is the payload no human reviewing
  the source document can see.
- **Flatten anything that must sit inline on an instruction line:** collapse
  whitespace (a newline inside a resume "name" would otherwise open a fresh
  prompt line) and cap the length.
- **Do not touch the surrounding prompt wording while doing any of this.**
  Judge prompts are eval-calibrated; fencing wraps data without editing
  instructions. Then re-run the gate to show the wrapper moved nothing.

Detection arrived one release later, and the thing it taught is not how to
write the patterns. It is which way the detector is allowed to be wrong.

- **Measure two rates, never one accuracy.** Recall over documents that
  really are attacks, and false-positive rate over documents that really are
  not. They fail in opposite directions and they do not cost the same.
- **Let the expensive error set the ceiling and give the cheap one the
  margin.** A missed attack still lands inside the fence, which the model
  usually respects — a degraded defence, not an absent one. A false positive
  tells a paying customer that their real document is an attack and stops
  them at the door, and there is no second chance at that. So the
  false-positive ceiling here is **zero**, exactly, and the recall bar (0.9)
  is the one carrying the slack.
- **Build the benign corpus adversarially against your own detector, not
  against the attacker.** Documents that legitimately say "system prompt",
  "override the rules" and "act as" are real postings in this product's own
  target market — prompt-engineering and AI-safety roles. The first
  classifier refused them, which is to say the first classifier's failure
  mode was refusing the product's core input. A benign fixture earns its
  place here by having been a false positive once.
- **Prefer a defence whose gate costs nothing to run.** This classifier is
  deterministic — weighted signal patterns and a refusal threshold, no model
  call — so its suite runs on every release for free instead of being
  rationed alongside the judge suites. Cheap to gate is a design property
  worth choosing for.
- **Name the signal that fired, never the text that matched.** An operator
  log and an API response must not reflect an attacker's payload back out of
  the system.

Implementation: `services/scorer/src/scorer/promptsafe.py` — `fence`,
`inline`, `strip_hidden_text` for the floor, `classify_injection` for the
detector. Fencing is applied at every prompt site that carries user text
(rubric compiler, content judge, research sweep, session planner, profile
intake, JD fact extraction); stripping and classification happen at the API
intake boundary in
`services/scorer/src/scorer/api/routers/packages.py`. The gate is
`evals/suites/injection/` with committed hostile and benign fixtures, run by
`services/scorer/src/scorer/evals_injection.py` against the two baselines in
`evals/baselines.json`. The deliberate split between fencing now and
detecting later is [DECISIONS.md](DECISIONS.md) #021; #027 closes it and
records why the benign ceiling is zero.

Honest limit: what is gated is a fixture corpus, not an adversary. Recall is
measured against attack shapes somebody already thought of, the patterns sit
in a public repo where anyone can read them, and the unit tests
(`services/scorer/tests/test_promptsafe.py`) still prove the wrapper's
behavior rather than resistance to a person who is trying. One older piece of
evidence is worth keeping separate from all of this: the v0.5 gate re-ran
layer 1 with the fences in place and rubric discrimination held at 1.0
([evals/reports/2026-08-03-v05-gate.md](evals/reports/2026-08-03-v05-gate.md)),
which shows the fences did not degrade judging — it was never evidence that
they stop anything.

### 3.4 Carve file ownership, not features, to run tracks in parallel

Parallel agents do not fail on merge conflicts. They fail when two tracks hold
different beliefs about the same file. Cut the work so that cannot happen.

- **Make the unit of a track an exclusive file list, not a feature.** If two
  candidate tracks want the same file, they are one track, or the cut is
  wrong.
- **Land shared-file changes first, alone.** Schemas, config, shared clients,
  pricing constants — change them once in a preceding standalone commit that
  every track builds on, then never touch them in parallel work.
- **One worktree and one branch per track. Tracks never merge and never
  push.** Integration is one owner's job, in a fixed cherry-pick order.
- **Re-run the full gate on the merged tree, and re-run the previous tag
  before blaming the merge.** Per-track green is not combined green. When the
  v0.2 merged tree failed rubric discrimination at 0.667 twice, a control
  probe on the v0.1.0 checkout passed in the same window — which replaced "our
  merge regressed the judge" with the finding that was actually true: an N=3
  gate flickering on a boundary triplet
  ([evals/reports/2026-08-01-v02-gate.md](evals/reports/2026-08-01-v02-gate.md)).
- **Check commit identity at every integration.** Delegating to an external
  CLI executor cost four separate authorship contaminations across this build,
  each caught and corrected at cherry-pick; that correction is the only reason
  the public history reads as a single author.

The contract the tracks work under is public rather than folklore:
[CLAUDE.md](CLAUDE.md) for how a release is built, [AGENTS.md](AGENTS.md) for
the worktree, branch and no-push rules the delegated executor obeys.

---

## Chapter 4 — Making a rule stick, and reviewing the review

These come from a design pass that restyled every screen, and from the two
rounds of adversarial review that followed it. At v0.5, where both rounds were
counted the same way, the second round found more in the first round's fixes
than the first round had found in the original work — ten regressions against
eight failing rules. That is the single most useful thing in this chapter.

### 4.1 A rule holds exactly as far as CI fails on it

A house rule was shipped in v0.6: every screen consumes the shared token
module rather than naming colours itself. Eight files had a scan behind it —
the landing components, walked by a `readdirSync` over that one directory —
and all eight came out with zero raw colour literals, so the rule held exactly
where it was enforced. The other hundred and eight non-test source files had
no scan at all, and forty-five of them had accumulated about six hundred raw
colour utilities — counted with the same property and palette vocabulary the
tree-wide gate now uses, so the figure can be reproduced rather than taken.

Read those figures carefully, because the first version of this paragraph
paired "seven" with "forty-three" and invited the second to be read as the
remainder of the first. It is not the remainder. The unscanned population was
a hundred and eight; forty-five is the count of files found *carrying*
literals. Stated as a complement it makes the tree sound small enough for the
gap to look like an oversight. It was most of the product.

That is the whole finding, and the correction is not "write the rule down more
firmly".

- **Make the gate the deliverable.** If a rule matters, the artifact you ship
  is the check, not the paragraph. The paragraph is documentation of the
  check.
- **Scope the check to the whole tree on day one.** A scan that covers the
  files you happened to be editing will be quoted later as covering the
  product.
- **Exemptions are a named list with a reason each, never a loosened
  pattern.** And **apply each exemption to the rule it argues for, not to the
  file that needs it.** One file here had a real reason to carry raw colour —
  its social-card image is rendered before the stylesheet exists, so a token
  there would draw nothing — and the exemption was implemented by dropping
  the file from the scan's file list. That reason covers three colour rules.
  Removing the file from the list dropped it out of every other rule in the
  suite as well, including the one covering the alt text screen readers speak
  and link previews unfurl, where an em-dash then passed silently. Filter
  inside the rule, never on the way into it.

### 4.2 Verify a gate by breaking it, with a spelling you did not have in mind

Every check in this repo now has to fail on demand: make the defect it exists
to catch, run the suite, watch it fail, revert. That discipline was in place
for the design batch, and it still shipped nine broken gates — nine is the
number the repair commit enumerates; a later recount says eleven, and
[RETRO.md](RETRO.md) records why this repo cannot settle which and declines to
pick. They broke because **the injection used to verify a regex is written by
the person who just wrote the regex.** Six of them shared that cause, and
those six are enumerated here because each one is reproducible:

| The check | Passed on |
| --- | --- |
| "no horizontal hero" banned `flex-row` | `flex`, which is already a row |
| "no gradients" required `-to-<side>` | `bg-radial`, `bg-conic`, `bg-[image:linear-gradient(...)]` |
| "no black shadow" matched `rgb(0 0 0)` | `rgba(0, 0, 0, .05)` |
| "no raw palette" required a numeric shade | `bg-white`, `text-black` |
| "no hard-coded colour" looked inside Tailwind brackets | `style={{ color: "#8b5cf6" }}` |
| opacity audit matched `prop-token/NN` | `border-b-ink/20`, `text-ink/[0.35]` |

So: **write the injection as the adversary, not as the author.** Ask what else
would satisfy the sentence the check is enforcing, and try that instead of the
example you had in mind. Better, have someone else write it — every row above
came from a reviewer whose brief was to break the check, not to confirm it.

Two structural rules fell out of the same review.

**Do not let a check's own escape hatch be self-certifying.** An
opacity-contrast table let each entry declare the bar it had to clear; every
entry declared "none", so the test named "computes every opacity modifier"
computed nothing, and a control label at 2.52:1 passed with a plausible note
attached. Entries now declare what the thing *is* — text, a control boundary,
a background — the bar is derived from that, and the declaration is checked
against the utility's own prefix.

**A suite's shared preprocessing step is a single point of failure across
every rule downstream of it, and it fails by deleting evidence rather than by
erroring.** This one was worse than any regex in the table above and it is
not a regex problem. The scans here read a file with its comments blanked
first, so a module that documents the pattern it forbids does not fail its
own documentation — reasonable, and it ran before all seven rules. The
blanker fired on any `//` not preceded by a colon, *including inside a
string*, and blanked the rest of that line. A reviewer put one `<div>`
carrying a template-literal `//status` into a screen, along with a raw
palette class, a `dark:` variant, a px font size and an em-dash. Ninety-five
characters of live code were erased before any rule saw them, four rules went
with it, and the suite stayed green. An unterminated `/*` inside a string was
worse still: the blanking ran to the next `*/` anywhere in the file.

- **Count the shared step as a rule and attack it like one.** A rule that
  fails wrongly gets read and fixed. A preprocessing step that fails wrongly
  reports nothing at all, and every rule behind it inherits the hole.
- **Prefer a preprocessor that can only be too conservative.** The
  replacement blanks only lines that *begin* with a comment marker, which
  cannot remove code, because a line starting with a marker has none. The
  trade is that a trailing comment after code is no longer blanked, so a rule
  can now fail on a comment. That is the right direction: a false failure
  gets read, a silent bypass does not.
- **Test the preprocessor directly, on a string that looks like a comment.**
  Not through the rules — they are exactly what cannot see it. Not done here:
  the replacement is argued safe in the function's own header rather than
  pinned by a test of its own, which is weaker, and it is the gap this suite
  still has.

### 4.3 Review the fixes, not just the work

Run the review twice. The second round reads the **fixed** tree, with
different reviewers, under one brief: *the fixes are the suspect.*

The evidence for this is now two releases deep:

| | Round 1 found | Round 2 found in Round 1's fixes |
| --- | --- | --- |
| v0.5 release audit | 8 rules failing | **10 regressions the fixes introduced** |
| F-21 design pass | not recorded | **41 findings, 7 HIGH** |

Only the first row is a comparison. Round 1 of the design pass was run as five
parallel reviewers and its findings were fixed as they arrived; the count was
never written down, so the ratio that would make the strongest version of this
argument cannot be reconstructed. That is a small lesson of its own — **record
the count each round returns, at the time, or the comparison you will want
later is not available** — and it is why the cell says so rather than
borrowing the reviewer count to fill the gap.

Why it works: a fix is written fast, by the person who was just proven wrong,
under the impression that the problem is now understood. That is the worst
possible state to write in and nobody notices from the inside.

Practical shape:

- **One reviewer per dimension, in parallel, each with a written brief naming
  what is most likely wrong in their area.** Not a generic checklist.
- **"A suspicion that cannot be demonstrated is not a finding."** Put that
  sentence in the brief. It converts a list of worries into a list of
  reproductions with commands and output attached.
- **Ask for the negative result too** — which checks they attacked and could
  not break. A gate that survived a real attempt is information; silence about
  it is not.
- **Round 2 reviewers must be different agents**, and must be told the tree
  they are reading has already been fixed once.

### 4.4 Check the built artifact, not only the source

A page shipped reading `"an overall of 4.0single dimension below 3.0"`. The
source was correct. The unit test printed the correct string. 1,740 tests
passed. The production bundler was constant-folding a module-scope string that
had been assembled by `+`-concatenating template literals, and folding dropped
the literal text following the last interpolation of each part. A second
instance corrupted a screen-reader sentence to `"4.0 out of 5with no dimension
below 3.0"`.

**No source-reading test can see this.** It was found by opening the deployed
page and reading it.

- **Assemble user-visible strings as one template literal**, never a `+` chain
  with interpolations in it. There is no reason to prefer the chain and it is
  a live hazard.
- **Add one gate that greps the build output for canonical sentences.** Pick
  fragments that start immediately after an interpolation, because that is
  exactly the text this class of bug removes.
- **A gate whose precondition is missing must fail, not skip.** This one can
  only read a build that exists. If the check answers "no build here" by
  returning early, the runner counts it green and the suite reports the same
  number of passes it reports when the build was there and clean — a skip is
  indistinguishable from a pass at the only place anyone looks, and "copy
  verified" then gets read as "built copy verified". Make the absent
  precondition the failure, with a message naming what to run.
- **Write the order into the contract, not into the test's header comment.**
  `build` then `test`: the source half of this gate is a lint, the built half
  is the only check that sees what a reader gets, and the built half has
  nothing to read until the bundler has run. Reverse the order and the gate
  still passes — that is the whole problem with it. A sequence that only one
  file knows about is one refactor of the CI script away from silently
  inverting, and nothing will report when it does.

Worth being concrete about what "the source was correct" means, because it
is the part that generalizes past this one bundler. A source-reading gate
sees what a module *says*. Everything between that and the reader is
invisible to it: constant folding, minification, dead-code elimination,
string joining, transpilation, environment substitution. The class is not
"bundler bugs" — it is any transform that runs after the last test reads the
file. So the built artifact needs its own gate, and the moment that gate
becomes conditional on something the pipeline might not have done, it is
back to reading the source.

Here that residual risk is real rather than theoretical, and stating it is
cheaper than implying it away: `apps/web/tests/built-copy.test.ts` warns on a
missing build instead of failing, so on a clean checkout its six canonical
assertions return early and its presence check degenerates into a tautology.
Six green tests, nothing verified. That is the weaker of the two designs
above, and it is exactly why the build-then-test order has to be a written
contract rather than a habit.

### 4.5 Prove the probe works before you trust a negative

A reviewer reported that readers with Reduce Motion enabled were getting a
blank page. The first check against it was `curl`ing the running server for
the offending inline style and finding none — which looked like a refuted
finding. The server had died minutes earlier. **Zero results from a dead
process are indistinguishable from zero results from a clean one**, and "I
verified it" was one sentence from being written about a real defect.

- **A negative result needs a positive control.** Before believing "the string
  is not there", confirm the probe finds a string you know *is* there.
- The finding was real: entry motion ships its hidden state in the server
  HTML, the reduced-motion branch rendered an element that never overrode it,
  and React does not remove server-rendered attributes the client did not
  re-declare. Nine blocks stayed invisible forever.
- **Render the accessibility path in a test, or gate it in CSS where rendering
  cannot betray you.** The test covering that branch passed throughout,
  because it regex-matched the component's source. The fix is a CSS backstop
  that does not depend on the client running at all.

### 4.6 Two traps in scaling type and layout to the reader

**A percentage that multiplies the reader's setting compounds. Floor it.**
`html { font-size: 87.5% }` was chosen so the scale respects a reader who has
enlarged their browser text, which is right. On a browser whose default is
14px rather than the assumed 16px it produced an 11.48px body against a 13.1px
target and a 784px reading column against 896px — so every screenshot the
design was reviewed from was 12.5% smaller than the thing being designed, and
the page kept reading as "too narrow" no matter how much the containers were
widened. `clamp(14px, 87.5%, 20px)` keeps the multiplication and removes the
compounding.

**A screen that bypasses the layout shell will be missed by the layout pass.**
Nine screens here render without the app chrome — the interview room, the
loading skeletons, the error and not-found pages, the capability-link pages —
and every one of them hand-rolled its page column. When the shell's widths
moved, they did not. The interview room opened in a 588px column while the
rest of the product read at 896px, and a report skeleton jumped 308px wider
the moment content arrived. **Export the page column as a token, have the
shell consume it too, and gate `<main>` against hand-rolled widths.** Scope
that gate to `<main>`: a centred narrow block inside a page is ordinary
layout, a page column is the thing there are exactly two of.

### 4.7 Delete what nothing renders

Four things came out of this codebase during review, on one shared reason: a
token or component nothing renders is **a claim the design makes that no
screen has to keep**.

- Two link tokens that differed only in an underline colour neither reader
  could see (1.23:1 and 1.61:1), one of which rested a link's whole affordance
  on a token the stylesheet itself declares decorative and deliberately under
  3:1. Collapsed to one.
- An elevation token and its card, written for "the few things that genuinely
  lift". Nothing lifted.
- A framed-screenshot component, its gallery, and four captioned slots —
  imported by nothing, with a placeholder promising captures "after the design
  pass" that had already happened.
- A client component whose own comment claimed four call sites and had zero.

The tell is always the same: **a comment describing consumers that do not
exist.** Grep for the symbol before you trust the sentence above it.

### 4.8 A scan of computed styles tells you how, not what

The design brief named a reference site. Scanning its computed styles for
`radial-gradient` returned nothing, from which this project concluded the
reference had no background field and reduced its own pastel language to a
single nearly-invisible wash. The reference's hero carries a large soft pink
cloud; it is drawn as an image, so a gradient scan could never see it. The
user's report was "why did all the pastel elements disappear".

**Look at the thing.** Automated inspection tells you how something is
implemented. It does not tell you what it looks like, and for a visual brief
that is the only question.

---

## Chapter 5 — Operating a pipeline you are not watching

The problem: the product now runs jobs nobody is sitting in front of, and the
test of that release is whether the operator can be away for a week. A
transient provider failure, a half-finished deletion and a metrics report
written by whoever happened to run it are one class of problem — something
goes wrong or goes unstated while nobody is looking, and the system has no way
to say so. Three patterns, in the order they cost the most.

### 5.1 Enumerate by discovery, then pin the cardinality

An audit here found retry backoff on exactly one of the pipeline's model
calls. The one without it that mattered was transcription — the most
expensive call in the product, and the only one whose input cannot be
recreated, because the twenty-minute interview it reads happened once. A
single 503 threw a customer's recording away.

The fix that does not hold is a test listing the call sites and asserting each
is wrapped. It cannot fail for a call added in a file nobody thought to list,
which is the exact way the gap appeared in the first place.

- **Discover the population; never write it down.** Walk the tree, parse each
  module, and fail on any unguarded call you find. The check's input is the
  repository, not an inventory someone maintains by hand.
- **Exempt by allowlist with a reason each, and keep it to a couple of
  entries.** Two here: the client wrapper that *is* the call being retried,
  and an offline eval harness that is not on a customer's path. Both reasons
  are about the entire module, which is what makes a module-level exemption
  the right shape — the opposite of 4.1's failure, where a reason about
  colour was cashed in as removal from every rule.
- **Then pin the count, so growth has to be noticed.** A discovery walk
  passes happily on a tree where a call site has vanished into a helper it
  classifies differently. Asserting the population is exactly eleven — nine
  generation calls and two file uploads — turns drift in either direction
  into a failing test that says which way it moved.
- **Count the unit you actually mean.** The audit said seven call sites; the
  discovery walk found eleven. Both were looking at the same code. The audit
  had counted *modules*, and four of the seven modules make two model calls
  each. The error was the unit, not the diligence — and the unit is what the
  gate is built out of.
- **"It imports the retry helper" is not evidence that it recovers.** Pair
  the structural walk with a behavioural test per site that drives the real
  function against a scripted transient failure and asserts the call was
  actually made twice.

Implementation:
`services/scorer/tests/test_llm_retry_coverage.py` — the AST walk, the
two-entry exemption list, the pinned total, and one behavioural test per
site; the retry itself is `services/scorer/src/scorer/resilience.py`.

### 5.2 Order an irreversible operation so that a failure removes nothing

Self-serve account deletion spans two stores that cannot be committed
together: object storage holds the recordings, the database holds the rows.
There is no transaction across them, so the only thing you control is the
order, and the order decides what a partial failure leaves behind.

- **Delete the blobs first, and abort the whole run if any of them will not
  go.** The rows are the only index to the bucket. Rows first, then a failed
  object removal, leaves recordings nobody can locate again — a privacy
  promise broken silently, discoverable by no one, fixable only by a
  bucket-wide audit. Blobs first, then the same failure, leaves the account
  completely intact.
- **Choose the ordering whose failure state is a state the user is already
  in.** "Nothing was deleted, try again" is a sentence you can say to
  someone. "Some of it went" is not, and there is no page you can build that
  makes it one.
- **Make both halves idempotent, because that is what makes the retry safe.**
  An object or row already gone counts as done, not as an error. The plan is
  recomputed identically on the second attempt and converges.
- **Do not remove the user's way back in until the work is done.** The
  deletion runs before the auth record is removed, so a customer whose run
  failed can still sign in and retry rather than being stranded outside a
  half-deleted account.
- **Report what you can prove, not what you attempted.** The row index is
  incomplete by construction — a browser can upload a recording and never
  reach the call that writes its key — so the plan also derives the key each
  session would have used and sweeps it. Those swept keys are deliberately
  *not* counted in the outcome: a key that may never have held anything is
  not a recording you can claim to have deleted. Likewise the count is
  objects confirmed absent, not objects this call removed, because the
  storage API cannot tell those apart and inventing the distinction would be
  a number nobody measured.

Implementation: `services/scorer/src/scorer/api/deletion.py`, one module
called by both the self-serve endpoint and the operator CLI so the two can
never drift about what "delete my account" means; rationale in
[DECISIONS.md](DECISIONS.md) #025.

### 5.3 Put the honesty rules in the generator, not in the person running it

A metrics report is written under exactly the conditions that produce
flattering numbers: by the person who wants them to be good, at the moment
they are needed, from data only they have seen. A standing rule that the
report must state its sample size is worth very little at that moment.

- **Generate the caveat from the data.** A sample drawn from a single
  account prints a "these are self-test numbers, not customer usage" banner
  because the account count is one, not because whoever ran it remembered to
  type it. A rule that can be forgotten will be.
- **Print every rate with the counts behind it.** "80% completion" and "4 of
  5 sessions" are the same measurement, and only one of them can be quoted
  out of context.
- **Lead with the number that sets the reader's expectations**, which is
  distinct accounts, not sessions.
- **A metric you do not instrument prints "not instrumented".** Never a dash,
  never a blank cell — a dash is an invitation to assume the number was fine.
  Give the report a standing "what these numbers do not say" section, so the
  reason has a place to live instead of being left to the reader.

Implementation: `services/scorer/tools/usage_report.py`, an operator tool
that reads the usage endpoint and renders a dated markdown report into
`docs/metrics/` — committed with its provenance, the same way eval reports
are.

---

## Appendix — ship-status snapshot (record, not a pattern)

A column per audit, never a column overwritten. The v0.5 audit forced the
second one; this batch's audit forced the third, because a row that says
"no detection" was true when it was written and had stopped being true by the
time anyone read it again. Three rows that v0.1 labeled "planned (v0.2)" are
still open three releases later; they are re-labeled rather than deleted,
because quietly dropping your own promises is the failure mode this appendix
exists to catch.

| | At v0.1 (2026-07-26) | At v0.5 (2026-08-03) | At v0.6 + the design pass (2026-08-04) |
| --- | --- | --- | --- |
| Grounded sweep + cited BARS compile + validation gate | shipped | shipped | shipped |
| Golden-triplet L1 gate with human blind-rank calibration | shipped (N=3 triplets) | shipped, still N=3 | still N=3 |
| DSP + audio-judge dual layer with conflict flagging | shipped | shipped | shipped |
| L3 controlled-triplet gate | shipped (2 triplets; DSP separability recorded, not yet baselined) | unchanged — judge accuracy gated, DSP separability still not baselined | unchanged — still 2 triplets, separability still not baselined |
| Few-shot correction as a recurring flywheel | planned (v0.2 — mechanism shipped, loop manual) | **not shipped**; loop still manual, and no longer scheduled | **not shipped**; unchanged |
| Durable publisher citation URLs (resolve grounding redirects) | planned (v0.2) | **not shipped** | **not shipped**; the sweep still stores the grounding redirect verbatim |
| Larger eval N, per-trial score recording for passing trials | planned (v0.2) | **not shipped**; failing trials record their scores, passing trials still do not | **not shipped**; unchanged |
| Scoring-eligibility gate ahead of judge spend (3.2) | — | shipped v0.5; unit-tested, no eval-gate coverage | unchanged — still no eval-gate coverage |
| Delimiter fencing + hidden-text strip (3.3) | — | shipped v0.5; fencing only, no detection, no adversarial suite | detection shipped v0.6 — refusal classifier at intake, gated by `evals/suites/injection/` against two baselines |
| Payment webhook verified by a real production delivery (3.1) | — | verified 2026-08-03 on one real order — the owner's own, refunded | unchanged; still no external customer |
