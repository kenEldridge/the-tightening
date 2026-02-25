# Transform The Tightening into a Data-First Rhythm Trainer (Ship-First Revision)

## Summary
Build a core around **extracting usable rhythm/chord practice data** first, and ship a playable trainer as fast as possible.

Phase 1 target is one complete benchmark flow for **Hey Jude**:
source link/file -> beat grid + chord timeline -> lightweight correction -> MIDI chord-change trainer loop.

Phase 2 adds generalized **key-by-key tutorial stepping** for piano tutorial videos.

## What Changed From Prior Plan
1. **Phase 0 is slimmed down**. No heavy orchestrator/migration framework before first value.
2. **Analyzer strategy is de-risked**. Start with a simple in-process analyzer path; keep Python as optional adapter later.
3. **Hint fusion is deferred**. Start with audio-first + manual correction.
4. **IPC scope is reduced** to only what is required to ship the first playable loop.
5. **Tempo handling is explicit**. Phase 1 assumes near-global tempo with optional section recalibration.

## Product Scope (Phase 1)
1. Primary output: versioned `ChordTimeline + BeatGrid` artifacts.
2. Inputs: `YouTube URL` and `local audio/video file`.
3. Practice mode: `Chord-Change Trainer` with one practical default voicing per chord.
4. Validation: `MIDI-first` (microphone validation deferred).
5. UI: minimal scaffolding only; no landing-page redesign.
6. Benchmark: `Hey Jude` end-to-end, repeatably.

## Non-Goals (Phase 1)
1. Instrument stem separation.
2. Full automatic transcription to notation/tab.
3. Advanced async job infra (cancellation/queue orchestration).
4. Polished generalized UX across many songs.

## Architecture

## Phase 0 (Slim): Ingestion Hardening + Error Clarity
Goal: reliable input and clear failures, without infrastructure bloat.

1. Keep current extraction stack (`yt-dlp`, `ffmpeg`) but standardize errors.
   - Error codes: `network_dns`, `download_failed`, `ffmpeg_missing`, `analysis_failed`.
   - Show actionable fallback: local file import.
2. Add local media import path (audio/video) through Electron IPC.
3. Normalize audio to mono WAV for deterministic analysis.
4. Persist minimal project artifact on disk (userData) for benchmark flow only.
   - No full migration away from existing localStorage yet.

Deliverable: reliable ingest + normalized audio + typed error reporting.

## Phase 1.1: Chord/Beat Extraction (Core Hard Part)
Goal: produce a usable first-pass chord timeline for Hey Jude.

1. Introduce `AnalyzerAdapter` interface.
   - `analyze(audioPath, options) -> BeatGrid + ChordCandidates + Timeline`.
2. Implement one **ship-first backend** first.
   - Prefer in-process/simple dependency path to minimize packaging risk.
   - Python backend is deferred to optional adapter status unless absolutely needed.
3. Output artifacts:
   - `BeatEvent[]`
   - `ChordEvent[]` with confidence
   - `analysisMeta` (version + config hash)
4. Apply basic smoothing to reduce chord jitter (simple transition penalties).

Deliverable: first-pass beat grid + chord timeline generated automatically.

## Phase 1.2: Minimal Correction Layer (Computational Assist)
Goal: make imperfect analysis quickly fixable.

1. Minimal edit operations:
   - `set_chord(range, symbol)`
   - `shift_boundary(eventId, delta)`
   - `split_event(eventId, atBeat)`
   - `merge_with_next(eventId)`
2. Persist corrected timeline to disk artifact.
3. Keep lightweight edit history for one-level undo/redo (not full immutable log yet).

Deliverable: corrected timeline can be saved and resumed without re-analysis.

## Phase 1.5: Chord-Change Trainer (Playable Value)
Goal: turn timeline into practical rhythm practice immediately.

1. Build `RhythmPracticePayload` from corrected timeline.
2. Trainer capabilities:
   - count-in bar
   - upcoming chord-change cue
   - loop selected bars
3. MIDI validation stats:
   - `correct`, `late`, `wrong`, `missed`
4. One practical voicing per chord event:
   - default RH chord voicing + optional LH root
   - reuse/extend existing chord voicing map

Deliverable: usable rhythm practice loop for Hey Jude.

## Phase 1.3+ (Only If Needed): Quality Boosters
Only execute after Phase 1.5 is playable and benchmarked.

1. Add optional hint sources:
   - OCR chord symbols
   - API hints
   - user seed progression
2. Add weighted fusion with audio candidates.
3. Upgrade edit history to full immutable edit log with rollback semantics.

## Phase 2: Tutorial Key-by-Key Step Mode
1. Build tutorial extraction pipeline for piano tutorial videos.
2. Produce deterministic keypress events with frame references.
3. Add step controls:
   - next/prev event
   - repeat N times
   - loop event range
4. Reuse ingestion/artifact infrastructure from rhythm core.

## Public Interfaces (Reduced Initial IPC)

## New/Updated Types
1. `PracticeProjectLite`
2. `BeatEvent`
3. `ChordEvent`
4. `ChordTimelineArtifact`
5. `RhythmPracticePayload`

## Minimal IPC for Phase 1
1. `project-create-lite(input)`
2. `project-load-lite(projectId)`
3. `project-import-local-media()`
4. `analysis-run-rhythm-lite(projectId, options)`
5. `timeline-apply-edit-lite(projectId, edit)`
6. `trainer-build-rhythm-payload(projectId, range)`

Deferred for now:
- `analysis-cancel`
- global async job orchestration/event bus
- full project migration endpoints

## Tempo Assumptions (Explicit)
1. Phase 1 assumes a near-steady global tempo for the benchmark.
2. `BeatEvent.tempoLocal` is retained for forward compatibility but initially derived from section-level recalibration, not full rubato modeling.
3. If timing drift appears in benchmark, allow manual section tempo anchors before adding complex tempo-map logic.

## Data Contracts (Phase 1)
1. `ChordEvent`: `id`, `startTime`, `endTime`, `barStart`, `barEnd`, `symbol`, `confidence`, `source(audio|manual)`, `voicing`.
2. `BeatEvent`: `time`, `bar`, `beatInBar`, `tempoLocal`, `confidence`.
3. `ChordTimelineArtifact`: `analysisVersion`, `analyzerConfigHash`, `beats`, `chords`, `edits`.

## Testing and Validation
1. Unit tests:
   - chord normalization + voicing lookup
   - beat/bar mapping
   - edit ops correctness
2. Integration tests:
   - YouTube + local ingest
   - analyzer success/failure mapping to typed errors
   - artifact save/load
3. Practice tests:
   - MIDI validation windows
   - loop stability and cue timing
4. End-to-end benchmark (`Hey Jude`):
   - ingest source
   - generate timeline
   - apply corrections
   - run trainer loop with MIDI stats

## Acceptance Criteria (Phase 1)
1. User can ingest Hey Jude from YouTube or local file and receive typed feedback on failures.
2. System produces a playable first-pass beat/chord timeline.
3. User can make targeted corrections and resume later without re-analysis.
4. Chord-change trainer loop works with MIDI-first validation.
5. The end-to-end Hey Jude flow is repeatable in one session.

## Rollout
1. Ship behind feature flag: `rhythm_core_v1`.
2. Keep legacy YouTube passage mode available during transition.
3. Capture structured metrics: ingest time, analysis time, correction count, failure class.
4. Promote to default only after benchmark stability is confirmed.

## Assumptions and Defaults
1. Primary goal is practical learning value quickly, not infrastructure completeness.
2. Audio-first extraction + manual correction is enough for first ship.
3. Python analyzer is optional and not a phase-1 packaging requirement.
4. Full hint fusion and full edit-log semantics are quality iterations, not blockers.
5. Tutorial key-by-key mode remains phase 2.
