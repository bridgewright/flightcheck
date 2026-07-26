# Architecture

## v0.1 system (shipped)

```mermaid
flowchart LR
    B[Browser<br/>landing / intake / session room / report]
    W[Next.js server routes<br/>Vercel — holds secrets]
    K[Scoring worker — FastAPI<br/>Railway — services/scorer]
    S[(Supabase<br/>Postgres + Storage)]
    OAI[OpenAI Realtime<br/>gpt-realtime interviewer]
    G[Gemini 2.5 Flash<br/>research / rubric / transcribe / judge]

    B -->|JSON, audio blob upload| W
    B <-->|WebRTC audio + oai-events data channel| OAI
    W -->|Bearer WORKER_API_TOKEN| K
    W -->|mint ephemeral client secret| OAI
    W -->|recordings bucket upload| S
    K -->|package/session state, recordings download, corpus sync| S
    K -->|file-based generate_content| G
```

### Data flow (one package, one session)

1. **Intake** — the browser POSTs JD text or URL plus optional resume/LinkedIn
   PDFs (base64) to a Next.js route, which forwards to the worker with the
   bearer token. The worker answers `202 {package_id, access_token}` and starts
   `compile_package` in the background. The browser never talks to the worker.
2. **Compile** — the worker normalizes intake (JD fetch, PDF extraction, profile
   build), runs the grounded research sweep (two-step: search with citations,
   then structure), and compiles the BARS rubric against the private corpus and
   few-shots. Package status: `compiling → ready | failed`. The package page
   polls by access token and renders the cited rubric preview.
3. **Session** — Start Session creates a session row with a baseline
   `SessionPlan` and interviewer instructions. The session room mints a
   short-lived OpenAI ephemeral secret server-side, opens WebRTC to
   `gpt-realtime` ("Morgan"), records the candidate locally (webm), and uploads
   the recording to the private `recordings` bucket on completion.
4. **Score** — completing the session flips it to `scoring` and runs the
   pipeline: download → `ensure_wav` (ffmpeg) → verbatim transcription → DSP
   delivery metrics → content judge (transcript vs BARS anchors) → delivery
   judge (actual audio; DSP conflicts flagged) → `compile_report` with the
   report-language lint. Status: `scoring → scored | failed`.
5. **Report** — the report page polls the session until `scored` and renders the
   verdict, per-dimension evidence, delivery metrics, and drills. Failures are
   shown honestly, never papered over.

**Secrets boundary:** the browser holds exactly one credential — the short-lived
Realtime ephemeral secret. Every long-lived key (`OPENAI_API_KEY`,
`GEMINI_API_KEY`, `WORKER_API_TOKEN`, Supabase service role) lives in Vercel or
Railway server env only.
