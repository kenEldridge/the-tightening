# Headless Analyzer Refactor Plan

Date: 2026-02-27
Goal: Run the analyzer in both renderer (current) and Node CLI (new) without algorithm rewrite.

## Context

`src/core/RhythmAnalyzer.ts` (~1400 lines) has two browser-dependent functions:
1. `loadAudioBuffer` (Electron IPC + `OfflineAudioContext.decodeAudioData`)
2. `toMono` (`AudioBuffer` API)

The remaining analyzer logic is pure numeric processing on `Float32Array`.

### Already done (Phase 0 complete)
1. Evaluation harness exists (`src/eval/`, `scripts/run-eval.ts`)
2. Baseline captured for Tier A songs in `eval-output/baseline.json`
3. Snapshot infrastructure for determinism exists

### Constraints
1. ESM project (`"type": "module"`)
2. `tsconfig.app.json` includes `src/**` with DOM libs
3. Node-specific files under `src/` must be isolated from app typecheck
4. No new npm deps
5. No intentional algorithm changes in this refactor

---

## Behavioral Policy (Explicit)
1. Headless path supports only PCM16 LE WAV input.
2. Non-PCM16, malformed, or unreadable WAV files are hard-fail with actionable error messages.
3. Sample rate/channel policy:
   - If file is mono 44100Hz, process directly.
   - If not mono 44100Hz, fail fast and instruct caller to pre-normalize via existing ffmpeg pipeline.
4. Do not silently resample or downmix in this refactor.

---

## Target Architecture

```
src/core/
  rhythmAnalyzeCore.ts   (new)  - pure: analyzeFromSamples(samples, sampleRate, options) -> AnalysisResult
  RhythmAnalyzer.ts      (slim) - browser adapter: decode via Web Audio -> call core

src/node/
  wavLoader.ts           (new)  - parse PCM16 LE WAV -> { samples: Float32Array, sampleRate: number }
  NodeRhythmAnalyzer.ts  (new)  - node adapter: read WAV path -> call core
```

---

## Phase 1A: Extract Pure Core (Renderer Behavior Lock)

### Work
1. Create `src/core/rhythmAnalyzeCore.ts`
2. Move pure analysis logic out of `RhythmAnalyzer.ts`
3. Keep `RhythmAnalyzer.analyze(audioPath, options)` unchanged
4. `RhythmAnalyzer` calls: decode -> mono -> `analyzeFromSamples`

### Gate 1A PASS
1. App builds and runs
2. `RhythmPage` requires no API changes
3. Renderer output parity vs baseline within thresholds:
   - Beat times: median absolute delta <= 1 ms
   - Same time-signature winner
   - Same bar count (or difference <= 1)
   - Chord symbol match >= 99% by bar

### Gate 1A Commands
```powershell
npx tsc --noEmit
npx tsc -p tsconfig.app.json --noEmit
npx tsx scripts/run-eval.ts
```

Decision: GO / NO-GO

---

## Phase 1B: Node Adapter + WAV Loader + Headless CLI

### Work
1. Create `src/node/wavLoader.ts`
   - RIFF/WAVE validation
   - PCM16 LE decode to Float32
   - hard-fail errors for unsupported format/rate/channels
2. Create `src/node/NodeRhythmAnalyzer.ts`
   - implements `AnalyzerAdapter`
3. Create `scripts/run-headless-analysis.ts`
   - `npx tsx scripts/run-headless-analysis.ts <wav-path> [--tempo N] [--time-sig 3/4|4/4] [--key D]`
4. Config updates
   - `tsconfig.app.json`: exclude `src/node/**`
   - `tsconfig.node.json`: include `src/node/**` and `scripts/**`
5. Tests
   - `src/node/wavLoader.test.ts`: valid parse + malformed/unsupported cases

### Gate 1B PASS
1. Headless CLI runs on all Tier A WAVs
2. Unsupported WAVs fail with clear actionable errors
3. App typecheck/build remains green
4. WAV loader tests pass

### Gate 1B Commands
```powershell
npx tsc -p tsconfig.app.json --noEmit
npx tsc -p tsconfig.node.json --noEmit
npx tsx scripts/run-headless-analysis.ts <tierA-wav-path>
npx vitest run src/node/wavLoader.test.ts
```

Decision: GO / NO-GO

---

## Phase 2: Parity Verification (Renderer vs Node)

### Work
1. Run both adapters on identical WAV + identical hints
2. Compare functional outputs only (ignore volatile runtime metadata such as `durationMs`)
3. Emit parity report artifact

### Gate 2 PASS
1. Beat parity:
   - median beat time delta <= 5 ms
   - p95 beat time delta <= 20 ms
2. Structural parity:
   - same time-signature winner
   - bar count difference <= 1
3. Chord parity:
   - root match >= 98% by bar
   - full symbol match >= 95% by bar
4. Any outlier case documented with root cause

### Gate 2 Commands
```powershell
npx tsx scripts/run-headless-analysis.ts <tierA-wav-path> --out eval-output/headless-node.json
# run renderer path baseline command/process, then compare via parity script/report
npx tsx scripts/run-eval.ts
```

Decision: GO / NO-GO

---

## Phase 3: Eval Integration

### Work
1. Add `--analyze` mode to `scripts/run-eval.ts` to run fresh headless analysis before metrics
2. Keep existing saved-timeline mode as default fallback
3. Document both modes and when to use each

### Gate 3 PASS
1. `run-eval` works in both modes:
   - default (saved timeline)
   - `--analyze` (fresh headless inference)
2. Report format remains unchanged for downstream readers
3. Full end-to-end command sequence is reproducible from docs

### Gate 3 Commands
```powershell
npx tsx scripts/run-eval.ts
npx tsx scripts/run-eval.ts --analyze
```

Decision: SHIP / HOLD

---

## Required Artifacts
1. `docs/headless-phase1a-core-extraction.md`
2. `docs/headless-phase1b-node-adapter.md`
3. `docs/headless-phase2-parity-report.md`
4. `docs/headless-phase3-eval-integration.md`

---

## Gate Decision Template
```md
### Headless Gate X Decision (YYYY-MM-DD)
- Decision: GO | NO-GO
- Evidence:
  - ...
- Metrics:
  - ...
- Reviewer(s):
  - ...
- Risks accepted:
  - ...
- Required follow-ups:
  - ...
```

## Immediate Next Step
Start Phase 1A only. Do not begin Node adapter work until Gate 1A is GO.
