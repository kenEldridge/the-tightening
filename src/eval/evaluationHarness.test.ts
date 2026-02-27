import { describe, it, expect } from 'vitest';
import {
  extractChordRoot,
  computeBeatFMeasure,
  computeDownbeatFMeasure,
  computeBarDrift,
  computeChordAccuracy,
  computeFalseChordChangeRate,
  computeDeterminism,
} from './evaluationHarness';
import type { BeatEvent, ChordEvent, ChordTimelineArtifact } from '../core/rhythmTypes';
import type { BarAnchor, ChordLabel } from './evaluationTypes';

// ============================================
// Helpers to build test data
// ============================================

function makeBeat(time: number, bar: number, beatInBar: number): BeatEvent {
  return { time, bar, beatInBar, tempoLocal: 120, confidence: 0.9 };
}

function makeAnchor(bar: number, timeSec: number): BarAnchor {
  return { bar, timeSec, source: 'computed' };
}

function makeChord(symbol: string, barStart: number, barEnd: number, startTime: number, endTime: number): ChordEvent {
  return {
    id: `chord_${barStart}`,
    startTime,
    endTime,
    barStart,
    barEnd,
    symbol,
    confidence: 0.9,
    source: 'audio',
    voicing: null,
  };
}

function makeLabel(bar: number, symbol: string): ChordLabel {
  return { bar, symbol, source: 'midi' };
}

function makeTimeline(
  tempo: number,
  beats: BeatEvent[],
  chords: ChordEvent[],
  barCount: number
): ChordTimelineArtifact {
  return {
    version: 1,
    analysisVersion: 'test-v1',
    analyzerConfigHash: 'test',
    beatGrid: {
      tempo,
      timeSignature: { numerator: 4, denominator: 4 },
      beats,
      barCount,
    },
    chords,
    edits: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

// ============================================
// extractChordRoot
// ============================================

describe('extractChordRoot', () => {
  it('extracts major chord root', () => {
    expect(extractChordRoot('C')).toBe('C');
    expect(extractChordRoot('F')).toBe('F');
  });

  it('extracts minor chord root', () => {
    expect(extractChordRoot('Am')).toBe('A');
    expect(extractChordRoot('Dm')).toBe('D');
  });

  it('extracts 7th chord root', () => {
    expect(extractChordRoot('C7')).toBe('C');
    expect(extractChordRoot('G7')).toBe('G');
  });

  it('handles sharps', () => {
    expect(extractChordRoot('F#m')).toBe('F#');
    expect(extractChordRoot('C#')).toBe('C#');
  });

  it('handles flats', () => {
    expect(extractChordRoot('Bb')).toBe('Bb');
    expect(extractChordRoot('Eb')).toBe('Eb');
  });

  it('handles lowercase input', () => {
    expect(extractChordRoot('c7')).toBe('C');
  });
});

// ============================================
// computeBeatFMeasure
// ============================================

describe('computeBeatFMeasure', () => {
  it('returns F1=1.0 for perfect match', () => {
    const beats = [makeBeat(1.0, 1, 1), makeBeat(2.0, 2, 1), makeBeat(3.0, 3, 1)];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0), makeAnchor(3, 3.0)];

    const result = computeBeatFMeasure(beats, anchors);
    expect(result.f1).toBeCloseTo(1.0);
    expect(result.precision).toBeCloseTo(1.0);
    expect(result.recall).toBeCloseTo(1.0);
  });

  it('matches within tolerance', () => {
    const beats = [makeBeat(1.03, 1, 1), makeBeat(2.05, 2, 1)];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0)];

    const result = computeBeatFMeasure(beats, anchors, 70);
    expect(result.f1).toBeCloseTo(1.0);
  });

  it('misses beyond tolerance', () => {
    const beats = [makeBeat(1.1, 1, 1), makeBeat(2.0, 2, 1)];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0)];

    const result = computeBeatFMeasure(beats, anchors, 70);
    // 1.1 is 100ms away from 1.0 → miss; 2.0 matches
    expect(result.matched).toBe(1);
    expect(result.recall).toBeCloseTo(0.5);
  });

  it('extra predictions lower precision', () => {
    const beats = [
      makeBeat(1.0, 1, 1), makeBeat(1.5, 1, 2),
      makeBeat(2.0, 2, 1), makeBeat(2.5, 2, 2),
    ];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0)];

    const result = computeBeatFMeasure(beats, anchors);
    expect(result.recall).toBeCloseTo(1.0);
    expect(result.precision).toBeCloseTo(0.5);
  });
});

// ============================================
// computeDownbeatFMeasure
// ============================================

describe('computeDownbeatFMeasure', () => {
  it('only considers beats with beatInBar=1', () => {
    const beats = [
      makeBeat(1.0, 1, 1), makeBeat(1.5, 1, 2), makeBeat(1.75, 1, 3),
      makeBeat(2.0, 2, 1), makeBeat(2.5, 2, 2),
    ];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0)];

    const result = computeDownbeatFMeasure(beats, anchors);
    expect(result.predicted).toBe(2);
    expect(result.f1).toBeCloseTo(1.0);
  });
});

// ============================================
// computeBarDrift
// ============================================

describe('computeBarDrift', () => {
  it('returns 0ms drift for perfectly aligned beats', () => {
    const beats = [makeBeat(1.0, 1, 1), makeBeat(2.0, 2, 1), makeBeat(3.0, 3, 1)];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0), makeAnchor(3, 3.0)];

    const result = computeBarDrift(beats, anchors);
    expect(result.medianMs).toBeCloseTo(0);
    expect(result.p95Ms).toBeCloseTo(0);
  });

  it('computes correct drift for systematic offset', () => {
    // All beats are 50ms early
    const beats = [makeBeat(0.95, 1, 1), makeBeat(1.95, 2, 1), makeBeat(2.95, 3, 1)];
    const anchors = [makeAnchor(1, 1.0), makeAnchor(2, 2.0), makeAnchor(3, 3.0)];

    const result = computeBarDrift(beats, anchors);
    expect(result.medianMs).toBeCloseTo(50);
    expect(result.p95Ms).toBeCloseTo(50);
  });

  it('computes correct median and p95 for varied drift', () => {
    const beats = [
      makeBeat(1.01, 1, 1),  // 10ms late
      makeBeat(2.0, 2, 1),   // 0ms
      makeBeat(3.05, 3, 1),  // 50ms late
      makeBeat(4.15, 4, 1),  // 150ms late
    ];
    const anchors = [
      makeAnchor(1, 1.0), makeAnchor(2, 2.0),
      makeAnchor(3, 3.0), makeAnchor(4, 4.0),
    ];

    const result = computeBarDrift(beats, anchors);
    // abs drifts sorted: [0, 10, 50, 150]
    // median (p=0.5): index ceil(0.5*4)-1 = 1 → 10
    expect(result.medianMs).toBeCloseTo(10);
    // p95: index ceil(0.95*4)-1 = 3 → 150
    expect(result.p95Ms).toBeCloseTo(150);
  });
});

// ============================================
// computeChordAccuracy
// ============================================

describe('computeChordAccuracy', () => {
  it('returns 100% for exact matches', () => {
    const chords = [
      makeChord('F', 1, 2, 0, 2),
      makeChord('C7', 3, 4, 2, 4),
    ];
    const labels = [makeLabel(1, 'F'), makeLabel(3, 'C7')];

    const result = computeChordAccuracy(chords, labels);
    expect(result.rootAccuracy).toBeCloseTo(1.0);
    expect(result.fullAccuracy).toBeCloseTo(1.0);
  });

  it('root-only match: root 100%, full < 100%', () => {
    const chords = [
      makeChord('C', 1, 2, 0, 2),   // predicted C
      makeChord('F', 3, 4, 2, 4),
    ];
    const labels = [makeLabel(1, 'C7'), makeLabel(3, 'F')]; // expected C7

    const result = computeChordAccuracy(chords, labels);
    expect(result.rootAccuracy).toBeCloseTo(1.0);
    expect(result.fullAccuracy).toBeCloseTo(0.5); // C≠C7, F=F
  });

  it('wrong root yields 0% for that bar', () => {
    const chords = [makeChord('G', 1, 1, 0, 1)];
    const labels = [makeLabel(1, 'C')];

    const result = computeChordAccuracy(chords, labels);
    expect(result.rootAccuracy).toBeCloseTo(0);
    expect(result.fullAccuracy).toBeCloseTo(0);
  });
});

// ============================================
// computeFalseChordChangeRate
// ============================================

describe('computeFalseChordChangeRate', () => {
  it('returns 0 when no false changes', () => {
    const chords = [
      makeChord('C', 1, 2, 0, 2),
      makeChord('G', 3, 4, 2, 4),
    ];
    // GT: C→C→G→G (change at bar 3)
    const labels = [makeLabel(1, 'C'), makeLabel(2, 'C'), makeLabel(3, 'G'), makeLabel(4, 'G')];

    const result = computeFalseChordChangeRate(chords, labels);
    expect(result.total).toBe(0);
    expect(result.per32Bars).toBeCloseTo(0);
  });

  it('counts false changes where GT is stable', () => {
    const chords = [
      makeChord('C', 1, 1, 0, 1),
      makeChord('G', 2, 2, 1, 2),  // predicted change at bar 2
      makeChord('C', 3, 4, 2, 4),
    ];
    // GT: all C — predicted changes are false
    const labels = [makeLabel(1, 'C'), makeLabel(2, 'C'), makeLabel(3, 'C'), makeLabel(4, 'C')];

    const result = computeFalseChordChangeRate(chords, labels);
    // transitions: 1→2 (pred changes C→G, GT stable) = false
    //              2→3 (pred changes G→C, GT stable) = false
    //              3→4 (pred stays C, GT stable) = ok
    expect(result.total).toBe(2);
    expect(result.totalBars).toBe(3); // 3 transitions
    expect(result.per32Bars).toBeCloseTo((2 / 3) * 32);
  });
});

// ============================================
// computeDeterminism
// ============================================

describe('computeDeterminism', () => {
  it('returns null for fewer than 2 runs', () => {
    expect(computeDeterminism([])).toBeNull();
    const single = makeTimeline(120, [makeBeat(1, 1, 1)], [], 1);
    expect(computeDeterminism([single])).toBeNull();
  });

  it('returns perfect agreement for identical runs', () => {
    const beats = [makeBeat(1.0, 1, 1), makeBeat(2.0, 2, 1)];
    const chords = [makeChord('C', 1, 2, 0, 2)];
    const t1 = makeTimeline(120, beats, chords, 2);
    const t2 = makeTimeline(120, beats, chords, 2);

    const result = computeDeterminism([t1, t2]);
    expect(result).not.toBeNull();
    expect(result!.beatVariance).toBeCloseTo(0);
    expect(result!.chordAgreement).toBeCloseTo(1.0);
    expect(result!.tempoVariance).toBeCloseTo(0);
  });

  it('measures variance for differing runs', () => {
    const beats1 = [makeBeat(1.0, 1, 1), makeBeat(2.0, 2, 1)];
    const beats2 = [makeBeat(1.1, 1, 1), makeBeat(2.1, 2, 1)];
    const chords1 = [makeChord('C', 1, 2, 0, 2)];
    const chords2 = [makeChord('G', 1, 2, 0, 2)];
    const t1 = makeTimeline(120, beats1, chords1, 2);
    const t2 = makeTimeline(125, beats2, chords2, 2);

    const result = computeDeterminism([t1, t2]);
    expect(result).not.toBeNull();
    expect(result!.beatVariance).toBeGreaterThan(0);
    expect(result!.chordAgreement).toBeLessThan(1.0);
    expect(result!.tempoVariance).toBeGreaterThan(0);
  });
});
