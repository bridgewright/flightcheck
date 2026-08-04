# Changelog

## [Unreleased]

### Added

- **A "?" beside the LinkedIn upload that shows where the PDF comes from.**
  The one-line hint stays; the new trigger opens a speech-bubble walkthrough
  in three steps — a small animated mock of your profile page clicking
  "More", then "Save to PDF" in the menu that opens, then the file arriving
  where the upload is. Step counter, Back and Next, replay per step; outside
  click or Escape closes it; the form underneath never locks. The mock is
  drawn in the product's own palette and names LinkedIn's labels as text —
  no screenshots of another company's interface, which would sit in a public
  repository and go stale the next time that menu moves. Reduced motion gets
  the finished picture and the caption. DECISIONS 039.

- **Every surface that names a package now says which company.** The
  employer identity from the package card — favicon mark when the pasted JD
  URL is the employer's own site, company name always, nothing when the JD
  never named one — now follows the package everywhere: the top-bar switcher
  and its rows, /home, /sessions, /progress, /rubric, /checkout. Two
  packages for the same role stop being indistinguishable. One shared
  component decides; no surface re-derives the rule. DECISIONS 038.

### Fixed

- **The top-bar menus dismiss like menus.** Clicking anywhere else closes
  them; Escape closes and puts focus back on the trigger; opening one closes
  the other. They were native `details` elements, which only close from
  their own button. With JavaScript disabled they still toggle exactly as
  before. DECISIONS 038.

## [0.8.0] — 2026-08-04

### Changed

- **Sign-in is Google, and it is the only door.** The passwordless email link
  is gone: `signInWithOtp`, the email field, the sent state and the resend
  cooldown that existed to survive Supabase's OTP throttle. `/login` is one
  button. The email provider is disabled in the hosted project too, so the
  removal holds at the API and not only in the UI.

  Why: the email link made delivery of a message the entire auth surface, on a
  sender the product does not control and whose own documentation calls it
  rate-limited and best-effort — under a message that never said
  "flightcheck", carried "powered by Supabase", and offered to unsubscribe the
  reader from their own sign-in link. Google is the account these customers
  already have, and it arrives with the address verified. The cost, stated
  plainly: someone without a Google account cannot sign in at all.

  DECISIONS 036, which supersedes the passwordless half of 022. Existing
  accounts were not stranded — Supabase links a Google identity to a user
  whose email is confirmed, and the sign-in was walked on production to prove
  it landed on the account holding the existing package and order rather than
  on a new empty one.

### Added

- **A scored report leaves the product as a file.** Two controls on a session:
  **Download PDF** and **Download Markdown**. The PDF is a real file arriving
  in Downloads, not a print dialog: it is rendered server-side with
  `@react-pdf/renderer`, on white rather than the product's paper ground,
  because a report that is printed or attached is read on white. Both formats
  carry the same facts in the same order, including the limits note verbatim
  and every evidence quote unparaphrased.

  Nothing is stored: each file is generated when it is asked for and streamed,
  so the export adds no new place a customer's data lives and nothing extra to
  delete. The export is exactly as authorized as the page it comes from, and a
  capability link's export dies with the link.

- **A session that stopped reporting can be reclaimed by its owner** (F-47).
  The room beats every 15 seconds; a session silent for 60 seconds may be
  reclaimed from `/home` by the account that owns it, and the slot is not
  consumed. Before this, a customer whose tab died one minute in waited out the
  25-minute hard cut with no route back, because that cut was the only thing
  that released the one-live-session lock (DECISIONS 028). A session with no
  heartbeat on record behaves exactly as it did before, so nothing already
  running changes meaning. Migration `007_session_heartbeat.sql`.

### Removed

- **The change-sign-in-email form on `/settings`** (F-35, shipped in v0.6).
  The address belongs to the Google account now; a form here would have
  changed our row without changing anyone's credential.
- **`NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.** The flag existed because the provider
  was unconfigured. It is configured, and a sign-in button behind a flag is
  how a login screen ships with no way into it.

## [0.7.0] — 2026-08-04

**The F-21 design pass**, which restyled every screen and then spent two rounds
of adversarial review finding out what that had broken.

Tagged at the commit that was deployed on 2026-08-04, plus the fixes the
release audit required. See DECISIONS 032 for why a tag is being cut after the
fact at all, and what that is and is not allowed to mean.

### Changed

- **A landing page that says less, and then said less again.** The v0.6 rebuild
  had given it a four-step how-it-works, itemized pricing and an on-page FAQ
  accordion. The design pass cut it to four blocks: the framed product
  screenshots came out because they were placeholders promising captures
  "after the design pass" that had just happened, and the FAQ moved to `/faq`,
  which is one click rather than a policy PDF. What is left: the hero carries
  the claim, a line, and two buttons, and nothing beside it.
- **One design system, and it is enforced rather than described.** Every
  colour, type step, radius and shadow is declared once in `app/globals.css`
  and composed in `lib/ui.ts`; a test walks `app/`, `components/` and `lib/`
  and fails on a raw palette utility, an arbitrary colour, a pixel font size,
  a CSS gradient, a hand-rolled page column, or a dash in a sentence a reader
  sees. The previous version of this rule was written down, believed, and
  scanned exactly one directory — the eight components under
  `components/landing/`, which stayed clean while the rest of the product did
  not.
- **Light only.** The product had `dark:` variants throughout, so it rendered
  as a different product depending on the reader's operating system setting.
  It is now one product, and the variant is rebound to a class nothing sets.
- **The report says why a verdict is what it is.** The sample report shows an
  overall of 4.27 out of 5 next to the word "Approaching", which reads as a
  bug until you know the rule has two clauses. It now draws both: overall
  against the 4.0 Ready bar, and the weakest dimension against the 3.0 floor
  every dimension has to clear, with a sentence naming the one that decided
  it. The verdict is not a traffic light, deliberately — rendering "Not yet
  ready" in red would punish the reader this product exists for.
- **The judge's finding is marked in each rationale**, bold and underlined, so
  the point of a paragraph is findable without reading all of it. It is a
  positional rule (the first sentence) rather than a semantic one: the product
  does not decide which of a judge's words matter. The version where the judge
  marks its own span is registered as F-48.
- **Type scales with the reader again.** The root is `clamp(14px, 87.5%, 20px)`
  — a multiple of the reader's own browser text size, floored so a browser
  that ships a smaller default cannot compound it into a page nobody designed.

### Fixed

- **A blank page for readers with Reduce Motion enabled.** Entry motion ships
  its hidden state in the server HTML, and the reduced-motion branch returned
  an element that never overrode it, so nine blocks on the landing and two on
  `/faq` stayed at zero opacity forever. The accommodation built for that
  reader was what blanked the page for them.
- **Sentences with words missing.** `/rubric` read "an overall of
  4.0single dimension below 3.0", and the readiness gauge told screen readers
  "4.0 out of 5with no dimension below 3.0". The source was correct in both
  cases; the production bundler was folding module-scope strings apart. Now
  checked against the built output rather than the source.
- **`/faq` was reachable by search engines and by no visitor.** It is in the
  footer.
- **Loading skeletons stood in the wrong column**, so a report jumped 308px
  wider the moment content arrived — the reflow a skeleton exists to prevent.
- **The interview room opened in a 588px column** while the rest of the
  product reads at 896px, along
  with eight other screens that render without the app chrome and had been
  missed for the same reason.
- **Safari lost the order of the how-it-works steps.** The numerals were
  hidden from screen readers on the grounds that the list carried the order;
  on WebKit a list with no marker style does not.
- **Controls that were only visible while hovered.** The secondary button's
  label sat at 3.73:1 and its border at 1.99:1, and that border is the only
  thing identifying it as a control. Also the link underline, which was 1.23:1
  and is now the token that exists for a boundary you have to see.
- **A purchase button that promised the wrong thing.** "Unlock all 6 sessions
  for $49" appears only after the trial session is spent, so it is five.
- **The landing's search-result description still said "a live interviewer"**,
  a word the hero dropped on purpose because the interviewer is an AI.

### Decisions

- DECISIONS 031: the two client dependencies the design pass introduced, the
  boundary they are allowed to cross, and the condition that revisits them.
- DECISIONS 032: a tag is retroactive only where the release boundary is —
  written because cutting this tag and 0.6.0 after the fact contradicts, on its
  face, a rule this repo states in four places.
- DECISIONS 035: one design system, enforced by the test suite, and rebuilt
  mid-batch from the reference's measured values after the first pass was built
  from a prose description of it.

### Evals

Release gate: `uv run scorer-evals` from `services/scorer`, exit 0, on this
tree. **One run covers both 0.6.0 and 0.7.0**, and it is stated here rather
than left for two tags to imply two runs. Report:
`evals/reports/2026-08-04-v06-v07-gate.md`.

The honest part: neither batch had a gate run at the time it was deployed.
`evals/reports/` held nothing between `2026-08-03-v05-gate.md` and this one,
and both batches went to production in between. Nothing here can make a gate
have run at `da254e3` after the fact, and this note exists so that the two new
tags do not imply one did.

### Not shipped, and why

- **A re-recorded demo.** The design pass replaced the README's four-frame
  GIF with two stills of the running app, because the GIF showed a dark
  interface the product no longer has and a verdict styled as a warning badge
  the design system now forbids. A real screen recording needs a live
  twenty-minute session and waits for v1.0.
- **Screenshots of the product.** The four captioned slots the landing was
  holding were deleted rather than left promising captures "after the design
  pass" that had already happened. They need a component as well as a file
  when they return.
- **Data export, the IndexedDB upload stash, and per-user worker
  authorization** are still not built. They were carried as "v0.7" while v0.7
  was the future; it is now this release, and it does not contain them. They
  are not being re-pointed at another version here — a version number attached
  to unbuilt work three releases running is a promise the log has stopped
  keeping. `docs/architecture.md` and `docs/ops/backup-restore.md` carried the
  same "v0.7" promise and have been corrected the same way.

## [0.6.0] — 2026-08-03

**The v0.6 batch — "operate at scale".** The release where the operator can be
away for a week: users leave cleanly, links share correctly, and the pipeline
survives its own history rather than a customer discovering it did not.

Tagged at `da254e3`, the commit deployed on 2026-08-03. Its version manifests
read `0.5.0`: the tag sits on the commit that was actually deployed, and that
commit was not going to be edited to make a version string agree with a tag
applied afterwards (DECISIONS 032).

### Added — you can leave, and take nothing with you

- **Delete your account yourself, from settings.** It removes every
  recording, transcript, report, package and order, and it is immediate.
  Recordings go before database rows, and a storage failure aborts the run
  before anything is removed — so a failure means *nothing* was deleted and
  you can simply try again, rather than being stranded half-deleted
  (DECISIONS 025). The operator purge script and the endpoint now run the
  same code instead of two implementations that could drift.
- **Change the email you sign in with**, with the confirmation round trip
  stated honestly: the new address is not your sign-in address until it is
  confirmed.

### Added — the landing page a stranger actually reads

- Rebuilt for screen parity with what the market ships: a four-step
  how-it-works, itemized pricing, and answers to the six questions people
  actually ask. What unlocks for $49 is listed **before** the button, with
  the refund line next to it.
  (The FAQ accordion and the framed screenshots both came out again in 0.7.0 —
  the accordion moved to `/faq`. Noted here because this bullet and its
  correction now sit in different releases.)
- The landing also briefly carried a live pre-signup rubric preview. It
  shipped, ran in production, and was removed the same day — see "Not
  shipped, and why".

### Added — the operator's instruments

- **A real-usage endpoint and a report script** (`GET /api/metrics/usage`),
  so completion rate, latency percentiles and package burn-through come off
  an instrument instead of a hand-written query. The generator enforces the
  honesty rules rather than trusting whoever runs it: every rate prints its
  counts, the account count leads the summary, a one-account sample is
  labelled a self-test in the output, and a metric the product does not
  instrument prints as **not instrumented** with the reason.
- **A dead-letter record for permanently failed jobs**, and an endpoint to
  read it. Failures were previously discovered by customer complaint.
- **Backup and restore documented as a procedure**, including the corpus
  bucket — the one asset whose loss would silently degrade every future
  rubric — plus worker-token rotation written down as ops.

### Added — the pipeline survives its own history

- **Backoff on every model call in the tree.** The audit found one of seven
  covered; a discovery-based test then found eleven call sites rather than
  seven, and pins the count so a twelfth cannot ship without it. Transcription
  first — the most expensive, least replaceable step, and the one that had
  none.
- **A scoring concurrency limit and a memory guard.** Measured peak was
  ~1.6GB; two concurrent scorings would be an OOM that has already happened
  once in production.
- **An overall job deadline**, so one job cannot occupy a worker thread for
  fifty minutes by chaining per-call timeouts.
- **One live session per package.** Two tabs on one session both mint upload
  URLs and the second overwrites the first — an interview lost with no error
  anywhere. The refusal says so, and says no session is consumed
  (DECISIONS 028, which also records what this costs a crashed tab).

### Added — security and observability

- **Real security headers**: a CSP with an explicit connect-source allowlist,
  `frame-ancestors 'none'`, and a Permissions-Policy that grants the
  microphone on the interview room and nowhere else (DECISIONS 026 records
  why it ships without a nonce, and what that trades away).
- **Capability revocation works end to end.** The room token can be revoked
  and the next room entry and secret mint refuse it. Automatic expiry is
  deliberately not minted yet, and DECISIONS 029 says why rather than
  implying a window that does not exist.
- **Prompt-injection refusal with its own eval suite.** A submission that
  reads as an instruction set is refused at intake with a message naming
  what was seen — and the suite's benign false-positive baseline is *zero*,
  because the first classifier refused real prompt-engineering job postings
  (DECISIONS 027).
- **`/healthz` checks what it claims.** It returned an unconditional true,
  which is what let a dead build keep serving while every deploy failed; it
  now probes the database and answers 503 naming what failed.
- **One request id** travels from the browser through the web routes into the
  worker's logs, and comes back on the response.
- Sentry on both sides, with alert rules recorded as configuration rather
  than as clicks someone did once.

### Fixed

- The poll loop could retry every five seconds forever, including for an id
  that would never resolve. It now backs off, breaks the circuit, and can
  re-arm.
- Closing a tab mid-upload silently threw away the interview. It warns.
- Session timing was double-sourced between the worker's config and the
  browser, with TypeScript quietly winning. One source now, with a test in
  each suite that fails if the mirror drifts.
- A missing environment variable used to surface as a 500 on a live page.
  It now fails the build, so the previous deployment keeps serving.
- Share links (`/p/`) carry a capability in the URL and were only protected
  by a robots.txt disallow — which cannot stop URL-only indexing and stops a
  crawler from ever seeing a noindex. They now send `X-Robots-Tag` as well.
- Per-page metadata, OG images, `robots.txt` and `sitemap.xml`, so a link
  pasted into a chat renders as something rather than nothing.
- Google sign-in is wired behind its flag, ready for the provider
  configuration.

### Decisions

- DECISIONS 025: deletion removes blobs before rows, and a partial failure
  deletes nothing.
- DECISIONS 026: a CSP without a nonce, and the prerendered pages that
  choice protects.
- DECISIONS 027: injection — fence, then detect, then refuse out loud, with
  a zero-tolerance benign false-positive baseline.
- DECISIONS 028: one live session per package, released by the hard cut, and
  what that costs a customer whose tab crashed.
- DECISIONS 029: the capability window — revocation now, expiry not yet.
- DECISIONS 030: the landing rubric preview is removed the day it shipped —
  the placement was the defect, and what the removal costs is written down.
- DECISIONS 033: error monitoring on both runtimes, and the line drawn around
  what a third party receives — identifiers and stack traces, never a
  recording, a transcript or a report body. Logged a day late, by the release
  audit, and its absence had already falsified a number in 026.
- DECISIONS 034: the worker survives its own history — backoff on eleven model
  call sites with the count pinned by a discovery test, a scoring concurrency
  limit behind a production OOM, an overall job deadline, and a dead letter.

### Evals

No gate ran at this commit. The run of record for this tag is the one made on
the 0.7.0 tree — `evals/reports/2026-08-04-v06-v07-gate.md` — and it is a
single run covering both tags. This release was deployed without one, which
`docs/deploy.md`'s pre-deploy checklist required; §5.2 of that runbook has
been amended so a deploy and its gate cannot come apart again.

### Not shipped, and why

- **Judge-authored report strengths and weaknesses (F-03b) was dropped
  whole.** It needs a judge-prompt change, and validating a judge-prompt
  change needs an eval run that this batch's cost directive batches to the
  release gate. Shipping an unvalidated judge change is precisely the
  regression that surfaces late and expensively, so it waits for a gate
  rather than riding this one degraded.
- **The pre-signup rubric preview (F-45) shipped and was rolled back the same
  day.** Paste a job description on the landing page, see the bar it is
  scored against, without an account. It worked — a real posting came back as
  four weighted dimensions in under eight seconds, and its guards held. On
  the page it read as an unexplained box: a bare textarea and a disabled
  button, offered before the page had said what this product is. The
  interaction arrived ahead of the argument for it. Removed whole rather than
  restyled, because the fault was placement, and the design pass rebuilds
  this page next (DECISIONS 030, which also records what the removal gives
  up — it was genuine competitive white space — and what it buys back: the
  product now exposes no unauthenticated model call at all).

## [0.5.0] — 2026-08-03

The payments release: a live merchant-of-record checkout, the
trial-then-unlock package behind it, and the complete signed-in webapp that
had to exist before charging for anything was honest — accounts, a session
archive with transcripts and voice replay, a progress screen, and the legal
surfaces.

**On the version numbers.** 0.3 (report quality) and 0.4 (session history)
were planned as their own releases (DECISIONS 008). Both shipped — as internal
milestones inside the 2026-08-02 and 2026-08-03 parallel batches — and neither
was ever tagged. No `v0.3.0` or `v0.4.0` exists, and none is being created
retroactively: a tag invented after the fact is a decoration, not a release
rhythm. Both are folded into this section, which therefore carries three
bundles of work, and headings below name the milestone where it helps. The tag
line of record **through v0.5** is v0.1.0 → v0.2.0 → v0.5.0.

*(Refined 2026-08-04, when `v0.6.0` and `v0.7.0` were cut after the fact. The
rule stands and is sharpened: a tag may be cut afterwards **at the commit that
was actually deployed**, and may not be invented for a boundary that never
shipped separately. 0.3 and 0.4 are the second kind and are still not tagged.
DECISIONS 032.)*

### Added — payments: the trial-then-unlock package
- **Read this before the rest of the section: no sale has happened.** The
  live path was verified by the operator's own $49 purchase, provisioned end
  to end and then self-refunded with the receipt kept — a self-test, not a
  sale, with zero external customers and zero revenue. Exactly one order
  exists and it is the project owner's own. What is proven here is that the
  payment path works, nothing about demand.
- Real payments, through Polar as merchant of record: checkout happens on
  Polar's hosted page — the app never renders a card field — and a
  signature-verified, replay-safe `order.paid` webhook unlocks the
  package. A forged or unsigned webhook provisions nothing; a missing
  webhook secret refuses to process at all (DECISIONS 017, 018).
- The trial model: the first session on a package is free. $49 unlocks
  the same package — same JD, same rubric — to its full six sessions.
  Every screen renders the honest quota ("of 1" until payment), and the
  unlock button is one sentence with the price on it (DECISIONS 018).
- The 30-day window starts at payment and blocks only new session
  starts — an expired package refuses with its own message, and reports,
  transcripts, and replays stay readable. Trials never expire
  (DECISIONS 019).
- Pricing is $49 USD on every surface, rendered from one constant with a
  test pinning it. The ₩89,000 stub price is retired.
- Receipts: an order history (date, amount, status) in settings.
- Packages whose rubric compilation failed get a "Retry compile" action
  instead of a dead end.
- Fixed in production the same evening (`84e3434`): every real `order.paid`
  delivery returned 403 while a locally signed, spec-compliant payload
  verified green. Polar signs with the literal secret string, not the
  base64-decoded key bytes the Standard Webhooks spec describes. Verification
  now accepts any derivation of the *same* secret — spec bytes, the full
  string, or the after-prefix string — so a tampered payload still matches
  nothing. The lesson is recorded in RETRO.md: a signature test that signs
  with your own code only proves you are self-consistent.

### Fixed — the session room on Safari and iOS
- Recorder construction moved inside the failure path with a container
  probe and an `audio/mp4` fallback, audio starts inside the user's own
  tap (autoplay policy), and a capability gate turns an unsupported
  browser into an honest message before the mic check — not a silent
  permanent "Connecting…".
- Start-session refusals now say what happened — package exhausted,
  package expired, slot closed, rate limited, or the service being
  unreachable — each with its own calm state. The raw red 502 string is
  gone.
- A recording disclosure line at the mic-check step says plainly that
  the session is recorded, scored, and kept privately for replay.

### Added — guardrails for a paid product
- Abuse and cost guards worker-side: per-user rate limits on package and
  session creation and scoring, input length caps (with base64 size
  checked before decoding), a recording-duration ceiling at scoring
  intake, a per-session connection-secret cap, retry caps that retire a
  slot honestly after repeated failures, and a refusal to re-mint upload
  URLs for a session that is already scored.
- A stuck-state reaper: packages and sessions stalled mid-pipeline for
  over 30 minutes are marked failed (and retryable) instead of spinning
  forever; every lifecycle write now carries a freshness timestamp.
- Prompt-injection minimum: user-controlled text (JD, resume, LinkedIn,
  transcript) is fenced at every prompt site, the JD is truncated before
  rubric compilation, and hidden HTML/zero-width payloads are stripped
  at intake. Judge instructions are unchanged (DECISIONS 021).
- Worker logs are visible in production and an error tracker (Sentry)
  switches on only when configured.

### Added — legal and trust surfaces
- Terms, privacy, and refund pages in the product's own plain register,
  linked from a footer on every app page with a support address. Every
  commercial number in them renders from the pricing constants. The
  refund rule is stated honestly: the verdict itself is never refund
  grounds; technical failures refund within 14 days (DECISIONS 020).
- Sign-in gains a consent line ("By continuing you agree…"), a resend
  button with a cooldown, and a check-your-spam note.
- Settings gains a deletion section: a prefilled email starts a manual
  deletion the privacy page describes, executed operator-side by a purge
  tool that dry-runs by default (DECISIONS 020).
- Session cookies now refresh on API calls too, so a long-lived tab
  cannot drift into a signed-out state mid-flow.

### Added — the complete webapp
- The app now lives at login-scoped addresses with a persistent top
  navigation: Home · Sessions · Progress · Role & Rubric section tabs, a
  package switcher, and an account menu. Package links (`/p/…`) became
  claim addresses — they bind an unclaimed package to the first signed-in
  account and redirect; a package owned by a different account gets a real
  403 page; old token report links redirect to the new session addresses
  (DECISIONS 012).
- Sessions archive: every session as one honest row — number, date, status
  or verdict, overall score, and movement against your previous scored
  session. Failed and insufficient rows offer a retry; neither burns the
  slot.
- Session detail: the report with per-dimension deltas vs your previous
  scored session, a verbatim transcript viewer (the judge's delivery
  observations inlined at their timestamps), and audio replay of the exact
  recording that was scored — timestamps seek the player. Transcripts are
  persisted for every new session, saved right after transcription so even
  failed sessions keep their record; sessions from before this honestly
  show "transcript unavailable" (DECISIONS 013).
- Progress screen: verdict and overall trajectory across the package,
  per-dimension trend rows, delivery trends (pace, fillers), and a
  recurring-focus callout computed by fixed rules — instrumentation, not
  badges.
- Rubric page: the bar made visible — your role's dimensions, weights,
  signals, and score anchors, shown before you ever sit a session. The
  question bank is deliberately withheld: rehearsing the exact probes
  would corrupt the verdict's honesty (DECISIONS 015).
- Scoring eligibility gate: a session below the evidence floor is not
  scored at all — no judge calls, no numbers, an honest "not enough
  evidence" state, and the slot stays available. A short-but-scorable
  session is scored and labeled as limited evidence (DECISIONS 014).
- Reports open with a one-line headline: the verdict and the dimension
  holding it back (DECISIONS 016).
- Packages overview with minimal cards and switch-in-place. Creating a
  package now requires sign-in, and packages are born bound to their
  creator — no unclaimed window.
- Settings: account details, a microphone check, an honest note about
  recordings and data, and sign-out.

### Added — accounts, landing, home (the 0.4 milestone, never tagged)
- Sign-in with Google or a passwordless email link (Supabase Auth). No
  passwords exist anywhere in the product. Interviews now require sign-in;
  a package binds to the first signed-in account that opens it, and a
  package opened by a different account gets an honest 403 page.
- Public landing page: the product explained plainly, a demo-video slot
  (coming soon), and sign-in as the single entry to the app.
- Logged-in home: session journey strip, the next session as a ticket-style
  card with the last verdict and one focus line, the full session list with
  report links, and a readiness dial. The package page becomes the same
  dashboard; the rubric moves into a collapsed disclosure.
- Pricing page and a checkout stub (₩89,000 · one JD · 30 days · 6
  sessions). Payment-provider wiring stays with the payments feature; the
  stub says so honestly.
- Multi-session packages live end to end: a 6-session quota, resume of an
  unfinished session (a connection-guard ending never burns the slot),
  next-index creation, and honest "package exhausted" copy. Two new worker
  routes list a package's sessions and a user's packages.
- The interviewer is locked to English: whatever language the candidate
  answers in, the interviewer replies in English — one warm invitation
  back the first time, no comment after that, and a plain ask-again if an
  answer wasn't understandable. The English session is the training.
- All the milestone's screens ship in the product's plain neutral baseline
  (light/dark adaptive). A branded visual identity was prototyped
  (night/aviation direction) and deliberately shelved: features first,
  design applied across the whole app in one dedicated pass later.
- Google sign-in is hidden behind a flag until the OAuth provider is
  configured; email sign-in links are the live method.

### Added — the client owns all conversational timing
- Silence machinery: with `create_response: false` the server commits turns
  but never speaks on its own — a pure, unit-tested reducer is now the only
  source of `response.create`. Every committed turn arms a debounced
  response (1.2 s); any candidate sound cancels it; sustained quiet walks
  staged `[silence status]` scaffolds at 8 s / 15 s / 30 s (a warm "take
  your time" → one directional hint → an offer to set the question aside),
  each at most once per quiet stretch.
- Filler tolerance: candidate sound shorter than 2 s (um, uh, a cough)
  pauses the silence clock without resetting it — thinking aloud does not
  restart the 8-second count. Interviewer audio also pauses the clock; only
  ≥ 2 s of real speech resets it.
- Reactive silence contract in the interviewer instructions: the model never
  self-initiates "Take your time" — it acts only on injected notes and never
  reads them aloud. If a turn is forced while the candidate's answer is
  clearly unfinished, it degrades to a soft "Mm-hm." and keeps waiting.
- Session-script alignment: interviewer instructions rewritten backwards
  from a co-designed ideal session script — audio-check opening, turn-initial
  backchannels, overlap yield, softened pressure with release, good-luck
  closing.
- Rubric reuse: an identical JD with no personalization inputs copies the
  newest ready rubric instead of recompiling — repeat links are instant and
  cost zero judge-model calls (DECISIONS 010).

### Added — adversarial stability harness
- A seeded adversarial suite now attacks the conversation clock on every
  test run: five generators (VAD flapping, commit storms, dropped/duplicated
  commit flags, echo/barge-in overlap patterns, tick-length spikes) plus a
  5,000-tick mixed soup, all checked against six spec-level invariants by a
  shadow model written independently of the reducer. Every scenario is a
  pure function of its seed, so any failure replays exactly. The five
  2026-08-01 live faults are pinned as named regression scenarios, and the
  wire-event parsers are fuzzed with hostile payloads (malformed frames,
  prototype-pollution shapes, 50 KB strings) and must never throw.
- The generated rounds found two real clock faults before any user did:
  the tick that carried a commit was also credited toward the response
  debounce (shrinking the candidate's room to resume — to zero on a jittery
  tick), and a scaffold and a debounced response could fire on the same
  tick (previously masked by a silent ordering detail in the component).
  Both are fixed in the reducer with named repro tests.
- Writing the seed scenarios exposed a third, pure-layer hole: an echo
  outlasting the 2 s filler threshold restarted the scaffold ladder, so a
  stuck candidate on open speakers would hear "Take your time" every eight
  seconds forever instead of escalating to the directional hint.
  Interviewer audibility now wins on overlapping ticks; a genuine barge-in
  still resets the stretch once the interviewer's audio stops
  (DECISIONS 011 records the related suspension-gap rule).

### Added — session stability guard
- A broken transport now ends the session honestly instead of leaving a
  ghost room where the timer runs and the interviewer never speaks again.
  A pure connection-guard reducer watches four signals every quarter
  second: ICE `failed` (immediate), ICE `disconnected` sustained 8 s, the
  data channel closing mid-session, and starvation — 20 s of expected
  traffic (candidate speaking, interviewer audible, or a response in
  flight) with nothing arriving. Detection is honest by construction: a
  healthy silent room accumulates nothing, so an away-from-keyboard
  candidate is never shown a fake "connection problem", and a
  backgrounded-tab gap resets the guard entirely (the suspension-amnesty
  rule, DECISIONS 011).
- On trip: a plain-language notice ("We hit a connection problem, so this
  session has to end here. It won't count against your package — please
  try again in a few minutes."), graceful teardown, no recording upload,
  and no scoring call — the session row stays `planned`, so the same link
  serves a fresh attempt and the package slot survives. A session where
  the interviewer never answers the opening nudge now ends at ~20 s
  instead of hanging forever.

### Fixed — background-tab resume
- A candidate whose tab was backgrounded (or whose machine slept) no longer
  gets the queued silence scaffolds machine-gunned into their ear on
  refocus: the ticker now measures real elapsed time on a monotonic clock,
  and any gap ≥ 2 s counts as absence rather than silence — the clock
  resets and the interviewer resumes quietly, as a human would after
  glancing up.

### Fixed — open-speakers hardening (five same-evening fixes, instrumented live sessions)
- Silence clock inert and the interviewer mute after the greeting: the
  machinery depended on single transport signals; commit arming and
  interviewer-audibility are now each fed by two independent sources
  (server events plus a WebAudio analyser fallback).
- The interviewer answering its own speaker-leaked echo (self-talking):
  physics-based echo rejection — candidate speech that starts during
  interviewer audio counts as real only if it outlives that audio (an echo
  dies with its source); echo-committed items are deleted from the
  conversation so the model never treats its own words as an answer.
- Phantom turns from ambient room noise: VAD threshold raised to 0.6.
- Broken audio at utterance onset: leaked echo tripped server-side
  interruption, truncating the interviewer's first words —
  `interrupt_response: false`; the audio stream is never chopped, and
  overlap yielding stays an instruction-level behavior.

### Decisions

Every entry added to DECISIONS.md since the v0.2.0 tag, in order. Completed
2026-08-03 during the release audit: the index had stopped at 016 and omitted
every payments entry the sections above cite by number.

- DECISIONS 009: `server_vad` + `create_response: false` chosen over
  `semantic_vad` by measured bake-off (semantic_vad never committed complete
  test answers and interrupted an 8 s thinking pause at ~4.4 s).
- DECISIONS 010: rubric reuse for identical JDs — narrowed on 2026-08-03,
  once accounts existed, to same-account reuse only; a global match would
  have copied one customer's resume-derived profile onto another's package.
- DECISIONS 011: a response armed before a suspension gap (backgrounded tab,
  throttled timers, machine sleep) is dropped rather than fired on return.
- DECISIONS 012: canonical URLs are login-scoped ids; token links demoted
  to claim/redirect addresses.
- DECISIONS 013: transcripts persist before judging; audio and transcript
  retained privately, retention policy due before payments.
- DECISIONS 014: scoring eligibility floors — below them, zero judge calls
  and the slot survives.
- DECISIONS 015: the rubric page conceals the question bank.
- DECISIONS 016: report headline is compile-side deterministic this batch.
- DECISIONS 017: merchant of record is Polar — settled empirically, by a
  Korean individual seller completing signup, identity verification, and
  payout onboarding end to end; the only candidate whose KR payout support
  could be verified. Lemon Squeezy and Paddle rejected, with reasons.
- DECISIONS 018: $49 USD on every surface from one constant, and the
  trial-then-unlock package — including the open record that the worker's
  quota chokepoint keys on `paid_at` alone, so *every* unpaid package grants
  the one-session trial, not only an account's first.
- DECISIONS 019: the 30-day window starts at payment and closes every route
  into the interview room — resumes of unfinished sessions included, which
  the entry originally understated and corrects in place. Reports,
  transcripts, and replays stay readable forever, and a session already in
  flight still gets scored. Trials never expire.
- DECISIONS 020: retention and deletion v0 — privacy page, mailto intake,
  operator-run purge tool, and the refund rule that the verdict itself is
  never refund grounds.
- DECISIONS 021: prompt-injection stance — fence now, detect later; the
  detection heuristics and the injection eval suite are F-11b (v0.6).
- Amended rather than superseded in this window: 008 (its v0.3 → v0.4 → v0.5
  version map did not survive contact — see the note under the 0.5.0 heading),
  012 and 013 (revisit conditions fired and are answered in place), and 016
  (revisit fired and was deliberately *not* acted on — the judge-authored
  report fields still ship as empty defaults).
- DECISIONS 022: accounts are Supabase Auth with passwordless email links
  and no passwords stored anywhere — logged retroactively during the release
  audit, which found the second-largest architecture decision of this arc
  unrecorded while much smaller ones were.
- DECISIONS 023: Polar's live webhook signs with the literal secret string,
  not the base64 bytes its own documented scheme describes, so verification
  accepts any derivation of the *same* secret — a tampered payload still
  matches nothing. Found only because real deliveries 403'd while a locally
  signed spec-compliant payload verified green.
- DECISIONS 024: the default track executor becomes the Codex CLI, with
  Claude assigned to design-open tracks — supersedes 007, whose revisit
  condition had fired at v0.2 and gone unrecorded until this audit.

### Evals (release gate: `scorer-evals` exit 0)
- 2026-08-03: layer 1 rubric discrimination accuracy 1.0 (baseline 0.8,
  N=3 triplets).
- 2026-08-03: layer 3 delivery discrimination judge accuracy 1.0
  (baseline 0.8, N=2 clip triplets); the DSP path ran clean on both
  triplets — recorded, still not gated.
- One run, first attempt, exit 0 — no re-runs, nothing omitted. Numbers of
  record committed verbatim in `evals/reports/2026-08-03-v05-gate.md`
  (generated `evals/out/` artifacts are gitignored).
- The report also states what the gate does *not* cover: the rubric compiler
  is never invoked, so the v0.5 JD truncation and the intake hidden-text
  strip have unit tests but no gate coverage; nor are the scoring-eligibility
  gate, report field quality, or the package/payment lifecycle exercised. The
  injection eval suite that closes the first gap is F-11b, in v0.6.

## [0.2.0] — 2026-08-01

Interviewer UX release, driven by the first full end-to-end session
(2026-07-29 — run by the developer as the product's first user; no external
users yet): the interviewer now opens the call, tolerates thinking pauses,
listens actively, and manages the clock — and the report explains its
scores.

### Added — interviewer UX
- The interviewer speaks first. Instructions alone could not do this —
  server-VAD realtime models never speak unprompted, so the session room now
  nudges the first response at data-channel open (`response.create`), and the
  opening beat is scripted: a hello with an audio check ("can you hear me
  okay?"), one conversational sentence of framing, and a put-at-ease line.
- Thinking-pause tolerance: mid-answer pauses are treated as thinking, not
  end-of-answer — wait, or offer one supportive scaffold; never re-ask the
  same question verbatim, never advance over an unfinished answer. Built for
  non-native speakers, for whom pauses are the norm.
- Active listening: one-sentence restatement of the candidate's key claim
  before follow-ups; evidence probes lead with an acknowledging clause.
- Time awareness: the model has no clock, so the client injects `[time
  status]` system notes at 75% elapsed and at the wrap-up margin; the
  interviewer treats them as its clock and never reads them aloud.
- Session-room copy: "Morgan speaks first — no need to say hello."

### Added — report
- Per-dimension cards now render the judge's written rationale (previously
  computed and stored but never displayed) with verified candidate quotes as
  block quotes under "What you actually said".
- Trimmed-by-default display: the four most load-bearing quotes per dimension
  and the five most significant timeline observations (DSP conflicts always
  surface); the full sets stay one native disclosure away.
- The report page distinguishes a briefly unreachable scoring worker
  (auto-retrying, honest copy) from a genuinely unknown link.

### Changed
- Content judge backs off briefly (1s/2s/4s) on transient 429/transport
  errors instead of failing the run — with a budget separate from the
  one-parse-retry-per-dimension semantics, sized for concurrent sessions.
- Content judge scores dimensions concurrently (bounded thread pool): the
  21 per-dimension judge calls that dominated scoring wall-time now overlap;
  results assemble in rubric order and retry/failure semantics are unchanged.
- Every Gemini API request now carries a hard 8-minute timeout: a stalled
  call fails the session honestly (and "failed" sessions can be re-scored)
  instead of pinning the row in "scoring" forever — observed once in
  production on 2026-07-29.

### Added — operations
- Scoring progress stages: the worker persists which pipeline stage a run is
  in (download → transcribe → delivery-metrics → content-judge →
  delivery-judge → compile) and the report page narrates it while polling.
  Migration: `docs/supabase/migrations/002_scoring_stage.sql`.
- Deploy runbook: first-production-deploy learnings — the Railway builder
  must be Nixpacks (Railpack ignores `nixpacks.toml`), full-length scoring
  needs a Hobby-plan memory ceiling (observed ~1.6 GB peak), `SUPABASE_URL`
  must be the bare project URL, and migrations run in filename order.

### Decisions
- DECISIONS 008: v0.2 ships product depth before payments — versions ship
  one bundle each; the PRD's original metrics stay as written, with the
  timeline shift logged honestly.

### Tag boundary (noted 2026-08-03)

The `v0.1.0` tag was not cut on the date of its release notes. It was created
on 2026-08-01 at `62ee785`, six days later, so it already contains the
2026-07-29 commits that *this* 0.2.0 section documents — the concurrent
content judge (`aaa3d80`), the Gemini request timeout (`d440ef0`), scoring
progress stages (`de7da70`), and the deploy runbook (`b42198b`). Check it:
`git tag --contains aaa3d80` prints both `v0.1.0` and `v0.2.0`. The 0.1.0
heading below is dated by its release notes; the tag object is dated
2026-08-01.

Nothing is being re-tagged or rewritten to tidy this. The overlap is a true
record of how the releases were actually cut, and correcting the section
boundaries by editing history would trade a small inaccuracy for a large one.

## [0.1.0] — 2026-07-26

First public release: the full loop is live — JD intake → per-JD researched rubric →
20-minute browser voice interview → dual-channel scoring → honest session report.

### Pre-release groundwork
- Repo bootstrapped with the PRD committed before any product code (see commit
  history).
- 2026-07-25 — S2S provider bake-off decided (DECISIONS #002): live
  interviewer OpenAI Realtime, scoring channel Gemini 2.5 Flash. Measured, not
  guessed: latency/stability/discrimination suites plus live browser sessions.
  Report: `evals/reports/2026-08-02-provider-bakeoff.md`.
- Browser session lab (webroom) built during the bake-off: ephemeral-token
  auth, WebRTC echo cancellation, tuned turn detection.

### Added
- JD intake (URL or pasted text) with optional resume PDF and LinkedIn
  Save-to-PDF profile inputs (no scraping).
- Per-JD live research sweep (grounded search with citations) feeding a BARS
  rubric compiler; every dimension carries at least one source citation and
  weights sum to 1.0 by validation.
- Baseline 20-minute S2S session in the browser: OpenAI Realtime (`gpt-realtime`)
  interviewer "Morgan" over WebRTC, one pressure probe, 25-minute hard cut,
  local recording uploaded straight to private storage via signed upload URLs.
- Dual-channel scoring on Gemini 2.5 Flash: content judge on the verbatim
  transcript (BARS anchors, quotes verified against the transcript) and delivery
  judge on the actual audio, cross-checked against DSP metrics (WPM timeline,
  fillers, silences >= 1s, response latency) with conflicts flagged.
- Session report with verdict (not_ready / approaching / ready), per-dimension
  evidence, timestamped observations, next drills, and a report-language lint
  that forbids inner-state assertions.
- Web app: landing, intake, rubric preview, session room, report pages, and a
  no-signup sample report (labeled illustrative synthetic data until the
  launch swap for a real anonymized session — deploy runbook section 5.1).
- Deploy: Vercel (`apps/web`) + Railway (`services/scorer` worker, ffmpeg via
  nixpacks) + Supabase (Postgres; private `recordings` and `corpus` buckets).
  Runbook in `docs/deploy.md`.
- `PLAYBOOK.md` (reusable rubric-compilation and raw-audio scoring patterns)
  and `RETRO.md` (honest retros, including the eval-gate iteration below).

### Fixed
- Live Gemini structured-output path: google-genai 2.14.0 forwards
  `additionalProperties` for the scorer's `extra="forbid"` pydantic schemas and
  the Developer API rejects it with 400; a client-seam shim now routes pydantic
  response schemas through `response_json_schema` (found live in release prep —
  the fake-client test gate cannot see it).
- Wrapped genai client lifetime: `genai.Client` closes its shared httpx client
  on garbage collection, killing requests mid-run; `CompatClient` now holds the
  inner client alive (also found live in release prep).
- Content judge discrimination: batched all-dimension scoring saturated the
  responsive dimension at 5.0 and single calls were not reproducible even at
  temperature 0 with a fixed seed; the judge now scores each content dimension
  in a focused call and averages three seeded samples (layer-1 accuracy
  0.0 → 1.0 against the golden triplets), with one retry per dimension on a
  malformed sample so a single bad reply cannot fail a whole session.
- JD URL intake: an unfetchable or bot-walled JD URL now returns a clean 422
  ("paste the JD text instead") surfaced on the intake form, instead of a
  generic 502.
- Background compile task wrapped like the scoring task, so a double fault can
  never crash the worker.

### Security (pre-release hardening from the final whole-branch review)
- Removed a dead browser-reachable route that returned the full package row —
  including the interview question bank — to any token holder; a vitest
  tripwire keeps it dead.
- Package access token is now required on every state-changing web route,
  including session creation.
- Recording storage paths are derived server-side from the authorized session
  row; the client can no longer point scoring at an arbitrary bucket path.
- Recordings upload straight to Supabase Storage via server-minted signed
  upload URLs, so multi-megabyte bodies never transit (or buffer in) a Vercel
  function.
- SSRF guard on the JD URL fetch: http/https only, public-address resolution
  enforced on every redirect hop, response size capped.
- Session create is idempotent (v0.1 is single-session per package) and
  re-scoring an in-flight or scored session returns 409 — closing both a
  recording-overwrite race and an unmetered re-scoring loop.
- Worker bearer auth compares tokens constant-time (`secrets.compare_digest`)
  and returns 401 (not 500) on non-ASCII Authorization headers.
- Web API routes log failures server-side (no tokens, no request bodies)
  before returning generic errors.

### Evals (release gate: `scorer-evals` exit 0)
- 2026-07-26: layer 1 rubric discrimination accuracy 1.0
  (baseline 0.8).
- 2026-07-26: layer 3 delivery discrimination judge accuracy
  1.0 (baseline 0.8); DSP separability recorded, not gated in v0.1.
- Numbers of record committed verbatim in
  `evals/reports/2026-07-26-v01-gate.md` (generated `evals/out/` artifacts are
  gitignored).
