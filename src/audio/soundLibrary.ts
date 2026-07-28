// Sound-library import: turn a folder of audio samples into playable instruments.
//
// Handles the common multisample naming used by MPC/F9, Salamander, and others,
// where each file encodes the note it was sampled at and (optionally) a velocity
// layer:
//
//   "Inst-Piano-F9 Club PIano X-036 C1.WAV"  -> note MIDI 36, no velocity layer
//   "A0v1.flac" / "Ds1v13.mp3"               -> note A0 / D#1, velocity layer 1 / 13
//
// A single folder can hold many instruments (all the F9 content lives in one
// directory), so samples are grouped by their filename prefix into instruments
// the user chooses between. Velocity layers within an instrument are used to
// pick a brighter/louder sample as you play harder.

import type { LoadedSample, Sampler } from './sampler';

export interface SampleEntry {
  midi: number;
  /** Velocity-layer number if the name encodes one (e.g. v13 -> 13), else null. */
  vel: number | null;
  path: string;
  name: string;
}

export interface Instrument {
  name: string;
  samples: SampleEntry[];
  /** Distinct sampled notes. */
  noteCount: number;
  /** Distinct velocity layers (1 when the instrument has none). */
  layerCount: number;
}

/** Audio extensions Chromium/Electron can decode via decodeAudioData. */
export const AUDIO_EXTENSIONS = ['wav', 'flac', 'mp3', 'ogg', 'm4a', 'aac'];

/** A playable melodic instrument spans several distinct pitched notes. */
const MIN_PLAYABLE_NOTES = 3;
/** Cap velocity layers actually decoded, to bound memory on big libraries. */
const MAX_VELOCITY_LAYERS = 4;

const NOTE_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Trailing velocity-layer token: "...v13" before the extension.
const VEL_SUFFIX = /[vV](\d{1,2})$/;
// Trailing note token: "C1", "Gb0", "F#3", "Ds1" (s = sharp), "A-1".
const NOTE_SUFFIX = /([A-Ga-g])([#bs]?)(-?\d)$/;
// Explicit MIDI-number token followed by a note name: "-036 C1".
const MIDI_TOKEN = /[-_\s](\d{2,3})[-_\s]+[A-Ga-g][#bs]?-?\d/;

interface ParsedName {
  midi: number;
  vel: number | null;
}

/**
 * Extract the note (as MIDI) and any velocity-layer number from a filename.
 * Prefers an explicit numeric MIDI token; otherwise reads a trailing note name
 * (standard convention: middle C = C4 = MIDI 60), tolerating a `vNN` suffix.
 */
export function parseSampleName(filename: string): ParsedName | null {
  let base = filename.replace(/\.[^.]+$/, '');

  let vel: number | null = null;
  const velMatch = base.match(VEL_SUFFIX);
  if (velMatch) {
    vel = parseInt(velMatch[1], 10);
    base = base.slice(0, velMatch.index).replace(/[-_\s]+$/, '');
  }

  const numMatch = filename.match(MIDI_TOKEN);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 0 && n <= 127) return { midi: n, vel };
  }

  const noteMatch = base.match(NOTE_SUFFIX);
  if (noteMatch) {
    const letter = noteMatch[1].toUpperCase();
    let semi = NOTE_TO_SEMITONE[letter];
    if (semi === undefined) return null;
    if (noteMatch[2] === '#' || noteMatch[2] === 's') semi += 1;
    else if (noteMatch[2] === 'b') semi -= 1;
    const octave = parseInt(noteMatch[3], 10);
    const midi = (octave + 1) * 12 + semi; // C-1 = 0
    if (midi >= 0 && midi <= 127) return { midi, vel };
  }

  return null;
}

/** Keep parseMidiFromFilename as a thin wrapper for callers that only want the note. */
export function parseMidiFromFilename(filename: string): number | null {
  return parseSampleName(filename)?.midi ?? null;
}

/** Strip the trailing velocity + note tokens to get the instrument name. */
export function instrumentPrefix(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const stripped = base
    .replace(/[-_\s]\d{2,3}[-_\s]+[A-Ga-g][#bs]?-?\d([vV]\d{1,2})?\s*$/, '') // "-036 C1" (+optional vNN)
    .replace(VEL_SUFFIX, '')
    .replace(NOTE_SUFFIX, '')
    .replace(/[-_\s]+$/, '')
    .trim();
  return stripped || '(default)';
}

/** Group a folder's audio entries into instruments, largest (most notes) first. */
export function scanInstruments(entries: { name: string; path: string }[]): Instrument[] {
  const groups = new Map<string, SampleEntry[]>();
  for (const e of entries) {
    const parsed = parseSampleName(e.name);
    if (!parsed) continue;
    const key = instrumentPrefix(e.name);
    const arr = groups.get(key) ?? [];
    arr.push({ midi: parsed.midi, vel: parsed.vel, path: e.path, name: e.name });
    groups.set(key, arr);
  }

  const all: Instrument[] = [];
  for (const [name, raw] of groups) {
    // Dedupe by (note, layer), keeping the first occurrence.
    const seen = new Set<string>();
    const samples: SampleEntry[] = [];
    for (const s of raw) {
      const k = `${s.midi}:${s.vel ?? '-'}`;
      if (seen.has(k)) continue;
      seen.add(k);
      samples.push(s);
    }
    samples.sort((a, b) => a.midi - b.midi || (a.vel ?? 0) - (b.vel ?? 0));
    const noteCount = new Set(samples.map((s) => s.midi)).size;
    const layerCount = new Set(samples.map((s) => s.vel).filter((v) => v !== null)).size || 1;
    all.push({ name, samples, noteCount, layerCount });
  }

  all.sort((a, b) => b.noteCount - a.noteCount || b.samples.length - a.samples.length);
  const playable = all.filter((i) => i.noteCount >= MIN_PLAYABLE_NOTES);
  return playable.length > 0 ? playable : all;
}

/** Scan a folder (via Electron) and return its instruments. */
export async function scanFolder(dirPath: string): Promise<Instrument[]> {
  const api = window.electronAPI;
  if (!api?.scanSoundLibrary) throw new Error('Sound-library import requires the desktop app.');
  const entries = await api.scanSoundLibrary(dirPath);
  return scanInstruments(entries);
}

/** Pick up to MAX_VELOCITY_LAYERS layers, evenly spaced across those available. */
function chooseLayers(layers: number[]): number[] {
  if (layers.length <= MAX_VELOCITY_LAYERS) return layers;
  const k = MAX_VELOCITY_LAYERS;
  const out: number[] = [];
  for (let j = 0; j < k; j++) out.push(layers[Math.round((j * (layers.length - 1)) / (k - 1))]);
  return [...new Set(out)];
}

/** Split 0..127 into `n` ascending velocity bands (soft -> loud). */
function velocityBands(n: number): Array<{ lo: number; hi: number }> {
  if (n <= 1) return [{ lo: 0, hi: 127 }];
  const bands: Array<{ lo: number; hi: number }> = [];
  for (let i = 0; i < n; i++) {
    bands.push({
      lo: i === 0 ? 0 : Math.floor((i * 128) / n),
      hi: i === n - 1 ? 127 : Math.floor(((i + 1) * 128) / n) - 1,
    });
  }
  return bands;
}

/** Read + decode an instrument's samples (capped velocity layers) into the sampler. */
export async function loadInstrument(
  instrument: Instrument,
  sampler: Sampler,
  onProgress?: (done: number, total: number) => void,
): Promise<{ count: number; layers: number }> {
  const api = window.electronAPI;
  if (!api?.readFileBinary) throw new Error('Sound-library import requires the desktop app.');

  const allLayers = [...new Set(instrument.samples.map((s) => s.vel).filter((v): v is number => v !== null))].sort(
    (a, b) => a - b,
  );
  const chosen = chooseLayers(allLayers); // empty when the instrument has no layers
  const bands = velocityBands(chosen.length || 1);
  const layerBand = new Map<number, { lo: number; hi: number }>();
  chosen.forEach((layer, i) => layerBand.set(layer, bands[i]));

  const wanted = instrument.samples.filter((s) => s.vel === null || layerBand.has(s.vel));

  const loaded: LoadedSample[] = [];
  const total = wanted.length;
  let done = 0;
  let cursor = 0;
  const CONCURRENCY = 6;

  const worker = async () => {
    while (cursor < wanted.length) {
      const entry = wanted[cursor++];
      const band = entry.vel !== null ? layerBand.get(entry.vel)! : { lo: 0, hi: 127 };
      try {
        const bytes = await api.readFileBinary(entry.path);
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        const buffer = await sampler.decode(ab);
        loaded.push({ midi: entry.midi, velLo: band.lo, velHi: band.hi, buffer });
      } catch {
        /* skip a sample that can't be read or decoded */
      }
      onProgress?.(++done, total);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  if (loaded.length === 0) throw new Error('Could not decode any samples in this instrument.');

  sampler.loadSamples(loaded, instrument.name);
  return { count: loaded.length, layers: chosen.length || 1 };
}
