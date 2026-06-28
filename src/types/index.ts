import type { EdgeType, IntervalStep } from '../core/chordPathfinder';

// Chord qualities supported in v1
export type ChordQuality =
  | 'major'
  | 'minor'
  | 'dim'
  | 'aug'
  | 'dom7'
  | 'maj7'
  | 'min7'
  | 'sus2'
  | 'sus4';

export interface ChordDefinition {
  name: string;       // e.g. "Gm7"
  root: string;       // e.g. "G"
  quality: ChordQuality;
  pitchClasses: Set<number>; // e.g. Set([7, 10, 2, 5]) for Gm7
}

export interface GraphNode {
  id: string;          // chord name, e.g. "G"
  chord: ChordDefinition;
  inDeg: number;
  outDeg: number;
  progressions: Set<string>; // names of progressions containing this chord
}

export interface GraphEdge {
  source: string;
  target: string;
  count: number;
  contributors: Map<string, number>; // progressionName → count
}

export interface Progression {
  name: string;
  chords: string[];
  color: string;
}

export interface GraphState {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>; // keyed by "source->target"
  progressions: Progression[];
  nextColorIndex: number;
  nodePositions?: Map<string, { x: number; y: number }>;
}

export interface MidiNoteEvent {
  note: number;
  velocity: number;
  channel: number;
}

export interface EdgeStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray: string;
}

// Save file format
export interface SaveData {
  version: 1;
  progressions: { name: string; chords: string[]; color: string }[];
  nodePositions?: Record<string, { x: number; y: number }>;
  walkPath?: { nodes: string[]; edgeTypes: string[] };
}

// Walk mode types
export type AppMode = 'jam' | 'walk' | 'replay';

export interface MidiEvent {
  type: 'noteOn' | 'noteOff' | 'cc';
  note: number;     // MIDI note number, or CC number (64 = sustain)
  velocity: number; // velocity (noteOn/noteOff) or CC value
  channel: number;  // 0–15
  offsetMs: number; // ms since recording start
}

export interface WalkState {
  fromChord: string;
  toChord: string;
  /** Must-include constraints for the outbound path, plus the trip flags. */
  options: Partial<Record<EdgeType, boolean>> & {
    returnTrip: boolean;
    endless: boolean;
  };
  /** Must-include constraints for the return leg (B→A). */
  returnOptions: Partial<Record<EdgeType, boolean>>;
  /**
   * Active cycle preset edge sequence. Each element is one direct hop of that
   * edge type in order: outbound = edges[0..n-2], closing = edges[n-1].
   * Kept for label display; path construction now uses cycleSteps when present.
   */
  cycleEdgeTypes?: EdgeType[];
  /**
   * Interval shape for the active cycle preset. When present, path construction
   * uses interval arithmetic (transposeChord) instead of graph BFS/DFS.
   * steps[0..n-2] are the outbound hops; steps[n-1] is the closing hop.
   */
  cycleSteps?: IntervalStep[];
  /** Current path result (null if not yet computed or no path exists) */
  path: WalkPathResult | null;
  /** Index of the step the player is currently on (0 = first chord) */
  currentStep: number;
  /** Whether the full path has been completed */
  completed: boolean;
  /** Number of paths completed in this session (for endless mode) */
  pathsCompleted: number;
  /** How many times to repeat the current path before advancing (endless mode) */
  repeatCount: number;
  /** How many times the current path has been completed this cycle */
  currentPathCompletions: number;
}

export interface WalkPathResult {
  chordNames: string[];
  edgeTypes: string[];  // EdgeType values from chordPathfinder
  explanations: string[];
  totalWeight: number;
}

// Type for the Electron API exposed via preload
export interface ElectronAPI {
  platform: string;
  onMenuNew: (callback: () => void) => void;
  onMenuOpen: (callback: (data: SaveData) => void) => void;
  onMenuSave: (callback: (filePath: string, saveAs: boolean) => void) => void;
  fileWrite: (filePath: string, data: string) => void;
  fileSaveAs: (defaultPath: string, data: string) => Promise<string | null>;
  midiActivity: () => void;
  setMenuBarVisible: (visible: boolean) => void;
  removeMenuListeners: () => void;

  // Recording pipeline
  requestRecordingPaths: (ts: string, saveDataJson: string) => Promise<{ polishedPath: string; midiPath: string } | null>;
  openWriteStream: (filePath: string) => Promise<void>;
  writeStreamChunk: (filePath: string, chunk: Uint8Array) => void;
  closeWriteStream: (filePath: string) => Promise<void>;
  saveMidi: (filePath: string, data: Uint8Array) => Promise<void>;

  // Replay
  getFilePath: (file: File) => string;
  readFileBinary: (filePath: string) => Promise<Uint8Array>;
  openRecording: () => Promise<{ audioPath: string; midiPath: string | null; cwalkData: string | null } | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
