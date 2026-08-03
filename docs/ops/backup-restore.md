# Backup and restore

What this covers: everything a running flightcheck deployment holds, where a
second copy of it lives, and — the part that matters when it matters — the
exact commands to put it back.

Written to be followed by someone who is stressed, possibly on a phone
hotspot, possibly at 2am. No step says "restore from the dashboard"; every
step says which button or which command.

**Scope note.** This is v0.6 operational reality for a single-operator
product, not an enterprise DR plan. Where the honest answer is "there is no
second copy", it says so instead of implying one.

---

## 1. What exists, and what backs it up

| Asset | Where it lives | Second copy | Rebuildable? |
| --- | --- | --- | --- |
| Postgres (packages, sessions, reports, transcripts, orders) | Supabase Postgres | Supabase automated daily backups (plan-dependent, see §2) | No |
| Session recordings | Supabase Storage, `recordings` bucket (private) | **None** | Yes — a customer can run the session again |
| Rubric corpus + few-shots | Supabase Storage, `corpus` bucket (private) | **Only what you take with `tools/backup_corpus.py`** | **No** |
| Application code | GitHub | Every clone | n/a |
| Migrations | `docs/supabase/migrations/*.sql` in git | Every clone | n/a |
| Secrets | Railway + Vercel + Supabase secret stores | Your password manager | No |

Two lines in that table are the reason this document exists.

**The corpus is the only asset with no second copy and no way to rebuild
it.** It is confidential, so by workspace rule it is deliberately not in
this public repo. It was assembled by hand. It exists in exactly one
bucket. And losing it is *silent*: `SupabaseStorage.sync_corpus` over an
empty bucket returns an empty directory, the rubric compiler writes
"(no corpus documents provided)" into its prompt, and every rubric compiled
from that moment on is quietly worse than the ones before it. No exception,
no log line, no alert — just a product that has stopped being as good as it
was, discovered weeks later by reading a bad rubric. Back it up.

**Recordings are not backed up, on purpose.** They are large, they are the
most sensitive thing here, and the product's own privacy promise is that
they are deleted when the customer asks. A backup of recordings is a copy
of customer audio that survives deletion — which would make the deletion
promise false. If the bucket is lost, the honest answer to affected
customers is that the recording is gone and the session can be re-run; the
report and transcript survive in Postgres.

---

## 2. Postgres

### Backup

Supabase takes automated backups. **Confirm the retention your plan actually
has** — Dashboard → Project Settings → Database → Backups. Free-tier
projects have historically had *no* automated backups; a paid plan has daily
ones with point-in-time recovery as an add-on. Look at the page and write
today's answer here:

- Plan: `_______________`
- Automated backup frequency: `_______________`
- Retention: `_______________`
- Checked on: `_______________`

If that page shows no backups, take a manual dump before anything else:

```bash
# From anywhere. Connection string: Supabase Dashboard -> Connect -> Session pooler.
# Never paste this string into a shell that logs history to a synced file.
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges \
  --file "flightcheck-$(date -u +%Y-%m-%d).sql"
```

### Restore

1. **Stop writes first.** Railway → the scorer service → **Remove** the
   deployment, or set the service to 0 replicas. A worker writing into a
   database you are restoring produces a state that matches neither.
2. Restore:
   - *From a Supabase automated backup:* Dashboard → Database → Backups →
     the backup → **Restore**. This replaces the whole database and takes
     the project offline while it runs.
   - *From a `pg_dump` file:*
     ```bash
     psql "$SUPABASE_DB_URL" --file flightcheck-YYYY-MM-DD.sql
     ```
3. **Re-apply any migration newer than the backup**, in filename order, from
   `docs/supabase/migrations/`. A restore rolls the schema back too, so a
   backup taken before `006_token_hygiene.sql` comes back without those
   columns and the current worker will fail on every session read.
4. Verify before restarting the worker:
   ```bash
   psql "$SUPABASE_DB_URL" -c "select count(*) from packages;" \
                           -c "select count(*) from sessions;" \
                           -c "select count(*) from orders;"
   ```
5. Redeploy the Railway service and confirm `/healthz`:
   ```bash
   curl -s https://<railway-domain>/healthz
   ```

**Known consequence of a restore: rows and blobs can disagree.** Sessions
restored from before a recording was uploaded point at a `audio_path` that
exists, and sessions deleted after the backup come back pointing at
recordings that were removed. The product degrades honestly here — a missing
recording hides the player rather than failing the page — but the counts
will not match. Do not treat that as a second incident.

---

## 3. The rubric corpus

This is the one that needs a human to remember it. `tools/backup_corpus.py`
is the whole procedure.

### Backup

```bash
cd services/scorer
uv run python tools/backup_corpus.py backup --dest ~/flightcheck-backups
```

Writes `~/flightcheck-backups/corpus-YYYY-MM-DD/` containing every `*.md`
at the bucket root, every `fewshot/*.json`, and a `MANIFEST.sha256`. It
refuses to write into a directory that already exists, and it downloads
everything before writing anything — a directory holding half the corpus
under a manifest that vouches for it is worse than no backup at all.

An empty bucket aborts with a non-zero exit and writes nothing, rather than
leaving an empty directory that would read as a backup six months from now.
If you see that and the project is not brand new, **stop and treat it as the
incident**, not as a backup problem.

**Cadence: after every corpus edit, and before every release.** The corpus
changes rarely and by hand, which is exactly the pattern that gets
forgotten. Two minutes.

**Where the backup lives.** Not in this repo — it is confidential. An
encrypted directory on the operator's machine plus one encrypted copy
somewhere that is not that machine. A backup that only exists on the laptop
does not survive the laptop.

### Verify (any time, without this repo)

```bash
cd ~/flightcheck-backups/corpus-2026-08-03
shasum -a 256 -c MANIFEST.sha256
```

The manifest is written in `shasum -c` format on purpose: verifying a backup
in two years must not require this tool, this repo, or a working Python.

### Restore

```bash
cd services/scorer

# 1. Dry run FIRST. Verifies the manifest and prints what it would upload.
uv run python tools/backup_corpus.py restore --from ~/flightcheck-backups/corpus-2026-08-03

# 2. Then, and only then:
uv run python tools/backup_corpus.py restore --from ~/flightcheck-backups/corpus-2026-08-03 --execute
```

The restore verifies every checksum before it uploads anything, in the dry
run as well as the real one — the bucket *is* the other copy, so uploading a
corrupted backup over it is unrecoverable, and finding out at `--execute`
time is finding out too late.

After a restore, confirm the corpus is actually being read: compile one
rubric and check it carries citations. A rubric compiled with an empty
corpus produces dimensions with no citations, which is the same symptom as
the loss you just fixed.

---

## 4. Secrets and worker-token rotation

Secrets live in three places and nowhere else: Railway (worker), Vercel
(web), Supabase (its own keys). They are never in the repo, never in logs,
never in this document. Keep a copy in a password manager — a lost
`WORKER_API_TOKEN` is not recoverable from either platform's UI, only
replaceable.

### Rotating `WORKER_API_TOKEN`

This is the containment lever for a leaked token or a spend incident, and it
is also the reason to rotate on a schedule. **The web and the worker share
one token today** — there is no per-user authorization on the worker, so
this single value is what stands between the internet and every compile and
scoring call. Per-user worker authz is v0.7; until then, rotation is the
mitigation and it is manual.

**There is a window.** The token exists in two platforms that deploy
independently, so between the two updates one side is wrong and every worker
call 401s. Expect roughly 1–3 minutes of failed API calls. Plan accordingly:

1. Generate the new value:
   ```bash
   openssl rand -hex 32
   ```
2. **Railway first, Vercel second.** Railway → scorer service → Variables →
   set `WORKER_API_TOKEN` → the service redeploys. During the redeploy the
   *old* container is still serving with the *old* token, so the web keeps
   working right up until the new container takes over.
3. The moment Railway reports the new deployment **SUCCESS** (check the
   deployment id changed — a failed build leaves the old image serving and
   looks identical from outside), set the same value on Vercel →
   Settings → Environment Variables → `WORKER_API_TOKEN`, then
   **redeploy** the web project. Vercel does not pick up a variable change
   without a new deployment.
4. Verify both halves:
   ```bash
   # Public health check still fine (never needed a token):
   curl -s https://<railway-domain>/healthz

   # The old token must now be refused:
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer <OLD-TOKEN>" \
     https://<railway-domain>/api/orders?user_id=whoami
   # expect 401

   # The new one must work:
   curl -s -o /dev/null -w "%{http_code}\n" \
     -H "Authorization: Bearer <NEW-TOKEN>" \
     "https://<railway-domain>/api/orders?user_id=00000000-0000-0000-0000-000000000000"
   # expect 200
   ```
5. Load the production site and open `/packages`. A page that renders the
   package list is the real end-to-end proof that Vercel is using the new
   value; the curl above only proves the worker accepts it.
6. Delete the old value from the password manager. A retired token that is
   still written down is still a credential.

**Rotate when:** the token has appeared anywhere it should not (a log, a
screenshot, a support thread), a spend anomaly needs stopping immediately
(step 2 alone halts every worker call), or on a cadence — at minimum, at
every release that changes who has access.

### The other secrets

`GEMINI_API_KEY`, `OPENAI_API_KEY`: rotate in the provider console, then
update Railway (both) and Vercel (`OPENAI_API_KEY`). Same
Railway-then-Vercel ordering, same redeploy requirement on Vercel.

`SUPABASE_SERVICE_ROLE_KEY`: rotating this invalidates it everywhere at
once — Railway and Vercel both hold it, and both break the instant it
changes. Only rotate with both dashboards already open, and expect a longer
outage window than the worker token.

---

## 5. Full-loss drill

The procedure above is only real if it has been walked. Rebuild from
nothing, on a scratch Supabase project, and time it:

1. New Supabase project. Run every file in `docs/supabase/migrations/` in
   filename order (see `docs/deploy.md` §1).
2. Create both buckets, `recordings` and `corpus`, **private**.
3. Restore the corpus:
   ```bash
   cd services/scorer
   SUPABASE_URL=<scratch-url> SUPABASE_SERVICE_ROLE_KEY=<scratch-key> \
     uv run python tools/backup_corpus.py restore --from ~/flightcheck-backups/corpus-YYYY-MM-DD --execute
   ```
4. Point a scratch Railway service at the scratch project and confirm
   `/healthz`.
5. Compile one rubric end to end and confirm **every dimension carries at
   least one citation** — that is the check that proves the corpus really
   came back, as opposed to the bucket merely existing.
6. Tear the scratch project down.

Record the date and the wall-clock time it took, here:

- Drill run on: `_______________` — took: `_______________`
- Notes / what was missing from this document: `_______________`

An undated drill line is the honest state of this document: the procedure is
written and its commands are the real ones, but it has not yet been walked
end to end against a scratch project. Fill it in the first time it is.
