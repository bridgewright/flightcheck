# Manual bake-off protocol

## A. Live persona sessions (criteria ③ ④)
Per provider, run 2 sessions × ~10 min: `make bakeoff-mic PROVIDER=openai` / `PROVIDER=gemini`.
During each session, elicit all four pressure probes (talk long once; give one vague "we did X"
answer; pause after an answer; say one Korean sentence). Immediately after, copy
`manual/sheet-template.yaml` to `manual/{provider}-{n}.yaml` and rate 1–5 per criterion.
Order: alternate providers (O, G, O, G) to neutralize warm-up effects.

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
