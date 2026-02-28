# Key-Invariant Chord Representation Plan

Date: 2026-02-28  
Scope: Refactor chord representation to support key transposition without re-analysis, with backward compatibility and minimal pipeline disruption.

## Goal
Store harmonic output in a key-relative form (`degree`) while preserving current absolute chord rendering (`symbol`) so:
1. Analysis remains stable and comparable.
2. Existing UI and eval continue working.
3. Transposition to a new key is a pure data transform (`degree` + target key), not a full re-run.

## Non-Goals
1. No redesign of beat detection or smoothing pipeline.
2. No broad model expansion beyond current quality classes already used.
3. No breaking schema change that invalidates existing saved projects.

---

## Current Risks to Address Up Front
1. Current output includes dominant-7 chords (for example `C7`). A plain Roman set (`I..vii_dim`) loses this quality unless we store an additional quality tag.
2. Existing projects only have absolute `symbol` and no `keyRoot` or `degree`.
3. Eval harness compares absolute symbols today, so rendered symbol compatibility must be preserved.

Decision for this plan:
1. Add `degree` plus a small `quality` tag to preserve triad/7 quality.
2. Keep `symbol` as rendered absolute output for compatibility.
3. Add `keyRoot` to timeline artifact (optional in migration window, required for new analyses).
4. Session 1 is annotation-only: keep existing absolute matching internals unchanged.
5. Any matcher internals swap (rotated relative matching) is deferred to a later optional iteration after transposition is validated.

Ordering invariant:
1. `detectChordsPerBeat` -> `smoothChords`/consolidation -> annotate `degree`/`qualityTag`.
2. `transposeTo()` is a post-analysis timeline transform only.
3. Transposition must not run before smoothing/consolidation.

---

## Data Model Changes

## Before
```ts
interface ChordEvent {
  id: string;
  startTime: number;
  endTime: number;
  barStart: number;
  barEnd: number;
  symbol: string;
  confidence: number;
  source: 'audio' | 'manual';
  voicing: ChordVoicingData | null;
  vocalEnergy?: number;
  lyrics?: string;
  section?: string;
}

interface ChordTimelineArtifact {
  version: 1;
  analysisVersion: string;
  analyzerConfigHash: string;
  beatGrid: BeatGrid;
  chords: ChordEvent[];
  edits: TimelineEdit[];
  createdAt: string;
  modifiedAt: string;
}
```

## After
```ts
type ChordDegree = 'I' | 'ii' | 'iii' | 'IV' | 'V' | 'vi' | 'vii_dim' | 'N';
type ChordQualityTag = 'maj' | 'min' | 'dim' | 'dom7' | 'unknown';

interface ChordEvent {
  id: string;
  startTime: number;
  endTime: number;
  barStart: number;
  barEnd: number;
  symbol: string;                 // rendered absolute symbol (compat)
  degree?: ChordDegree;           // key-relative degree
  qualityTag?: ChordQualityTag;   // preserves V7 / triad distinction
  confidence: number;
  source: 'audio' | 'manual';
  voicing: ChordVoicingData | null;
  vocalEnergy?: number;
  lyrics?: string;
  section?: string;
}

interface ChordTimelineArtifact {
  version: 1;                     // remain v1 for lazy migration compatibility
  analysisVersion: string;
  analyzerConfigHash: string;
  beatGrid: BeatGrid;
  keyRoot?: number;               // 0..11, C=0 (optional for migrated legacy)
  chords: ChordEvent[];
  edits: TimelineEdit[];
  createdAt: string;
  modifiedAt: string;
}
```

Notes:
1. `degree` and `keyRoot` are optional in transition period for backward compatibility.
2. New analyses must always emit both.

---

## Function Signatures (New/Changed)

## New in `src/core/chordDegrees.ts`
```ts
function symbolToDegree(
  symbol: string,
  keyRoot: number,
): { degree: ChordDegree; qualityTag: ChordQualityTag } | null;

function renderDegreeToSymbol(
  degree: ChordDegree,
  qualityTag: ChordQualityTag,
  keyRoot: number,
): string;
```

## Changed in `src/core/rhythmAnalyzeCore.ts`
```ts
// current shape
function detectChordsPerBeat(...): {
  chords: Array<{ bar: number; beat: number; time: number; symbol: string; confidence: number }>;
  detectedKey: string;
}

// Session 1 target: matching internals unchanged; annotation after smoothing
function annotateChordsWithDegrees(
  chords: ChordEvent[],
  keyRoot: number,
): ChordEvent[];
```

```ts
// add key root to analysis meta for timeline creation
interface AnalysisResult {
  beatGrid: BeatGrid;
  chords: ChordEvent[];
  meta: {
    analysisVersion: string;
    configHash: string;
    durationMs: number;
    timeSignatureDecision?: TimeSignatureDecision;
    keyRoot?: number;
  };
}
```

## New in `src/core/timelineEditor.ts`
```ts
export function transposeTo(
  timeline: ChordTimelineArtifact,
  newKeyRoot: number,
): ChordTimelineArtifact;
```

Behavior:
1. For each chord with `degree`, re-render `symbol` using `newKeyRoot`.
2. Recompute `voicing` via existing lookup.
3. Preserve timing/confidence/source/lyrics/section.
4. Update `timeline.keyRoot`.
5. Append an edit entry (new op type, see below).

## Edit op update in `src/core/rhythmTypes.ts`
```ts
type TimelineEditOp =
  | ...
  | { type: 'transpose_key'; fromKeyRoot: number; toKeyRoot: number };
```

---

## Exact Files to Modify/Create

## Modify
1. `src/core/rhythmTypes.ts`
   - Add `ChordDegree`, `ChordQualityTag`
   - Extend `ChordEvent`
   - Extend `ChordTimelineArtifact` with `keyRoot?`
   - Add `transpose_key` edit op
   - Extend `AnalysisResult.meta` with `keyRoot?`

2. `src/core/rhythmAnalyzeCore.ts`
   - Keep existing matching internals and DIATONIC_BOOST in Session 1
   - Add post-smoothing annotation pass deriving `degree` and `qualityTag` from (`symbol`, `keyRoot`)
   - Keep rendered `symbol` production in analyzer output
   - Emit `degree`, `qualityTag`, and `meta.keyRoot`
   - Keep `smoothChords`/consolidation unchanged (absolute symbols)

3. `src/core/timelineEditor.ts`
   - Add `transposeTo(timeline, newKeyRoot)`
   - Add `transpose_key` op handling in `applyEdit`
   - Ensure manual `set_chord` behavior:
     - if timeline has `keyRoot`, derive/update `degree` + `qualityTag` from edited symbol when possible
     - else keep `degree` undefined

4. `src/components/RhythmPage.tsx`
   - Timeline header controls: add key selector dropdown
   - On change: call transpose operation and persist via existing save path
   - Disable or tooltip when timeline lacks `keyRoot`/`degree` (legacy pre-migration)

5. `src/main/projectStorage.ts`
   - Add lazy migration in `loadProject`:
     - keep project readable when `keyRoot`/`degree` missing
     - do not rewrite file until next save (idempotent behavior)

6. `src/eval/evaluationHarness.ts`
   - Keep absolute symbol comparison as default
   - Add helper to ensure evaluation always reads rendered `symbol` (not `degree`)
   - Optional: add degree-based comparison mode behind an explicit flag (not default)

7. `scripts/run-eval.ts`
   - No default metric logic change required
   - Add log line showing timeline `keyRoot` when present for traceability

## Create
1. `src/core/chordDegrees.ts`
   - Shared degree mapping utilities used by analyzer + timeline transposition
2. `src/core/chordDegrees.test.ts`
   - Unit tests for symbol<->degree conversion and render logic
3. `src/core/timelineTranspose.test.ts`
   - Unit tests for `transposeTo`
4. `docs/key-invariant-chords-migration.md`
   - Migration notes and behavior for legacy projects

---

## Implementation Phases (3 focused sessions + optional Session 4)

## Session 1: Internal Representation
1. Add new types and helper module (`chordDegrees.ts`)
2. Keep analyzer matching internals unchanged (absolute matching + existing bias)
3. After smoothing, annotate each chord with `degree`/`qualityTag` via (`symbol`, `keyRoot`)
4. Emit `degree`, `qualityTag`, absolute rendered `symbol`, and `meta.keyRoot`
5. Keep all downstream consumers untouched by preserving `symbol`

Exit criteria:
1. `run-eval --analyze` runs successfully
2. No compile breaks in renderer/headless paths
3. Chord output contains both `symbol` and `degree` for newly analyzed tracks
4. Tier A eval metrics are unchanged within noise band (absolute delta <= 0.005 on aggregate chord metrics)

## Session 2: Transposition + UI
1. Implement `transposeTo(timeline, newKeyRoot)` in timeline editor
2. Add `transpose_key` edit op
3. Add timeline key selector UI and wire to save flow
4. Ensure voicing lookup refreshes after transposition

Exit criteria:
1. Key change updates symbols instantly without reanalysis
2. Timeline persists and reloads with new `keyRoot`
3. Audio preview reflects updated symbols/voicings

## Session 3: Migration + Eval Hardening
1. Implement lazy migration logic in `projectStorage.loadProject`
2. Backfill degree when possible from (`symbol`, `keyRoot`)
3. Add tests for legacy project loading and transposition behavior
4. Confirm eval comparability remains intact

Exit criteria:
1. Legacy project opens without errors
2. Reanalyze path upgrades data cleanly
3. Eval metrics still comparable pre/post refactor on Tier A

## Optional Session 4: Matcher Internals Swap (Only If Needed)
1. Prototype rotated-relative matching in analyzer internals
2. Run under bounded iteration protocol (small single-change loops)
3. Keep as opt-in until eval gate passes

Exit criteria:
1. No regression beyond keep/revert thresholds
2. Clear improvement rationale over annotation-first baseline

---

## Migration Strategy (Existing Projects)

## Load-time (idempotent, lazy)
For each loaded project:
1. If `timeline.keyRoot` missing:
   - Try derive from `project.analysisHints.keyHint` if valid
   - Else parse from `timeline.analyzerConfigHash` token `_key<NAME>_` if present
   - Else leave undefined (legacy fallback mode)
2. For each chord with missing `degree`:
   - If `keyRoot` available, derive via `symbolToDegree`
   - If derivation fails (non-diatonic/unmapped), set `degree='N'`, `qualityTag='unknown'`
3. Do not force-save migrated data immediately.

## Save-time
1. On any project save, persist migrated fields (`keyRoot`, `degree`, `qualityTag`).

## Legacy behavior fallback
1. If timeline has no `keyRoot` or no usable degrees:
   - keep current symbol-only display/edit behavior
   - disable transposition UI with clear message: "Re-analyze to enable key transposition."

---

## Verification Plan

## Unit tests
1. `chordDegrees.test.ts`
   - `renderDegreeToSymbol` for all 12 keys and 7 degrees
   - `symbolToDegree` round-trip coverage for maj/min/dim/dom7
2. `timelineTranspose.test.ts`
   - transposing twice returns expected symbols
   - timing/confidence untouched
   - voicing refreshed correctly
3. Migration tests
   - legacy timeline without `keyRoot` loads
   - keyHint/configHash derivation paths

## Integration checks
1. `npx tsx scripts/run-eval.ts --analyze` before and after refactor
2. Compare Tier A aggregate deltas:
   - beat/downbeat/drift should be unchanged
   - Session 1 chord metrics should remain within 0.005 absolute delta
   - later optional matcher changes follow iteration protocol thresholds
3. Manual UI smoke:
   - open timeline
   - transpose key via dropdown
   - save/reopen project
   - confirm symbols + preview playback + edits intact

## Typecheck/test commands
```powershell
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx vitest run src/core/chordDegrees.test.ts src/core/timelineTranspose.test.ts
npx tsx scripts/run-eval.ts --analyze
```

---

## Rollout Note
Ship behind a small UI feature flag if needed:
1. Analyzer and persistence fields can land first.
2. Key selector can be enabled after eval parity check passes.
