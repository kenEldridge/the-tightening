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
}

// Walk mode types
export type AppMode = 'home' | 'jam' | 'walk';

export interface WalkState {
  fromChord: string;
  toChord: string;
  options: {
    relative: boolean;
    iiVI: boolean;
    leadingTone: boolean;
  };
  /** Current path result (null if not yet computed or no path exists) */
  path: WalkPathResult | null;
  /** Index of the step the player is currently on (0 = first chord) */
  currentStep: number;
  /** Whether the full path has been completed */
  completed: boolean;
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
  onMenuSave: (callback: (filePath: string) => void) => void;
  fileWrite: (filePath: string, data: string) => void;
  removeMenuListeners: () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
