# Rhythm Plan Revision (Analyzer + Lyrics First, Feb 26, 2026)

## Summary
Primary loop for this phase:

`analyze -> align lyrics -> correct -> reanalyze`

Scope files:
- `src/core/RhythmAnalyzer.ts`
- `src/core/lyricsAlign.ts`
- `src/core/rhythmTypes.ts`
- `src/core/timelineEditor.ts`
- `src/components/RhythmPage.tsx`
- `src/main/projectStorage.ts`

MIDI/practice polish is deferred. Structural reliability and lyric alignment intent preservation are the active top priority.

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| A | Beat Grid Reliability | DONE |
| B | Vocal-Energy Baseline Lyrics | DONE |
| C | Scoped Corrections + Intent Preservation | DONE |
| D | Section Fingerprint Design | DONE |
| E | External Evidence Fusion | SKIPPED |
| G | Fix Correction → Reanalyze (line scope) | DONE |
| H | Scope Chooser UI + Global Offset Unification | DONE |

## Out of Scope (Deferred)
1. MIDI scoring and transport-driven practice improvements.
2. Practice UX work unrelated to analyzer and lyrics trust.
3. New audio engine capabilities.

## Phase A: Beat Grid Reliability — DONE

Onset-peak extraction, beat nudging (weighted toward nearest onset peak), per-beat confidence, deterministic time-signature decision with exposed diagnostics.

Constants: `BEAT_NUDGE_WEIGHT=0.6`, `BEAT_NUDGE_MAX_SHIFT_SEC=0.08`, `BEAT_NUDGE_SEARCH_WINDOW_SEC=0.12`.

## Phase B: Vocal-Energy Baseline Lyrics — DONE

`estimateIntroBars()` uses 3-bar median smoothed vocal energy, dynamic threshold `T = max(0.55, medianEnergy + 0.1)`, first run of 3 consecutive bars above T. Falls back to length heuristic when vocal energy is missing on >50% bars. `computeBarLyricWeights()` de-prioritizes low-energy bars for structural lyric placement.

## Phases C+D: Scoped Corrections + Section Fingerprints — DONE

### Correction system
- `lyric_correction` edit op with scope: `line | section_occurrence | section_class | global`
- Corrections stored in `timeline.edits[]` as single source of truth
- On reanalyze: carry over `lyric_correction` edits, regenerate baseline, then apply corrections
- Precedence: line > section_occurrence > section_class > global
- Line corrections: accumulate (sum deltas for same text+position)
- Section/global corrections: latest wins (last edit in array)

### Section fingerprints
Format: `<sectionType>|occ<N>|txt<textAnchor>|p<positionBucket>`
- Stable across reruns for unchanged song/audio
- Position bucket (decile) + occurrence index disambiguate repeated text

### Line-level targetKey
Format: `line|bar<N>|p<positionDecile>|txt<normalizedText>`
- Position decile disambiguates identical lyrics at different song positions
- Accumulation groups corrections within 10 bars with matching text
- Fuzzy matching: ±3 bar search window on reanalysis

## Phase G: Fix Correction → Reanalyze Iteration — DONE

Arrow buttons default to `line` scope. Single-line nudge no longer shifts entire section. Same-line corrections accumulate across multiple nudges.

## Phase H: Scope Chooser UI + Global Offset Unification — DONE

### Scope chooser
- Button group in timeline view: "This line" | "This section" | "Global"
- Default: "This line" (per-row arrow buttons)
- Section scope: shifts all lyrics in the current section (uses section fingerprint)
- Global scope: shifts all lyrics in the song

### Global offset unification
- `lyricsBarOffset` is now a legacy field, always 0
- Any existing non-zero `lyricsBarOffset` is migrated once to a `lyric_correction` with `scope: 'global'`
- All lyric shifts are managed through `lyric_correction` edits in `timeline.edits[]`
- Removed `lyricsBarOffset` from `AnalysisOptions` and the hints panel
- No more double-apply risk between `shiftLyricsByBars` and `applyLyricCorrections`

## Public Interface and Type Changes
1. `TimelineEditOp` includes `lyric_correction` with scope/targetKey/deltaBars.
2. `BeatEvent.confidence` is real per-beat confidence (not constant).
3. `AnalysisResult.meta` includes `timeSignatureDecision` diagnostics.
4. `AnalysisOptions.lyricsBarOffset` removed — global shifts are lyric_correction edits.
5. `buildLineTargetKey()` exported from lyricsAlign.ts for consistent key generation.

## Analysis Hints
Persisted via `projectSaveHints` IPC. Survive across reanalyses.
- Key hint (e.g., 'D', 'Am')
- Tempo hint (BPM)
- Time signature hint ('auto' | '3/4' | '4/4')

## Deferred Backlog
1. MIDI live scoring completion.
2. Practice transport lifecycle cleanup.
3. Loop UX polish outside analyzer/lyrics phase needs.
4. `section_class` scope support in UI (nudge all choruses at once).
5. "From here down" scope for systematic drift correction.
