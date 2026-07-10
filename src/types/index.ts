import type { EdgeType, IntervalStep, WalkMood } from 'theory-core';

// Platform-neutral theory types live in packages/theory-core; re-exported here
// so app code keeps a single import site for types.
export type {
  ChordQuality,
  ChordDefinition,
  GraphNode,
  GraphEdge,
  Progression,
  GraphState,
  MidiNoteEvent,
  EdgeStyle,
  MidiEvent,
} from 'theory-core';

// Save file format
export interface SaveData {
  version: 1;
  progressions: { name: string; chords: string[]; color: string }[];
  nodePositions?: Record<string, { x: number; y: number }>;
  walkPath?: { nodes: string[]; edgeTypes: string[] };
  walkHistory?: { startMs: number; nodes: string[]; edgeTypes: string[] }[];
}

// Walk mode types
export type AppMode = 'jam' | 'walk' | 'replay';

export interface WalkState {
  fromChord: string;
  toChord: string;
  /** Must-include constraints for the outbound path, plus the trip flags. */
  options: Partial<Record<EdgeType, boolean>> & {
    returnTrip: boolean;
    endless: boolean;
    /** In endless mode, pick a fresh random cycle preset each advance. */
    randomPattern?: boolean;
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
  /**
   * Rolling window of recently-visited tonic root pitch classes (endless mode),
   * most recent last. Lets auto-advance bias away from neighborhoods that were
   * just visited, and lets the home base recenter onto ground already reached
   * (instead of jumping to an unrelated chord).
   */
  recentTonics?: string[];
  /**
   * Mood/feel filter for endless-mode wandering. Restricts the random cycle-
   * preset pool to patterns matching the mood, and pins the tonic (home base)
   * to a quality that delivers it (major for happy, minor for melancholy).
   * 'any' is the unfiltered original behavior. See packages/theory-core/src/mood.ts.
   */
  mood?: WalkMood;
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
