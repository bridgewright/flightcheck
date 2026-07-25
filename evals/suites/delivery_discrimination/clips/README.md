# delivery_discrimination clips (evals layer 3)

Controlled clips for the delivery-channel discrimination check. The `.wav`
files are voice recordings and are **gitignored** (DECISIONS #005) — only this
README is committed. Each operator copies or records the clips locally.

## Naming convention

Three takes of the same answer per question, at different delivery quality:

    <question>-fluent.wav      steady pacing, minimal fillers, no long pauses
    <question>-filler.wav      same content, loaded with fillers ("um", "uh", ...)
    <question>-hesitant.wav    same content with long (>= 1 s) pauses and restarts

All three files must exist for a question or the run aborts with an error.

## Populate from the existing bake-off clips

The W1 bake-off recorded exactly these takes as
`evals/suites/bakeoff/clips/q{1,2}/{fluent,filler,hesitant}.wav` (already WAV,
no conversion needed). From the repo root:

    for q in q1 q2; do
      for v in fluent filler hesitant; do
        cp "evals/suites/bakeoff/clips/$q/$v.wav" \
           "evals/suites/delivery_discrimination/clips/$q-$v.wav"
      done
    done

## Recording new triplets

Record a 45-60 s answer once per variant, then convert to WAV (Gemini and the
DSP both consume WAV; webm is not supported by the Gemini file API):

    # macOS built-in
    afconvert -f WAVE -d LEI16@16000 -c 1 in.m4a q3-fluent.wav
    # or ffmpeg
    ffmpeg -i in.webm -ac 1 -ar 16000 q3-fluent.wav

## Run (from services/scorer/)

    uv run scorer-evals

The layer-3 suite runs only when clips are present; otherwise the regression
gate reports it as SKIPPED (visible, never silently passing).
