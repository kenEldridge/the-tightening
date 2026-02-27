/**
 * CSV Parser
 *
 * Simple CSV parse/serialize for ground truth files. No external deps.
 */

import type { BarAnchor, ChordLabel } from './evaluationTypes';

export function parseCSV(text: string): string[][] {
  const lines = text.trim().split('\n');
  return lines.map(line => line.split(',').map(cell => cell.trim()));
}

export function toCSV(rows: string[][]): string {
  return rows.map(row => row.join(',')).join('\n') + '\n';
}

export function parseBarAnchors(text: string): BarAnchor[] {
  const rows = parseCSV(text);
  // Skip header row
  return rows.slice(1).map(([bar, timeSec, source]) => ({
    bar: parseInt(bar, 10),
    timeSec: parseFloat(timeSec),
    source: (source || 'computed') as 'computed' | 'ear',
  }));
}

export function parseChordLabels(text: string): ChordLabel[] {
  const rows = parseCSV(text);
  return rows.slice(1).map(([bar, symbol, source]) => ({
    bar: parseInt(bar, 10),
    symbol,
    source: (source || 'computed') as 'midi' | 'manual' | 'computed',
  }));
}

export function barAnchorsToCSV(anchors: BarAnchor[]): string {
  const header = ['bar', 'timeSec', 'source'];
  const rows = anchors.map(a => [String(a.bar), a.timeSec.toFixed(4), a.source]);
  return toCSV([header, ...rows]);
}

export function chordLabelsToCSV(labels: ChordLabel[]): string {
  const header = ['bar', 'symbol', 'source'];
  const rows = labels.map(l => [String(l.bar), l.symbol, l.source]);
  return toCSV([header, ...rows]);
}
