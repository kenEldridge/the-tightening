/**
 * Timeline Editor
 *
 * Applies edit operations to a ChordTimelineArtifact.
 * Supports set_chord, shift_boundary, split_event, merge_with_next.
 * Lightweight undo/redo (one level).
 */

import type {
  ChordTimelineArtifact,
  ChordEvent,
  TimelineEdit,
  TimelineEditOp,
  ChordVoicingData,
} from './rhythmTypes';
import { CHORD_VOICINGS } from '../data/chordProgressions';

function lookupVoicing(symbol: string): ChordVoicingData | null {
  const voicing = CHORD_VOICINGS[symbol];
  if (!voicing) return null;
  return { bass: voicing.bass, notes: [...voicing.notes] };
}

function generateEditId(): string {
  return `edit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateChordId(): string {
  return `chord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Apply an edit operation to a timeline, returning a new timeline.
 * The original is not mutated.
 */
export function applyEdit(
  timeline: ChordTimelineArtifact,
  op: TimelineEditOp,
): ChordTimelineArtifact {
  const newTimeline: ChordTimelineArtifact = {
    ...timeline,
    chords: timeline.chords.map(c => ({ ...c })),
    edits: [...timeline.edits],
    modifiedAt: new Date().toISOString(),
  };

  const edit: TimelineEdit = {
    id: generateEditId(),
    op,
    timestamp: new Date().toISOString(),
  };

  switch (op.type) {
    case 'set_chord':
      applySetChord(newTimeline, op);
      break;
    case 'shift_boundary':
      applyShiftBoundary(newTimeline, op);
      break;
    case 'split_event':
      applySplitEvent(newTimeline, op);
      break;
    case 'merge_with_next':
      applyMergeWithNext(newTimeline, op);
      break;
  }

  newTimeline.edits.push(edit);
  return newTimeline;
}

function applySetChord(
  timeline: ChordTimelineArtifact,
  op: { type: 'set_chord'; eventId: string; symbol: string; barStart?: number; barEnd?: number },
): void {
  const idx = timeline.chords.findIndex(c => c.id === op.eventId);
  if (idx === -1) return;

  const chord = timeline.chords[idx];
  chord.symbol = op.symbol;
  chord.source = 'manual';
  chord.confidence = 1.0;
  chord.voicing = lookupVoicing(op.symbol);

  if (op.barStart !== undefined) chord.barStart = op.barStart;
  if (op.barEnd !== undefined) chord.barEnd = op.barEnd;
}

function applyShiftBoundary(
  timeline: ChordTimelineArtifact,
  op: { type: 'shift_boundary'; eventId: string; deltaBeat: number },
): void {
  const idx = timeline.chords.findIndex(c => c.id === op.eventId);
  if (idx === -1 || idx === 0) return;

  const beatDuration = 60 / timeline.beatGrid.tempo;
  const shiftTime = op.deltaBeat * beatDuration;

  const prev = timeline.chords[idx - 1];
  const curr = timeline.chords[idx];

  // Shift boundary between prev and curr
  prev.endTime += shiftTime;
  curr.startTime += shiftTime;

  // Don't let events collapse to zero/negative duration
  if (prev.endTime >= curr.endTime || curr.startTime <= prev.startTime) {
    prev.endTime -= shiftTime;
    curr.startTime -= shiftTime;
  }
}

function applySplitEvent(
  timeline: ChordTimelineArtifact,
  op: { type: 'split_event'; eventId: string; atBar: number; atBeat: number },
): void {
  const idx = timeline.chords.findIndex(c => c.id === op.eventId);
  if (idx === -1) return;

  const chord = timeline.chords[idx];
  const beatDuration = 60 / timeline.beatGrid.tempo;
  const barsFromStart = op.atBar - chord.barStart;
  const splitTime = chord.startTime + (barsFromStart * timeline.beatGrid.timeSignature.numerator + (op.atBeat - 1)) * beatDuration;

  if (splitTime <= chord.startTime || splitTime >= chord.endTime) return;

  const secondHalf: ChordEvent = {
    id: generateChordId(),
    startTime: splitTime,
    endTime: chord.endTime,
    barStart: op.atBar,
    barEnd: chord.barEnd,
    symbol: chord.symbol,
    confidence: chord.confidence,
    source: chord.source,
    voicing: chord.voicing ? { ...chord.voicing, notes: [...chord.voicing.notes] } : null,
  };

  chord.endTime = splitTime;
  chord.barEnd = op.atBar - 1;

  timeline.chords.splice(idx + 1, 0, secondHalf);
}

function applyMergeWithNext(
  timeline: ChordTimelineArtifact,
  op: { type: 'merge_with_next'; eventId: string },
): void {
  const idx = timeline.chords.findIndex(c => c.id === op.eventId);
  if (idx === -1 || idx >= timeline.chords.length - 1) return;

  const curr = timeline.chords[idx];
  const next = timeline.chords[idx + 1];

  curr.endTime = next.endTime;
  curr.barEnd = next.barEnd;
  curr.source = 'manual';

  timeline.chords.splice(idx + 1, 1);
}

/**
 * Create a fresh ChordTimelineArtifact from analysis results
 */
export function createTimeline(
  beatGrid: import('./rhythmTypes').BeatGrid,
  chords: ChordEvent[],
  meta: { analysisVersion: string; configHash: string },
): ChordTimelineArtifact {
  const now = new Date().toISOString();
  return {
    version: 1,
    analysisVersion: meta.analysisVersion,
    analyzerConfigHash: meta.configHash,
    beatGrid,
    chords,
    edits: [],
    createdAt: now,
    modifiedAt: now,
  };
}
