# Deploy runbook — flightcheck

Three deploy units: `apps/web` on Vercel, `services/scorer` on Railway, Supabase for
Postgres + Storage. This file lists **env var names only** — values live in each
platform's secret store and are never written into the repo, logs, or docs.

Sections 0–4 are the standing runbook, current as of **v0.5.0 (2026-08-03)**.
Section 5 is the first-launch ritual, written in the tense it was run in for
v0.1 and left that way — those steps happened. The one part of it that is not
one-time is the anonymization checklist in §5.1.2: it re-runs whenever the
public sample report is regenerated, and it now carries the record of the
release where it was ticked without being satisfied.

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
   — as of v0.5 that is `001_init.sql`, `002_scoring_stage.sql`,
   `003_accounts_multisession.sql`, `004_session_transcript.sql`,
   `005_payments_trial_expiry.sql`: paste each file's full contents, run it,
   confirm `Success. No rows returned`, then move to the next. Later migrations
   assume earlier ones already ran, so the order is not optional. `001_init.sql`
   creates the `packages` and `sessions` tables. When upgrading an existing
   deployment, apply any new migration files **before** deploying the worker
   build that uses them — the worker assumes its columns exist.
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

- [ ] `curl -s https://<railway-domain>/healthz` returns `{"ok":true}`
      (unauthenticated).
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

   > **This checklist has failed once — recorded 2026-08-03.** The client
   > reference box above was ticked at the v0.1 launch and was not actually
   > satisfied. `apps/web/public/sample-report.json` — the fixture behind
   > `/sample-report`, which is the no-signup surface the README sends every
   > reviewer to — shipped with evidence quotes reading "one of my clients when
   > I was in consulting firm", "we collected the whole data that the client
   > was actually managing", and a judge rationale naming "a consulting firm".
   > It stayed live in production from v0.1 until the v0.5 release audit found
   > it; neutralized at `2ffd643`.
   >
   > What the box missed: no name and no employer string was in that file, so
   > the name and employer greps in step 3 came back clean and the item read as
   > done. The identifier was **relational** — a client existing at all places
   > the speaker inside a client-serving firm, and the engagement detail
   > narrows it further. Two working rules from it: this item cannot be
   > discharged by grep, only by reading every evidence quote and rationale end
   > to end and asking what the sentence implies about where the speaker
   > worked; and the fixture is regenerated by step 1 from a live session, so
   > passing once does not carry forward — the checklist runs again in full
   > every time the sample is refreshed.

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

5. **Restore the "real session" banner wording.** In
   `apps/web/app/sample-report/page.tsx`, replace the synthetic-data banner
   text ("Illustrative sample report — synthetic data ... replaces this at
   launch.") with:

   > Sample report from a real practice session (anonymized).

   This wording is only true after steps 1–4 above succeeded — never commit
   it over the synthetic fixture.
6. Confirm the web app still builds with the new fixture and banner (from
   `repo/apps/web/`): `npm run typecheck` and `npx next build`, both exit 0.
7. Commit (from `repo/`):

   ```bash
   git add apps/web/public/sample-report.json apps/web/app/sample-report/page.tsx
   git commit -m "feat(web): swap sample report for real anonymized session" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
   ```

8. Update `README.md`: replace every `PENDING-DEPLOY-URL` placeholder in the
   "v0.1 — live" section with the Vercel production URL, link the demo GIF
   from section 5.1a, delete the operator TODO note, verify
   `grep -n PENDING-DEPLOY-URL README.md` prints nothing, and commit.

### 5.1a Record the demo GIF (README landing material)

The smoke session **is** the demo material — capture it while running
section 4's full loop (screen-record intake → rubric preview → a session-room
moment → the report verdict; keep it under ~30 s, no audio needed for the
GIF). Check the same anonymization boxes as 5.1.2 for anything visible
on-screen, commit the GIF (or a `docs/` asset + link), and reference it from
`README.md`'s "v0.1 — live" section (step 8 above).

### 5.2 Tag and publish

1. Re-run every gate in the pre-deploy checklist (a tag never goes on a tree
   that was not just verified), then tag from `repo/`:

   ```bash
   git tag -a v0.1.0 -m "flightcheck v0.1.0 — full loop live: JD intake to honest session report"
   git tag -l v0.1.0
   ```

2. Run the full 12-rule impression audit against the repo as it would appear
   publicly (landing copy, sample report, README, docs, changelog). This is a
   **hard gate**: any failing rule blocks the release — fix, re-run the gates,
   re-tag if commits moved (`git tag -d v0.1.0`, tag again), audit again.
3. Only after all 12 rules pass, push:

   ```bash
   git push origin main
   git push origin v0.1.0
   ```

   Railway and Vercel auto-redeploy from `main`. Re-run the two `curl` items
   from the smoke checklist against production as a final sanity check.
