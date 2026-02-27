# Rhythm Detection Baseline Metrics
Generated: 2026-02-27T16:33:29.051Z

## Aggregate

| Metric | Value |
|--------|-------|
| Mean Beat F1 | 0.164 |
| Mean Downbeat F1 | 0.308 |
| Mean Root Accuracy | 12.1% |
| Mean Full Accuracy | 11.2% |
| Mean Drift (median) | 2712.1 ms |
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
- **F1**: 0.054 (P=0.030, R=0.235)
- Matched: 19 / 81 GT, 623 predicted

### Downbeat Detection
- **F1**: 0.042 (P=0.032, R=0.062)
- Matched: 5 / 81 GT, 156 predicted

### Bar Drift
- Median: 7690.6 ms
- P95: 14612.1 ms
- Bars evaluated: 81

### Chord Accuracy
- Root: 24.7%
- Full: 24.7%
- Bars evaluated: 81

### False Chord Changes
- Per 32 bars: 0.0
- Total: 0 / 80 transitions

### Determinism
- *Not evaluated (single run)*
