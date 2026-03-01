# Rhythm Detection Baseline Metrics
Generated: 2026-03-01T03:38:02.244Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.220 |
| Mean Downbeat F1 | 0.041 |
| Mean Root Accuracy | 0.0% |
| Mean Full Accuracy | 0.0% |
| Mean Drift (median) | 704.6 ms |
| Mean False Changes /32 bars | 0.0 |

## Ben E. King - Stand By Me (`stand-by-me`)

### Beat Detection
- **F1**: 0.220 (P=0.259, R=0.191)
- Matched: 43 / 225 GT, 166 predicted

### Downbeat Detection
- **F1**: 0.041 (P=0.049, R=0.035)
- Matched: 2 / 57 GT, 41 predicted

### Bar Drift
- Median: 704.6 ms
- P95: 1407.6 ms
- Bars evaluated: 57

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*

## Alignment Summary

- Total songs: 1
- Aligned: 1
- Skipped: 0
- Mean Downbeat F1: 0.041
- Mean All-Beat F1: 0.220

### Alignment Quality

| Song | Status | Tier | Model | Quality Mode | Coverage | Median (ms) | P95 (ms) |
|------|--------|------|-------|--------------|----------|-------------|----------|
| stand-by-me | aligned_ok | 2 | affine | energy_peak | 100% | 40 | 200 |
