#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

say \
  --voice Samantha \
  --rate 165 \
  --data-format=LEI16@16000 \
  --output-file "$SCRIPT_DIR/golden.wav" \
  'Welcome. Tell me about a project you enjoyed. [[slnc 1800]] I built a small flight planner and tested it with friends. [[slnc 2000]] What did you learn from their feedback? [[slnc 1700]] I learned to simplify the first screen and explain each result clearly.'

if [ ! -s "$SCRIPT_DIR/golden.wav" ] ||
  [ "$(wc -c < "$SCRIPT_DIR/golden.wav")" -le 4096 ]; then
  echo "say did not produce audio; check macOS speech access" >&2
  exit 1
fi

echo "Wrote $SCRIPT_DIR/golden.wav"
