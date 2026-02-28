# Prompt: Plan Key-Invariant Chord Representation

You are planning a refactor for a rhythm/chord analyzer in an Electron music learning app. Write a concrete implementation plan and save it to `plans/key-invariant-chords.md`.

## Context

The app analyzes audio to detect chords per beat. Currently it works in absolute pitch space: extract chroma (12 pitch classes C through B), match against absolute chord templates (e.g., "C major" = C,E,G), then use a key hint to boost diatonic chords by 1.3x. This means changing the key requires full re-analysis.

The insight (from https://keneldridge.github.io/the-derple-dex/blog/melody-as-log-derivative/) is that melody and harmony are defined by interval ratios, not absolute frequencies. In log-frequency space, transposition is just a constant offset that cancels in the derivative. Applied to chords: if we rotate the chroma vector so the key root is at index 0, we can match against relative templates (I, ii, iii, IV, V, vi, vii°) and store Roman numerals. Rendering in any key is then a lookup table swap with zero re-analysis.

## Current Architecture

All analysis lives in `src/core/rhythmAnalyzeCore.ts` (~1400 lines). Key functions:

1. **`extractChroma(frame, sampleRate)`** — Goertzel algorithm, returns `Float32Array(12)` of pitch class energy [C, C#, D, ..., B]
2. **`matchChroma(chroma, diatonicChords?)`** — cosine similarity against `CHORD_TEMPLATES` (absolute templates like `{symbol: 'C', template: [1,0,0,0,1,0,0,1,0,0,0,0]}`). Optional diatonic boost of 1.3x.
3. **`detectKey(rawChords, chromaHistogram, keyHint?)`** — if keyHint provided, uses it directly. Otherwise uses chord-frequency voting + Krumhansl-Schmuckler chroma correlation.
4. **`detectChordsPerBeat(audio, sampleRate, beatGrid, keyHint?)`** — two-pass: first pass unbiased chord detection to detect key, second pass with diatonic bias. Returns `{chords, detectedKey}`.
5. **`consolidateChords(rawChords, diatonicChords)`** — removes rare non-diatonic chords, replaces with nearest diatonic.
6. **`smoothChords(chords, beatGrid)`** — per-bar majority vote to produce final `ChordEvent[]`.

The output is `ChordEvent[]` stored in `ChordTimelineArtifact` (persisted to disk as JSON). Each `ChordEvent` has: `id, symbol, barStart, startTime, endTime, source, confidence`.

The `symbol` field currently holds absolute chord names like "A", "E", "F#m", "D".

## What the Plan Should Cover

### Phase 1: Internal Representation Change
- Add a `degree` field to `ChordEvent` (Roman numeral: "I", "ii", "iii", "IV", "V", "vi", "vii°")
- Rotate chroma by detected key root before matching, so templates are relative
- Define relative chord templates (I major, ii minor, iii minor, IV major, V major, vi minor, vii° diminished) — these are the same 7 templates just anchored at degree 0
- `matchChroma` operates on rotated chroma against relative templates
- `symbol` field continues to hold the rendered absolute name for backward compatibility
- Store `keyRoot` (0-11 pitch class) in `ChordTimelineArtifact` so we know what key was used

### Phase 2: Key Transposition Without Re-analysis
- Add a function `transposeTo(timeline, newKeyRoot)` that:
  - Takes the stored `degree` on each chord
  - Renders new absolute `symbol` values for the new key
  - Updates `keyRoot` in the artifact
- Wire this into the UI (a key selector dropdown on the timeline view)
- The 1.3x diatonic boost hack in `matchChroma` should become unnecessary since we're matching against diatonic-only relative templates

### Phase 3: Eval Harness Compatibility
- The eval harness (`src/eval/evaluationHarness.ts`) compares predicted chord symbols to ground truth labels
- Ground truth in `ground-truth/chord_labels.csv` uses absolute symbols (F, C, Bb, etc.)
- The eval needs to compare against the rendered symbols for the correct key, OR convert ground truth to Roman numerals too
- Ensure `npx tsx scripts/run-eval.ts --analyze` still works and produces comparable metrics

## Constraints
- This is a TypeScript codebase (strict mode, ESM)
- The analyzer must remain a pure function (no browser/Node deps) — it lives in `rhythmAnalyzeCore.ts`
- Backward compatibility: existing saved projects with absolute-only chord symbols must still load and display correctly
- The plan should be scoped to what can be built in 2-3 focused sessions
- Keep changes minimal — don't redesign the whole pipeline, just rotate the representation

## Deliverables
Write the plan as a markdown file with:
1. Exact files to modify/create
2. Function signatures for new/changed functions
3. Data structure changes (show before/after for ChordEvent and ChordTimelineArtifact)
4. Migration strategy for existing saved projects
5. Verification steps (unit tests, eval parity check)
