# Ground Truth Data

Annotation data for evaluating rhythm detection accuracy.

## Files

- `bar_anchors.csv` — Bar start times (songId, bar, timeSec, source)
- `chord_labels.csv` — Chord labels per bar (songId, bar, symbol, source)
- `snapshots/` — Determinism test snapshots (run `npx tsx scripts/run-eval.ts --snapshot <songId>`)

## Sources

| Song | Anchors | Chords | Notes |
|------|---------|--------|-------|
| Hey Jude | Computed from 72 BPM, 4/4 | From `chordProgressions.ts` | Needs ear verification |
| Canon in D | Computed from 54 BPM, 4/4 | From `chordProgressions.ts` | Needs ear verification |
| Mull of Kintyre | Computed from 92.3 BPM, 3/4 | Not available | Needs ear verification + chord annotation |

## Methodology

1. **Computed anchors** are derived from constant tempo. Real audio has tempo variation, so these are approximate.
2. **MIDI-derived chords** come from `src/data/chordProgressions.ts` — simplified arrangements, not necessarily matching what the analyzer hears.
3. Anchors marked `source=ear` have been manually verified by listening. `source=computed` have not.
4. To improve ground truth, listen to the audio and adjust timeSec values, then change source to `ear`.

## Running Evaluation

```bash
# Generate/regenerate CSVs from code
npx tsx scripts/run-eval.ts --generate-ground-truth

# Run evaluation
npx tsx scripts/run-eval.ts

# Snapshot current analysis for determinism testing
npx tsx scripts/run-eval.ts --snapshot mull-of-kintyre
```
