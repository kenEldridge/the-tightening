import { describe, it, expect } from 'vitest';
import { symbolToDegree, renderDegreeToSymbol } from './chordDegrees';
import type { ChordDegree, ChordQualityTag } from './rhythmTypes';

describe('symbolToDegree', () => {
  it('maps diatonic triads in key of C (root=0)', () => {
    expect(symbolToDegree('C', 0)).toEqual({ degree: 'I', qualityTag: 'maj' });
    expect(symbolToDegree('Dm', 0)).toEqual({ degree: 'ii', qualityTag: 'min' });
    expect(symbolToDegree('Em', 0)).toEqual({ degree: 'iii', qualityTag: 'min' });
    expect(symbolToDegree('F', 0)).toEqual({ degree: 'IV', qualityTag: 'maj' });
    expect(symbolToDegree('G', 0)).toEqual({ degree: 'V', qualityTag: 'maj' });
    expect(symbolToDegree('Am', 0)).toEqual({ degree: 'vi', qualityTag: 'min' });
    expect(symbolToDegree('Bdim', 0)).toEqual({ degree: 'vii_dim', qualityTag: 'dim' });
  });

  it('maps diatonic triads in key of A (root=9)', () => {
    expect(symbolToDegree('A', 9)).toEqual({ degree: 'I', qualityTag: 'maj' });
    expect(symbolToDegree('D', 9)).toEqual({ degree: 'IV', qualityTag: 'maj' });
    expect(symbolToDegree('E', 9)).toEqual({ degree: 'V', qualityTag: 'maj' });
    expect(symbolToDegree('F#m', 9)).toEqual({ degree: 'vi', qualityTag: 'min' });
  });

  it('maps dominant 7th chords', () => {
    expect(symbolToDegree('G7', 0)).toEqual({ degree: 'V', qualityTag: 'dom7' });
    expect(symbolToDegree('C7', 5)).toEqual({ degree: 'V', qualityTag: 'dom7' });
    expect(symbolToDegree('E7', 9)).toEqual({ degree: 'V', qualityTag: 'dom7' });
  });

  it('maps flat-named roots', () => {
    expect(symbolToDegree('Bb', 5)).toEqual({ degree: 'IV', qualityTag: 'maj' });
    expect(symbolToDegree('Eb', 10)).toEqual({ degree: 'IV', qualityTag: 'maj' });
  });

  it('returns null for N (no chord)', () => {
    expect(symbolToDegree('N', 0)).toBeNull();
  });

  it('returns null for non-diatonic intervals', () => {
    // C# in key of C is semitone 1 — not a diatonic degree
    expect(symbolToDegree('C#', 0)).toBeNull();
  });
});

describe('renderDegreeToSymbol', () => {
  it('renders all degrees in key of C', () => {
    expect(renderDegreeToSymbol('I', 'maj', 0)).toBe('C');
    expect(renderDegreeToSymbol('ii', 'min', 0)).toBe('Dm');
    expect(renderDegreeToSymbol('iii', 'min', 0)).toBe('Em');
    expect(renderDegreeToSymbol('IV', 'maj', 0)).toBe('F');
    expect(renderDegreeToSymbol('V', 'maj', 0)).toBe('G');
    expect(renderDegreeToSymbol('vi', 'min', 0)).toBe('Am');
    expect(renderDegreeToSymbol('vii_dim', 'dim', 0)).toBe('Bdim');
  });

  it('renders in key of D (root=2)', () => {
    expect(renderDegreeToSymbol('I', 'maj', 2)).toBe('D');
    expect(renderDegreeToSymbol('IV', 'maj', 2)).toBe('G');
    expect(renderDegreeToSymbol('V', 'maj', 2)).toBe('A');
    expect(renderDegreeToSymbol('vi', 'min', 2)).toBe('Bm');
  });

  it('renders in key of F using flats', () => {
    expect(renderDegreeToSymbol('I', 'maj', 5)).toBe('F');
    expect(renderDegreeToSymbol('IV', 'maj', 5)).toBe('Bb');
    expect(renderDegreeToSymbol('V', 'dom7', 5)).toBe('C7');
  });

  it('renders in key of Bb using flats', () => {
    expect(renderDegreeToSymbol('I', 'maj', 10)).toBe('Bb');
    expect(renderDegreeToSymbol('IV', 'maj', 10)).toBe('Eb');
    expect(renderDegreeToSymbol('V', 'maj', 10)).toBe('F');
  });

  it('renders N as N regardless of key', () => {
    expect(renderDegreeToSymbol('N', 'unknown', 0)).toBe('N');
    expect(renderDegreeToSymbol('N', 'unknown', 7)).toBe('N');
  });
});

describe('round-trip: symbolToDegree -> renderDegreeToSymbol', () => {
  const testCases: Array<{ symbol: string; keyRoot: number; expected: string }> = [
    { symbol: 'C', keyRoot: 0, expected: 'C' },
    { symbol: 'G7', keyRoot: 0, expected: 'G7' },
    { symbol: 'Am', keyRoot: 0, expected: 'Am' },
    { symbol: 'A', keyRoot: 9, expected: 'A' },
    { symbol: 'E', keyRoot: 9, expected: 'E' },
    { symbol: 'F#m', keyRoot: 9, expected: 'F#m' },
    { symbol: 'D', keyRoot: 2, expected: 'D' },
    { symbol: 'Bm', keyRoot: 2, expected: 'Bm' },
    { symbol: 'F', keyRoot: 5, expected: 'F' },
    { symbol: 'Bb', keyRoot: 5, expected: 'Bb' },
  ];

  for (const { symbol, keyRoot, expected } of testCases) {
    it(`${symbol} in key root=${keyRoot} round-trips to ${expected}`, () => {
      const deg = symbolToDegree(symbol, keyRoot);
      expect(deg).not.toBeNull();
      const rendered = renderDegreeToSymbol(deg!.degree, deg!.qualityTag, keyRoot);
      expect(rendered).toBe(expected);
    });
  }
});

describe('cross-key transposition', () => {
  it('I in A -> I in D', () => {
    const deg = symbolToDegree('A', 9);
    expect(deg).not.toBeNull();
    expect(renderDegreeToSymbol(deg!.degree, deg!.qualityTag, 2)).toBe('D');
  });

  it('V in A -> V in F', () => {
    const deg = symbolToDegree('E', 9);
    expect(deg).not.toBeNull();
    expect(renderDegreeToSymbol(deg!.degree, deg!.qualityTag, 5)).toBe('C');
  });

  it('vi in D -> vi in F (uses flat)', () => {
    const deg = symbolToDegree('Bm', 2);
    expect(deg).not.toBeNull();
    expect(renderDegreeToSymbol(deg!.degree, deg!.qualityTag, 5)).toBe('Dm');
  });
});
