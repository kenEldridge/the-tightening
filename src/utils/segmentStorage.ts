/**
 * Segment Storage Utility
 *
 * Saves and loads practice segments per video in localStorage.
 * Each segment stores timing info, OCR notes, and tempo/time signature.
 */

import type { ExtractedNote } from '../core/SheetMusicOCR';

export interface SavedSegment {
  /** YouTube video ID */
  videoId: string;
  /** Full YouTube URL (e.g. https://www.youtube.com/watch?v=xxxx) */
  videoUrl: string;
  /** Video title for display */
  videoTitle?: string;
  /** Optional user-given name for the segment */
  name?: string;
  /** Start time in the video (seconds) */
  startTime: number;
  /** End time in the video (seconds) */
  endTime: number;
  /** Notes extracted from OCR */
  ocrNotes: ExtractedNote[];
  /** Time signature detected from sheet music */
  timeSignature: { numerator: number; denominator: number };
  /** Key signature (e.g., "D major", "2 sharps") */
  keySignature?: string;
  /** Inferred tempo based on segment duration and measure count */
  tempo: number;
  /** When this segment was saved */
  savedAt: string;
  /** Number of measures detected */
  measureCount?: number;
}

const STORAGE_KEY_PREFIX = 'the-tightening-segments-';

/**
 * Get storage key for a video ID
 */
function getStorageKey(videoId: string): string {
  return `${STORAGE_KEY_PREFIX}${videoId}`;
}

/**
 * Save a segment for a video
 * Appends to existing segments or creates new list
 */
export function saveSegment(segment: SavedSegment): void {
  const key = getStorageKey(segment.videoId);
  const existing = loadSegments(segment.videoId);

  // Add timestamp if not present
  const segmentWithTimestamp: SavedSegment = {
    ...segment,
    savedAt: segment.savedAt || new Date().toISOString(),
  };

  existing.push(segmentWithTimestamp);

  try {
    localStorage.setItem(key, JSON.stringify(existing));
    console.log('[segmentStorage] Saved segment:', {
      videoId: segment.videoId,
      name: segment.name,
      totalSegments: existing.length,
    });
  } catch (err) {
    console.error('[segmentStorage] Failed to save segment:', err);
    throw new Error('Failed to save segment to localStorage');
  }
}

/**
 * Load all segments for a video
 */
export function loadSegments(videoId: string): SavedSegment[] {
  const key = getStorageKey(videoId);

  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return [];
    }

    const segments = JSON.parse(stored) as SavedSegment[];
    console.log('[segmentStorage] Loaded segments:', {
      videoId,
      count: segments.length,
    });

    return segments;
  } catch (err) {
    console.error('[segmentStorage] Failed to load segments:', err);
    return [];
  }
}

/**
 * Delete a segment by index
 */
export function deleteSegment(videoId: string, index: number): boolean {
  const segments = loadSegments(videoId);

  if (index < 0 || index >= segments.length) {
    console.error('[segmentStorage] Invalid segment index:', index);
    return false;
  }

  segments.splice(index, 1);

  const key = getStorageKey(videoId);

  try {
    if (segments.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(segments));
    }

    console.log('[segmentStorage] Deleted segment:', {
      videoId,
      index,
      remaining: segments.length,
    });

    return true;
  } catch (err) {
    console.error('[segmentStorage] Failed to delete segment:', err);
    return false;
  }
}

/**
 * Delete a segment by its savedAt timestamp (unique identifier for segments)
 */
export function deleteSegmentBySavedAt(videoId: string, savedAt: string): boolean {
  const segments = loadSegments(videoId);
  const index = segments.findIndex(s => s.savedAt === savedAt);

  if (index === -1) {
    console.error('[segmentStorage] Segment not found:', { videoId, savedAt });
    return false;
  }

  return deleteSegment(videoId, index);
}

/**
 * Update a segment at a specific index
 */
export function updateSegment(
  videoId: string,
  index: number,
  updates: Partial<SavedSegment>
): boolean {
  const segments = loadSegments(videoId);

  if (index < 0 || index >= segments.length) {
    console.error('[segmentStorage] Invalid segment index:', index);
    return false;
  }

  segments[index] = {
    ...segments[index],
    ...updates,
    savedAt: new Date().toISOString(),
  };

  const key = getStorageKey(videoId);

  try {
    localStorage.setItem(key, JSON.stringify(segments));
    console.log('[segmentStorage] Updated segment:', {
      videoId,
      index,
      updates: Object.keys(updates),
    });
    return true;
  } catch (err) {
    console.error('[segmentStorage] Failed to update segment:', err);
    return false;
  }
}

/**
 * Get a single segment by index
 */
export function getSegment(videoId: string, index: number): SavedSegment | null {
  const segments = loadSegments(videoId);

  if (index < 0 || index >= segments.length) {
    return null;
  }

  return segments[index];
}

/**
 * Get all video IDs that have saved segments
 */
export function getAllVideoIds(): string[] {
  const videoIds: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_KEY_PREFIX)) {
      videoIds.push(key.replace(STORAGE_KEY_PREFIX, ''));
    }
  }

  return videoIds;
}

/**
 * Get all saved videos with their segments, grouped by video ID.
 * Sorted by most recently used (based on latest savedAt timestamp).
 */
export function getAllSavedVideos(): Array<{
  videoId: string;
  videoTitle?: string;
  videoUrl: string;
  segments: SavedSegment[];
}> {
  const videoIds = getAllVideoIds();
  const result = videoIds
    .map(videoId => {
      const segments = loadSegments(videoId);
      if (segments.length === 0) return null;
      // Use metadata from first segment that has it
      const withTitle = segments.find(s => s.videoTitle);
      const withUrl = segments.find(s => s.videoUrl);
      return {
        videoId,
        videoTitle: withTitle?.videoTitle,
        videoUrl: withUrl?.videoUrl ?? '',
        segments,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  // Sort by most recently saved segment
  result.sort((a, b) => {
    const aLatest = Math.max(...a.segments.map(s => new Date(s.savedAt).getTime()));
    const bLatest = Math.max(...b.segments.map(s => new Date(s.savedAt).getTime()));
    return bLatest - aLatest;
  });

  return result;
}

/**
 * Clear all segments for a video
 */
export function clearSegments(videoId: string): void {
  const key = getStorageKey(videoId);
  localStorage.removeItem(key);
  console.log('[segmentStorage] Cleared all segments for video:', videoId);
}

/**
 * Export all segments as JSON (for backup)
 */
export function exportAllSegments(): Record<string, SavedSegment[]> {
  const allSegments: Record<string, SavedSegment[]> = {};

  for (const videoId of getAllVideoIds()) {
    allSegments[videoId] = loadSegments(videoId);
  }

  return allSegments;
}

/**
 * Import segments from JSON backup
 */
export function importSegments(data: Record<string, SavedSegment[]>): void {
  for (const [videoId, segments] of Object.entries(data)) {
    const key = getStorageKey(videoId);
    localStorage.setItem(key, JSON.stringify(segments));
  }
  console.log('[segmentStorage] Imported segments for videos:', Object.keys(data));
}
