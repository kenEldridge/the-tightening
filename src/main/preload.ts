import { contextBridge, ipcRenderer } from 'electron';

// ============================================
// CONSOLE CAPTURE - Send all console output to main process via IPC
// ============================================

// Save original console methods
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

// Format args for logging
function formatArgs(args: any[]): string {
  return args.map(arg => {
    if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg, null, 2);
      } catch (e) {
        return String(arg);
      }
    }
    return String(arg);
  }).join(' ');
}

// Intercept all console methods
(['log', 'info', 'warn', 'error', 'debug'] as const).forEach(method => {
  (console as any)[method] = (...args: any[]) => {
    const message = formatArgs(args);

    // Send to main process via IPC for file logging
    try {
      ipcRenderer.send('renderer-log', { level: method, message });
    } catch (e) {
      // IPC might not be ready yet
    }

    // Also call original console for DevTools
    originalConsole[method](...args);
  };
});

originalConsole.log('[Preload] Console capture initialized - sending to main process via IPC');

// ============================================
// MIDI EVENT BRIDGE - Forward MIDI events from main process to renderer
// ============================================

type MidiNoteOnCallback = (data: { note: number; velocity: number; channel: number }) => void;
type MidiNoteOffCallback = (data: { note: number }) => void;
type MidiStatusCallback = (data: { connected: boolean; message: string }) => void;

// Expose safe APIs for renderer process communication
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // MIDI event listeners
  onMidiNoteOn: (callback: MidiNoteOnCallback) => {
    ipcRenderer.on('midi-note-on', (_event, data) => callback(data));
  },
  onMidiNoteOff: (callback: MidiNoteOffCallback) => {
    ipcRenderer.on('midi-note-off', (_event, data) => callback(data));
  },
  onMidiStatus: (callback: MidiStatusCallback) => {
    ipcRenderer.on('midi-status', (_event, data) => callback(data));
  },

  // Remove MIDI listeners (for cleanup)
  removeMidiListeners: () => {
    ipcRenderer.removeAllListeners('midi-note-on');
    ipcRenderer.removeAllListeners('midi-note-off');
    ipcRenderer.removeAllListeners('midi-status');
  }
});

originalConsole.log('[Preload] MIDI bridge initialized');
