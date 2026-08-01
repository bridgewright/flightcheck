# F-06 VAD bake-off — turn-detection config for the silence machinery (2026-08-01)

**Question (DECISIONS 009):** which turn-detection config should carry the
client-owned silence machinery — `semantic_vad`, or `server_vad` with
`create_response: false` and client-side response arming?

**Verdict: `server_vad` (900 ms tail) + `create_response: false`.** Not a
close call — semantic_vad failed a disqualifying metric in both eagerness
settings tested.

## Method

Scripted PCM16 tapes (macOS `say`-synthesized speech + digital silence,
24 kHz mono) streamed to the GA Realtime WS endpoint (`gpt-realtime`) at
real-time pacing (200 ms chunks), recording every server event with
timestamps plus send-side segment marks. Suite: `evals/suites/vad_bakeoff/`.

Tapes:

- **pause** — incomplete lead ("So the main metric we tracked was…") + 8 s
  silence + completing continuation + 5 s silence. Models the mid-answer
  thinking pause that defines the target audience.
- **complete** — one fully complete answer + 6 s silence.
- **filler** — incomplete lead + "um" every ~2 s (4×) + 5 s silence. Models
  filler-stalling.

## Results

| Metric | semantic_vad low | semantic_vad auto | server_vad 900ms + create_response:false |
| --- | --- | --- | --- |
| ① Commit after a complete answer | **NEVER within ≥12 s observed — 2/2 runs** | ~4.1 s | 0.9 s (deterministic) |
| ② Behavior during the 8 s thinking pause | perfect hold (0 events) | **false commit at ~4.4 s + spoken response** | commits at 0.9 s but **zero responses fire** — the client decides |
| ③ Response fired without client consent | n/a (never responded) | yes — and it **invented content** ("The main metric you tracked was customer adoption rate, correct?" — never said) | **0 in 3/3 runs** — `create_response: false` contract verified |
| ④ Filler ("um") handling | turn held, but see ⑤ | not run | each "um" commits as a 0.7–1.2 s episode → cleanly identifiable as a stall blip |
| ⑤ Event visibility for a client clock | **none while a turn is held** (no speech_stopped for the whole hold) | partial | full speech_started/stopped per episode |

## Why this settles it

- semantic_vad **low** swallowed a fully complete answer twice: no commit for
  the entire observation window. In production that is Morgan going silent
  after the candidate finishes — indefinitely. Disqualifying.
- semantic_vad **auto** broke the one behavior semantic_vad was supposed to
  buy: it interrupted an 8 s thinking pause at ~4.4 s, and the forced
  response hallucinated specifics. Disqualifying for this audience.
- Both semantic settings starve the client clock: while a turn is held, the
  server emits nothing, so the client cannot see the pause it must scaffold.
- server_vad + `create_response: false` is deterministic everywhere and
  moves 100% of response timing to the client, which composes exactly with
  the client-owned silence clock: premature commits become harmless (no
  response fires), filler commits are identifiable by episode duration, and
  the client's debounce + stall-blip filter decides when Morgan speaks.

## Limitations (read before citing)

- 1–2 runs per cell; synthesized voice prosody ≠ real speech; WS transport
  probed, production uses WebRTC (event availability may differ — the web
  implementation re-verifies the events it consumes).
- The semantic_vad no-commit result is reproducible (2/2) but its trigger
  conditions are opaque; a future model update could change it (revisit
  condition in DECISIONS 009).
