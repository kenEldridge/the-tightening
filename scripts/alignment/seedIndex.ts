import type { Token } from './logTokens';

export interface SeedPair {
  midiIdx: number;
  audioIdx: number;
}

function encodePitchOnlyWindow(tokens: Token[], start: number, k: number): string {
  const parts: string[] = [];
  for (let i = 0; i < k; i++) {
    parts.push(`${tokens[start + i].deltaPitch}`);
  }
  return parts.join(';');
}

function encodeWindow(tokens: Token[], start: number, k: number): string {
  const parts: string[] = [];
  for (let i = 0; i < k; i++) {
    const t = tokens[start + i];
    parts.push(`${t.deltaPitch}|${t.deltaRhythmBin}`);
  }
  return parts.join(';');
}

export function buildSeedIndex(tokens: Token[], k: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  if (k <= 0 || tokens.length < k) return index;

  for (let i = 0; i <= tokens.length - k; i++) {
    const key = encodeWindow(tokens, i, k);
    const arr = index.get(key);
    if (arr) arr.push(i);
    else index.set(key, [i]);
  }
  return index;
}

export function enumerateSeedPairs(
  midiTokens: Token[],
  audioTokens: Token[],
  k: number,
  maxPairs: number = 5000,
): SeedPair[] {
  const midiIndex = buildSeedIndex(midiTokens, k);
  const audioIndex = buildSeedIndex(audioTokens, k);
  const pairs: SeedPair[] = [];

  for (const [key, midiStarts] of midiIndex.entries()) {
    const audioStarts = audioIndex.get(key);
    if (!audioStarts) continue;
    for (const midiIdx of midiStarts) {
      for (const audioIdx of audioStarts) {
        pairs.push({ midiIdx, audioIdx });
        if (pairs.length >= maxPairs) return pairs;
      }
    }
  }

  return pairs;
}

export function enumerateSeedPairsPitchOnly(
  midiTokens: Token[],
  audioTokens: Token[],
  k: number,
  maxPairs: number = 5000,
): SeedPair[] {
  const midiIndex = new Map<string, number[]>();
  const audioIndex = new Map<string, number[]>();
  const pairs: SeedPair[] = [];
  if (k <= 0 || midiTokens.length < k || audioTokens.length < k) return pairs;

  for (let i = 0; i <= midiTokens.length - k; i++) {
    const key = encodePitchOnlyWindow(midiTokens, i, k);
    const arr = midiIndex.get(key);
    if (arr) arr.push(i);
    else midiIndex.set(key, [i]);
  }
  for (let i = 0; i <= audioTokens.length - k; i++) {
    const key = encodePitchOnlyWindow(audioTokens, i, k);
    const arr = audioIndex.get(key);
    if (arr) arr.push(i);
    else audioIndex.set(key, [i]);
  }

  for (const [key, midiStarts] of midiIndex.entries()) {
    const audioStarts = audioIndex.get(key);
    if (!audioStarts) continue;
    for (const midiIdx of midiStarts) {
      for (const audioIdx of audioStarts) {
        pairs.push({ midiIdx, audioIdx });
        if (pairs.length >= maxPairs) return pairs;
      }
    }
  }

  return pairs;
}
