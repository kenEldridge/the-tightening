import type { Token } from './logTokens';
import type { SeedPair } from './seedIndex';

export interface LocalAlignMatch {
  midiIdx: number;
  audioIdx: number;
  midiTimeSec: number;
  audioTimeSec: number;
}

export interface LocalAlignResult {
  matches: LocalAlignMatch[];
  score: number;
  secondBestScore: number;
  blockCount: number;
  confidence: number;
}

interface OffsetResult {
  offset: number;
  score: number;
  blockCount: number;
  startMidiIdx: number;
  endMidiIdx: number;
  matches: LocalAlignMatch[];
}

function tokenSimilarity(a: Token, b: Token): number {
  const pitchDiff = Math.abs(a.deltaPitch - b.deltaPitch);
  const rhythmEqual = a.deltaRhythmBin === b.deltaRhythmBin;

  if (pitchDiff === 0 && rhythmEqual) return 3;
  if (pitchDiff === 0) return 1;
  if (pitchDiff === 1 && rhythmEqual) return 0;
  if (pitchDiff === 1) return -1;
  return -2;
}

function scoreOffset(midiTokens: Token[], audioTokens: Token[], offset: number): OffsetResult {
  let runScore = 0;
  let bestScore = 0;
  let bestStart = 0;
  let bestEnd = -1;
  let runStart = 0;
  let blockCount = 0;
  let inRun = false;

  const startI = Math.max(0, -offset);
  const endI = Math.min(midiTokens.length - 1, audioTokens.length - 1 - offset);

  for (let i = startI; i <= endI; i++) {
    const j = i + offset;
    const sim = tokenSimilarity(midiTokens[i], audioTokens[j]);
    const candidate = runScore + sim;
    if (candidate > 0) {
      if (!inRun) {
        inRun = true;
        blockCount++;
        runStart = i;
      }
      runScore = candidate;
      if (runScore > bestScore) {
        bestScore = runScore;
        bestStart = runStart;
        bestEnd = i;
      }
    } else {
      runScore = 0;
      inRun = false;
    }
  }

  const matches: LocalAlignMatch[] = [];
  if (bestEnd >= bestStart) {
    for (let i = bestStart; i <= bestEnd; i++) {
      const j = i + offset;
      if (j < 0 || j >= audioTokens.length) continue;
      if (tokenSimilarity(midiTokens[i], audioTokens[j]) >= 1) {
        matches.push({
          midiIdx: i,
          audioIdx: j,
          midiTimeSec: midiTokens[i].timeSec,
          audioTimeSec: audioTokens[j].timeSec,
        });
      }
    }
  }

  return {
    offset,
    score: bestScore,
    blockCount,
    startMidiIdx: bestStart,
    endMidiIdx: bestEnd,
    matches,
  };
}

function overlapRatio(a: OffsetResult, b: OffsetResult): number {
  if (a.endMidiIdx < a.startMidiIdx || b.endMidiIdx < b.startMidiIdx) return 0;
  const lo = Math.max(a.startMidiIdx, b.startMidiIdx);
  const hi = Math.min(a.endMidiIdx, b.endMidiIdx);
  if (hi < lo) return 0;
  const overlap = hi - lo + 1;
  const lenA = a.endMidiIdx - a.startMidiIdx + 1;
  const lenB = b.endMidiIdx - b.startMidiIdx + 1;
  return overlap / Math.max(1, Math.min(lenA, lenB));
}

export function localAlign(
  midiTokens: Token[],
  audioTokens: Token[],
  seedPairs: SeedPair[],
): LocalAlignResult {
  if (midiTokens.length === 0 || audioTokens.length === 0 || seedPairs.length === 0) {
    return {
      matches: [],
      score: 0,
      secondBestScore: 0,
      blockCount: 0,
      confidence: 0,
    };
  }

  const offsets = new Set<number>();
  for (const p of seedPairs) {
    offsets.add(p.audioIdx - p.midiIdx);
  }

  const results: OffsetResult[] = [];
  for (const offset of offsets) {
    const scored = scoreOffset(midiTokens, audioTokens, offset);
    if (scored.score > 0) results.push(scored);
  }

  if (results.length === 0) {
    return {
      matches: [],
      score: 0,
      secondBestScore: 0,
      blockCount: 0,
      confidence: 0,
    };
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  let secondBestScore = 0;
  for (let i = 1; i < results.length; i++) {
    if (overlapRatio(best, results[i]) < 0.5) {
      secondBestScore = results[i].score;
      break;
    }
  }

  const margin = best.score > 0 ? Math.max(0, best.score - secondBestScore) / best.score : 0;
  const lengthFactor = Math.min(1, best.matches.length / 24);
  const confidence = Math.max(0, Math.min(1, 0.6 * margin + 0.4 * lengthFactor));

  return {
    matches: best.matches,
    score: best.score,
    secondBestScore,
    blockCount: best.blockCount,
    confidence,
  };
}
