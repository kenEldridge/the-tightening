/**
 * LRC (LyRiCs) Parser
 *
 * Parses standard LRC format files for synchronized lyrics.
 * LRC is the industry standard for timed lyrics, used by media players,
 * karaoke software, and music apps worldwide.
 *
 * Format reference: https://en.wikipedia.org/wiki/LRC_(file_format)
 */

export interface LrcMetadata {
  title?: string;      // [ti:Title]
  artist?: string;     // [ar:Artist]
  album?: string;      // [al:Album]
  author?: string;     // [au:Lyrics author]
  length?: string;     // [length:mm:ss]
  offset?: number;     // [offset:+/-ms] - timing adjustment
}

export interface LrcLine {
  time: number;        // Time in seconds
  text: string;        // Lyric text or section name
  isSection: boolean;  // True if this is a section marker like [Verse 1]
}

export interface ParsedLrc {
  metadata: LrcMetadata;
  lines: LrcLine[];
}

// Regex patterns
const TIMESTAMP_REGEX = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/g;
const METADATA_REGEX = /^\[([a-z]+):(.+)\]$/i;
const SECTION_MARKER_REGEX = /^\[([A-Z][^:\]]*)\]$/;

/**
 * Parse an LRC file content string into structured data
 */
export function parseLrc(content: string): ParsedLrc {
  const metadata: LrcMetadata = {};
  const lines: LrcLine[] = [];

  const rawLines = content.split('\n');

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for metadata tags (no timestamp)
    const metaMatch = trimmed.match(METADATA_REGEX);
    if (metaMatch && !trimmed.match(TIMESTAMP_REGEX)) {
      const [, key, value] = metaMatch;
      switch (key.toLowerCase()) {
        case 'ti':
          metadata.title = value.trim();
          break;
        case 'ar':
          metadata.artist = value.trim();
          break;
        case 'al':
          metadata.album = value.trim();
          break;
        case 'au':
          metadata.author = value.trim();
          break;
        case 'length':
          metadata.length = value.trim();
          break;
        case 'offset':
          metadata.offset = parseInt(value.trim(), 10);
          break;
      }
      continue;
    }

    // Parse timestamped lines
    const timestamps: number[] = [];
    let match;
    TIMESTAMP_REGEX.lastIndex = 0;

    while ((match = TIMESTAMP_REGEX.exec(trimmed)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centiseconds = parseInt(match[3].padEnd(3, '0').slice(0, 3), 10);
      const time = minutes * 60 + seconds + centiseconds / 1000;
      timestamps.push(time);
    }

    if (timestamps.length === 0) continue;

    // Get the text after all timestamps
    let text = trimmed.replace(TIMESTAMP_REGEX, '').trim();

    // Check if this is a section marker
    let isSection = false;
    const sectionMatch = text.match(SECTION_MARKER_REGEX);
    if (sectionMatch) {
      text = sectionMatch[1];
      isSection = true;
    }

    // Add a line for each timestamp (LRC allows multiple timestamps per line)
    for (const time of timestamps) {
      lines.push({ time, text, isSection });
    }
  }

  // Sort by time
  lines.sort((a, b) => a.time - b.time);

  // Apply offset if specified
  if (metadata.offset) {
    const offsetSeconds = metadata.offset / 1000;
    for (const line of lines) {
      line.time += offsetSeconds;
    }
  }

  return { metadata, lines };
}

/**
 * Get the current lyric line based on playback time
 */
export function getCurrentLine(lines: LrcLine[], currentTime: number): LrcLine | null {
  if (lines.length === 0) return null;

  // Find the last line that started before or at current time
  let currentLine: LrcLine | null = null;
  for (const line of lines) {
    if (line.time <= currentTime) {
      currentLine = line;
    } else {
      break;
    }
  }

  return currentLine;
}

/**
 * Get the current section based on playback time
 */
export function getCurrentSection(lines: LrcLine[], currentTime: number): string | null {
  let currentSection: string | null = null;

  for (const line of lines) {
    if (line.time > currentTime) break;
    if (line.isSection) {
      currentSection = line.text;
    }
  }

  return currentSection;
}

/**
 * Get all section markers from the LRC
 */
export function getSections(lines: LrcLine[]): Array<{ name: string; time: number }> {
  return lines
    .filter(line => line.isSection)
    .map(line => ({ name: line.text, time: line.time }));
}

/**
 * Get lyrics for a specific time range (useful for section display)
 */
export function getLyricsInRange(
  lines: LrcLine[],
  startTime: number,
  endTime: number
): LrcLine[] {
  return lines.filter(
    line => !line.isSection && line.time >= startTime && line.time < endTime
  );
}
