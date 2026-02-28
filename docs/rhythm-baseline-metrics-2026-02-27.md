# Rhythm Detection Baseline Metrics
Generated: 2026-02-27T20:53:11.887Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.160 |
| Mean Downbeat F1 | 0.306 |
| Mean Root Accuracy | 11.7% |
| Mean Full Accuracy | 10.8% |
| Mean Drift (median) | 32414.5 ms |
| Mean False Changes /32 bars | 3.6 |

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

## Hey Jude - The Beatles (`hey-jude`)

### Beat Detection
- **F1**: 0.010 (P=0.006, R=0.038)
- Matched: 3 / 78 GT, 510 predicted

### Downbeat Detection
- **F1**: 0.029 (P=0.023, R=0.038)
- Matched: 3 / 78 GT, 128 predicted

### Bar Drift
- Median: 399.2 ms
- P95: 733.5 ms
- Bars evaluated: 78

### Chord Accuracy
- Root: 11.5%
- Full: 9.0%
- Bars evaluated: 78

### False Chord Changes
- Per 32 bars: 10.8
- Total: 26 / 77 transitions

### Determinism
- *Not evaluated (single run)*

## Canon in D - Pachelbel (`canon-in-d`)

### Beat Detection
- **F1**: 0.044 (P=0.028, R=0.111)
- Matched: 9 / 81 GT, 324 predicted

### Downbeat Detection
- **F1**: 0.037 (P=0.037, R=0.037)
- Matched: 3 / 81 GT, 81 predicted

### Bar Drift
- Median: 96797.8 ms
- P95: 183915.3 ms
- Bars evaluated: 81

### Chord Accuracy
- Root: 23.5%
- Full: 23.5%
- Bars evaluated: 81

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 80 transitions

### Determinism
- *Not evaluated (single run)*
