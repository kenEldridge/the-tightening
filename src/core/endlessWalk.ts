import { getChordDefinition } from './chordDefinitions';
import { intervalCycleDestination } from './chordPathfinder';
import type { EdgeType, IntervalStep } from './chordPathfinder';
import { CYCLE_PRESETS } from './cyclePresets';
import type { CyclePreset } from './cyclePresets';

export interface EndlessAdvanceParams {
  fromChord: string;
  toChord: string;
  lastChord: string;
  cycleEdgeTypes: EdgeType[];
  cycleSteps: IntervalStep[];
  returnTrip: boolean;
  randomPattern: boolean;
  recentTonics: string[];
  presets?: CyclePreset[];
  rng?: () => number;
  recenterProb?: number;
}

export interface EndlessAdvanceResult {
  from: string;
  edges: EdgeType[];
  steps: IntervalStep[];
  dest: string;
  recentTonics: string[];
}

/**
 * Decide the next home base and cycle preset for endless-mode auto-advance.
 *
 * With return trip on, every leg departs from and returns to the same home,
 * so the home base would otherwise never move — endless mode just orbits the
 * same handful of nearby chords forever (confirmed against recorded walks).
 * `recenterProb` of the time we instead recenter onto the peak of the leg
 * just played (`toChord`), which is already harmonically connected to the old
 * home via the path just heard, preserving continuity while still drifting.
 *
 * Independently, the random preset draw is biased away from tonic roots
 * visited in the last few legs (`recentTonics`) so a small neighborhood can't
 * keep winning the draw — but falls back to a repeat if nothing fresh turns
 * up within a bounded number of tries, so it never stalls.
 */
export function pickNextCycleAdvance(params: EndlessAdvanceParams): EndlessAdvanceResult {
  const {
    fromChord, toChord, lastChord, cycleEdgeTypes, cycleSteps,
    returnTrip, randomPattern, recentTonics,
    presets = CYCLE_PRESETS, rng = Math.random, recenterProb = 0.35,
  } = params;

  const canRecenter = returnTrip && !!toChord && toChord !== fromChord;
  const from = returnTrip
    ? (canRecenter && rng() < recenterProb ? toChord : fromChord)
    : lastChord;

  const recentRoots = new Set(recentTonics.slice(-6));
  let edges = cycleEdgeTypes;
  let steps = cycleSteps;

  if (randomPattern && presets.length > 0) {
    let fallback: { edges: EdgeType[]; steps: IntervalStep[] } | null = null;
    for (let tries = 0; tries < 20; tries++) {
      const preset = presets[Math.floor(rng() * presets.length)];
      const dest = intervalCycleDestination(from, preset.steps);
      if (dest === from) continue; // degenerates to "home ... home ... home"
      const candidate = { edges: preset.loop.split(' ') as EdgeType[], steps: preset.steps };
      if (!fallback) fallback = candidate;
      const destRoot = getChordDefinition(dest).root;
      if (!recentRoots.has(destRoot)) {
        edges = candidate.edges;
        steps = candidate.steps;
        fallback = null;
        break;
      }
    }
    if (fallback) { edges = fallback.edges; steps = fallback.steps; }
  }

  const dest = intervalCycleDestination(from, steps);
  const destRoot = getChordDefinition(dest).root;
  const nextRecentTonics = [...recentTonics, destRoot].slice(-8);

  return { from, edges, steps, dest, recentTonics: nextRecentTonics };
}
