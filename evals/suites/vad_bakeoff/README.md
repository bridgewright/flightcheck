# vad_bakeoff — F-06 turn-detection probe suite

Measures Realtime turn-detection configs against the three failure modes the
silence machinery must handle: mid-answer thinking pauses, complete-answer
transitions, and filler stalling. Results: `out/*.json`; findings:
`evals/reports/2026-08-01-f06-vad-bakeoff.md`; decision: DECISIONS 009.

## Regenerate the clips (not committed — synthesized, ~1 MB)

macOS `say` outputs 24 kHz mono WAV directly; the probe consumes raw PCM16:

```bash
mkdir -p clips && cd clips
say -v Samantha --file-format=WAVE --data-format=LEI16@24000 -o lead.wav \
  "So the main metric we tracked for that rollout was"
say -v Samantha --file-format=WAVE --data-format=LEI16@24000 -o cont.wav \
  "Sorry — the main metric was weekly active usage, which grew about twenty percent over the quarter."
say -v Samantha --file-format=WAVE --data-format=LEI16@24000 -o complete.wav \
  "In my last project I led the rollout of a new analytics dashboard, and we shipped it to three client teams within two months. That's the short version."
say -v Samantha --file-format=WAVE --data-format=LEI16@24000 -o um.wav "um"
python3 -c "
import wave, pathlib
for f in ['lead', 'cont', 'complete', 'um']:
    w = wave.open(f'{f}.wav')
    pathlib.Path(f'{f}.pcm').write_bytes(w.readframes(w.getnframes()))"
```

## Run

From `services/scorer` (resolves the venv and `OPENAI_API_KEY` via
`scorer.env`):

```bash
uv run python ../../evals/suites/vad_bakeoff/probe.py            # all combos
uv run python ../../evals/suites/vad_bakeoff/probe.py semantic:pause  # one combo
```

Each run writes `out/<config>-<tape>.json`: every server event with
timestamps plus send-side segment marks (`begin:`/`end:` per clip/silence),
so any event can be aligned against the exact audio position that caused it.
