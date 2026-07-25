# Manual bake-off protocol

## A. Live persona sessions (criteria ③ ④)
Run `make webroom`, open http://localhost:8787, and use the two buttons. Per provider,
run 2 sessions × ~10 min. Wear headphones. During each session, elicit all four pressure
probes (talk long once; give one vague "we did X" answer; pause after an answer; say one
Korean sentence). End with the End button. Immediately after, copy
`manual/sheet-template.yaml` to `manual/{provider}-{n}.yaml` and rate 1–5 per criterion.
Order: alternate providers (O, G, O, G) to neutralize warm-up effects.

Why the browser and not the mic runner: the raw `sounddevice` path has no echo
cancellation, so the interviewer's own voice re-enters the mic and trips server VAD
mid-answer, and both providers end a turn after ~500 ms of silence — shorter than a
thinking pause. `getUserMedia` supplies AEC/NS/AGC, and the session room mints sessions
with a 900 ms VAD tail server-side. Rate interruption naturalness (criterion ③) from
these sessions; sessions run through the mic runner measure the harness, not the provider.

The page holds a short-lived provider credential, so the server binds 127.0.0.1 only.
Gemini live sessions are capped by the protocol (the websocket goes away around 10 min);
resumption is enabled, so a session may run past that — the page logs the handle updates
and the `go_away` warning.

**Fallback:** `make bakeoff-mic PROVIDER=openai` / `PROVIDER=gemini` still works and is
the only path that writes a jsonl event log to `out/{provider}-mic-{n}.jsonl`. Use it if
the browser path is unavailable — and discount ③ accordingly, for the reason above.

## B. Turn clips (Tasks 6 scenario input)
Record 4 clips of yourself answering interview questions in English, 20–40 s each,
into `clips/turns/turn{1..4}.wav` (any quiet room, phone or laptop mic, wav).

## C. Controlled delivery triplets (criterion ⑤)
Pick 2 questions. For each, record the SAME content three ways into `clips/q{1,2}/`:
- `fluent.wav` — steady pace, no fillers
- `filler.wav` — inject "um/uh/like" every sentence or two
- `hesitant.wav` — 2–4 s pauses mid-sentence, trailing off
Keep wording near-identical so delivery is the only variable. ~30 s each.

Clips contain a real person's voice → git-ignored by design (DECISIONS #005).
