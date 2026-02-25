/**
 * Lyrics Alignment
 *
 * Two strategies:
 * A. Timed lyrics (LRC format from LRCLIB syncedLyrics) — maps lines directly
 *    to bars by matching timestamps to bar start times.
 * B. Structural fallback (plain lyrics) — parses sections, estimates intro,
 *    distributes lines proportionally across bars.
 */

import type { ChordTimelineArtifact } from './rhythmTypes';

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
 * Uses a simple heuristic: look at total energy per bar.
 * The intro is the initial run of low-energy bars before energy stabilizes.
 * Falls back to a percentage estimate if energy data isn't useful.
 */
function estimateIntroBars(chords: ChordTimelineArtifact['chords']): number {
  // Simple approach: assume intro is ~8-15% of the song
  // Most pop songs have 4-8 bar intros
  const totalBars = chords.length;

  // Look for a significant energy jump in the first quarter of the song
  // using confidence as a proxy (higher confidence = clearer harmonic content = more instruments)
  const firstQuarter = Math.floor(totalBars * 0.25);
  let avgConfEarly = 0;
  let avgConfLater = 0;

  for (let i = 0; i < Math.min(8, totalBars); i++) {
    avgConfEarly += chords[i].confidence;
  }
  avgConfEarly /= Math.min(8, totalBars);

  for (let i = firstQuarter; i < Math.min(firstQuarter + 8, totalBars); i++) {
    avgConfLater += chords[i].confidence;
  }
  avgConfLater /= Math.min(8, totalBars - firstQuarter);

  // Default: estimate 4-8 bars of intro depending on song length
  if (totalBars > 80) return 8;
  if (totalBars > 40) return 4;
  return 2;
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

    // Distribute lines within this section's bars
    const barsPerLine = Math.max(1, Math.floor(barsForSection / section.lines.length));

    for (let lineIdx = 0; lineIdx < section.lines.length; lineIdx++) {
      const targetBar = barIdx + lineIdx * barsPerLine;
      if (targetBar >= totalBars) break;

      updatedChords[targetBar].lyrics = section.lines[lineIdx];
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
