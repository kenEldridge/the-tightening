# Rhythm Notes Archive (Feb 25, 2026)

This file captures the long-form narrative that was previously in `rhythm.md`.
The active execution plan now lives in `rhythm.md`.

## Snapshot Summary

### Main objective
Build a data-first rhythm trainer that can:
1. ingest audio from YouTube/local,
2. extract beat/chord timeline,
3. allow quick corrections,
4. support trust validation by hearing generated output,
5. drive rhythm-focused piano practice.

### What was implemented by this snapshot
- Project model and persistence in `userData/rhythm-projects`.
- IPC for create/load/list/save timeline/import local media/normalize audio.
- Typed extraction error taxonomy.
- In-process analyzer (`RhythmAnalyzer`) with tempo, beat grid, chord detection, smoothing.
- One-bar-per-row chord timeline.
- Basic edit operations (`set_chord`, `shift_boundary`, `split_event`, `merge_with_next`).
- Hear It player with generated chords+bass, source playback, A/B switch, shared cursor.
- Lyrics fetch + structural alignment + project caching.
- Re-analyze hint inputs for key/tempo/time signature.

## Music Theory and Analyzer Notes

### Why v2 was needed
Raw chroma matching produced too many chord varieties. Simple songs could return many noisy symbols.

### Strategies added
- Two-pass detection:
  - pass 1 for rough chords,
  - detect likely key,
  - pass 2 with diatonic boost.
- Diatonic tiebreaking during smoothing.
- Single-bar anomaly absorption.
- Rare-chord consolidation by pitch-class overlap.
- One chord event per bar for easier visual inspection.

### Known analyzer weaknesses (at snapshot time)
- Key detection could miss on songs like Mull of Kintyre.
- Time signature classification could prefer 4/4 for 3/4 material.
- Vocal-energy heuristic was not reliable for instrument-heavy mixes.

## Lyrics Pipeline Notes

### Provider decisions
- LRCLIB worked well as primary.
- lyrics.ovh remained fallback due inconsistent reliability.

### Alignment approaches tried
1. Even distribution across bars (rejected).
2. Vocal-energy based sectioning (rejected in this domain).
3. Structural sectioning + bar distribution (kept as fallback baseline).

### Future improvement identified
Use LRCLIB `syncedLyrics` (LRC timestamps) when available, then map lines directly to bars.

## UX and Product Lessons

### What worked
- Data-first delivery gave clearer progress than UI-first iteration.
- A/B generated-vs-source playback was critical for trust.
- One-bar-per-row display made corrections faster.

### What remained weak
- Practice mode still manual and not transport-driven.
- MIDI scoring not fully wired.
- Loop controls not fully surfaced in timeline UI despite backend support.

## Benchmark Song Context

### Mull of Kintyre
- Useful stress case: 3/4 feel and simpler rhythm-chord core.
- Helped expose key/time-signature reliability issues.
- Helped reveal sparse lyric placement issues in structural alignment.

## Archived Prior Priorities (from narrative plan)
- Improve auto key and time-signature detection.
- Validate quality on more songs (4/4 and varied structures).
- Prefer timed lyrics where available.
- Complete transport-driven practice and live MIDI stats.

## Archive Policy
- Keep this file as historical context.
- Keep `rhythm.md` compact and execution-oriented.
- If major direction changes again, add a new dated archive file under `docs/`.
