# Rhythm Detection Baseline Metrics
Generated: 2026-02-27T15:55:22.125Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.427 |
| Mean Downbeat F1 | 0.853 |
| Mean Root Accuracy | 0.0% |
| Mean Full Accuracy | 0.0% |
| Mean Drift (median) | 46.4 ms |
| Mean False Changes /32 bars | 0.0 |

## Wings - Mull Of Kintyre (`mull-of-kintyre`)

### Beat Detection
- **F1**: 0.427 (P=0.284, R=0.856)
- Matched: 125 / 146 GT, 440 predicted

### Downbeat Detection
- **F1**: 0.853 (P=0.850, R=0.856)
- Matched: 125 / 146 GT, 147 predicted

### Bar Drift
- Median: 46.4 ms
- P95: 89.2 ms
- Bars evaluated: 146

### Chord Accuracy
- Root: 0.0%
- Full: 0.0%
- Bars evaluated: 0

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 0 transitions

### Determinism
- *Not evaluated (single run)*
