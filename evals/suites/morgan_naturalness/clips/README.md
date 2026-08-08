# Morgan session recordings (local only)

Recordings of real Morgan interview sessions, copied here by the operator
from the product's own session recordings. They are voice recordings and
are never committed (DECISIONS 005); everything in this directory except
this README is gitignored, and on any machine without the clips the suite
reports SKIPPED rather than failing.

File names match `cases.json` entries (`<case_id>.<ext>`; webm and mp4
both work — the metrics CLI transcodes through the scorer's existing
`ensure_wav`). Transcripts are cached under
`evals/out/morgan_naturalness/transcripts/`, keyed by audio content hash:
deleting `evals/out/` costs one Gemini transcription per case on the next
run, nothing else.

Fresh cycle recordings should be SHORT (about five minutes — a greeting
and a few turns is what the naturalness axes need); a short session ends
`insufficient` and preserves its slot.

When adding a Morgan case, record its structured `lever_state` in
`cases.json`: the short instructions commit, the VAD silence duration,
threshold and prefix padding, plus optional free text. The manifest documents
this operator contract; no code consumes `lever_state` yet.
