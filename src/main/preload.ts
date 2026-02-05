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
  },

  // ============================================
  // YouTube Extraction API
  // ============================================

  // Get video info without downloading
  youtubeGetInfo: (url: string) => ipcRenderer.invoke('youtube-get-info', url),

  // Extract audio from YouTube URL
  youtubeExtractAudio: (url: string) => ipcRenderer.invoke('youtube-extract-audio', url),

  // Listen for extraction progress updates
  onYoutubeProgress: (callback: (progress: any) => void) => {
    ipcRenderer.on('youtube-extraction-progress', (_event, progress) => callback(progress));
  },

  // Remove YouTube progress listener
  removeYoutubeProgressListener: () => {
    ipcRenderer.removeAllListeners('youtube-extraction-progress');
  },

  // Get output directory for extracted audio
  youtubeGetOutputDir: () => ipcRenderer.invoke('youtube-get-output-dir'),

  // Clean up old extracted files
  youtubeCleanup: (maxAgeHours?: number) => ipcRenderer.invoke('youtube-cleanup', maxAgeHours),

  // ============================================
  // Analysis Cache API
  // ============================================

  // Save analysis results to cache
  analysisCacheSave: (videoId: string, data: any) => ipcRenderer.invoke('analysis-cache-save', videoId, data),

  // Load analysis results from cache
  analysisCacheLoad: (videoId: string) => ipcRenderer.invoke('analysis-cache-load', videoId),

  // Check if analysis cache exists
  analysisCacheExists: (videoId: string) => ipcRenderer.invoke('analysis-cache-exists', videoId),

  // Read audio file as base64 (bypasses file:// security restriction)
  readAudioFile: (filePath: string) => ipcRenderer.invoke('read-audio-file', filePath),

  // ============================================
  // Video & Frame Extraction API
  // ============================================

  // Download video file (for frame extraction)
  youtubeDownloadVideo: (url: string) => ipcRenderer.invoke('youtube-download-video', url),

  // Extract frames from video at specific timestamps
  extractFrames: (videoPath: string, timestamps: number[]) => ipcRenderer.invoke('extract-frames', videoPath, timestamps),

  // Get video path if already downloaded
  getVideoPath: (url: string) => ipcRenderer.invoke('get-video-path', url),

  // Read image file as base64 data URL
  readImageFile: (filePath: string) => ipcRenderer.invoke('read-image-file', filePath),
});

originalConsole.log('[Preload] MIDI bridge initialized');
originalConsole.log('[Preload] YouTube extraction bridge initialized');
originalConsole.log('[Preload] Analysis cache bridge initialized');
