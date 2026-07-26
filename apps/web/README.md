# apps/web — flightcheck web app

The Next.js (App Router) half of flightcheck: landing page, JD intake form,
cited rubric preview, the WebRTC voice session room, the session report, and
a no-signup sample report. Server routes hold every secret and broker the
FastAPI scoring worker (`services/scorer`), OpenAI Realtime ephemeral-secret
minting, and Supabase signed upload URLs — the browser itself holds only the
short-lived Realtime secret and the package access token in the URL. System
diagram: [docs/architecture.md](../../docs/architecture.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:3000
npm run test       # vitest
npm run lint
npm run typecheck
npx next build     # production build gate
```

## Environment variables (names only — values never enter the repo)

- `OPENAI_API_KEY` — mints OpenAI Realtime ephemeral client secrets
- `WORKER_URL` — the scoring worker base URL (Railway)
- `WORKER_API_TOKEN` — bearer token for worker calls (server routes only)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — mint signed upload URLs for
  the private `recordings` bucket

There are deliberately no `NEXT_PUBLIC_*` variables. Setup, deploy, and the
release smoke checklist live in [docs/deploy.md](../../docs/deploy.md).
