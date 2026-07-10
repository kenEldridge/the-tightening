export interface ProcessingConfig {
  enabled: boolean;
  targetPeakDb: number;
  targetRmsDb: number;
  limiterEnabled: boolean;
  limiterThresholdDb: number;
  maxGainDb: number;
  highpassHz: number;
  fadeMs: number;
}

export interface AudioMetrics {
  durationSec: number;
  sampleRate: number;
  channels: number;
  rawPeakDb: number;
  rawRmsDb: number;
  inputClipped: boolean;
  polishedPeakDb: number;
  polishedRmsDb: number;
  appliedGainDb: number;
  limiterClampedSamples: number;
}

export interface ProcessedAudio {
  polished: Float32Array[];
  metrics: AudioMetrics;
}

export const DEFAULT_CONFIG: ProcessingConfig = {
  enabled: true,
  targetPeakDb: -3.0,
  targetRmsDb: -27.0,
  limiterEnabled: true,
  limiterThresholdDb: -1.0,
  maxGainDb: 14,
  highpassHz: 25,
  fadeMs: 5,
};

function toDb(x: number): number {
  return 20 * Math.log10(Math.max(x, 1e-10));
}

function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

function channelPeak(channels: Float32Array[]): number {
  let max = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const abs = Math.abs(ch[i]);
      if (abs > max) max = abs;
    }
  }
  return max;
}

function rms(channels: Float32Array[]): number {
  let sum = 0;
  let count = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      sum += ch[i] * ch[i];
      count++;
    }
  }
  return Math.sqrt(sum / Math.max(count, 1));
}

function validateChannels(channels: Float32Array[]): number {
  const numFrames = channels.length > 0 ? channels[0].length : 0;
  for (const ch of channels) {
    if (ch.length !== numFrames) {
      throw new Error('All audio channels must have the same frame count.');
    }
  }
  return numFrames;
}

function removeDcOffset(channels: Float32Array[]): Float32Array[] {
  return channels.map(ch => {
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i];
    const mean = sum / ch.length;
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i] - mean;
    return out;
  });
}

function highpass(channels: Float32Array[], sampleRate: number, hz: number): Float32Array[] {
  if (hz <= 0 || sampleRate <= 0) {
    return channels.map(ch => new Float32Array(ch));
  }

  const rc = 1 / (2 * Math.PI * hz);
  const dt = 1 / sampleRate;
  const alpha = rc / (rc + dt);

  return channels.map(ch => {
    const out = new Float32Array(ch.length);
    if (ch.length === 0) return out;

    let previousInput = ch[0];
    let previousOutput = 0;
    out[0] = 0;

    for (let i = 1; i < ch.length; i++) {
      const current = ch[i];
      const filtered = alpha * (previousOutput + current - previousInput);
      out[i] = filtered;
      previousInput = current;
      previousOutput = filtered;
    }

    return out;
  });
}

function applyEdgeFade(channels: Float32Array[], sampleRate: number, fadeMs: number): Float32Array[] {
  const fadeFrames = Math.min(
    channels[0]?.length ?? 0,
    Math.max(0, Math.round(sampleRate * fadeMs / 1000)),
  );
  if (fadeFrames <= 1) {
    return channels.map(ch => new Float32Array(ch));
  }

  return channels.map(ch => {
    const out = new Float32Array(ch);
    const last = ch.length - 1;
    for (let i = 0; i < fadeFrames; i++) {
      const gain = i / fadeFrames;
      out[i] *= gain;
      out[last - i] *= gain;
    }
    return out;
  });
}

export function processAudio(
  channels: Float32Array[],
  sampleRate: number,
  config: ProcessingConfig = DEFAULT_CONFIG,
): ProcessedAudio {
  const numFrames = validateChannels(channels);

  const empty: AudioMetrics = {
    durationSec: 0,
    sampleRate,
    channels: channels.length,
    rawPeakDb: -Infinity,
    rawRmsDb: -Infinity,
    inputClipped: false,
    polishedPeakDb: -Infinity,
    polishedRmsDb: -Infinity,
    appliedGainDb: 0,
    limiterClampedSamples: 0,
  };

  if (channels.length === 0 || numFrames === 0) {
    return { polished: channels, metrics: empty };
  }

  const rawPk = channelPeak(channels);
  const rawPeakDb = toDb(rawPk);
  const rawRmsDb = toDb(rms(channels));
  const inputClipped = rawPk >= 0.999;

  const cleaned = applyEdgeFade(
    highpass(removeDcOffset(channels), sampleRate, config.highpassHz),
    sampleRate,
    config.fadeMs,
  );
  const cleanedPk = channelPeak(cleaned);
  const cleanedRms = rms(cleaned);

  if (!config.enabled || cleanedPk < 1e-6) {
    return {
      polished: cleaned,
      metrics: {
        durationSec: numFrames / sampleRate,
        sampleRate,
        channels: channels.length,
        rawPeakDb,
        rawRmsDb,
        inputClipped,
        polishedPeakDb: toDb(cleanedPk),
        polishedRmsDb: toDb(cleanedRms),
        appliedGainDb: 0,
        limiterClampedSamples: 0,
      },
    };
  }

  const targetPeakLinear = fromDb(config.targetPeakDb);
  const targetRmsLinear = fromDb(config.targetRmsDb);
  const maxGainLinear = fromDb(config.maxGainDb);
  const peakGain = targetPeakLinear / cleanedPk;
  const rmsGain = targetRmsLinear / Math.max(cleanedRms, 1e-10);
  const gain = Math.min(peakGain, rmsGain, maxGainLinear);
  const limThreshold = fromDb(config.limiterThresholdDb);

  let limiterClampedSamples = 0;
  const polished: Float32Array[] = cleaned.map(ch => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let sample = ch[i] * gain;
      if (config.limiterEnabled && Math.abs(sample) > limThreshold) {
        sample = sample > 0 ? limThreshold : -limThreshold;
        limiterClampedSamples++;
      }
      out[i] = sample;
    }
    return out;
  });

  return {
    polished,
    metrics: {
      durationSec: numFrames / sampleRate,
      sampleRate,
      channels: channels.length,
      rawPeakDb,
      rawRmsDb,
      inputClipped,
      polishedPeakDb: toDb(channelPeak(polished)),
      polishedRmsDb: toDb(rms(polished)),
      appliedGainDb: toDb(gain),
      limiterClampedSamples,
    },
  };
}
