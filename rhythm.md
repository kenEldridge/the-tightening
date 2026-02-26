# Rhythm Plan Revision (Analyzer + Lyrics First, Feb 26, 2026)

## Summary
Primary loop for this phase:

`analyze -> align lyrics -> correct -> reanalyze`

This revision is code-grounded to current implementation in:
- `src/core/RhythmAnalyzer.ts`
- `src/core/lyricsAlign.ts`
- `src/core/rhythmTypes.ts`
- `src/core/timelineEditor.ts`
- `src/main/projectStorage.ts`

MIDI/practice polish is deferred. Structural reliability and lyric alignment intent preservation are the active top priority.

## Current Code Findings (Ground Truth)
1. `buildBeatGrid(...)` currently creates a uniform grid with constant beat confidence `0.8`.
2. Onset strength is currently energy-difference based (not full spectral flux).
3. Dual 3/4 vs 4/4 chord-pipeline comparison already exists.
4. `detectVocalEnergyPerBar(...)` exists and writes `ChordEvent.vocalEnergy`.
5. `lyricsAlign.estimateIntroBars(...)` currently ignores `vocalEnergy` and uses song-length constants.
6. `TimelineEditOp` has no lyric correction op yet (`set_chord`, `shift_boundary`, `split_event`, `merge_with_next` only).
7. Project storage is raw JSON; old projects will be deleted and rebuilt rather than migrated.

## Scope
1. Analyzer structural reliability with explicit drift correction spec.
2. Vocal-energy-informed lyric baseline placement.
3. Scoped lyric correction model with deterministic reapply on reanalyze.
4. Integrate lyric corrections into timeline edit history.

## Out of Scope (Deferred)
1. MIDI scoring and transport-driven practice improvements.
2. Practice UX work unrelated to analyzer and lyrics trust.
3. New audio engine capabilities.

## Execution Plan

### Phase Dependencies and Parallelism
1. Phases A and B are independent and may be implemented in parallel.
2. Phases C and D are interdependent and should be implemented together.
3. Phase E (external evidence) is optional and runs after C+D if pursued.

### Phase A: Beat Grid Reliability (Option B, Concrete)
Goal: fix grid drift, not just smoothing side effects.

Scope files:
- `src/core/RhythmAnalyzer.ts`
- `src/core/rhythmTypes.ts`
- `src/components/RhythmPage.tsx` (confidence surfacing only)

Implementation:
1. Keep current onset strength function, but add onset-peak extraction:
   - local maxima on `strength[]`
   - peak threshold: `>= p75(nonzeroStrength)` per track
2. Extract beat-correction tuning literals into named constants in `RhythmAnalyzer.ts`:
   - `BEAT_NUDGE_WEIGHT = 0.6`
   - `BEAT_NUDGE_MAX_SHIFT_SEC = 0.08`
   - `BEAT_NUDGE_SEARCH_WINDOW_SEC = 0.12`
   - keep constants centralized for future `AnalysisOptions` exposure
3. Add onset-weighted beat correction after uniform grid creation:
   - predicted beat time = uniform beat time
   - search window per beat: `W = min(BEAT_NUDGE_SEARCH_WINDOW_SEC, 0.25 * beatDuration)`
   - if strongest peak found in `[-W, +W]`, apply:
      - `delta = peakTime - predictedTime`
      - `nudgedTime = predictedTime + BEAT_NUDGE_WEIGHT * delta`
      - clamp final shift to `[-BEAT_NUDGE_MAX_SHIFT_SEC, +BEAT_NUDGE_MAX_SHIFT_SEC]`
   - if no peak found, keep predicted time unchanged
4. Enforce monotonic beat order after nudging:
   - minimum spacing `>= 0.35 * beatDuration`
   - if violated, fall back to previous valid spacing
5. Replace fixed beat confidence with per-beat confidence:
   - onset support score (normalized local peak strength)
   - correction magnitude penalty (larger shifts lower confidence)
   - confidence floor for no-peak beats
6. Keep existing dual 3/4 vs 4/4 arbitration, but expose explicit decision metrics:
   - `score34`, `score44`, `accentPreference`, `winnerMargin`
7. Deterministic reruns:
   - deterministic tie-break ordering for equal scores
   - no random sources in decision path

Definition of done (pass/fail):
1. Mull of Kintyre time signature:
   - no-hint reruns (3 consecutive) all choose 3/4
2. Beat grid drift:
   - against manual bar-start fixture (first 60 bars), mean absolute bar-start error < 100 ms
3. Determinism:
   - same audio + same hints + same code returns identical time-signature winner and barCount on 5 reruns

### Phase B: Vocal-Energy-Informed Baseline Lyrics
Goal: baseline lyric placement should use available singing/instrumental evidence before user correction rules.

Scope files:
- `src/core/lyricsAlign.ts`
- `src/core/rhythmTypes.ts`

Implementation:
1. Replace `estimateIntroBars(...)` constants with vocal-energy-driven intro detection:
   - smooth `vocalEnergy` by 3-bar median
   - find first run of 3 bars with energy above threshold `T = max(0.55, medianEnergy + 0.1)`
   - intro ends at run start; clamp intro bars to `[0, 12]`
2. Fallback when vocal energy is unusable:
   - if missing on > 50% bars, revert to current length-based heuristic
3. Structural fallback mapping uses vocalEnergy as bar weight:
   - low-energy bars are de-prioritized for lyric line placement
   - preserve section ordering and minimum 1-bar line spacing
4. Keep timed lyrics (LRC) highest priority when available

Definition of done:
1. On a fixture with known vocal onset, intro bar estimate matches expected onset window.
2. Structural fallback avoids placing dense lyrics in clearly instrumental intro bars when vocalEnergy is present.

### Phase C: Scoped Corrections + Reanalyze Intent Preservation
Goal: corrections apply at intended scope, not accidental global shift.
Dependency note: implement together with Phase D because `targetKey` depends on the section fingerprint scheme.

Scope files:
- `src/core/rhythmTypes.ts`
- `src/core/timelineEditor.ts`
- `src/components/RhythmPage.tsx`
- `src/core/lyricsAlign.ts`

Implementation:
1. Add lyric correction op to `TimelineEditOp`:
   - `{ type: 'lyric_correction'; scope: 'line' | 'section_occurrence' | 'section_class' | 'global'; targetKey: string; deltaBars: number }`
2. Source of truth:
   - lyric corrections are persisted in `timeline.edits[]` as `lyric_correction`
   - no separate mutation-only store as primary truth
3. Build alignment rules from edit history at analysis time:
   - resolver precedence: line > section_occurrence > section_class > global
4. Reanalyze flow:
   - regenerate baseline placement
   - reapply resolved correction rules from edits
5. UI behavior:
   - default nudge scope: `section_occurrence`
   - support explicit scope chooser in correction controls
   - repeated-section propagation is suggestion-based, never automatic global promotion

Definition of done:
1. Nudge + reanalyze does not snap corrected line back.
2. Verse-only correction leaves chorus unchanged unless explicitly propagated.
3. Global corrections still work when intentionally chosen.

### Phase D: Section Fingerprint Design (Concrete)
Goal: stable target keys for scoped lyric corrections across reruns.

Fingerprint key format:
`<sectionType>|occ<occurrenceIndex>|txt<textAnchor>|p<positionBucket>`

Definitions:
1. `sectionType`:
   - explicit header label if available (`verse`, `chorus`, `bridge`, etc.)
   - else inferred from repeated-first-line clustering
   - else `unknown`
2. `occurrenceIndex`:
   - Nth occurrence within each `sectionType` in timeline order (1-based)
3. `textAnchor`:
   - normalized first non-empty line, truncated to 40 chars
   - if absent, `no_lyrics`
4. `positionBucket`:
   - decile bucket from section start bar: `floor((startBar / totalBars) * 10)`

Edge-case handling:
1. Lyrics not fetched yet:
   - use synthetic sections from timeline spans; `textAnchor = no_lyrics`
2. Same text in Verse 1 and Verse 3:
   - separated by `occurrenceIndex` and `positionBucket`
3. LRC with no section headers:
   - segment into pseudo-sections by lyric time gaps (`> max(8s, 2 bars)`)
   - then apply same fingerprint scheme

Definition of done:
1. Fingerprints are stable across reruns for unchanged song/audio.
2. Same repeated text in different song regions does not collapse into one occurrence key.

### Phase E (Optional): External Evidence Fusion
Goal: improve structure confidence without replacing internal analyzer.

Scope files:
- `src/core/RhythmAnalyzer.ts`
- `src/main/index.ts` (if provider calls run in main process)

Implementation:
1. Provider adapter interface for optional priors.
2. Async refine pass after baseline result.
3. Apply priors as soft weighting only if confidence improves.
4. Provider timeout/failure cannot block baseline analysis.

Definition of done:
1. Baseline timeline appears immediately.
2. Refinement applies only on measurable confidence gain.
3. Provider failures are non-fatal.

## Public Interface and Type Changes
1. `TimelineEditOp` includes `lyric_correction`.
2. `AnalysisOptions` may include correction application mode flags (if needed for staged rollout).
4. `BeatEvent.confidence` becomes real per-beat confidence (not constant).
5. `AnalysisResult.meta` adds time-signature decision diagnostics for debugging.

## Test Matrix

### Unit
1. Vocal-energy intro detection:
   - fixture with known vocal onset yields expected intro bar estimate
3. Beat nudge:
   - beats with nearby strong onsets move toward peak within clamp limits
4. Correction precedence:
   - line overrides section; section overrides global
5. Section fingerprint:
   - same text in different occurrences yields distinct keys

### Integration
1. Reanalyze after section-only correction:
   - corrected section remains, unrelated sections unchanged
3. Reanalyze after global correction:
   - full-song shift preserved
4. External evidence off/on:
   - baseline still works with providers disabled or failing

### Manual
1. Mull of Kintyre (3/4 stress case, first 60 bars checked)
2. Hey Jude (4/4 baseline)
3. One additional repeated-chorus song

## Acceptance Criteria
1. Plan focus is analyzer + lyrics, with MIDI/practice clearly deferred.
2. Reanalyze preserves correction intent at selected scope.
3. Vocal energy is used in baseline structural lyric placement.
4. Phase A has measurable pass/fail thresholds, not qualitative-only goals.

## Deferred Backlog
1. MIDI live scoring completion.
2. Practice transport lifecycle cleanup.
3. Loop UX polish outside analyzer/lyrics phase needs.
