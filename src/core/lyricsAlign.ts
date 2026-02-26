/**
 * Lyrics Alignment
 *
 * Two strategies:
 * A. Timed lyrics (LRC format from LRCLIB syncedLyrics) — maps lines directly
 *    to bars by matching timestamps to bar start times.
 * B. Structural fallback (plain lyrics) — parses sections, estimates intro,
 *    distributes lines proportionally across bars.
 */

import type { ChordTimelineArtifact, TimelineEdit, LyricCorrectionScope } from './rhythmTypes';

// ============================================
// LRC Timed Lyrics
// ============================================

interface TimedLyricLine {
  time: number; // seconds
  text: string;
}

/**
 * Parse LRC-format synced lyrics into timed lines.
 * LRC format: [mm:ss.xx] lyrics text
 */
function parseLrc(lrc: string): TimedLyricLine[] {
  const lines: TimedLyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const match = raw.match(/^\[(\d+):(\d+)\.(\d+)\]\s*(.*)$/);
    if (!match) continue;
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const centis = parseInt(match[3], 10);
    const text = match[4].trim();
    if (!text) continue; // skip empty/instrumental lines
    const time = mins * 60 + secs + centis / 100;
    lines.push({ time, text });
  }
  return lines;
}

/**
 * Apply timed lyrics to timeline by matching each lyric timestamp
 * to the nearest bar.
 */
function applyTimedLyrics(
  timeline: ChordTimelineArtifact,
  timedLines: TimedLyricLine[],
): ChordTimelineArtifact {
  const updatedChords = timeline.chords.map(c => ({ ...c }));

  for (const line of timedLines) {
    // Find the bar whose start time is closest to (but not after) the lyric timestamp
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < updatedChords.length; i++) {
      const dist = Math.abs(updatedChords[i].startTime - line.time);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    // Append to existing lyrics on the same bar (multiple lines can land on one bar)
    if (updatedChords[bestIdx].lyrics) {
      updatedChords[bestIdx].lyrics += ' / ' + line.text;
    } else {
      updatedChords[bestIdx].lyrics = line.text;
    }
  }

  const lyricsCount = updatedChords.filter(c => c.lyrics).length;
  console.log('[LyricsAlign] Timed lyrics applied', {
    inputLines: timedLines.length,
    barsWithLyrics: lyricsCount,
  });

  return { ...timeline, chords: updatedChords };
}

/**
 * Shift all lyric (and section) placements by a fixed number of bars.
 * Positive offset moves text later in the song; negative moves earlier.
 */
export function shiftLyricsByBars(
  timeline: ChordTimelineArtifact,
  rawBarOffset: number,
): ChordTimelineArtifact {
  const barOffset = Number.isFinite(rawBarOffset) ? Math.trunc(rawBarOffset) : 0;
  if (barOffset === 0) return timeline;

  const sourceChords = timeline.chords;
  const updatedChords: ChordTimelineArtifact['chords'] = sourceChords.map(c => ({
    ...c,
    lyrics: undefined,
    section: undefined,
  }));
  let movedBars = 0;
  let droppedBars = 0;

  for (let i = 0; i < sourceChords.length; i++) {
    const source = sourceChords[i];
    if (!source.lyrics && !source.section) continue;

    const targetIdx = i + barOffset;
    if (targetIdx < 0 || targetIdx >= updatedChords.length) {
      droppedBars++;
      continue;
    }

    movedBars++;

    if (source.lyrics) {
      if (updatedChords[targetIdx].lyrics) {
        updatedChords[targetIdx].lyrics += ' / ' + source.lyrics;
      } else {
        updatedChords[targetIdx].lyrics = source.lyrics;
      }
    }

    if (source.section && !updatedChords[targetIdx].section) {
      updatedChords[targetIdx].section = source.section;
    }
  }

  console.log('[LyricsAlign] Shifted lyrics by bars', {
    barOffset,
    movedBars,
    droppedBars,
  });

  return {
    ...timeline,
    chords: updatedChords,
  };
}

// ============================================
// Lyrics Parsing
// ============================================

interface LyricsSection {
  label: string;
  lines: string[];
  type: 'chorus' | 'verse' | 'other';
}

/**
 * Parse raw lyrics into sections. Detect chorus by finding repeated sections.
 */
function parseLyrics(raw: string): LyricsSection[] {
  // Split on double newlines to get raw sections
  const rawSections = raw.split(/\n\n+/).map(s => s.trim()).filter(s => s.length > 0);
  if (rawSections.length === 0) return [];

  // Parse each raw section into lines, check for headers
  const parsed: Array<{ label: string; lines: string[] }> = [];

  for (const section of rawSections) {
    const lines = section.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    // Check if first line is a section header
    const headerMatch = lines[0].match(/^\[(.+?)\]$/) ||
                        lines[0].match(/^\((.+?)\)$/) ||
                        lines[0].match(/^(Verse\s*\d*|Chorus|Bridge|Outro|Intro|Pre-Chorus|Refrain|Interlude)\s*:?\s*$/i);

    if (headerMatch) {
      parsed.push({ label: headerMatch[1].trim(), lines: lines.slice(1) });
    } else {
      parsed.push({ label: '', lines });
    }
  }

  // Detect chorus by finding repeated first lines
  // (chorus sections have the same opening line)
  const firstLineCount = new Map<string, number>();
  for (const s of parsed) {
    if (s.lines.length > 0) {
      const key = s.lines[0].toLowerCase().trim();
      firstLineCount.set(key, (firstLineCount.get(key) || 0) + 1);
    }
  }

  // The most repeated first line is likely the chorus
  let chorusFirstLine = '';
  let maxRepeats = 0;
  for (const [line, count] of firstLineCount) {
    if (count > maxRepeats) {
      maxRepeats = count;
      chorusFirstLine = line;
    }
  }

  // Label sections
  let verseNum = 0;
  let chorusNum = 0;
  const sections: LyricsSection[] = [];

  for (const s of parsed) {
    if (s.lines.length === 0) continue;

    const isChorus = maxRepeats > 1 &&
      s.lines[0].toLowerCase().trim() === chorusFirstLine;

    let type: 'chorus' | 'verse' | 'other';
    let label: string;

    if (s.label) {
      // Use explicit label
      label = s.label;
      type = /chorus|refrain/i.test(label) ? 'chorus' :
             /verse/i.test(label) ? 'verse' : 'other';
    } else if (isChorus) {
      chorusNum++;
      label = chorusNum === 1 ? 'Chorus' : `Chorus ${chorusNum}`;
      type = 'chorus';
    } else {
      verseNum++;
      label = `Verse ${verseNum}`;
      type = 'verse';
    }

    sections.push({ label, lines: s.lines, type });
  }

  return sections;
}

// ============================================
// Structure-based Alignment
// ============================================

/**
 * Estimate how many bars of intro before singing starts.
 *
 * Uses vocalEnergy data when available: smooths by 3-bar median, finds the
 * first run of 3 consecutive bars above a dynamic threshold.
 * Falls back to song-length heuristic when vocal energy is missing or unusable.
 */
function estimateIntroBars(chords: ChordTimelineArtifact['chords']): number {
  const totalBars = chords.length;
  if (totalBars < 3) return 0;

  // Check if vocalEnergy data is usable (present on >50% of bars)
  const barsWithEnergy = chords.filter(c => c.vocalEnergy !== undefined && c.vocalEnergy > 0).length;
  const hasUsableEnergy = barsWithEnergy > totalBars * 0.5;

  if (hasUsableEnergy) {
    // Extract raw vocal energy values
    const rawEnergy = chords.map(c => c.vocalEnergy ?? 0);

    // 3-bar median smoothing
    const smoothed: number[] = [];
    for (let i = 0; i < rawEnergy.length; i++) {
      const window: number[] = [];
      for (let j = Math.max(0, i - 1); j <= Math.min(rawEnergy.length - 1, i + 1); j++) {
        window.push(rawEnergy[j]);
      }
      window.sort((a, b) => a - b);
      smoothed.push(window[Math.floor(window.length / 2)]);
    }

    // Dynamic threshold: T = max(0.55, medianEnergy + 0.1)
    const sortedEnergy = [...smoothed].sort((a, b) => a - b);
    const medianEnergy = sortedEnergy[Math.floor(sortedEnergy.length / 2)];
    const threshold = Math.max(0.55, medianEnergy + 0.1);

    // Find first run of 3 consecutive bars above threshold
    for (let i = 0; i <= smoothed.length - 3; i++) {
      if (smoothed[i] >= threshold &&
          smoothed[i + 1] >= threshold &&
          smoothed[i + 2] >= threshold) {
        // Intro ends at bar i (0-indexed), clamp to [0, 12]
        const introBars = Math.min(12, Math.max(0, i));
        console.log('[LyricsAlign] Vocal-energy intro detection', {
          introBars,
          threshold: threshold.toFixed(3),
          medianEnergy: medianEnergy.toFixed(3),
          firstVocalBar: i,
        });
        return introBars;
      }
    }

    // No clear vocal onset found — all bars are below threshold or instrumental
    // Fall back to length heuristic
    console.log('[LyricsAlign] No vocal onset found via energy, falling back to heuristic');
  }

  // Fallback: song-length heuristic
  if (totalBars > 80) return 8;
  if (totalBars > 40) return 4;
  return 2;
}

/**
 * Score bars by vocal energy for lyric placement priority.
 * Returns an array of weights (0-1) where higher = better for lyrics.
 * Bars with low vocal energy are de-prioritized.
 */
function computeBarLyricWeights(chords: ChordTimelineArtifact['chords']): number[] {
  const hasEnergy = chords.some(c => c.vocalEnergy !== undefined && c.vocalEnergy > 0);
  if (!hasEnergy) {
    // No energy data — all bars equally weighted
    return chords.map(() => 1);
  }

  const energies = chords.map(c => c.vocalEnergy ?? 0);
  const maxEnergy = Math.max(...energies, 0.01);

  // Normalize to 0-1, then apply a floor so even low-energy bars
  // can receive lyrics if needed (just lower priority)
  return energies.map(e => Math.max(0.2, e / maxEnergy));
}

/**
 * Apply lyrics to timeline.
 *
 * If syncedLyrics (LRC format) is provided, uses timed alignment (accurate).
 * Otherwise falls back to structural alignment from plain lyrics (heuristic).
 */
export function applyLyricsToTimeline(
  timeline: ChordTimelineArtifact,
  rawLyrics: string,
  syncedLyrics?: string,
): ChordTimelineArtifact {
  // Prefer timed lyrics when available
  if (syncedLyrics) {
    const timedLines = parseLrc(syncedLyrics);
    if (timedLines.length > 0) {
      console.log('[LyricsAlign] Using timed lyrics (LRC)', { lines: timedLines.length });
      return applyTimedLyrics(timeline, timedLines);
    }
    console.log('[LyricsAlign] LRC parse returned 0 lines, falling back to structural');
  }

  const sections = parseLyrics(rawLyrics);
  if (sections.length === 0) return timeline;

  const updatedChords = timeline.chords.map(c => ({ ...c }));
  const totalBars = updatedChords.length;

  // Estimate intro
  const introBars = estimateIntroBars(updatedChords);

  // Count total lyrics lines for proportional distribution
  const totalLines = sections.reduce((sum, s) => sum + s.lines.length, 0);
  if (totalLines === 0) return timeline;

  // Available bars for lyrics (after intro, before potential outro)
  // Reserve ~4 bars at the end for outro/fade
  const outroBars = Math.min(4, Math.floor(totalBars * 0.05));
  const availableBars = totalBars - introBars - outroBars;

  // Estimate gap bars between sections (instrumental breaks)
  // Use 1-2 bars between sections, more between verse→chorus transitions
  const gapBars = Math.max(0, Math.min(2, Math.floor(availableBars * 0.02)));
  const totalGapBars = gapBars * Math.max(0, sections.length - 1);
  const barsForLyrics = availableBars - totalGapBars;

  if (barsForLyrics <= 0) {
    // Not enough bars — just distribute evenly ignoring structure
    return applyLyricsFlat(updatedChords, sections, timeline);
  }

  // Distribute bars per section proportionally to line count
  const sectionBars: number[] = sections.map(s =>
    Math.max(s.lines.length, Math.round((s.lines.length / totalLines) * barsForLyrics))
  );

  // Adjust to fit exactly
  let totalAllocated = sectionBars.reduce((a, b) => a + b, 0);
  while (totalAllocated > barsForLyrics && sectionBars.length > 0) {
    // Shrink the largest section
    const maxIdx = sectionBars.indexOf(Math.max(...sectionBars));
    sectionBars[maxIdx]--;
    totalAllocated--;
  }
  while (totalAllocated < barsForLyrics && sectionBars.length > 0) {
    // Grow the largest section
    const maxIdx = sectionBars.indexOf(Math.max(...sectionBars));
    sectionBars[maxIdx]++;
    totalAllocated++;
  }

  // Compute vocal energy weights for smart line placement
  const barWeights = computeBarLyricWeights(updatedChords);

  // Place lyrics
  let barIdx = introBars;

  console.log('[LyricsAlign] Structure:', {
    totalBars,
    introBars,
    outroBars,
    sections: sections.length,
    gapBars,
    barsForLyrics,
    sectionBars: sectionBars.join(','),
  });

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    const section = sections[sIdx];
    const barsForSection = sectionBars[sIdx];

    if (barIdx >= totalBars || barsForSection <= 0) break;

    // Mark section label on first bar
    if (barIdx < updatedChords.length) {
      updatedChords[barIdx].section = section.label;
    }

    // Distribute lines within this section's bars, preferring high-vocal-energy bars
    const sectionEnd = Math.min(barIdx + barsForSection, totalBars);
    const barsPerLine = Math.max(1, Math.floor(barsForSection / section.lines.length));

    for (let lineIdx = 0; lineIdx < section.lines.length; lineIdx++) {
      const nominalBar = barIdx + lineIdx * barsPerLine;
      if (nominalBar >= sectionEnd) break;

      // Search within a small window around nominal position for a high-energy bar
      let bestBar = nominalBar;
      let bestWeight = barWeights[nominalBar] ?? 0;
      const searchRadius = Math.min(1, Math.floor(barsPerLine / 2));
      for (let offset = -searchRadius; offset <= searchRadius; offset++) {
        const candidate = nominalBar + offset;
        if (candidate < barIdx || candidate >= sectionEnd) continue;
        if (updatedChords[candidate].lyrics) continue; // already has lyrics
        if ((barWeights[candidate] ?? 0) > bestWeight) {
          bestWeight = barWeights[candidate] ?? 0;
          bestBar = candidate;
        }
      }

      if (bestBar < totalBars) {
        updatedChords[bestBar].lyrics = section.lines[lineIdx];
      }
    }

    // Advance past this section + gap
    barIdx += barsForSection + gapBars;
  }

  return {
    ...timeline,
    chords: updatedChords,
  };
}

/** Flat fallback if structure doesn't fit */
function applyLyricsFlat(
  chords: ChordTimelineArtifact['chords'],
  sections: LyricsSection[],
  timeline: ChordTimelineArtifact,
): ChordTimelineArtifact {
  const allLines = sections.flatMap(s => s.lines);
  const barsPerLine = Math.max(1, Math.floor(chords.length / allLines.length));
  let barIdx = 0;

  for (const line of allLines) {
    if (barIdx >= chords.length) break;
    chords[barIdx].lyrics = line;
    barIdx += barsPerLine;
  }

  return { ...timeline, chords };
}

// ============================================
// Section Fingerprinting (Phase D)
// ============================================

interface SectionSpan {
  label: string;
  sectionType: string;
  startBarIdx: number;
  endBarIdx: number;
  firstLine: string;
}

/**
 * Identify sections from the chord timeline (using section labels + lyric gaps).
 * Returns section spans with their bar ranges.
 */
function identifySections(chords: ChordTimelineArtifact['chords']): SectionSpan[] {
  const spans: SectionSpan[] = [];
  let currentSection: SectionSpan | null = null;

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];

    if (chord.section) {
      // Explicit section boundary
      if (currentSection) {
        currentSection.endBarIdx = i - 1;
        spans.push(currentSection);
      }
      const sType = inferSectionType(chord.section);
      currentSection = {
        label: chord.section,
        sectionType: sType,
        startBarIdx: i,
        endBarIdx: i,
        firstLine: chord.lyrics || '',
      };
    } else if (!currentSection && chord.lyrics) {
      // No section marker yet but lyrics started — create a synthetic section
      currentSection = {
        label: 'unknown',
        sectionType: 'unknown',
        startBarIdx: i,
        endBarIdx: i,
        firstLine: chord.lyrics,
      };
    }

    if (currentSection) {
      currentSection.endBarIdx = i;
      if (!currentSection.firstLine && chord.lyrics) {
        currentSection.firstLine = chord.lyrics;
      }
    }
  }

  if (currentSection) {
    spans.push(currentSection);
  }

  // If no sections were found, try to segment by lyric time gaps
  if (spans.length === 0) {
    return segmentByLyricGaps(chords);
  }

  return spans;
}

/**
 * Segment into pseudo-sections by lyric time gaps (for LRC without headers).
 * A gap > max(8s, 2 bars) starts a new section.
 */
function segmentByLyricGaps(chords: ChordTimelineArtifact['chords']): SectionSpan[] {
  const spans: SectionSpan[] = [];
  const lyricsIndices = chords
    .map((c, i) => c.lyrics ? i : -1)
    .filter(i => i >= 0);

  if (lyricsIndices.length === 0) return [];

  // Estimate bar duration for gap threshold
  const barDuration = chords.length >= 2
    ? chords[1].startTime - chords[0].startTime
    : 2;
  const gapThresholdBars = Math.max(2, Math.ceil(8 / barDuration));

  let sectionStart = lyricsIndices[0];
  let sectionNum = 1;

  for (let i = 1; i < lyricsIndices.length; i++) {
    const gap = lyricsIndices[i] - lyricsIndices[i - 1];
    if (gap > gapThresholdBars) {
      // End current section, start new one
      spans.push({
        label: `Section ${sectionNum}`,
        sectionType: 'unknown',
        startBarIdx: sectionStart,
        endBarIdx: lyricsIndices[i - 1],
        firstLine: chords[sectionStart].lyrics || '',
      });
      sectionNum++;
      sectionStart = lyricsIndices[i];
    }
  }

  // Final section
  spans.push({
    label: `Section ${sectionNum}`,
    sectionType: 'unknown',
    startBarIdx: sectionStart,
    endBarIdx: lyricsIndices[lyricsIndices.length - 1],
    firstLine: chords[sectionStart].lyrics || '',
  });

  return spans;
}

/**
 * Infer section type from a section label string.
 */
function inferSectionType(label: string): string {
  const lower = label.toLowerCase();
  if (/chorus|refrain/i.test(lower)) return 'chorus';
  if (/verse/i.test(lower)) return 'verse';
  if (/bridge/i.test(lower)) return 'bridge';
  if (/intro/i.test(lower)) return 'intro';
  if (/outro/i.test(lower)) return 'outro';
  if (/pre-?chorus/i.test(lower)) return 'prechorus';
  if (/interlude/i.test(lower)) return 'interlude';
  return 'unknown';
}

/**
 * Generate a stable fingerprint key for a section.
 *
 * Format: <sectionType>|occ<N>|txt<textAnchor>|p<positionBucket>
 *
 * This key is used as the targetKey in lyric_correction edits,
 * enabling corrections to survive reanalysis.
 */
export function generateSectionFingerprint(
  sectionType: string,
  occurrenceIndex: number,
  firstLine: string,
  startBarIdx: number,
  totalBars: number,
): string {
  const textAnchor = firstLine
    ? firstLine.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 40)
    : 'no_lyrics';
  const positionBucket = totalBars > 0
    ? Math.floor((startBarIdx / totalBars) * 10)
    : 0;
  return `${sectionType}|occ${occurrenceIndex}|txt${textAnchor}|p${positionBucket}`;
}

/**
 * Generate fingerprints for all sections in a timeline.
 * Returns a map of chord index -> fingerprint key.
 */
export function generateTimelineFingerprints(
  chords: ChordTimelineArtifact['chords'],
): Map<number, string> {
  const sections = identifySections(chords);
  const totalBars = chords.length;

  // Count occurrences per section type
  const occurrenceCounts = new Map<string, number>();
  const fingerprints = new Map<number, string>();

  for (const section of sections) {
    const count = (occurrenceCounts.get(section.sectionType) || 0) + 1;
    occurrenceCounts.set(section.sectionType, count);

    const key = generateSectionFingerprint(
      section.sectionType,
      count,
      section.firstLine,
      section.startBarIdx,
      totalBars,
    );

    fingerprints.set(section.startBarIdx, key);
  }

  return fingerprints;
}

// ============================================
// Lyric Correction Resolution (Phase C)
// ============================================

interface ResolvedCorrection {
  scope: LyricCorrectionScope;
  targetKey: string;
  deltaBars: number;
}

/**
 * Extract lyric correction edits from the edit history.
 */
function extractLyricCorrections(edits: TimelineEdit[]): ResolvedCorrection[] {
  return edits
    .filter(e => e.op.type === 'lyric_correction')
    .map(e => {
      const op = e.op as { type: 'lyric_correction'; scope: LyricCorrectionScope; targetKey: string; deltaBars: number };
      return { scope: op.scope, targetKey: op.targetKey, deltaBars: op.deltaBars };
    });
}

/**
 * Resolve the effective delta for a given section fingerprint,
 * applying precedence: line > section_occurrence > section_class > global.
 *
 * For section/global scopes, "latest wins" — the last matching edit in the
 * array takes precedence (allows users to override earlier corrections).
 * Line corrections are handled separately via accumulation, not here.
 */
function resolveCorrection(
  fingerprint: string,
  corrections: ResolvedCorrection[],
): number {
  // Parse fingerprint parts
  const parts = fingerprint.split('|');
  const sectionType = parts[0] || '';

  // Check in precedence order (highest to lowest)
  // 1. Section occurrence (exact fingerprint match) — latest wins
  for (let i = corrections.length - 1; i >= 0; i--) {
    if (corrections[i].scope === 'section_occurrence' && corrections[i].targetKey === fingerprint) {
      return corrections[i].deltaBars;
    }
  }

  // 2. Section class (matches section type) — latest wins
  for (let i = corrections.length - 1; i >= 0; i--) {
    if (corrections[i].scope === 'section_class' && corrections[i].targetKey === sectionType) {
      return corrections[i].deltaBars;
    }
  }

  // 3. Global — latest wins
  for (let i = corrections.length - 1; i >= 0; i--) {
    if (corrections[i].scope === 'global') {
      return corrections[i].deltaBars;
    }
  }

  return 0;
}

/**
 * Normalize text for fuzzy matching: lowercase, strip punctuation, trim, take first 40 chars.
 */
function normalizeTextAnchor(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().slice(0, 40);
}

/**
 * Build a line-level targetKey for a lyric correction.
 *
 * Format: line|bar<barNumber>|p<positionDecile>|txt<textAnchor>
 *
 * The position decile (0-9) based on bar position within the song
 * disambiguates identical lyrics at different song positions (e.g., repeated chorus).
 */
export function buildLineTargetKey(barNumber: number, totalBars: number, lyricsText: string): string {
  const textAnchor = normalizeTextAnchor(lyricsText);
  const posDecile = totalBars > 0 ? Math.floor((barNumber / totalBars) * 10) : 0;
  return `line|bar${barNumber}|p${posDecile}|txt${textAnchor}`;
}

/**
 * Parse a line-level targetKey into its components.
 * Supports both old format (line|bar<N>|txt<text>) and new format (line|bar<N>|p<D>|txt<text>).
 */
function parseLineTargetKey(targetKey: string): { barNumber: number; positionDecile: number; textAnchor: string } | null {
  // New format: line|bar<N>|p<D>|txt<text>
  const newMatch = targetKey.match(/^line\|bar(\d+)\|p(\d+)\|txt(.*)$/);
  if (newMatch) {
    return {
      barNumber: parseInt(newMatch[1], 10),
      positionDecile: parseInt(newMatch[2], 10),
      textAnchor: newMatch[3],
    };
  }
  // Legacy format: line|bar<N>|txt<text>
  const oldMatch = targetKey.match(/^line\|bar(\d+)\|txt(.*)$/);
  if (oldMatch) {
    return {
      barNumber: parseInt(oldMatch[1], 10),
      positionDecile: -1, // unknown
      textAnchor: oldMatch[2],
    };
  }
  return null;
}

/**
 * Apply lyric corrections from edit history to a timeline.
 *
 * Handles two correction types:
 * 1. Line-level: matches a specific lyric line by text content within ±3 bars
 *    of its original position. Multiple nudges on the same line accumulate.
 * 2. Section/global level: shifts all lyrics in a section or the entire song.
 *
 * Line-level corrections take precedence (applied first, bars are marked as handled).
 */
export function applyLyricCorrections(
  timeline: ChordTimelineArtifact,
): ChordTimelineArtifact {
  const corrections = extractLyricCorrections(timeline.edits);
  if (corrections.length === 0) return timeline;

  const lineCorrections = corrections.filter(c => c.scope === 'line');
  const sectionCorrections = corrections.filter(c => c.scope !== 'line');

  const updatedChords = timeline.chords.map(c => ({ ...c }));
  const handledBars = new Set<number>(); // bars already shifted by line corrections
  let lineApplied = 0;
  let lineSkipped = 0;

  // --- Line-level corrections ---
  if (lineCorrections.length > 0) {
    // Accumulate deltas per text+position (multiple nudges on the same line).
    // Group by text anchor + approximate position: corrections within 10 bars
    // of each other with the same text are considered the same line.
    const accumulatedDeltas = new Map<string, { textAnchor: string; originalBar: number; totalDelta: number }>();
    for (const corr of lineCorrections) {
      const parsed = parseLineTargetKey(corr.targetKey);
      if (!parsed) continue;

      // Find existing group with same text within 10 bars
      let groupKey: string | null = null;
      for (const [key, group] of accumulatedDeltas) {
        if (group.textAnchor === parsed.textAnchor &&
            Math.abs(group.originalBar - parsed.barNumber) <= 10) {
          groupKey = key;
          break;
        }
      }

      if (groupKey) {
        accumulatedDeltas.get(groupKey)!.totalDelta += corr.deltaBars;
      } else {
        const newKey = `${parsed.textAnchor}|near${parsed.barNumber}`;
        accumulatedDeltas.set(newKey, {
          textAnchor: parsed.textAnchor,
          originalBar: parsed.barNumber,
          totalDelta: corr.deltaBars,
        });
      }
    }

    // Apply each accumulated line correction
    for (const [, { textAnchor, originalBar, totalDelta }] of accumulatedDeltas) {
      if (totalDelta === 0) continue;

      // Search for matching lyrics text within ±3 bars of original position
      const searchRadius = 3;
      let matchIdx = -1;
      let bestDist = Infinity;

      for (let i = Math.max(0, originalBar - searchRadius);
           i <= Math.min(updatedChords.length - 1, originalBar + searchRadius);
           i++) {
        if (!updatedChords[i].lyrics) continue;
        if (handledBars.has(i)) continue;
        const normalized = normalizeTextAnchor(updatedChords[i].lyrics!);
        if (normalized === textAnchor) {
          const dist = Math.abs(i - originalBar);
          if (dist < bestDist) {
            bestDist = dist;
            matchIdx = i;
          }
        }
      }

      if (matchIdx >= 0) {
        const targetIdx = matchIdx + totalDelta;
        if (targetIdx >= 0 && targetIdx < updatedChords.length) {
          const lyricsText = updatedChords[matchIdx].lyrics;
          updatedChords[matchIdx].lyrics = undefined;
          handledBars.add(matchIdx);

          if (updatedChords[targetIdx].lyrics) {
            updatedChords[targetIdx].lyrics += ' / ' + lyricsText;
          } else {
            updatedChords[targetIdx].lyrics = lyricsText;
          }
          handledBars.add(targetIdx);
          lineApplied++;
        } else {
          lineSkipped++;
        }
      } else {
        console.warn('[LyricsAlign] Line correction target not found', { textAnchor, originalBar });
        lineSkipped++;
      }
    }
  }

  // --- Section/global corrections ---
  let sectionApplied = 0;
  if (sectionCorrections.length > 0) {
    const fingerprints = generateTimelineFingerprints(updatedChords);

    // Group bars by their section fingerprint
    const sectionBars = new Map<string, number[]>();
    for (const [barIdx, fp] of fingerprints) {
      const nextSectionStart = [...fingerprints.keys()]
        .filter(k => k > barIdx)
        .sort((a, b) => a - b)[0] ?? updatedChords.length;

      for (let i = barIdx; i < nextSectionStart; i++) {
        if (!sectionBars.has(fp)) sectionBars.set(fp, []);
        sectionBars.get(fp)!.push(i);
      }
    }

    for (const [fp, barIndices] of sectionBars) {
      const delta = resolveCorrection(fp, sectionCorrections);
      if (delta === 0) continue;

      const lyricData: Array<{ lyrics?: string; section?: string; sourceIdx: number }> = [];
      for (const idx of barIndices) {
        if (handledBars.has(idx)) continue; // already handled by line correction
        if (updatedChords[idx].lyrics || updatedChords[idx].section) {
          lyricData.push({
            lyrics: updatedChords[idx].lyrics,
            section: updatedChords[idx].section,
            sourceIdx: idx,
          });
          updatedChords[idx].lyrics = undefined;
          updatedChords[idx].section = undefined;
        }
      }

      for (const data of lyricData) {
        const targetIdx = data.sourceIdx + delta;
        if (targetIdx >= 0 && targetIdx < updatedChords.length) {
          if (data.lyrics) {
            if (updatedChords[targetIdx].lyrics) {
              updatedChords[targetIdx].lyrics += ' / ' + data.lyrics;
            } else {
              updatedChords[targetIdx].lyrics = data.lyrics;
            }
          }
          if (data.section && !updatedChords[targetIdx].section) {
            updatedChords[targetIdx].section = data.section;
          }
          sectionApplied++;
        }
      }
    }
  }

  console.log('[LyricsAlign] Applied lyric corrections', {
    total: corrections.length,
    lineApplied,
    lineSkipped,
    sectionApplied,
  });

  return { ...timeline, chords: updatedChords };
}

// ============================================
// Title Parsing
// ============================================

/**
 * Try to extract artist and title from a project source title.
 */
export function parseArtistTitle(sourceTitle: string): { artist: string; title: string } {
  let cleaned = sourceTitle
    .replace(/\(official\s*(video|audio|lyric\s*video|music\s*video)\)/gi, '')
    .replace(/\[official\s*(video|audio|lyric\s*video|music\s*video)\]/gi, '')
    .replace(/\(lyrics?\)/gi, '')
    .replace(/\[lyrics?\]/gi, '')
    .replace(/\(HD\)/gi, '')
    .replace(/\|.*$/g, '')
    .trim();

  // "Artist - Title" pattern
  const dashMatch = cleaned.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    return { artist: dashMatch[1].trim(), title: dashMatch[2].trim() };
  }

  // "Title by Artist" pattern
  const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { artist: byMatch[2].trim(), title: byMatch[1].trim() };
  }

  return { artist: '', title: cleaned };
}
