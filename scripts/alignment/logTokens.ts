import { PitchDetector as PitchyDetector } from 'pitchy';

export interface AudioOnset {
  timeSec: number;
  dominantMidi: number;
  pitchConfidence: number;
  onsetStrength: number;
}

export interface AudioFeatures {
  sampleRate: 44100;
  bitDepth: 16;
  channels: 1;
  durationSec: number;
  onsets: AudioOnset[];
  onsetDensity: number;
  medianPitchConfidence: number;
}

export interface Token {
  // integer semitone delta, 1-semitone resolution, clamp [-12, 12], 25 distinct values
  deltaPitch: number;
  // bucket index from quantizeDeltaRhythmBin(log2(currIOI / prevIOI)) within the same stream
  deltaRhythmBin: number;
  timeSec: number;
}

interface MelodyNoteLike {
  midi: number;
  time: number;
}

interface MidiGroundTruthLike {
  melodyNotes: MelodyNoteLike[];
}

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;
const ADAPTIVE_THRESHOLD_SEC = 0.25;
const MIN_ONSET_SPACING_SEC = 0.05;
const PITCH_WINDOW_SEC = 0.12;
const MIN_PITCH_HZ = 80;
const MAX_PITCH_HZ = 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function frequencyToMidi(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440);
}

function normalizeFrequencyToRange(freqHz: number, minHz: number, maxHz: number): number {
  if (!Number.isFinite(freqHz) || freqHz <= 0) return NaN;
  let f = freqHz;
  while (f < minHz) f *= 2;
  while (f > maxHz) f /= 2;
  return f;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function quantizeDeltaRhythmBin(log2LocalIoiRatio: number): 0 | 1 | 2 | 3 | 4 {
  if (log2LocalIoiRatio < -1.0) return 0;
  if (log2LocalIoiRatio < -0.5) return 1;
  if (log2LocalIoiRatio <= 0.5) return 2;
  if (log2LocalIoiRatio <= 1.0) return 3;
  return 4;
}

/**
 * Build pseudo-spectral flux values using positive frame-wise magnitude deltas.
 * This keeps the intended spectral-flux behavior while remaining lightweight in Node.
 */
function computeFlux(samples: Float32Array): number[] {
  const flux: number[] = [];
  const prevMag = new Float32Array(FRAME_SIZE);
  const currMag = new Float32Array(FRAME_SIZE);

  for (let frameStart = 0; frameStart + FRAME_SIZE <= samples.length; frameStart += HOP_SIZE) {
    let frameFlux = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const v = Math.abs(samples[frameStart + i]);
      currMag[i] = v;
      const diff = v - prevMag[i];
      if (diff > 0) frameFlux += diff;
    }
    flux.push(frameFlux / FRAME_SIZE);
    prevMag.set(currMag);
  }

  return flux;
}

function estimateOnsetPitch(
  samples: Float32Array,
  sampleRate: number,
  onsetSample: number,
  pitchWindowLen: number,
  detector: ReturnType<typeof PitchyDetector.forFloat32Array>,
): { midi: number; confidence: number } {
  const probeOffsetsSec = [0.0, 0.03, 0.06];
  let bestConfidence = 0;
  let bestMidi = 60;

  for (const offsetSec of probeOffsetsSec) {
    const start = onsetSample + Math.round(offsetSec * sampleRate);
    if (start >= samples.length) continue;

    const window = new Float32Array(pitchWindowLen);
    const end = Math.min(samples.length, start + pitchWindowLen);
    window.set(samples.subarray(start, end), 0);

    // Remove DC offset before autocorrelation pitch estimate.
    let mean = 0;
    for (let i = 0; i < window.length; i++) mean += window[i];
    mean /= Math.max(1, window.length);
    for (let i = 0; i < window.length; i++) window[i] -= mean;

    const [freqRaw, clarity] = detector.findPitch(window, sampleRate);
    const confidence = clamp(clarity, 0, 1);
    if (!Number.isFinite(freqRaw) || confidence <= 0) continue;

    const freqHz = normalizeFrequencyToRange(freqRaw, MIN_PITCH_HZ, MAX_PITCH_HZ);
    if (!Number.isFinite(freqHz)) continue;

    const midi = clamp(Math.round(frequencyToMidi(freqHz)), 0, 127);
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMidi = midi;
    }
  }

  return {
    midi: bestMidi,
    confidence: bestConfidence,
  };
}

export function extractAudioFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const durationSec = samples.length / sampleRate;
  const flux = computeFlux(samples);
  if (flux.length < 3) {
    return {
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
      durationSec,
      onsets: [],
      onsetDensity: 0,
      medianPitchConfidence: 0,
    };
  }

  const pitchWindowLen = Math.max(64, Math.round(PITCH_WINDOW_SEC * sampleRate));
  const detector = PitchyDetector.forFloat32Array(pitchWindowLen);
  const onsets: AudioOnset[] = [];
  const maxFlux = Math.max(...flux, 1e-8);
  const localWindowFrames = Math.max(1, Math.round((ADAPTIVE_THRESHOLD_SEC * sampleRate) / HOP_SIZE));
  const minSpacingFrames = Math.max(1, Math.round((MIN_ONSET_SPACING_SEC * sampleRate) / HOP_SIZE));

  let lastPeakIdx = -minSpacingFrames;

  for (let i = 1; i < flux.length - 1; i++) {
    const wStart = Math.max(0, i - localWindowFrames);
    const wEnd = Math.min(flux.length - 1, i + localWindowFrames);
    let sum = 0;
    for (let j = wStart; j <= wEnd; j++) sum += flux[j];
    const localMean = sum / (wEnd - wStart + 1);

    const isPeak = flux[i] > flux[i - 1] && flux[i] >= flux[i + 1];
    const passesThreshold = flux[i] >= localMean * 1.5;
    if (!isPeak || !passesThreshold) continue;
    if (i - lastPeakIdx < minSpacingFrames) continue;
    lastPeakIdx = i;

    const onsetTimeSec = (i * HOP_SIZE) / sampleRate;
    const onsetSample = Math.round(onsetTimeSec * sampleRate);
    const estimated = estimateOnsetPitch(samples, sampleRate, onsetSample, pitchWindowLen, detector);

    onsets.push({
      timeSec: onsetTimeSec,
      dominantMidi: estimated.midi,
      pitchConfidence: estimated.confidence,
      onsetStrength: flux[i] / maxFlux,
    });
  }

  const medianPitchConfidence = median(onsets.map(o => o.pitchConfidence));
  const onsetDensity = durationSec > 0 ? onsets.length / durationSec : 0;

  return {
    sampleRate: 44100,
    bitDepth: 16,
    channels: 1,
    durationSec,
    onsets,
    onsetDensity,
    medianPitchConfidence,
  };
}

function buildTokensFromPitchAndTime(events: Array<{ midi: number; timeSec: number }>): Token[] {
  if (events.length < 3) return [];
  const sorted = [...events].sort((a, b) => a.timeSec - b.timeSec);
  const tokens: Token[] = [];

  for (let i = 2; i < sorted.length; i++) {
    const prevPrev = sorted[i - 2];
    const prev = sorted[i - 1];
    const curr = sorted[i];

    const deltaPitch = clamp(Math.round(curr.midi - prev.midi), -12, 12);

    const prevIoi = Math.max(1e-4, prev.timeSec - prevPrev.timeSec);
    const currIoi = Math.max(1e-4, curr.timeSec - prev.timeSec);
    const log2LocalIoiRatio = Math.log2(currIoi / prevIoi);
    const deltaRhythmBin = quantizeDeltaRhythmBin(log2LocalIoiRatio);

    tokens.push({
      deltaPitch,
      deltaRhythmBin,
      timeSec: curr.timeSec,
    });
  }

  return tokens;
}

export function buildMidiTokens(gt: MidiGroundTruthLike): Token[] {
  const events = gt.melodyNotes.map(n => ({
    midi: n.midi,
    timeSec: n.time,
  }));
  return buildTokensFromPitchAndTime(events);
}

export function buildAudioTokens(audioFeatures: AudioFeatures): Token[] {
  const events = audioFeatures.onsets.map(o => ({
    midi: o.dominantMidi,
    timeSec: o.timeSec,
  }));
  return buildTokensFromPitchAndTime(events);
}
