/**
 * Autonomous drummer engine — mode 1 ("user leads, drummer follows").
 *
 * Stateful factory-closure owning the AudioContext, a lookahead scheduler
 * (TICK_MS JS timer + SCHEDULE_AHEAD_SEC audio-clock window — the standard
 * "Tale of Two Clocks" pattern, so hit timing comes from WebAudio rather
 * than setInterval), the idle→learning→following→leading state machine,
 * keyboard-range tracking, and the long-press reset gesture.
 *
 * Clock reconciliation: MIDI onsets arrive stamped on the performance clock
 * (e.timeStamp, ms); scheduling happens on AudioContext.currentTime, a
 * separate clock with its own epoch. start() captures
 *   clockOffset = ctx.currentTime - performance.now() / 1000
 * and every onset is converted to audio-time BEFORE it reaches the pulse
 * detector, so phase math and scheduling share one clock domain.
 */

import {
  createPulseDetector,
  perfMsToAudioTime,
  nextBeatTime,
  phaseErrorSec,
} from './pulseDetector';
import type { PulseEstimate } from './pulseDetector';
import { patternForIntensity, STEPS_PER_BAR, STEPS_PER_BEAT } from './drummerPatterns';
import { createDrumVoices, MASTER_LEVEL } from './drummerVoices';
import type { DrumVoices } from './drummerVoices';
import type { DrummerPhase, DrummerState } from './types';

// Scheduler
export const TICK_MS = 25;
export const SCHEDULE_AHEAD_SEC = 0.1;

// learning → following gate
export const FOLLOW_CONFIDENCE = 0.6;

// following → leading gate. The drummer should feel the player out for a
// bar or two and then COMMIT — following is an on-ramp, never a permanent
// state. Phase-lock R collapses under real playing (eighth-note/offbeat
// onsets land on the opposite beat phase and cancel the circular mean), so
// the confidence bar is low, BPM is compared against the drummer's own
// smoothed grid (not a separate resettable anchor), an unstable bar decays
// the streak instead of zeroing it, and MAX_FOLLOW_BARS hard-caps the
// follow phase: after that many bars it locks unconditionally. If it locks
// onto the wrong groove, the reset gesture starts over.
export const LOCK_IN_BARS = 2;
export const MAX_FOLLOW_BARS = 4;
export const LOCK_CONFIDENCE = 0.45;
export const LOCK_BPM_TOLERANCE = 8;

/**
 * Per-bar lock-in evaluation (pure, exported for tests). Returns the updated
 * stable-bar streak and whether the drummer should freeze the grid now.
 */
export function evaluateLockIn(
  est: { bpm: number; confidence: number } | null,
  gridBpm: number,
  stableBars: number,
  barsFollowed: number,
): { stableBars: number; lock: boolean } {
  const stable =
    est !== null && est.confidence >= LOCK_CONFIDENCE && Math.abs(est.bpm - gridBpm) <= LOCK_BPM_TOLERANCE;
  const nextStable = stable ? stableBars + 1 : Math.max(0, stableBars - 1);
  return { stableBars: nextStable, lock: nextStable >= LOCK_IN_BARS || barsFollowed >= MAX_FOLLOW_BARS };
}

// Reset gesture: hold the lowest AND highest observed keys this long.
export const RESET_HOLD_MS = 900;

// following-mode nudging (gentle: following is a short on-ramp to leading,
// not a long-term tempo chase)
const PERIOD_LERP = 0.05;         // per-tick tempo correction factor
const PHASE_CORRECTION = 0.25;    // fraction of phase error corrected per tick
const MAX_PHASE_STEP_SEC = 0.015; // cap on per-tick phase correction

// How hard intensity drives hit velocity: the floor keeps quiet playing
// audible, the ceiling keeps the drummer an accompanist rather than a lead.
const VELOCITY_FLOOR = 0.3;
const VELOCITY_CEIL = 0.75;

const EMIT_MIN_MS = 150;

export const INITIAL_DRUMMER_STATE: DrummerState = {
  enabled: false,
  phase: 'idle',
  bpm: null,
  confidence: 0,
  intensity: 0,
};

export interface DrummerEngine {
  start(): void;
  stop(): void;
  noteOn(note: number, velocity: number, timeStampMs: number): void;
  noteOff(note: number): void;
  isEnabled(): boolean;
  getState(): DrummerState;
  dispose(): void;
}

export function createDrummerEngine(onState?: (s: DrummerState) => void): DrummerEngine {
  const detector = createPulseDetector();

  let ctx: AudioContext | null = null;
  let voices: DrumVoices | null = null;
  let clockOffset = 0;

  let enabled = false;
  let phase: DrummerPhase = 'idle';
  let timer: ReturnType<typeof setInterval> | null = null;

  // Beat grid while following/leading
  let periodSec = 0.5;
  let nextStepTime = 0;
  let stepIndex = 0;
  let stepsScheduled = 0;
  let lastBarChecked = 0;

  // follow → lead stability tracking
  let stableBars = 0;

  // Keyboard range (session-wide, survives reset) + reset gesture state
  let lowNote = Infinity;
  let highNote = -Infinity;
  const held = new Map<number, number>(); // note → perf-clock ms when pressed
  let resetLatched = false;

  let lastEst: PulseEstimate | null = null;
  let intensity = 0;

  let lastEmitMs = 0;
  let lastSnapshotKey = '';

  function snapshot(): DrummerState {
    const playing = phase === 'following' || phase === 'leading';
    return {
      enabled,
      phase,
      bpm: playing ? 60 / periodSec : lastEst?.bpm ?? null,
      confidence: lastEst?.confidence ?? 0,
      intensity,
    };
  }

  function emit(force: boolean): void {
    if (!onState) return;
    const s = snapshot();
    const key = `${s.enabled}|${s.phase}|${s.bpm === null ? '-' : Math.round(s.bpm)}|${s.intensity.toFixed(2)}|${s.confidence.toFixed(2)}`;
    const nowMs = performance.now();
    if (!force && (key === lastSnapshotKey || nowMs - lastEmitMs < EMIT_MIN_MS)) return;
    lastSnapshotKey = key;
    lastEmitMs = nowMs;
    onState(s);
  }

  function enterFollowing(est: PulseEstimate, nowAudio: number): void {
    phase = 'following';
    periodSec = est.periodSec;
    stepIndex = 0;
    stepsScheduled = 0;
    lastBarChecked = 0;
    // First hit lands on the next detected beat, treated as a bar start.
    nextStepTime = nextBeatTime(nowAudio + 0.05, est.phaseSec, periodSec);
    stableBars = 0;
    voices?.setMasterGain(MASTER_LEVEL);
  }

  function resetToIdle(): void {
    detector.reset();
    phase = 'idle';
    stableBars = 0;
    lastEst = null;
    intensity = 0;
    voices?.setMasterGain(0); // swallow anything already scheduled in the lookahead
  }

  function checkResetGesture(nowPerfMs: number): void {
    if (!Number.isFinite(lowNote) || lowNote >= highNote) return; // no distinct range yet
    const lowSince = held.get(lowNote);
    const highSince = held.get(highNote);
    const bothHeld =
      lowSince !== undefined &&
      highSince !== undefined &&
      nowPerfMs - lowSince >= RESET_HOLD_MS &&
      nowPerfMs - highSince >= RESET_HOLD_MS;
    if (bothHeld && !resetLatched) {
      resetLatched = true; // one reset per gesture; re-arms when a key lifts
      resetToIdle();
      emit(true);
    } else if (!bothHeld && (lowSince === undefined || highSince === undefined)) {
      resetLatched = false;
    }
  }

  function scheduleWindow(nowAudio: number): void {
    if (!ctx || !voices) return;
    const pattern = patternForIntensity(intensity);
    const stepDur = periodSec / STEPS_PER_BEAT;
    const scale = VELOCITY_FLOOR + (VELOCITY_CEIL - VELOCITY_FLOOR) * intensity;
    while (nextStepTime < nowAudio + SCHEDULE_AHEAD_SEC) {
      const step = pattern[stepIndex];
      if (step.kick) voices.playKick(nextStepTime, step.kick * scale);
      if (step.snare) voices.playSnare(nextStepTime, step.snare * scale);
      if (step.openHat) voices.playHat(nextStepTime, step.openHat * scale, true);
      else if (step.hat) voices.playHat(nextStepTime, step.hat * scale, false);
      stepIndex = (stepIndex + 1) % STEPS_PER_BAR;
      stepsScheduled += 1;
      nextStepTime += stepDur;
    }
  }

  function tick(): void {
    if (!ctx) return;
    const nowAudio = ctx.currentTime;
    checkResetGesture(performance.now());

    const est = detector.estimate(nowAudio);
    lastEst = est;
    intensity = detector.getIntensity(nowAudio);

    if (phase === 'learning') {
      if (est && est.confidence >= FOLLOW_CONFIDENCE) enterFollowing(est, nowAudio);
    } else if (phase === 'following') {
      if (est) {
        // Nudge tempo and phase toward the freshest estimate.
        periodSec += PERIOD_LERP * (est.periodSec - periodSec);
        const stepDur = periodSec / STEPS_PER_BEAT;
        const stepsToBeat = (STEPS_PER_BEAT - (stepIndex % STEPS_PER_BEAT)) % STEPS_PER_BEAT;
        const ourNextBeat = nextStepTime + stepsToBeat * stepDur;
        const err = phaseErrorSec(ourNextBeat, est.phaseSec, periodSec);
        const correction = Math.max(-MAX_PHASE_STEP_SEC, Math.min(MAX_PHASE_STEP_SEC, PHASE_CORRECTION * err));
        nextStepTime -= correction;
      }
      // Evaluate lock-in once per completed bar; MAX_FOLLOW_BARS guarantees
      // following always terminates.
      const barsCompleted = Math.floor(stepsScheduled / STEPS_PER_BAR);
      if (barsCompleted > lastBarChecked) {
        lastBarChecked = barsCompleted;
        const result = evaluateLockIn(est, 60 / periodSec, stableBars, barsCompleted);
        stableBars = result.stableBars;
        if (result.lock) phase = 'leading'; // freeze the grid
      }
    }
    // leading: grid frozen; intensity (already updated above) keeps tracking.

    if (phase === 'following' || phase === 'leading') scheduleWindow(nowAudio);
    emit(false);
  }

  return {
    start() {
      // Must be called synchronously from a user gesture: constructs/resumes
      // the AudioContext and captures the perf→audio clock mapping.
      if (!ctx) {
        ctx = new AudioContext();
        voices = createDrumVoices(ctx);
      }
      void ctx.resume();
      clockOffset = ctx.currentTime - performance.now() / 1000;
      enabled = true;
      resetToIdle();
      if (!timer) timer = setInterval(tick, TICK_MS);
      emit(true);
    },

    stop() {
      enabled = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      resetToIdle();
      void ctx?.suspend();
      emit(true);
    },

    noteOn(note, velocity, timeStampMs) {
      // Range + gesture tracking runs even when disabled (session-wide range).
      if (note < lowNote) lowNote = note;
      if (note > highNote) highNote = note;
      held.set(note, timeStampMs);
      if (!enabled || !ctx) return;
      detector.recordNoteOn(velocity, perfMsToAudioTime(timeStampMs, clockOffset));
      if (phase === 'idle') {
        phase = 'learning';
        emit(true);
      }
    },

    noteOff(note) {
      held.delete(note);
      if (note === lowNote || note === highNote) resetLatched = false;
    },

    isEnabled() {
      return enabled;
    },

    getState() {
      return snapshot();
    },

    dispose() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      void ctx?.close().catch(() => {});
      ctx = null;
      voices = null;
    },
  };
}
