/**
 * Synthesized drum voices — kick, snare, closed/open hihat — from plain
 * WebAudio nodes on a caller-owned AudioContext. No samples, no dependencies
 * (same AudioContext usage as AudioRecorder's capture pipeline).
 */

// Accompaniment level: the drummer sits under the player, not beside them.
export const MASTER_LEVEL = 0.5;

export interface DrumVoices {
  playKick(when: number, velocity: number): void;
  playSnare(when: number, velocity: number): void;
  playHat(when: number, velocity: number, open: boolean): void;
  /** Ramp the master bus to an absolute level (0 mutes, MASTER_LEVEL restores). */
  setMasterGain(level: number, rampSec?: number): void;
}

export function createDrumVoices(ctx: AudioContext): DrumVoices {
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  master.connect(ctx.destination);

  // One shared noise buffer for snare/hat bursts.
  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noiseSource = (when: number, stopAt: number): AudioBufferSourceNode => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.start(when);
    src.stop(stopAt);
    return src;
  };

  const envelope = (when: number, peak: number, decaySec: number): GainNode => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(peak, 0.001), when);
    g.gain.exponentialRampToValueAtTime(0.001, when + decaySec);
    return g;
  };

  return {
    playKick(when, velocity) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, when);
      osc.frequency.exponentialRampToValueAtTime(40, when + 0.12);
      const g = envelope(when, velocity, 0.4);
      osc.connect(g);
      g.connect(master);
      osc.start(when);
      osc.stop(when + 0.45);
    },

    playSnare(when, velocity) {
      const noise = noiseSource(when, when + 0.25);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const ng = envelope(when, velocity * 0.8, 0.18);
      noise.connect(hp);
      hp.connect(ng);
      ng.connect(master);

      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(185, when);
      const bg = envelope(when, velocity * 0.5, 0.1);
      body.connect(bg);
      bg.connect(master);
      body.start(when);
      body.stop(when + 0.15);
    },

    playHat(when, velocity, open) {
      const decay = open ? 0.35 : 0.06;
      const noise = noiseSource(when, when + decay + 0.05);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = envelope(when, velocity * 0.5, decay);
      noise.connect(hp);
      hp.connect(g);
      g.connect(master);
    },

    setMasterGain(level, rampSec = 0.03) {
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(level, t + rampSec);
    },
  };
}
