/**
 * Piano Arranger
 *
 * Converts aligned MIDI note streams into playable chord reductions and
 * refines generic chord streams with voice-led voicings.
 */

import type { BeatGrid, ChordEvent, ChordVoicingData, GuideMelodyNote } from './rhythmTypes';

export interface AlignedMidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

interface ParsedChord {
  rootPc: number;
  quality: 'maj' | 'min' | 'dom7' | 'dim';
}

interface BeatWindow {
  bar: number;
  beatInBar: number;
  start: number;
  end: number;
}

interface RawBeatChord {
  bar: number;
  beatInBar: number;
  startTime: number;
  endTime: number;
  symbol: string;
  confidence: number;
  bassHint?: number;
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
  Cb: 'B',
  Fb: 'E',
};

const CHORD_TEMPLATES: Array<{ symbol: string; pcs: number[] }> = buildChordTemplates();

function buildChordTemplates(): Array<{ symbol: string; pcs: number[] }> {
  const templates: Array<{ symbol: string; pcs: number[] }> = [];
  for (let root = 0; root < 12; root++) {
    const name = NOTE_NAMES_SHARP[root];
    templates.push({ symbol: name, pcs: [root, (root + 4) % 12, (root + 7) % 12] });
    templates.push({ symbol: `${name}m`, pcs: [root, (root + 3) % 12, (root + 7) % 12] });
    templates.push({ symbol: `${name}7`, pcs: [root, (root + 4) % 12, (root + 7) % 12, (root + 10) % 12] });
    templates.push({ symbol: `${name}dim`, pcs: [root, (root + 3) % 12, (root + 6) % 12] });
  }
  return templates;
}

function pitchClassFromRootName(name: string): number {
  const norm = FLAT_TO_SHARP[name] || name;
  return NOTE_NAMES_SHARP.indexOf(norm);
}

function parseKeyHintToRoot(keyHint?: string): number | null {
  if (!keyHint) return null;
  const m = keyHint.trim().match(/^([A-G](?:#|b)?)/);
  if (!m) return null;
  const pc = pitchClassFromRootName(m[1]);
  return pc >= 0 ? pc : null;
}

function detectMajorKeyRoot(notes: AlignedMidiNote[]): number {
  const hist = new Array(12).fill(0);
  for (const n of notes) {
    const pc = ((n.midi % 12) + 12) % 12;
    hist[pc] += Math.max(0.05, n.duration) * (0.25 + n.velocity);
  }
  let bestPc = 0;
  let bestScore = -Infinity;
  const majorScale = [0, 2, 4, 5, 7, 9, 11];
  for (let root = 0; root < 12; root++) {
    let score = 0;
    for (const interval of majorScale) score += hist[(root + interval) % 12];
    if (score > bestScore) {
      bestScore = score;
      bestPc = root;
    }
  }
  return bestPc;
}

function diatonicChordSet(rootPc: number): Set<string> {
  const scale = [0, 2, 4, 5, 7, 9, 11];
  const suffix = ['', 'm', 'm', '', '', 'm', 'dim'];
  const out = new Set<string>();
  for (let i = 0; i < scale.length; i++) {
    const pc = (rootPc + scale[i]) % 12;
    const base = NOTE_NAMES_SHARP[pc] + suffix[i];
    out.add(base);
    if (i === 4) out.add(NOTE_NAMES_SHARP[pc] + '7');
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function buildBeatWindows(beatGrid: BeatGrid): BeatWindow[] {
  const beats = [...beatGrid.beats].sort((a, b) => a.time - b.time);
  if (beats.length === 0) return [];
  const intervals: number[] = [];
  for (let i = 1; i < beats.length; i++) {
    const dt = beats[i].time - beats[i - 1].time;
    if (dt > 1e-4) intervals.push(dt);
  }
  const defaultBeat = intervals.length > 0 ? median(intervals) : (60 / Math.max(1, beatGrid.tempo));
  const windows: BeatWindow[] = [];
  for (let i = 0; i < beats.length; i++) {
    const start = beats[i].time;
    const end = i + 1 < beats.length ? beats[i + 1].time : start + defaultBeat;
    windows.push({
      bar: beats[i].bar,
      beatInBar: beats[i].beatInBar,
      start,
      end: Math.max(start + 1e-3, end),
    });
  }
  return windows;
}

function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function weightedSimilarity(hist: number[], pcs: number[]): number {
  let num = 0;
  let denA = 0;
  for (let i = 0; i < 12; i++) {
    const inTemplate = pcs.includes(i) ? 1 : 0;
    num += hist[i] * inTemplate;
    denA += hist[i] * hist[i];
  }
  const denB = pcs.length;
  const denom = Math.sqrt(Math.max(1e-9, denA)) * Math.sqrt(denB);
  return denom > 0 ? num / denom : 0;
}

function matchHistogramToChord(
  hist: number[],
  bassPc?: number,
  diatonic?: Set<string>,
  prevSymbol?: string | null,
): { symbol: string; confidence: number } {
  let best = { symbol: 'N', confidence: 0 };
  let second = 0;
  for (const tpl of CHORD_TEMPLATES) {
    let score = weightedSimilarity(hist, tpl.pcs);
    if (bassPc != null) {
      const rootPc = parseChordSymbol(tpl.symbol)?.rootPc;
      if (rootPc != null && rootPc === bassPc) score *= 1.12;
    }
    if (diatonic && diatonic.has(tpl.symbol)) score *= 1.18;
    if (prevSymbol && tpl.symbol === prevSymbol) score *= 1.14;
    if (tpl.symbol.endsWith('7') && (!diatonic || !diatonic.has(tpl.symbol))) score *= 0.93;
    if (score > best.confidence) {
      second = best.confidence;
      best = { symbol: tpl.symbol, confidence: score };
    } else if (score > second) {
      second = score;
    }
  }
  const margin = Math.max(0, best.confidence - second);
  const confidence = Math.max(0, Math.min(1, 0.75 * best.confidence + 0.25 * (margin * 2)));
  return { symbol: best.symbol, confidence };
}

function parseChordSymbol(symbol: string): ParsedChord | null {
  const m = symbol.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!m) return null;
  const rootRaw = m[1];
  const rootNorm = FLAT_TO_SHARP[rootRaw] || rootRaw;
  const rootPc = NOTE_NAMES_SHARP.indexOf(rootNorm);
  if (rootPc < 0) return null;
  const suffix = (m[2] || '').toLowerCase();
  if (suffix.startsWith('dim')) return { rootPc, quality: 'dim' };
  if (suffix.startsWith('m') && !suffix.startsWith('maj')) return { rootPc, quality: 'min' };
  if (suffix.startsWith('7')) return { rootPc, quality: 'dom7' };
  return { rootPc, quality: 'maj' };
}

function qualityIntervals(quality: ParsedChord['quality']): number[] {
  if (quality === 'min') return [0, 3, 7];
  if (quality === 'dom7') return [0, 4, 7, 10];
  if (quality === 'dim') return [0, 3, 6];
  return [0, 4, 7];
}

function generateRightHandCandidates(parsed: ParsedChord): number[][] {
  const baseIntervals = qualityIntervals(parsed.quality);
  const candidates: number[][] = [];
  for (let octave = 4; octave <= 5; octave++) {
    const rootMidi = octave * 12 + parsed.rootPc;
    for (let inversion = 0; inversion < baseIntervals.length; inversion++) {
      const raw = baseIntervals.map((intv, idx) => {
        const rel = (idx - inversion + baseIntervals.length) % baseIntervals.length;
        const octShift = idx < inversion ? 12 : 0;
        return rootMidi + baseIntervals[rel] + octShift;
      }).sort((a, b) => a - b);
      for (let shift = -12; shift <= 12; shift += 12) {
        const shifted = raw.map(n => n + shift).filter(n => n >= 48 && n <= 84);
        if (shifted.length >= 3) candidates.push(shifted.sort((a, b) => a - b));
      }
    }
  }
  return candidates;
}

function voiceLeadingCost(prev: number[] | null, next: number[]): number {
  if (!prev || prev.length === 0) return 0;
  const a = [...prev].sort((x, y) => x - y);
  const b = [...next].sort((x, y) => x - y);
  const minLen = Math.min(a.length, b.length);
  let cost = 0;
  for (let i = 0; i < minLen; i++) {
    cost += Math.abs(a[i] - b[i]);
  }
  cost += Math.abs(a.length - b.length) * 6;
  return cost;
}

function nearestBassForRoot(rootPc: number, prevBass: number | null, bassHint?: number): number {
  const candidates: number[] = [];
  for (let octave = 2; octave <= 4; octave++) {
    candidates.push(octave * 12 + rootPc);
  }
  const target = bassHint ?? (prevBass ?? (36 + rootPc));
  let best = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const leapPenalty = prevBass != null && Math.abs(c - prevBass) > 7 ? 4 : 0;
    const score = Math.abs(c - target) + leapPenalty;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function chooseMelodyTarget(
  melody: AlignedMidiNote[] | undefined,
  startTime: number,
  endTime: number,
): number | null {
  if (!melody || melody.length === 0) return null;
  let best: number | null = null;
  for (const note of melody) {
    if (note.time > endTime || note.time + note.duration < startTime) continue;
    if (best == null || note.midi > best) best = note.midi;
  }
  return best;
}

export function applyVoiceLedVoicings(
  chords: ChordEvent[],
  melody?: AlignedMidiNote[],
  bassHints?: Array<number | undefined>,
): ChordEvent[] {
  const out: ChordEvent[] = [];
  let prevRh: number[] | null = null;
  let prevBass: number | null = null;

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const parsed = parseChordSymbol(chord.symbol);
    if (!parsed) {
      out.push(chord);
      continue;
    }

    const candidates = generateRightHandCandidates(parsed);
    const topTarget = chooseMelodyTarget(melody, chord.startTime, chord.endTime);

    let bestRh = candidates[0] || chord.voicing?.notes || [];
    let bestCost = Infinity;
    for (const cand of candidates) {
      let cost = voiceLeadingCost(prevRh, cand);
      if (topTarget != null) {
        const top = cand[cand.length - 1];
        cost += 0.35 * Math.abs(top - topTarget);
      }
      if (cost < bestCost) {
        bestRh = cand;
        bestCost = cost;
      }
    }

    const bass = nearestBassForRoot(parsed.rootPc, prevBass, bassHints?.[i]);
    const voicing: ChordVoicingData = { bass, notes: bestRh };
    out.push({ ...chord, voicing });

    prevRh = bestRh;
    prevBass = bass;
  }

  return out;
}

function smoothBeatLabels(raw: RawBeatChord[]): RawBeatChord[] {
  if (raw.length < 3) return raw;
  const out = raw.map(r => ({ ...r }));

  // Absorb one-beat anomalies if neighboring harmony agrees.
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    if (prev.symbol === next.symbol && cur.symbol !== prev.symbol && cur.confidence < Math.min(prev.confidence, next.confidence) * 1.1) {
      out[i] = {
        ...cur,
        symbol: prev.symbol,
        confidence: Math.min(1, (prev.confidence + next.confidence) * 0.45),
      };
    }
  }

  // Confidence backfill: very weak symbol adopts strongest local neighbor.
  for (let i = 0; i < out.length; i++) {
    if (out[i].confidence >= 0.42) continue;
    const local = [out[i - 1], out[i + 1]].filter(Boolean) as RawBeatChord[];
    if (local.length === 0) continue;
    const best = local.sort((a, b) => b.confidence - a.confidence)[0];
    if (best.confidence > out[i].confidence * 1.2) {
      out[i] = { ...out[i], symbol: best.symbol, confidence: best.confidence * 0.85 };
    }
  }

  return out;
}

function mergeBeatChords(raw: RawBeatChord[]): Array<RawBeatChord & { barEnd: number; beatEnd: number }> {
  if (raw.length === 0) return [];
  const merged: Array<RawBeatChord & { barEnd: number; beatEnd: number }> = [];
  let acc = {
    ...raw[0],
    barEnd: raw[0].bar,
    beatEnd: raw[0].beatInBar,
    confidenceSum: raw[0].confidence,
    confidenceCount: 1,
    bassHints: raw[0].bassHint != null ? [raw[0].bassHint] : [] as number[],
  };

  for (let i = 1; i < raw.length; i++) {
    const cur = raw[i];
    const canMerge = cur.symbol === acc.symbol && (cur.confidence >= 0.42 || acc.confidence >= 0.42);
    if (canMerge) {
      acc.endTime = cur.endTime;
      acc.barEnd = cur.bar;
      acc.beatEnd = cur.beatInBar;
      acc.confidenceSum += cur.confidence;
      acc.confidenceCount += 1;
      if (cur.bassHint != null) acc.bassHints.push(cur.bassHint);
      continue;
    }

    merged.push({
      ...acc,
      confidence: acc.confidenceSum / Math.max(1, acc.confidenceCount),
      bassHint: acc.bassHints.length > 0 ? median(acc.bassHints) : undefined,
    });
    acc = {
      ...cur,
      barEnd: cur.bar,
      beatEnd: cur.beatInBar,
      confidenceSum: cur.confidence,
      confidenceCount: 1,
      bassHints: cur.bassHint != null ? [cur.bassHint] : [] as number[],
    };
  }

  merged.push({
    ...acc,
    confidence: acc.confidenceSum / Math.max(1, acc.confidenceCount),
    bassHint: acc.bassHints.length > 0 ? median(acc.bassHints) : undefined,
  });

  return merged;
}

function absorbShortMergedEvents(
  merged: Array<RawBeatChord & { barEnd: number; beatEnd: number }>,
  beatDuration: number,
): Array<RawBeatChord & { barEnd: number; beatEnd: number }> {
  if (merged.length < 3) return merged;
  const out = merged.map(m => ({ ...m }));
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1];
    const cur = out[i];
    const next = out[i + 1];
    const curDur = cur.endTime - cur.startTime;
    const shortDur = curDur < beatDuration * 1.2;

    if (shortDur && prev.symbol === next.symbol && cur.confidence < Math.min(prev.confidence, next.confidence) * 1.15) {
      // absorb current into neighbors by extending previous through current
      out[i - 1] = {
        ...prev,
        endTime: cur.endTime,
        barEnd: cur.barEnd,
        beatEnd: cur.beatEnd,
        confidence: Math.max(prev.confidence, (prev.confidence + next.confidence) / 2),
      };
      out[i] = {
        ...cur,
        symbol: prev.symbol,
        confidence: out[i - 1].confidence * 0.9,
      };
    }
  }

  // Re-merge after replacements
  return mergeBeatChords(out);
}

export function reduceAlignedMidiToChords(
  beatGrid: BeatGrid,
  harmonyNotes: AlignedMidiNote[],
  melodyNotes?: AlignedMidiNote[],
  keyHint?: string,
): { chords: ChordEvent[]; guideMelody: GuideMelodyNote[] } {
  const windows = buildBeatWindows(beatGrid);
  if (windows.length === 0 || harmonyNotes.length === 0) {
    return {
      chords: [],
      guideMelody: buildGuideMelody(melodyNotes || harmonyNotes),
    };
  }
  const approxBeatDuration = windows.length > 1
    ? median(windows.slice(1).map((w, i) => w.start - windows[i].start).filter(dt => dt > 1e-4))
    : (60 / Math.max(1, beatGrid.tempo));

  const notes = harmonyNotes
    .filter(n => Number.isFinite(n.time) && Number.isFinite(n.duration) && n.duration > 0 && Number.isFinite(n.midi))
    .map(n => ({ ...n }))
    .sort((a, b) => a.time - b.time);

  const raw: RawBeatChord[] = [];
  let prevSymbol: string | null = null;
  const keyRoot = parseKeyHintToRoot(keyHint) ?? detectMajorKeyRoot(notes);
  const diatonic = diatonicChordSet(keyRoot);

  for (const win of windows) {
    const hist = new Array(12).fill(0);
    let totalWeight = 0;
    let bassHint: number | undefined;
    let bassWeight = 0;

    for (const note of notes) {
      if (note.time > win.end) break;
      const noteEnd = note.time + note.duration;
      if (noteEnd < win.start) continue;

      const overlap = overlapSeconds(note.time, noteEnd, win.start, win.end);
      if (overlap <= 0) continue;

      const registerWeight = note.midi > 76 ? 0.55 : (note.midi < 36 ? 0.85 : 1.0);
      const weight = overlap * registerWeight * (0.5 + Math.max(0.05, note.velocity));
      const pc = ((note.midi % 12) + 12) % 12;
      hist[pc] += weight;
      totalWeight += weight;

      const bassEligible = note.midi <= 60;
      const bassScore = bassEligible ? (weight / Math.max(1, note.midi)) : 0;
      if (bassEligible && (bassHint == null || bassScore > bassWeight)) {
        bassHint = note.midi;
        bassWeight = bassScore;
      }
    }

    let symbol = prevSymbol || 'C';
    let confidence = 0.25;
    if (totalWeight > 0.035) {
      const match = matchHistogramToChord(
        hist,
        bassHint != null ? bassHint % 12 : undefined,
        diatonic,
        prevSymbol,
      );
      symbol = match.symbol;
      confidence = match.confidence;
      if (confidence < 0.33 && prevSymbol) {
        symbol = prevSymbol;
        confidence = 0.34;
      }
    } else if (prevSymbol) {
      confidence = 0.32;
    }

    raw.push({
      bar: win.bar,
      beatInBar: win.beatInBar,
      startTime: win.start,
      endTime: win.end,
      symbol,
      confidence,
      bassHint,
    });
    prevSymbol = symbol;
  }

  const smoothed = smoothBeatLabels(raw);
  const merged = absorbShortMergedEvents(mergeBeatChords(smoothed), approxBeatDuration);

  const baseChords: ChordEvent[] = merged.map((c, idx) => ({
    id: `chord_midi_${idx + 1}`,
    startTime: c.startTime,
    endTime: c.endTime,
    barStart: c.bar,
    barEnd: c.barEnd,
    symbol: c.symbol,
    confidence: c.confidence,
    source: 'audio',
    voicing: null,
  }));

  const voiced = applyVoiceLedVoicings(
    baseChords,
    melodyNotes,
    merged.map(m => m.bassHint),
  );

  return {
    chords: voiced,
    guideMelody: buildGuideMelody(melodyNotes || harmonyNotes),
  };
}

export function buildGuideMelody(notes: AlignedMidiNote[]): GuideMelodyNote[] {
  const sorted = notes
    .filter(n => n.midi >= 50 && n.duration > 0.05)
    .sort((a, b) => a.time - b.time);
  const result: GuideMelodyNote[] = [];
  let lastTime = -Infinity;
  let lastMidi = -1;
  for (const note of sorted) {
    // Keep phrase contour but avoid over-dense machine-gun playback.
    if (note.time - lastTime < 0.08 && Math.abs(note.midi - lastMidi) <= 1) continue;
    result.push({
      time: note.time,
      midi: note.midi,
      duration: Math.max(0.06, Math.min(1.0, note.duration)),
      velocity: Math.max(0.18, Math.min(0.55, note.velocity * 0.7 + 0.15)),
    });
    lastTime = note.time;
    lastMidi = note.midi;
  }
  return result;
}
