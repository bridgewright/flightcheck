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
(`services/scorer/src/scorer/delivery/judge.py`). Counted honestly, though:
this one is a near-miss, not a failure — nothing was built and nothing was
thrown away — and a retro that files its saves next to its scars is grading
itself generously.

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

## 2026-08-01 — Three v0.2 lessons: the trigger, the flicker, and the numbering

**"Speak first" cannot be instructed — it must be triggered.** We shipped an
opening script ("greet the candidate the moment the call connects") purely as
system instructions, with text-assertion tests proving the words were in the
prompt. The first real test session got a minute of mutual silence: server-VAD
realtime models generate nothing until audio arrives or a `response.create`
event is sent, so the model held a perfect opening script it was never asked
to perform. The fix is one client-side nudge at data-channel open. The lesson
generalizes: unit tests on instruction text verify what the model is *told*,
not what the runtime lets it *do* — every instruction-shaped behavior needs
one live confirmation of the mechanism that lets the behavior begin.

**The eval gate flickered, and the flicker was the finding.** The v0.2 merged
tree failed rubric discrimination twice (a borderline answer saturating to
5.0 — the exact mode the v0.1 judge redesign fixed), then passed with no code
change; an untouched v0.1.0 checkout passed in the same window. We nearly
mis-attributed it to our own merge. The control-probe habit (re-run the old
code before blaming the new) is what separated "regression" from "N=3 gate
fragility on a boundary triplet". Consequences: the golden set grows (E1
pulled forward), passing-trial margins get recorded so flicker is visible
before it fails a gate, and gate reports now publish failing runs — a gate
that only records its passes teaches nothing.

**Structure leaks into speech.** The interviewer read its numbered question
list aloud ("Question 1…") and recited JD topics when asked to preview
coverage — instructions written for the model's *planning* were performed as
*script*. Realtime instructions need an explicit boundary between what is for
the model's eyes ("the numbering is for you alone") and what is meant to be
said. AI-feel is mostly this: internal scaffolding escaping into the
conversation.

## 2026-08-01 — The silence clock's first night: five fixes and one physics rule

The silence machinery merged green (three parallel tracks, 90+ unit tests, a
measured VAD bake-off) and then needed **five fixes in one evening** of live
sessions. Worth recording honestly, because each fix was exposed by the
previous fix working:

1. Dual-sourcing the transport signals revealed the echo chain (the
   interviewer answering its own speaker-leaked audio, previously masked by
   an inert clock). 2. The first echo guard (a duration heuristic) survived
   earphone testing and failed on open speakers the same hour. 3. The
   physics-based rule that replaced it exposed phantom commits from room
   noise. 4. Raising the VAD threshold made sessions quiet enough to *hear*
   the last bug: server-side interruption truncating the interviewer's first
   words — tripped by the same echo.

**Lesson 1 — distributed-timing bugs relocate; they don't disappear.** The
conversation clock spans three deciders (server VAD, client reducer, model
judgment) across two transports. What broke the blind fix-test cycle was
instrumentation, not cleverness: a permanent structured diagnostic line and a
**silent-room null test** — in a silent room the only legal output is the
greeting plus the 8/15/30 s scaffolds, so any other event in the log is a
bug, no ears required. Every one of the five fixes was diagnosed from logs
before being believed.

**Lesson 2 — both audio environments are first-class.** The echo chain
shipped twice because verification happened wearing earphones. Customers run
sessions on open laptop speakers; "wear headphones" is not a fix, it's the
product failing its own bar. The durable engineering rule turned out to be
physics, not tuning: **an echo dies with its source** — input that starts
during interviewer audio must outlive that audio to count as speech. This is
now a standing design constraint: every conversational-timing feature is
designed and verified for speakers and headsets both.

**Lesson 3 — probe transport ≠ production transport.** The VAD bake-off ran
over WebSocket with synthesized speech tapes; production runs WebRTC. The
architectural conclusion transferred, but two production-only behaviors
(`output_audio_buffer.*` lifecycle events and server-side interruption
chopping onset audio) only appeared live. Timing-sensitive decisions get a
production-transport confirmation pass from now on.

**Left deliberately unfixed — corrected 2026-08-03.** This entry originally
closed by deferring background-tab timer throttling (queued silence ticks
machine-gunning scaffolds on refocus) to "the adversarial stability harness
(next release)", on the argument that a sixth blind patch would repeat the
cycle above. The argument held. The forecast did not. The harness landed
**seven minutes after this paragraph was committed, and the bug was fixed
four minutes after that** — `a317eb9` at 23:09:04, `f258364` at 23:16:28,
`2b4ea38` at 23:20:52, the rest through 23:30 the same night. The throttling
bug went in as the harness's third pinned seed, and `2b4ea38` fixed it
test-first: a tick measuring absence rather than silence (`SUSPEND_GAP_S`,
2 s, read off a monotonic clock) is treated as a resume, so a candidate who
steps away and comes back is met quietly. The generated rounds also caught two
clock faults no user had reached — the response debounce measured from the
wrong instant, and one tick that could ask the interviewer to speak twice —
and writing the seed scenarios exposed a third, pure-layer hole on its own:
the scaffold ladder restarting on leaked speaker echo. The wrong
sentence then stood here for two days and over a hundred commits, in a file
whose whole claim is that it records what happened, while any reader could
disprove it with one `git log`. It is corrected in place rather than deleted:
"next release" in a retrospective is a forecast wearing the clothes of a
record, and this is the cleanest evidence of that we have. v0.2.0 had already
been tagged at 16:46 that afternoon, so both the claim and its refutation
ship inside v0.5.0.

## 2026-08-03 — Taking money: three failures only production could show

v0.5 is the payments release — hosted checkout, a signed webhook, a trial
that unlocks. All of it went through an adversarial review pass and the full
gate suite on the merged tree before it shipped. It then broke in three
places, every one of them only in production, and each break is a different
way of believing a green signal.

**A signature test signed by your own code proves only that you are
self-consistent.** Polar's webhooks follow Standard Webhooks, whose spec says
the secret is `whsec_` + base64-encoded key *bytes* — so we decoded it, and a
payload signed by our test helper verified against our verifier without a
complaint. In production every real `order.paid` delivery returned 403 and
provisioned nothing: Polar's own verifier feeds the secret **string** to the
HMAC and base64-wraps it only to satisfy the library that decodes it straight
back. `84e3434` now accepts a signature under any derivation of the *same*
secret (spec bytes, the full string, the part after the prefix), so a live
delivery matches while a tampered payload still matches nothing. The unit
test was careful and structurally incapable of catching this, because both
sides of it were ours. It is the 2026-07-26 fake-client lesson one layer
further out: fakes prove your logic, live calls prove the contract, and a
signature scheme is a contract with someone else's code. The test class that
would have caught it — a real delivery captured once and replayed as a
fixture — does not exist in this repo. Naming the gap is the honest state of
it; it is also cheap to build now that a real delivery has been seen.

**A health check proves something is alive at that address, not that it is
the thing you just built.** Railway's builder stopped supplying
`NIXPACKS_UV_VERSION`, so the worker image built `pip install uv==` — an
invalid requirement — and every deploy from 08:51 failed while the 08:50
image kept serving. `/healthz` was green, the platform dashboard was green,
and for four hours nothing we pushed was actually running (`53bed4d` pins the
version in `nixpacks.toml`). The habit that replaces the green check: after a
deploy, read the new deployment's own build status, and ask the service
something only the new build can answer. Liveness and identity are different
questions, and a platform's implicit variables are someone else's release
note.

**In a streaming framework, a guard that runs during render can change the
body but not the status line.** `/dev/preview` renders components from
checked-in fixtures and must not exist in production, so it called
`notFound()`. Statically prerendered, that ran at *build* time and the shell
went out with HTTP 200 — safe content, lying status (`b7065b9`). Forcing the
route dynamic moved the guard to request time, and it still answered 200,
because the app-level `loading.tsx` flushes a shell before any page guard can
set a status. Only a check in `proxy.ts`, which runs before render, made
production return a real 404 (`4439313`). The general form: existence and
authorization checks belong before the first byte, not inside the render that
produces it. Neither failure mode is reachable in local development, where
nothing is prerendered — the only instrument that sees this is a request
against production.

## 2026-08-03 — What was abandoned, and what delegation cost

**A visual identity, built end to end and reverted the same day.** The v0.4
screens shipped on a night/aviation skin: dark tokens and a gradient body
(`86dcc5c`), a landing page rebuilt around runway lights (`c66daaf`), a
conic-gradient readiness dial, and a session card drawn as a boarding pass
with a stub, a perforation and a barcode. The skin was dark-only, so
`globals.css` made Tailwind's `dark:` variant unconditional — the app stopped
honoring the reader's OS theme in order to hold one look. Seen rendered
together, the identity was put on hold the same day and three commits took
every screen back to plain neutrals (`75fab51`, `9f1f240`, `374f5ea`): the dial became a
stat block, the ticket a bordered card, the strip three dots. The cost was
thirteen files styled twice and a global `dark:` override that had to be
unwound. The part worth recording is what it did *not* cost: no route,
string, or behavior changed, because the revert brief forbade touching them
and confined the whole reversal to class strings and CSS tokens. The skin
never appeared in a tagged release. That containment was luck once and is
policy now — the identity returns as one dedicated design pass rather than as
a skin threaded through feature work. One carry-forward is worth more than
the skin was: Tailwind v4 silently drops unknown utilities instead of failing
the build, so a green build is not evidence that a restyle is complete. Grep
for dead tokens.

**A price, and the package shape under it.** From the product definition
onward one JD cost ₩89,000 for 30 days and six sessions; it was in `PRD.md`,
on the pricing page, and on a v0.4 checkout stub that never took a payment.
v0.5 retired it for **$49 USD**, and changed the package shape at the same
time: the first package on an account is a trial with one scored session, and
$49 unlocks that same package — same JD, same rubric — to six sessions with
a 30-day window that starts at payment (DECISIONS 018/019; constants in
`apps/web/lib/pricing.ts`, with a test pinning them). Two things triggered the
reversal. DECISIONS 008 had rejected a free tier on the ground that free usage does not
validate willingness to pay and anchors the perceived price at zero, back when
there were no accounts; once quotas, rate limits, and per-account
caps were enforced worker-side, one free scored session became the cheapest
honest demonstration of the only thing this product sells — a verdict. And a
won-denominated price fits badly on a product whose entire audience is
applying to companies that think in dollars. The honest note on the reversal:
the second reason needed none of the nine days it took, and the first only
needed the accounts to exist — neither was waiting on evidence we did not
already have.

**Delegation is cheaper than doing the work yourself, and it is not free.**
Most of this repo is built by dispatching self-contained briefs to parallel
agent sessions, one worktree and branch each, with a human integrating. It
works, and the bookkeeping tax is real: the delegated CLI executor set the
wrong commit identity on its own branch **four separate times**, caught and
corrected at cherry-pick each time. The public history shows a single author
on every commit only because that check ran every time — it is normalization,
not evidence of solo work, which is why `CLAUDE.md` now says so outright. Two
lessons, one general and one specific. Automate the check you catch yourself
doing by hand more than twice; this one is still a manual line on the merge
checklist, which is exactly why it had to be run a fourth time. And when
you delegate, own the metadata as deliberately as the diff — a work-sample
repository whose commit trail is inconsistent about who wrote it is worth
less than one with fewer commits.

## 2026-08-04 — The design pass, and eleven things that were true on paper

A one-batch restyle that turned into a two-round adversarial review. What
follows is mostly about the controller's own work, because that is where the
review found the most.

**The batch closed a gate it had not built.** The design system's whole
premise was that a house rule only holds as far as CI enforces it: v0.6 had
run "every track consumes the token module" and it held for the seven landing
files that had a scan and failed for the forty-three that did not, which
accumulated about six hundred raw colour literals. So F-21's spec said "leave
a gate behind", `lib/ui.ts` recorded that the fix was "widening the gate, not
restating the rule", and the test file opened with "the rule is whatever CI
fails on". All three were false. Both scans read `lib/ui.ts` alone. A reviewer
proved it by adding `text-red-600 dark:text-red-300` to a signed-in screen and
watching the full suite stay green. The lesson is not about scans: **the batch
wrote down that it had solved the exact problem it was repeating**, and the
sentence was persuasive enough that nobody re-read it against the code for a
day.

**Round two found twenty-six defects in round one's fixes.** This is the
second time that has happened — v0.5's fix batch introduced ten regressions
that only a second pass caught — so it is no longer a surprise, it is a
property. Nine of the twenty-six were in gates written the day before, and six
of those nine shared one cause: **a regex written against the single spelling
its author had just been looking at.** The hero rule banned `flex-row` while
`flex` on its own is already a row. The gradient rule demanded a `-to-<side>`
suffix that Tailwind's radial and conic forms never take. The black-shadow
check knew `rgb(0 0 0)` and not `rgba(0, 0, 0)`. Each one was verified "by
injection" when it was written, and each injection used the spelling the
author had in mind.

The worst of them was not a rule but the thing all six ran through: a comment
blanker that fired on any `//` not preceded by a colon, **including inside a
string**, and blanked the rest of that line. One `<div>` carrying a
template-literal `//status` erased ninety-five characters of live code and
took four rules with it, silently.

**The accessibility accommodation was the thing that broke the page.** Entry
motion ships its hidden state in the server HTML, because the server cannot
know the reader's motion preference before hydration. The client's
reduced-motion branch returned a plain `<div>` with no style, and React does
not remove server-rendered attributes the client did not re-declare. So a
visitor with Reduce Motion enabled got the top bar, the cloud, the footer, and
**nine invisible blocks** where the page was. The only backstop covered
JavaScript being disabled, which is a different reader. The test for the
reduce branch passed throughout, because it regex-matches the component's
source instead of rendering it.

Worth recording how close this came to being dismissed: the finding arrived
from a reviewer working in jsdom, and the first check against it was `curl`ing
the production server for `opacity:0` and finding none. The server had died
minutes earlier. Zero results from a dead process reads exactly like zero
results from a clean one, and "I verified it" was one sentence away from being
written. The rule that saved it was the boring one — look at the output, not
the exit path.

**The bundler was deleting words out of shipped sentences.** `/rubric` read
"an overall of 4.0single dimension below 3.0". The source was correct, the
test printed the correct string, and 1,740 tests passed. The corruption is
created at build time: a module-scope constant string, `+`-concatenated from
template literals whose interpolations are all compile-time values, gets
constant-folded, and folding the chain drops the literal text following the
last interpolation of each part. A second instance had corrupted the readiness
gauge's screen-reader sentence to "4.0 out of 5with no dimension below 3.0" —
what a blind reader was being told the bar is.

**No test in this repository could have caught that**, because every test
reads source and the defect exists only in the bundle. It was found by opening
the deployed site and reading it. The gate that now exists reads
`.next/server`, and when there is no build it says so out loud rather than
passing quietly.

**The design was being judged 12.5% smaller than it was drawn.** The root was
`font-size: 87.5%`, chosen so the scale multiplies the reader's own browser
setting instead of overriding it. That instinct is right and the implementation
compounds: measured in a real browser whose default is 14px rather than the
assumed 16px, the product rendered an 11.48px body against a 13.1px target and
a 784px reading column against 896px. Every screenshot the design was reviewed
from was smaller than the thing being designed, which is most of why it kept
reading as "too narrow" no matter how much the containers were widened. Now
`clamp(14px, 87.5%, 20px)`: still a multiple of the reader's setting, floored
at the size the design was measured for.

**A scan of computed styles tells you how something is implemented, not what
it looks like.** The reference's hero carries a large soft pink cloud. Scanning
its computed styles for `radial-gradient` returned nothing, from which this
batch concluded it had no background field and reduced the product's whole
pastel language to one nearly-invisible wash. The cloud is drawn as an image.
The user's report was "why did all the pastel elements disappear", and the
check that would have caught it was looking at the page.

**Three renders of nothing, with a clean 200 and no console error.** The
replacement cloud is an SVG. It served, the browser fetched it twice, and zero
pixels appeared. The cause was a comment inside the file documenting the
`--color-bloom` token by name: **a double hyphen inside an XML comment is a
parse error**, and the browser fails it silently. What separated "the container
is wrong" from "the image is wrong" was painting the same box solid red.

**The README advertised a product that no longer existed.** The demo GIF at the
top showed a dark interface (the deployed build rendered dark on a dark-mode
machine, through `dark:` variants this batch removed), a verdict drawn as an
amber warning badge the design system now forbids by name, and no sign of why
4.27 out of 5 reads as "Approaching" — which is the exact confusion this batch
built a two-track gauge to answer. It was four days stale across three
releases, and its own caption promised a re-record "when the visual pass
lands".

**`/faq` was published to crawlers and reachable by nobody.** The objections
block moved off the landing to its own route, which was added to
`PUBLIC_ROUTES`, so `sitemap.ts` published it and `robots.ts` allowed it. No
link was ever built. Two separate files described the click. A customer
deciding whether to spend $49 could not read the refund answer; Google could.

**What was abandoned.** `QUIET_LINK` and `LINK` turned out to differ only in a
decoration neither reader could see (1.23:1 and 1.61:1), and the quiet one
rested a link's entire affordance on the token the stylesheet declares
decorative and deliberately under 3:1 — so they collapsed into one.
`CARD_RAISED` and `--shadow-raise` existed for "cards that genuinely lift" and
nothing ever lifted. `ScreenFrame`, `Showcase` and their four captioned
screenshot slots were imported by nothing, with a placeholder still promising
captures "after the design pass". `RevealGroup` was a complete client component
whose comment claimed four call sites and had zero. Each was deleted rather
than parked, on the same reasoning: **a token or component nothing renders is
a claim the design makes that no screen has to keep.**

**What is still not verified.** True phone rendering, because Chrome's minimum
window width blocked it. The signed-in session detail against real scored data,
because it needs a live session. `prefers-reduced-motion` toggled by hand in a
real browser — the blank page was demonstrated from the built server HTML and
React's documented hydration behaviour, and fixed with a CSS backstop that
depends on neither. And the in-session interview room, whose pre-connect state
is verified and whose live state costs a session slot and a realtime call to
see.

---

## 2026-08-03 — The ledger at the v0.5 tag

**One order exists, and it is ours.** v0.5 ships payments, and exactly one
$49 order has ever been placed: by the project owner, against the live
product, to prove the path end to end — hosted checkout, signed webhook,
provisioning, receipt — and then **self-refunded, with the receipt kept** as
the record. That order is evidence the pipeline works. It is not a sale, not
revenue, and not evidence that anybody wants this. As of this tag flightcheck
has **zero external users and zero external paying customers**; every session
that exists, including the one behind the public sample report, was run by
the developer. The distinction matters more here than anywhere else in this
file, because "first payment received" is precisely the sentence a portfolio
repo wants to write and precisely the sentence that would be false. The PRD
carries "paid packages ≥ 1" as a dated success metric, and as of v0.5 the
instrument that measures it exists — the `orders` table, with receipts in
settings. The only row in that table is ours. Counting it would be marking
our own homework.

**Code shipped ahead of the PRD, on the largest product change of the
release.** `CLAUDE.md`'s first non-negotiable is PRD before code. On
2026-08-03 the $49 price and the trial model landed in the code at `97ee0b4`
(14:43, the scorer's paid/trial/expiry columns) and `6308211` (14:48,
`lib/pricing.ts` plus the pricing and checkout pages), while `PRD.md` still
read ₩89,000 until `aa282c2` at 15:53 — code preceded the PRD by about 65
minutes on the one change that redefined what the product sells. The decision
itself predates both commits and its options-and-rejections trail is logged
(DECISIONS 018), so this is a sequencing failure rather than an undocumented
one; that is the smaller version of the sin and still the sin. It is recorded
here rather than tidied away, because the timestamps are in the log and a
reviewer will find them. A rule the work reliably breaks is either the wrong
rule or an unenforced one, and the honest response is to restate it at the
granularity the work actually has — current at the tag, with the tag as the
gate — not to quietly stop counting.

**The version numbers admit a reorder.** The published plan (README,
DECISIONS 008) was v0.3 report quality → v0.4 session history → v0.5
curriculum-lite → then payments. What happened instead: the v0.3 and v0.4
bundles — report quality, accounts, the complete signed-in webapp, session
history, progress — were built, merged, and deployed but **never tagged**,
and payments jumped the queue to become v0.5. Curriculum-lite has not shipped
and moves past this tag (v0.6+). Tags and release notes are impression rule
⑤, and we broke the rhythm for two versions by shipping faster than we
published. The correction is one tag, v0.5.0, with 0.3 and 0.4 named for what
they actually were — internal milestones folded into it — rather than a pair
of backdated tags invented at release time to make the history look tidy.

**A made-up example cost us a release cycle, because nobody reads the
author's mind.** `docs/deploy.md` carries a release-blocking anonymization
checklist that bars client references "including indirect identifiers". The
fixture behind `/sample-report` — the no-signup demo the README sends every
reviewer to — carried a detailed consulting engagement in the candidate's
answers: a diagnostic, a pilot, a percentage. The developer invented all of
it on the spot, the way anyone invents examples in a practice interview.
Nothing in it describes a real client, and no client information has ever
been in this repository.

None of that helped. It was phrased as client work, so it read as client
work — to two independent audits, one of which called it a release blocker,
and it would have read the same way to a reviewer. It was found by this
release's audit rather than by the checklist that existed to find it, and
reworded at `2ffd643` so it stops implying an engagement that never
happened. The lesson is not about confidentiality, which was never at risk;
it is that a public artifact is judged by how it reads and never by what its
author knows about it. The checklist item is now written that way.

That fix then produced the sharper failure. The post-mortem written into the
runbook recorded what the checklist had missed **by quoting the removed
strings back verbatim** — putting into the operator's manual exactly what had
just been taken out of the fixture. A note describing an incident is a
publication too. It now describes shapes instead of content, and says so as a
standing rule. One real cost survives the whole affair: the reworded quotes
are no longer verbatim transcript, which is the thing this product's evidence
is supposed to be. That is discharged the next time the fixture is captured
fresh, not by editing it further.

Two smaller ones came out of the same sweep: the favicon
was still create-next-app's default, byte-identical since scaffold — a
framework vendor's mark serving as the product's own on the tab of something
we were about to charge for — and `AGENTS.md` published an absolute local
path that disclosed the OS username and the existence of the private
workspace above this repo. A checklist nobody is required to run is a
document, not a control; the ones that hold here are the ones wired into a
gate.

**The gate that passed says less than it looks like it says.** The v0.5 eval
gate passed on its first run, exit 0, rubric discrimination 1.0 and delivery
judge 1.0 against unchanged 0.8 baselines
([report](evals/reports/2026-08-03-v05-gate.md)). N is 3 triplets at layer 1
and 2 clip triplets at layer 3, unchanged since v0.1, and one boundary case
still decides the gate. It exercises the content and delivery judges and
nothing else: the scoring-eligibility gate, report field quality, the package
and payment lifecycle, and prompt-injection resistance beyond unit-tested
fencing are all outside it, and the judge–human agreement (Cohen's κ) the PRD
names as a v1.0 target has no instrument built yet. A green gate on a
payments release is a statement about two judges. It is not a statement about
the release.
