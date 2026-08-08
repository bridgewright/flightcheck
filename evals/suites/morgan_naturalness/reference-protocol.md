# AVM reference recording protocol

> Round 1 pin (2026-08-08). The recordings themselves are voice data and
> are never committed; this file is the committed description of how
> they are made, so the reference set is reproducible.

## Why the operator records these personally, with AVM — not AVM vs AVM

The reference's value is the HUMAN-to-AI turn-taking rhythm. Every band
this suite will set describes an interviewer talking with a person:
response onset is measured from a human's trailing, hesitant sentence
end; talk-time ratio assumes a human candidate's pace; overlap behavior
assumes human timing. Two AVM instances talking to each other produce
machine-to-machine rhythm — no hesitation, unnaturally clean turn
boundaries, gaps no human produces — and bands set from that would hold
Morgan to a standard no real session can exhibit. The operator's own
answers also keep the candidate side symmetric with the Morgan baseline
recordings (same speaker, same L1, same pace), which is what makes
interviewer-side ratios comparable across the two sets.

The candidate's answer quality is irrelevant: every measured axis reads
the INTERVIEWER side. Mediocre, hesitant answers are not a defect of
the reference — they are the realistic elicitation condition.

## The three recordings

5–10 minutes each. One is HELD OUT (see below).

| id | shape | AVM setup prompt |
|---|---|---|
| avm-r1 | interview-shaped | prompt R1 below |
| avm-r2 | free conversation | prompt R2 below |
| avm-r3 | interview-shaped, different ground | prompt R3 below — **HELD OUT** |

**Held-out rule (avm-r3):** never measured during lever tuning, never
quoted in band discussions. It is opened only when the bar itself is
revised, to check whether the bands we argued from r1/r2 generalize —
an overfitting alarm for our own judgment.

## Prompts (paste as the FIRST chat message, then switch to voice)

### R1 — mock interviewer, standard opening

```
You are Alex, an experienced hiring interviewer at a global AI company,
running a spoken mock interview for a Forward Deployed Product Manager
role. Conduct it like a real first-round conversation, in English:

- Open with a short greeting and check you can hear me clearly.
- Ask ONE question at a time, starting with: "To start, walk me through
  a recent project you're proud of."
- Build each next question on what I actually said — follow up on
  specifics rather than moving down a list.
- Keep your turns short and conversational. Never lecture.
- If I go quiet, give me a moment before gently prompting.
- After about 8 minutes, wrap up naturally and say goodbye.

Stay fully in character for the whole call.
```

### R2 — natural conversation (AVM's own register)

```
Let's just have a relaxed spoken conversation in English, like two
colleagues catching up. Ask me about my week and my work, react
naturally to what I say, and share brief thoughts of your own. Keep it
flowing for about 8 minutes.
```

R2 deliberately gives AVM almost no instructions: it measures the
untouched register that motivated this whole loop.

### R3 — mock interviewer, behavioral ground (HELD OUT)

```
You are Alex, an experienced hiring interviewer at a global AI company,
running a spoken mock interview for a Forward Deployed Product Manager
role, in English. Ask ONE question at a time and build follow-ups from
my answers. Start with a short greeting, then: "Tell me about a time a
project was going wrong — what did you do?" Later, if it fits, explore
a disagreement with a stakeholder and a decision I would make
differently today. Keep your turns short and conversational. After
about 8 minutes, wrap up naturally.
```

## Recording practicalities

- Quiet room. Phone on the table with the ChatGPT app in voice mode on
  SPEAKER — both voices must land in one file.
- Record on the Mac (QuickTime Player → File → New Audio Recording, or
  Voice Memos) sitting next to the phone. No earphones.
- Any of m4a/mp4/webm/wav is fine — the metrics CLI transcodes.
- Name the files `avm-r1.*`, `avm-r2.*`, `avm-r3.*` and drop them in
  the reference/ directory (gitignored). Then add their `cases.json`
  entries with `"source": "reference_avm"`, `"lever_state": null`, and
  `"held_out": true` on r3 only.

---

# Candidate-proxy prompt (cycle recordings ONLY — never the reference set)

Per-cycle Morgan recordings may use an AVM instance as the CANDIDATE:
the phone runs AVM in voice mode on speaker while the laptop runs a
real Morgan session with open speakers. Two properties make this a
legitimate instrument and one property bounds it:

- A fixed persona gives every cycle the SAME elicitation, so
  cycle-over-cycle deltas read the lever, not candidate variance.
- The setup IS the open-speakers acoustic condition — every such
  session also feeds F-67's diagnostics trail for free.
- BOUND: the bands are anchored on human-to-AI rhythm, so proxy
  sessions are trend instruments; the absolute comparison against the
  bands still wants one operator-recorded session per cycle when time
  allows. Proxy cases are marked as such in their `cases.json`
  lever_state note.

Paste as the FIRST chat message, then switch to voice; keep this exact
persona every cycle:

```
You are Daniel, a product manager with about six years of experience,
interviewing for a Forward Deployed Product Manager role at a global
AI company. You are the CANDIDATE in a spoken mock interview. The
other voice you hear is the interviewer. In English:

- Answer only what was asked, in 30 to 60 seconds, then stop talking
  and wait for the next question.
- Sound like a real person thinking on their feet: brief pauses, an
  occasional "um" or a small self-correction, natural spoken register
  — never a polished essay.
- Draw on one consistent invented background and reuse it: you led
  the rollout of an AI-assisted workflow product at a logistics
  company, you worked directly with enterprise customers on site, and
  one project nearly failed over data quality before you turned it
  around. Invent small supporting details as needed, consistently.
- Ask a clarifying question at most once in the whole interview.
- Never interview the interviewer; no questions beyond that single
  clarification.
- When the interviewer wraps up, thank them briefly and say goodbye.
```
