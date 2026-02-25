# Rhythm Plan Refresh (Grounded to Current Code, Feb 25, 2026)

## Summary
Goal: lock the app around a trustable rhythm practice loop:

`analyze -> hear -> correct -> practice`

Current code already ships ingestion, analyzer v2, and Hear It A/B playback.
The biggest remaining gap is transport-driven practice with live MIDI scoring.

Long-form implementation history has been moved to:
`docs/rhythm-notes-2026-02-25.md`

## Implementation Status (Done / Partial / Not Started)

### Done
- `PracticeProjectLite` storage and project IPC are in place.
- In-process `RhythmAnalyzer` v3 with dual time-sig evaluation, K-S key detection, diatonic scoring, smoothing, and consolidation.
- `RhythmPreviewPlayer` exists with generated/source modes and shared cursor.
- Timeline view has Hear It transport, A/B toggle, seek, and active-chord highlight.
- Lyrics fetch/cache/alignment pipeline exists.
- Re-analysis hints exist (`keyHint`, `tempoHint`, `timeSignatureHint`).

### Partial
- Looping exists in player API but timeline UI does not expose loop controls.
- Core timeline edit ops exist, but timeline UI is mostly `set_chord`.
- Practice view is not transport-driven.
- MIDI listeners and validation are not wired into live practice flow.
- Stats state exists but does not increment from real MIDI practice flow.
- Analyzer trust is inconsistent on 3/4 and key detection edge cases.

### Not Started
- Cross-song validation pack (Mull of Kintyre, Hey Jude, one additional song) is not formalized.
- Unit/integration coverage for Hear It loop plus practice transport is not in place.

## Known Gaps Blocking Trust
- No timeline UI for `Loop Start Bar`, `Loop End Bar`, `Set Loop`, `Clear Loop`.
- No generated-playback trust indicator for skipped chords (missing voicings).
- No transport-following practice mode.
- No live MIDI scoring pipeline (note on/off -> chord window -> stats).
- Time signature and key estimation need stronger reliability on non-4/4 songs.
- Rhythm practice stats and transport lifecycle ownership are not explicit in code contracts.

## Execution Plan (Ordered Phases + Definition of Done)

### Phase 1A: Complete Hear It Trust Surface
Scope files:
- `src/components/RhythmPage.tsx`
- `src/core/RhythmPreviewPlayer.ts`
- `rhythm.md`

Implementation:
- Add timeline loop controls:
  - `Loop Start Bar`
  - `Loop End Bar`
  - `Set Loop`
  - `Clear Loop`
- Wire controls to existing `setLoopBars(...)` and `setLoop(null)`.
- Add UI indicator for generated-playback skipped chords (missing voicing coverage).

Definition of done:
- User can set and clear loop from timeline UI.
- A/B mode preserves cursor while loop is active.
- UI exposes skipped-chord count for trust transparency.

### Phase 1B: Transport-Driven Practice + Live MIDI Scoring
Scope files:
- `src/components/RhythmPage.tsx`
- `src/core/rhythmTrainer.ts`
- `src/core/rhythmTypes.ts`

Implementation:
- Replace manual Prev/Next practice with transport-following chord windows.
- Start generated transport when entering practice.
- Subscribe to `onMidiNoteOn` and `onMidiNoteOff` during practice.
- Remove MIDI listeners on practice stop/exit/unmount.
- Evaluate current chord window using existing `validateChordPress(...)`.
- Increment `correct`, `late`, `wrong`, `missed`, and `total` in real time.
- Track a per-chord resolved state so each change is counted once.

Definition of done:
- Practice cursor follows playback time.
- MIDI input updates stats in real time.
- Practice exit reliably stops transport and cleans up listeners.

### Phase 1C: Analyzer Reliability Pass
Scope files:
- `src/core/RhythmAnalyzer.ts`
- `rhythm.md`

Implementation:
- Keep `timeSignatureHint` as highest-priority override.
- Add dual time-signature evaluation path for `3/4` and `4/4`.
- Choose winner using one combined score with:
  - unique-chord penalty,
  - low-confidence-bar ratio,
  - anomaly ratio.
- Blend current key scoring with pitch-class histogram correlation.
- Keep analyzer in-process TypeScript (no Python/WASM in this phase).

Definition of done:
- Mull of Kintyre baseline improves vs current output.
- With hints provided, output is deterministic and stable across reruns.

### Phase 1D: Lyrics Accuracy (Non-Blocking for Rhythm Trust)
Scope files:
- `src/main/index.ts`
- `src/core/lyricsAlign.ts`
- `src/App.tsx`

Implementation:
- Extend `fetch-lyrics` response shape to include `syncedLyrics` when available from LRCLIB.
- Prefer timestamped lyric mapping when `syncedLyrics` exists.
- Fall back to current structural alignment when timed lyrics are unavailable.

Definition of done:
- Timed lyrics align by bar when available.
- Structural fallback remains functional.

### Public Interfaces / Type Changes
- Keep existing `PreviewMode`, `HearItState`, and `RhythmPreviewPlayer`.
- Add `PracticeTransportState` in `src/core/rhythmTypes.ts` with:
  - `playing: boolean`
  - `currentTime: number`
  - `activeChordId: string | null`
  - `loopRange: { startTime: number; endTime: number } | null`
- Keep `ChordValidationStats`, but define ownership/lifecycle in practice flow.
- Widen lyrics API typing in:
  - `src/App.tsx`
  - `src/main/preload.ts`
  to: `{ ok: boolean; lyrics?: string; syncedLyrics?: string; error?: string }`
- No new backend IPC unless renderer-only implementation proves insufficient.

## Acceptance Criteria + Test Matrix

### Acceptance Criteria
1. User can analyze a song and immediately use Hear It with play/pause/stop/seek and bar-loop UI.
2. Generated chords+bass and source audio support A/B trust-check with shared cursor.
3. Timeline edits are audible immediately in generated playback without re-analysis.
4. Practice mode is transport-driven and MIDI stats increment during live play.
5. Analyzer behavior is validated on at least 3 songs with documented failure modes and hint effects.
6. `rhythm.md` statuses stay accurate (`done` vs `partial`) with no overstated completion claims.

### Test Matrix

#### Unit
- Generated event schedule timing correctness from timeline chord events.
- Loop boundary conversion from bars to seconds.
- Cursor continuity when toggling A/B modes.
- Validation-window classification around timing thresholds.
- Time-signature evaluator behavior on fixed fixtures.

#### Integration
- Analyze project then Hear It generated/source both work.
- Toggle A/B without cursor reset drift.
- Loop controls work in both generated and source playback.
- Practice mode receives MIDI and updates stats live.
- Re-analysis with hints persists updated timeline.

#### Manual Acceptance Set
- Mull of Kintyre (3/4 stress case).
- Hey Jude (4/4 baseline).
- One additional song for generalization.
- For each song:
  - run A/B in at least 3 sections,
  - apply at least 2 timeline edits,
  - confirm audible improvement.

### Assumptions and Defaults
- Default Hear It mode remains `generated`.
- Trust workflow remains A/B toggle (no overlay mix).
- Analyzer remains in-process TypeScript for this phase.
- No new dependencies by default.
- No new backend IPC by default.
- Lyrics improvements are useful but non-blocking for phase 1 completion.
