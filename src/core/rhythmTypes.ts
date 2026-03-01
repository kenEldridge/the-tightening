/**
 * Rhythm Core Types
 *
 * Data contracts for the rhythm/chord analysis pipeline.
 * Phase 1 of the data-first rhythm trainer.
 */

// ============================================
// Error Taxonomy
// ============================================

export type ExtractionErrorCode =
  | 'network_dns'
  | 'download_failed'
  | 'ffmpeg_missing'
  | 'python_missing'
  | 'analysis_failed'
  | 'file_not_found'
  | 'invalid_format'
  | 'unknown';

export interface ExtractionError {
  code: ExtractionErrorCode;
  message: string;
  detail?: string;
  recoverable: boolean;
  /** Suggested fallback action */
  fallback?: 'import_local' | 'retry' | 'manual_entry';
}

// ============================================
// Beat & Chord Data
// ============================================

export interface BeatEvent {
  /** Time in seconds from audio start */
  time: number;
  /** Bar number (1-indexed) */
  bar: number;
  /** Beat within bar (1-indexed) */
  beatInBar: number;
  /** Local tempo estimate at this beat */
  tempoLocal: number;
  /** Detection confidence 0-1 */
  confidence: number;
  /** Onset-derived beat strength, normalized 0-1 for playback dynamics. */
  strength?: number;
}

export interface ChordCandidate {
  symbol: string;
  confidence: number;
  source: 'audio' | 'manual';
}

export type ChordDegree = 'I' | 'ii' | 'iii' | 'IV' | 'V' | 'vi' | 'vii_dim' | 'N';
export type ChordQualityTag = 'maj' | 'min' | 'dim' | 'dom7' | 'unknown';

export interface ChordEvent {
  id: string;
  /** Start time in seconds */
  startTime: number;
  /** End time in seconds */
  endTime: number;
  /** Start bar (1-indexed) */
  barStart: number;
  /** End bar (1-indexed, inclusive) */
  barEnd: number;
  /** Chord symbol (e.g. 'F', 'C7', 'Bb') */
  symbol: string;
  /** Key-relative scale degree (optional, new analyses always set this) */
  degree?: ChordDegree;
  /** Chord quality preserving triad/7th distinction (optional) */
  qualityTag?: ChordQualityTag;
  /** Detection confidence 0-1 */
  confidence: number;
  /** How this chord was determined */
  source: 'audio' | 'manual';
  /** MIDI voicing for practice */
  voicing: ChordVoicingData | null;
  /** Vocal energy ratio for this bar (0-1, higher = vocals likely present) */
  vocalEnergy?: number;
  /** Lyrics text for this bar (optional, from lyrics fetch) */
  lyrics?: string;
  /** Section label e.g. "Chorus", "Verse 1" (optional) */
  section?: string;
}

export interface ChordVoicingData {
  bass: number;      // MIDI note for left hand root
  notes: number[];   // MIDI notes for right hand chord
}

export interface GuideMelodyNote {
  /** Time in seconds from audio start */
  time: number;
  /** MIDI pitch */
  midi: number;
  /** Duration in seconds */
  duration: number;
  /** Velocity 0-1 */
  velocity: number;
}

// ============================================
// Beat Grid
// ============================================

export interface BeatGrid {
  /** Global tempo estimate (BPM) */
  tempo: number;
  /** Time signature */
  timeSignature: { numerator: number; denominator: number };
  /** All detected beats */
  beats: BeatEvent[];
  /** Total number of bars */
  barCount: number;
}

// ============================================
// Timeline Artifact
// ============================================

export interface ChordTimelineArtifact {
  /** Schema version for forward compatibility */
  version: 1;
  /** Analyzer that produced this */
  analysisVersion: string;
  /** Hash of analyzer config for reproducibility */
  analyzerConfigHash: string;
  /** Beat grid */
  beatGrid: BeatGrid;
  /** Detected key root as pitch class 0-11 (C=0). Optional for legacy projects. */
  keyRoot?: number;
  /** Chord events */
  chords: ChordEvent[];
  /** Optional recognizable top-line guide melody for generated playback */
  guideMelody?: GuideMelodyNote[];
  /** Edit history (lightweight for Phase 1) */
  edits: TimelineEdit[];
  /** When this analysis was created */
  createdAt: string;
  /** When last modified */
  modifiedAt: string;
}

// ============================================
// Edit Operations
// ============================================

export type LyricCorrectionScope = 'line' | 'section_occurrence' | 'section_class' | 'global';

export type TimelineEditOp =
  | { type: 'set_chord'; eventId: string; symbol: string; barStart?: number; barEnd?: number }
  | { type: 'shift_boundary'; eventId: string; deltaBeat: number }
  | { type: 'split_event'; eventId: string; atBar: number; atBeat: number }
  | { type: 'merge_with_next'; eventId: string }
  | { type: 'lyric_correction'; scope: LyricCorrectionScope; targetKey: string; deltaBars: number }
  | { type: 'transpose_key'; fromKeyRoot: number; toKeyRoot: number };

export interface TimelineEdit {
  id: string;
  op: TimelineEditOp;
  timestamp: string;
}

// ============================================
// Practice Project (Lite)
// ============================================

export type ProjectSourceType = 'youtube' | 'local_file';

export interface ProjectSource {
  type: ProjectSourceType;
  /** YouTube URL or local file path */
  uri: string;
  /** Display title */
  title: string;
  /** Duration in seconds (if known) */
  duration?: number;
}

export interface PracticeProjectLite {
  id: string;
  /** Human-readable project name */
  name: string;
  /** How the audio was sourced */
  source: ProjectSource;
  /** Path to normalized mono WAV on disk */
  audioPath: string | null;
  /** Analysis result (null if not yet analyzed) */
  timeline: ChordTimelineArtifact | null;
  /** Cached raw lyrics text (so re-analysis doesn't need to re-fetch) */
  cachedLyrics?: string;
  /** Cached synced lyrics (LRC format) for stable timed re-analysis */
  cachedSyncedLyrics?: string;
  /** Global lyrics shift in bars applied after alignment (positive = later) */
  lyricsBarOffset?: number;
  /** Persisted analysis hints (survive across reanalyses) */
  analysisHints?: {
    keyHint?: string;
    tempoHint?: number;
    timeSignatureHint?: string; // 'auto' | '3/4' | '4/4'
    lyricsBarOffset?: number;
  };
  /** When created */
  createdAt: string;
  /** When last opened */
  lastOpenedAt: string;
}

// ============================================
// Rhythm Practice Payload
// ============================================

export interface RhythmPracticePayload {
  /** Project this payload was built from */
  projectId: string;
  /** Tempo for playback */
  tempo: number;
  /** Time signature */
  timeSignature: { numerator: number; denominator: number };
  /** Chord changes in order */
  changes: PracticeChordChange[];
  /** Bar range being practiced (inclusive) */
  barRange: { start: number; end: number };
}

export interface PracticeChordChange {
  /** Time in seconds */
  time: number;
  /** Bar number */
  bar: number;
  /** Beat within bar */
  beat: number;
  /** Chord symbol */
  symbol: string;
  /** MIDI voicing to play/validate */
  voicing: ChordVoicingData;
  /** Duration until next change */
  duration: number;
}

// ============================================
// Analyzer Interface
// ============================================

export interface AnalysisOptions {
  /** Hint for expected tempo (optional) */
  tempoHint?: number;
  /** Hint for time signature (optional) */
  timeSignatureHint?: { numerator: number; denominator: number };
  /** Hint for key (e.g. 'D', 'Am', 'Bb'). If provided, diatonic chords are boosted. */
  keyHint?: string;
}

export interface TimeSignatureDecision {
  score34: number;
  score44: number;
  accentPreference: string;
  winnerMargin: number;
  winner: string;
}

export interface AnalysisResult {
  beatGrid: BeatGrid;
  chords: ChordEvent[];
  meta: {
    analysisVersion: string;
    configHash: string;
    durationMs: number;
    timeSignatureDecision?: TimeSignatureDecision;
    keyRoot?: number;
  };
}

export interface AnalyzerAdapter {
  analyze(audioPath: string, options: AnalysisOptions): Promise<AnalysisResult>;
}

// ============================================
// MIDI Validation Stats
// ============================================

export interface ChordValidationStats {
  correct: number;
  late: number;
  wrong: number;
  missed: number;
  total: number;
}
