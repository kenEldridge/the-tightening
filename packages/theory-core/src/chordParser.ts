/**
 * Chord input parser — same regex and validation as the blog ProgressionGraph.
 */

const CHORD_RE = /^[A-G][#b]?(m|dim|aug|maj7|m7|7|sus2|sus4|add9|\u00B0)?$/;

export function parseChordInput(input: string): { chords: string[] | null; error: string | null } {
  if (!input.trim()) return { chords: null, error: 'Chord input is required' };
  const tokens = input.split(',');
  const chords: string[] = [];
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) return { chords: null, error: 'Empty chord between commas' };
    if (!CHORD_RE.test(t)) return { chords: null, error: `Invalid chord: ${t}` };
    chords.push(t);
  }
  return { chords, error: null };
}

export { CHORD_RE };
