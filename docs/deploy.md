# Deploy runbook — flightcheck

Three deploy units: `apps/web` on Vercel, `services/scorer` on Railway, Supabase for
Postgres + Storage. This file lists **env var names only** — values live in each
platform's secret store and are never written into the repo, logs, or docs.

Sections 0–4 are the standing runbook, re-checked against the tree at
**v0.7.0 (2026-08-04)**. Section 5 is the release ritual; its opening
paragraph is written in the tense the first launch was run in, and that
paragraph is the only one-time part. Everything under it re-runs: the
anonymization checklist (**§5.1 step 2**) whenever the public sample report is
regenerated, §5.1a whenever the README imagery is recaptured, and §5.2 at
every tag — §5.2 is what produces the release notes and the published GitHub
Release. §5.1 step 2 also carries the record of the release where it was
ticked without being satisfied.

## 0. Pre-deploy checklist

- [ ] **npm audit status (documented, not blocking).** As of 2026-07-26,
      `npm audit` in `apps/web` reports 12 high advisories, all transitive:
      `next@16.2.12`'s bundled `postcss`/`sharp` copies (build-time CSS
      processing and image optimization), plus a dev-only `eslint` chain via
      `brace-expansion`/`minimatch` that never ships to production. The only
      "fix" npm offers is a breaking downgrade to `next@9` — rejected.
      Decision: track and bump `next` as soon as a patched release lands;
      re-run `npm audit` before every release and update this entry.
- [ ] **ffmpeg on PATH (Railway).** The scoring pipeline shells out to ffmpeg
      (`scorer.audio_utils.ensure_wav`); `services/scorer/nixpacks.toml` appends
      `ffmpeg` to the Python provider's nix packages. After the first deploy,
      verify from the Railway service shell (or a one-off `railway run`):
      `ffmpeg -version` prints a version banner. If it does not, the build did
      not pick up `nixpacks.toml` — check that Root Directory is
      `services/scorer`.
- [ ] **WORKER_API_TOKEN generated correctly.** Long random value, generated
      once (`openssl rand -hex 32`, 64 hex chars) and set in both Railway and
      Vercel — never committed, never logged. The worker compares it with
      `secrets.compare_digest` (constant-time), so token strength is the only
      thing the operator controls: do not shorten it, do not reuse it across
      environments.
- [ ] Gates green locally before deploying: from `repo/services/scorer/`,
      `uv run pytest`, `uv run ruff check .`, and `uv run scorer-evals`
      (exit 0); from `repo/apps/web/`, `npm run lint`, `npm run typecheck`,
      `npm run test`, `npx next build`.

## 1. Supabase

1. Create a project at supabase.com (pick a region close to the Railway worker).
   Note the project URL and the service-role key from Project Settings > API.
2. SQL Editor: run every file in `docs/supabase/migrations/` in filename order
   — as of v0.7 that is `001_init.sql`, `002_scoring_stage.sql`,
   `003_accounts_multisession.sql`, `004_session_transcript.sql`,
   `005_payments_trial_expiry.sql`, `006_token_hygiene.sql`: paste each file's
   full contents, run it, confirm `Success. No rows returned`, then move to
   the next. Do not stop at the last one this list happened to name when it
   was written — run `ls docs/supabase/migrations/` and apply every file it
   returns. Later migrations assume earlier ones already ran, so the order is
   not optional. `001_init.sql` creates the `packages` and `sessions` tables;
   `006_token_hygiene.sql` adds the two `sessions` columns the worker's hot
   session read selects (`SESSION_COLUMNS` in `api/db.py`), so a deployment
   that skips it fails every session read rather than degrading. When
   upgrading an existing deployment, apply any new migration files **before**
   deploying the worker build that uses them — the worker assumes its columns
   exist.
3. Storage: create two buckets, `recordings` and `corpus`. Both **must be private**
   (public access off) — recordings are user audio, the corpus is confidential.
4. Upload the private rubric corpus: every local corpus `*.md` doc into the
   `corpus` bucket root. The corpus is never committed to this repo (workspace
   confidentiality rule) — only `services/scorer/corpus/README.md` and the neutral
   example doc live in git.

## 2. Railway (scoring worker)

1. New Project > Deploy from GitHub repo > select this repo, then set
   **Root Directory** to `services/scorer`.
2. Settings > Build > **Builder**: set to **Nixpacks**. Railway's current
   default builder (Railpack) ignores `nixpacks.toml` entirely — the build
   fails in seconds with "No start command detected", and even hand-feeding a
   start command would silently omit the ffmpeg install.
3. Build and start come from `services/scorer/nixpacks.toml` (nixpacks adds
   `ffmpeg` to the default Python toolchain; start command
   `uv run python -m scorer.api.app`, which serves on `$PORT`). The same file
   pins `NIXPACKS_UV_VERSION` — leave it pinned. On 2026-08-03 Railway's
   builder briefly stopped supplying that variable, the install step became
   the invalid `pip install uv==`, and **every** build failed while the last
   good image kept serving: `/healthz` and the Railway dashboard both read
   green while nothing shipped. A health check proves an image is
   alive, not that it is the image you just built — after any deploy, confirm
   the newest deployment itself reached SUCCESS.
4. Variables (names only — set values in the Railway dashboard):
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `SUPABASE_URL` — the bare project URL (`https://PROJECT-REF.supabase.co`).
     The dashboard sometimes displays a `/rest/v1` endpoint form; the SDKs
     append path prefixes themselves, so a `/rest/v1` suffix breaks every call.
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKER_API_TOKEN` — generate once with `openssl rand -hex 32`; the same
     value goes to Vercel below
   - optional: `SSL_CERT_FILE`
   - optional: `SENTRY_DSN` — enables error monitoring. Unset is a clean no-op
     (`scorer.observability.init_sentry`), and PII is off either way
     (`send_default_pii=False`), so events carry ids and tracebacks but never
     candidate text or tokens. If you do set it, error monitoring is a
     subprocessor — the privacy policy already lists one.
   - **`SCORER_CORPUS_DIR` — do NOT set in production.** It is a local-dev
     bypass, not a cache: when set, the worker skips the `corpus` bucket sync
     entirely and reads that directory instead. On Railway it would silently
     compile every rubric with zero corpus grounding and zero few-shots
     (an empty or wrong directory produces "(no corpus documents provided)"
     rubrics with no error and no log line).
5. Settings > Networking > Generate Domain. Note the public URL — it becomes
   `WORKER_URL` for the web app.

**Memory:** full-length (~20 min) session scoring holds the whole waveform plus
analysis intermediates in memory — observed peak ~1.6 GB — and OOM-crashed a
trial-plan container in production. Move to the Hobby plan or higher before
running real sessions. After a plan change, **Restart** the service: the new
limits do not apply to the already-running container.

## 3. Vercel (web)

1. New Project > import this repo > set **Root Directory** to `apps/web`
   (framework preset: Next.js).
2. Environment variables (names only):
   - `OPENAI_API_KEY` (mints OpenAI Realtime ephemeral client secrets)
   - `WORKER_URL` (the Railway domain, with `https://`)
   - `WORKER_API_TOKEN` (same value as on Railway)
   - `SUPABASE_URL` (bare project URL, `https://PROJECT-REF.supabase.co` — no
     `/rest/v1` suffix; the SDKs append path prefixes themselves, so the
     suffixed form the dashboard sometimes shows breaks every call)
   - `SUPABASE_SERVICE_ROLE_KEY` (used by the recordings route to mint
     signed upload URLs for the private `recordings` bucket — the browser
     then PUTs the recording straight to Supabase Storage, so multi-megabyte
     audio never passes through a Vercel function body limit). The Polar
     webhook route reads `SUPABASE_SECRET_KEY` first and falls back to this
     name, so setting only this one is fine.
   - `POLAR_ACCESS_TOKEN` and `POLAR_PRODUCT_ID` (v0.5 — server-side hosted
     checkout creation). Absent or empty, `/checkout` renders the honest
     "payments are not available right now" state and charges nothing; it
     does not crash, so a missing value is easy to miss.
   - `POLAR_WEBHOOK_SECRET` (v0.5 — verifies the `order.paid` webhook).
     **Set this or payments provision nothing:** unset, the webhook route
     answers 503 by design rather than trusting an unverified payload, so
     checkout succeeds, the customer is charged, and no package unlocks.
3. Deploy. Note the production URL.
4. Point the Polar webhook at `https://<vercel-domain>/api/webhooks/polar` and
   subscribe it to `order.paid`. Polar signs deliveries with the literal
   secret **string**, not the base64-decoded bytes the Standard Webhooks spec
   describes — the verifier accepts any derivation of the same secret for that
   reason (`lib/polar.ts`, fixed at `84e3434`). Verify with a real delivery
   from Polar, never with a payload signed by this repo's own code: a
   locally-signed test proves only self-consistency, and that is exactly how
   every real `order.paid` came to 403 in production while the tests were
   green.

## 4. Smoke checklist (release-blocking)

- [ ] `curl -s https://<railway-domain>/healthz` answers `200` with
      `{"ok": true, "checks": {"database": "ok"}, "release": "<commit sha>"}`
      (unauthenticated). Since v0.6 the probe is real: the endpoint runs a
      bounded database lookup and answers `503` when it fails, so a `200`
      here means this build reached Postgres — the unconditional `{"ok":true}`
      that let a dead build keep serving is gone. Read `release` and confirm
      it names the deploy you just made; it is `null` only when Railway
      supplied neither `RAILWAY_GIT_COMMIT_SHA` nor `RAILWAY_DEPLOYMENT_ID`.
- [ ] `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<railway-domain>/api/packages`
      returns `401` or `403` — bearer auth is enforced.
- [ ] Full loop on a representative **public** JD (never one from the private
      application-target list), from the Vercel production URL: intake → rubric
      preview shows 5–8 dimensions, every one with at least one citation →
      **full-length voice session** (run the real ~20 minutes, not a short
      probe: the recording upload is a direct-to-Supabase signed-URL PUT and
      must be verified at a real recording size, well past any function body
      limit) → report reaches `scored` with a verdict, delivery metrics, and
      timestamped observations. Known gap: during a worker restart window the
      report page currently renders "Report not found" — reload once the
      worker is back up (tracked for v0.2).
- [ ] Evals gate: from `repo/services/scorer/`, `uv run scorer-evals; echo "exit=$?"`
      prints `exit=0`.
- [ ] Secrets audit: in browser devtools on the production site, search all
      network responses for the `WORKER_API_TOKEN` value — zero hits; the browser
      talks only to the Vercel origin, OpenAI's Realtime endpoints, and the
      Supabase Storage host (the signed-URL recording PUT — the signed URL is
      single-purpose and short-lived, not a stored secret).
- [ ] `curl -s -o /dev/null -w "%{http_code}\n" https://<railway-domain>/openapi.json`
      returns `404`, and so do `/docs` and `/redoc`. FastAPI publishes all
      three unauthenticated by default; on this service they are off
      (`create_app`). They were **on** in production from the worker's first
      commit until the v0.5 release audit — bearer auth held on every `/api`
      route, so nothing leaked, but the full schema of all fourteen paths,
      request bodies included, was public.
- [ ] **Kill switch noted** (cost/abuse incident on the public URL): pause the
      Railway worker service, or rotate `WORKER_API_TOKEN` on Railway only —
      either immediately stops all compile/scoring spend while the static
      pages stay up. Since v0.5 the worker also carries its own per-account
      fixed-window limits and per-row attempt caps
      (`services/scorer/config/product.toml`, `[limits]`), but those are
      in-process and reset on deploy — they bound burst abuse, they are not
      the containment lever. This is.

## 5. Post-deploy release steps (operator, release-blocking)

The smoke session from section 4 doubles as the source of the public sample
report. Note its `access_token`, `package_id`, and `session_id` from the URLs,
and the Vercel production URL for `README.md`.

### 5.1 Swap the sample report for the real anonymized session

As committed, `apps/web/public/sample-report.json` holds a compiler-shaped
synthetic fixture and the sample page's banner honestly labels it:
"Illustrative sample report — synthetic data in the exact format the product
produces. A real anonymized session replaces this at launch." This step
performs that promised replacement — fixture **and** banner together, so the
page is never mislabeled in either direction. **This step blocks the
release.**

1. Fetch the smoke session's report and rubric metadata from the production
   worker and write the fixture shape (run from `repo/services/scorer/`, which
   has httpx and the repo's `.env` with `WORKER_API_TOKEN`):

   ```bash
   WORKER_URL="https://<railway-domain>" SESSION_ID="<session_id>" PACKAGE_TOKEN="<access_token>" \
   uv run python - <<'PY'
   import json
   import os

   import httpx

   from scorer.env import load_env

   load_env()
   base = os.environ["WORKER_URL"].rstrip("/")
   headers = {"Authorization": f"Bearer {os.environ['WORKER_API_TOKEN']}"}
   session = httpx.get(
       f"{base}/api/sessions/{os.environ['SESSION_ID']}", headers=headers, timeout=30.0
   ).raise_for_status().json()
   package = httpx.get(
       f"{base}/api/packages/by-token/{os.environ['PACKAGE_TOKEN']}", headers=headers, timeout=30.0
   ).raise_for_status().json()
   assert session["status"] == "scored", session["status"]
   doc = {
       "report": session["report"],
       "dimensions": [
           {"key": d["key"], "name": d["name"], "channel": d["channel"]}
           for d in package["rubric"]["dimensions"]
       ],
   }
   out = "../../apps/web/public/sample-report.json"
   with open(out, "w") as f:
       json.dump(doc, f, indent=2)
       f.write("\n")
   print("wrote", out, "verdict:", doc["report"]["verdict"])
   PY
   ```

2. **Anonymization checklist (by hand — release-blocking).** Open
   `apps/web/public/sample-report.json` and edit:
   - [ ] Your **name** in any form (evidence quotes often contain "I'm ...") —
         remove or replace with a neutral phrasing; delete the quote if the
         sentence stops being verbatim-true.
   - [ ] **Employer names**, current and past — replace with neutral
         descriptors ("my current employer", "a prior team") only where the
         sentence stays truthful; otherwise drop the quote.
   - [ ] **Any client references** (workspace rule: client names never appear
         in the public repo) — remove entirely, including indirect identifiers
         (industry + engagement detail combinations).
   - [ ] The **target company** — the smoke session ran on a representative
         public JD, so the JD company may stay; if any private
         application-target detail leaked into an answer, remove it.
   - [ ] Set `report.session_id` to `"sample-anon-001"`.

   > **This box is about how a passage READS, not about what you know is
   > true — recorded 2026-08-03.** It was ticked at the v0.1 launch and the
   > fixture still shipped with a detailed engagement narrative phrased as
   > client work. The narrative was invented on the spot during the practice
   > session, the way anyone invents examples in an interview, and describes
   > no real client. That changed nothing: it read as client work to two
   > independent audits, one of which called it a release blocker, and it
   > would have read that way to a reviewer. It went out at v0.1 and through
   > two tags before the v0.5 audit caught it.
   >
   > Why the box was ticked wrongly: the greps in step 3 look for names and
   > employer strings, and there were none, so the item read as done. The
   > signal was **relational** — a possessive pointing at a client, and a
   > clause locating the speaker inside a client-serving firm — and no grep
   > for a proper noun finds that shape.
   >
   > **Do not quote offending strings when recording a future failure here.**
   > The first attempt at this note did exactly that, republishing in the
   > runbook what had just been taken out of the fixture. A note describing an
   > incident is a publication too.
   >
   > Three working rules. Read every evidence quote and rationale end to end
   > and ask what the passage *implies* about where the speaker worked —
   > invented content trips this wire exactly as hard as real content, and
   > costs the same audit cycle. Prefer **regenerating** the fixture over
   > rewording it: a reworded quote is no longer verbatim transcript, which is
   > the thing this product's evidence is supposed to be, so rewording buys
   > time and owes a recapture. And because step 1 regenerates the fixture
   > from a live session, passing once does not carry forward — this checklist
   > runs again in full every time the sample is refreshed.

3. Verify the scrub with greps for your real name, current employer, and every
   client name (expected: **no output** from each), for example:

   ```bash
   grep -in "<your-name>" apps/web/public/sample-report.json
   ```

4. Re-validate against the schema of record (from `repo/services/scorer/`):

   ```bash
   uv run python - <<'PY'
   import json
   from pathlib import Path

   from scorer.schemas import SessionReport

   doc = json.loads(Path("../../apps/web/public/sample-report.json").read_text())
   report = SessionReport.model_validate(doc["report"])
   meta_keys = [d["key"] for d in doc["dimensions"]]
   scored_keys = [s.dimension_key for s in report.dimension_scores]
   assert meta_keys == scored_keys, (meta_keys, scored_keys)
   assert report.session_id == "sample-anon-001"
   print("sample-report.json OK:", report.verdict, report.overall_score)
   PY
   ```

5. **Set the banner to what is actually true.** In
   `apps/web/app/sample-report/page.tsx`, the banner must state the fixture's
   real provenance and claim nothing beyond it. "Anonymized" and "identifying
   details removed" are both **forbidden** wordings: each asserts a
   completeness that step 2 cannot guarantee, and each invites a reader to
   infer a real user whose identity was protected. Say who ran the session and
   what was taken out, in that order, and say nothing about what remains.
   Never commit a real-session banner over a synthetic fixture, or the
   reverse.
6. Confirm the web app still builds with the new fixture and banner (from
   `repo/apps/web/`): `npm run typecheck` and `npx next build`, both exit 0.
7. Commit (from `repo/`):

   ```bash
   git add apps/web/public/sample-report.json apps/web/app/sample-report/page.tsx
   git commit -m "feat(web): swap sample report for real anonymized session" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

8. Update `README.md`'s **Live** section: the app URL, the sample-report URL
   and the price must be the ones just deployed, and the imagery must show
   the screens as they now look (§5.1a). Verify nothing unresolved survived —
   `grep -nE "PENDING-DEPLOY-URL|TODO" README.md` prints nothing — and commit.

### 5.1a README imagery (landing material)

`README.md` carries two stills: `docs/landing.jpg` (the signed-out landing)
and `docs/report.jpg` (a scored report). A screen recording is deferred to
the v1.0 demo, which needs a live 20-minute session rather than a screenshot;
the README's caption says so, and this step and that caption must not
disagree. Recapture whenever a release changes what either screen looks like
— the smoke session from section 4 is the material.

**This is the anonymization control for imagery, and it blocks the release.**
An image is not greppable, so nothing else in this runbook can catch what is
in one:

- [ ] Read every word visible in each capture and run the **same boxes as
      §5.1 step 2** — name, employer, client references including indirect
      identifiers, target company — by eye, on the pixels. The relational
      signal that box describes ("a possessive pointing at a client", "a
      clause locating the speaker inside a client-serving firm") is exactly
      the shape that survives a screenshot.
- [ ] The banner rule from §5.1 step 5 applies to anything legible in the
      image too: **"anonymized" and "identifying details removed" are
      forbidden wordings**, in pixels as in source.
- [ ] **Delete the asset the new one replaces, in the same commit.**
      Everything under `apps/web/public/` is served at its own URL whether or
      not a page links it, so an unreferenced leftover is still published.
      `apps/web/public/demo.gif` is the worked example: it shipped from v0.1,
      the README swapped it for the two stills and referenced it nowhere
      afterwards, and it went on answering `200` at
      `https://flightcheck.vercel.app/demo.gif` with the client-work phrasing
      and the forbidden `(anonymized)` banner still in its pixels — text a
      fixture fix had already removed everywhere a grep could reach. Confirm
      both halves, from `repo/`:

      ```bash
      grep -rn '<asset-filename>' --exclude-dir=node_modules \
        --exclude-dir=.next --exclude-dir=.venv --exclude-dir=.git .   # no output
      curl -s -o /dev/null -w "%{http_code}\n" https://<prod-domain>/<asset>  # 404
      ```

      Removing the file from the repo is not enough on its own: the asset
      keeps answering until the deploy that drops it reaches production, so
      run the `curl` after that deploy, not before.
- [ ] Update the README caption to describe what the new capture shows and
      what it does not, and to say what it replaced and why.

### 5.2 Tag and publish

A release is five artifacts, not one: the version in the manifests, a
`docs/releases/<v>.md` file, an annotated tag, a pushed `main`, and a
published GitHub Release. Steps 2 and 6 exist because this section did not
have them — it went straight from "tag" to "push", and the Releases page
consequently sat empty behind three tags until a release audit found it.

This release is the worked example. `v0.6.0` sits at `da254e3` — the commit
that was actually deployed for that batch, so the tag names a real release
boundary rather than one invented for the occasion — with
`docs/releases/v0.6.md` as its notes; `v0.7.0` sits at the release commit
with `docs/releases/v0.7.md`. The commands below are written for `v0.7.0`.

0. **Bump both manifests and both lockfiles**, in one `chore:` commit before
   anything else — a tag on a tree whose manifests name the previous version
   is a tag that disagrees with itself. Two commands, each of which updates
   its own lockfile:

   ```bash
   cd repo/apps/web        && npm pkg set version=0.7.0 && npm install --package-lock-only
   cd ../../services/scorer && uv version 0.7.0 --no-sync
   ```

   Verify all four fields before committing, from `repo/`:

   ```bash
   grep -n '"version": "0.7.0"' apps/web/package.json apps/web/package-lock.json
   grep -n '^version = "0.7.0"' services/scorer/pyproject.toml
   grep -n -A1 '^name = "scorer"' services/scorer/uv.lock
   ```

   Nothing enforces this: there is no CI, and no test reads a manifest
   version, so the only thing standing between the tag and a wrong version
   string is this step. Both commands regenerate their lockfile rather than
   leaving it, because editing only the manifest is what left `v0.5.0` tagged
   over lockfiles naming the previous version — repaired by the very next
   commit on `main`, which the tag does not contain.

1. **Re-run every gate** in the pre-deploy checklist — a tag never goes on a
   tree that was not just verified. Keep the `scorer-evals` output and the
   date it ran: step 2 has to publish those numbers, and copying a previous
   release's numbers forward under a new date is the exact dishonesty the
   audit in step 4 fails a release for.

2. **Write `docs/releases/<v>.md`** to the shape the existing files use — see
   `docs/releases/v0.5.md`, which is the current convention:

   - `# flightcheck vX.Y.0` and `Released: YYYY-MM-DD` as the first two lines;
   - a narrative section of what shipped, in past tense;
   - `## Measured evals (release gate: scorer-evals)` — a table of
     suite / metric / result / baseline / **run date** from step 1's run, prose
     about how the run actually went including any flake, and a link to the
     `evals/reports/…` file for that run. If no gate ran, say so here and say
     why; do not carry an older run's row forward under this heading;
   - `## Known limits`, carrying prior releases' limits forward by link;
   - one section per broken expectation this release creates — a version
     skipped, a tag that does not sit where a reader would expect, a manifest
     that disagrees with its tag. `docs/releases/v0.5.md`'s "Why the tags jump
     from v0.2 to v0.5" is the model. A reviewer meets the anomaly either
     from you or on their own.

   Commit it. Docs are outside every gate's scope — no test in either suite
   reads a file under `docs/` — so this commit cannot change step 1's result,
   but it must land **before** the tag so the notes are inside the tagged
   tree.

3. **Tag**, from `repo/`. Annotated, never lightweight, and the annotation
   restates the notes rather than quoting them — what shipped, the gate
   result, the honest caveat, then the notes path:

   ```bash
   git tag -a v0.7.0 \
     -m "flightcheck v0.7.0 — <one line: what a reader gets that they did not have>" \
     -m "<what shipped>" \
     -m "<the release gate, naming the evals report path>" \
     -m "<what this release does not have — user counts, measured claims — stated rather than left to be assumed>" \
     -m "Notes: docs/releases/v0.7.md"
   git tag -l -n99 v0.7.0
   ```

   Each `-m` becomes its own paragraph, and `-n99` prints the whole
   annotation back so you can read what a reviewer will read. A one-line
   annotation is the v0.1/v0.2 shape and has been superseded: `v0.5.0`'s is
   the convention.

4. **Run the release audit** against the repo as a stranger would meet it —
   landing copy, sample report, README, docs, changelog, and the deployed
   site, not just the source. It checks that the PRD preceded the code and
   still describes the product; that success metrics are numeric and dated;
   that `evals/` carries rubrics, a runnable suite and reports that are real
   run artifacts; that the live URL shows a reviewer something without a
   signup; that every tag has release notes; that the decision log records
   what was rejected and when to revisit, not only what was chosen; that any
   usage number states its real sample and never reads as customer data when
   it is self-test data; that the working contract in `CLAUDE.md` describes
   the process actually used; that the README works as a landing page; that
   `PLAYBOOK.md` gives patterns someone else can reuse; that the tree is
   English-only, MIT, and free of confidential content; and that `RETRO.md`
   is honest about what went wrong. **This is a hard gate: any failure blocks
   the release** — fix it, re-run the gates, re-tag if commits moved
   (`git tag -d v0.7.0`, tag again), and audit again. A finding is closed by
   fixing it, never by softening the standard it failed.

5. **Push**, only after the audit passes:

   ```bash
   git push origin main
   git push origin v0.7.0
   ```

   Railway and Vercel auto-redeploy from `main`. Re-run the two `curl` items
   from the smoke checklist against production, and confirm the newest Railway
   deployment itself reached SUCCESS (§2 step 3) — a green `/healthz` proves an
   image is alive, not that it is the image you just pushed.

6. **Publish the GitHub Release.** The tag alone puts nothing on the Releases
   page, which is where `README.md` sends a reviewer. The body is the notes
   file — but its relative links resolve against `/releases/` there and 404,
   so rewrite them to absolute blob URLs at this tag first (from `repo/`):

   ```bash
   TAG=v0.7.0
   BASE=https://github.com/bridgewright/flightcheck/blob
   sed -E "s#\]\(\.\./\.\./#](${BASE}/${TAG}/#g; s#\]\((v[0-9]+\.[0-9]+\.md)#](${BASE}/${TAG}/docs/releases/\1#g" \
     "docs/releases/${TAG%.0}.md" > /tmp/${TAG}-notes.md
   grep -n '](\.\./\|](v0\.' /tmp/${TAG}-notes.md   # must print nothing
   gh release create "$TAG" --title "$TAG — <the notes' one-line subject>" \
     --notes-file /tmp/${TAG}-notes.md
   ```

   Then verify, and open one rewritten link rather than trusting the rewrite:

   ```bash
   gh release list
   gh release view "$TAG" --json isDraft,isPrerelease,url
   ```

   Note for a reader, not a thing to fix: GitHub stamps every entry with when
   it was *published*, so releases created in one sitting all carry the same
   timestamp regardless of when their tags were cut. The `Released:` line
   inside each notes file is the dated record; the Releases page is not.
