# Rhythm Iteration Protocol (Bounded, Low-Token)

Date: 2026-02-27  
Purpose: Make measurable rhythm/chord improvements without long uncontrolled runs.

## 1. Session Budget (Hard Limits)
1. Max session time: 90 minutes.
2. Max iterations per session: 3.
3. Max code scope per iteration: 1 change only (one constant, one heuristic, or one small function block).
4. Stop early if 2 consecutive failed iterations.

## 2. Baseline Lock
Before first iteration in a session:
1. Run fresh eval:
   ```powershell
   npx tsx scripts/run-eval.ts --analyze
   ```
2. Create both a timestamped session baseline and a stable working baseline:
   ```powershell
   $ts = Get-Date -Format "yyyy-MM-ddTHHmmss"
   Copy-Item eval-output/baseline.json "eval-output/baseline.$ts.session-start.json" -Force
   Copy-Item eval-output/baseline.json eval-output/baseline.session-start.json -Force
   ```
3. Record `$ts` in the session log.
4. Do not change ground truth during the session.

## 3. One Iteration Loop
For each iteration `i`:
1. Define a single hypothesis in one sentence.
   - Example: "Increase onset peak threshold from p75 to p80 to reduce false beats."
2. Apply one code change only.
3. Run:
   ```powershell
   npx tsx scripts/run-eval.ts --analyze
   ```
4. Compare current `eval-output/baseline.json` to `eval-output/baseline.session-start.json`.
5. Record result in session log (template below).
6. Decision: `KEEP` or `REVERT`.

## 4. Keep/Revert Gate
A change is `KEEP` only if all are true:
1. At least one primary metric improves on Tier A:
   - beat F1, or
   - downbeat F1, or
   - chord root accuracy, or
   - full chord accuracy, or
   - bar drift p95 decreases.
2. No Tier A regression larger than:
   - F1/accuracy drop > 0.02 absolute, or
   - drift p95 increase > 15 ms.
3. Determinism check passes using this concrete procedure:
   ```powershell
   npx tsx scripts/run-eval.ts --analyze
   Copy-Item eval-output/baseline.json eval-output/_det_run1.json -Force
   npx tsx scripts/run-eval.ts --analyze
   Copy-Item eval-output/baseline.json eval-output/_det_run2.json -Force

   $r1 = Get-Content eval-output/_det_run1.json | ConvertFrom-Json
   $r2 = Get-Content eval-output/_det_run2.json | ConvertFrom-Json
   $fields = 'meanBeatF1','meanDownbeatF1','meanRootAccuracy','meanFullAccuracy','meanDriftMedianMs','meanFalseChangePer32'
   $fail = $false
   foreach($f in $fields){
     $delta = [math]::Abs($r1.aggregate.$f - $r2.aggregate.$f)
     $limit = if($f -eq 'meanDriftMedianMs'){ 1.0 } else { 0.001 }
     if($delta -gt $limit){ Write-Host "$f delta $delta > $limit"; $fail = $true }
   }
   if($fail){ throw 'Determinism check failed' } else { Write-Host 'Determinism check passed' }
   ```

If any rule fails: `REVERT`.

## 5. End-of-Session Rules
1. If no `KEEP` changes: end session, write brief note, no extra exploration.
2. If 1+ `KEEP` changes: stop at 3 iterations max and summarize best delta.
3. Queue next session from observed failure mode, not new brainstorming.
4. Commit all `KEEP` changes at end of session:
   ```powershell
   git add <changed-files>
   git commit -m "rhythm: session YYYY-MM-DD keep <short-summary>"
   ```

## 6. Minimal Scorecard (Per Iteration)
Keep logs short. One row per iteration.

```md
## Session YYYY-MM-DD

### Iteration N
- Hypothesis:
- Change:
- Result:
  - Beat F1 (Tier A aggregate): old -> new
  - Downbeat F1: old -> new
  - Drift p95 ms: old -> new
  - Root acc: old -> new
  - Full acc: old -> new
- Gate: KEEP | REVERT
- Note (1 line):
```

## 7. Low-Token Collaboration Mode
When using assistant support during this loop:
1. Ask for one candidate change at a time.
2. Ask for one-screen output only:
   - hypothesis
   - exact code edit target (file + expected line range)
   - expected metric impact
3. Skip long reasoning unless a change fails twice.

## 8. Optional Throughput Upgrade (When Song Count Grows)
If eval runtime starts slowing sessions (for example, Tier B expansion), queue this as a separate scoped task:
1. Add `--analyze-only <songId>` to `scripts/run-eval.ts`.
2. Keep full-suite mode as default for gate decisions.
3. Use single-song mode only for exploratory iteration; always confirm `KEEP` with full-suite run.

## 9. Suggested File for Logs
Append iteration logs to:
- `docs/rhythm-iteration-log.md`

This keeps decision history compact and auditable.
