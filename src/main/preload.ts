import { contextBridge, ipcRenderer, webUtils } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Menu event listeners
  onMenuNew: (callback: () => void) => {
    ipcRenderer.on('menu-new', () => callback());
  },
  onMenuOpen: (callback: (data: any) => void) => {
    ipcRenderer.on('menu-open', (_event, data) => callback(data));
  },
  onMenuSave: (callback: (filePath: string, saveAs: boolean) => void) => {
    ipcRenderer.on('menu-save', (_event, filePath, saveAs) => callback(filePath, saveAs));
  },

  // Write file data (renderer → main)
  fileWrite: (filePath: string, data: string) => {
    ipcRenderer.send('file-write', filePath, data);
  },
  fileSaveAs: (defaultPath: string, data: string) => {
    return ipcRenderer.invoke('file-save-as', defaultPath, data);
  },

  // Tell the main process that MIDI activity occurred (prevents system sleep)
  midiActivity: () => {
    ipcRenderer.send('midi-activity');
  },

  // Show or hide the native menu bar
  setMenuBarVisible: (visible: boolean) => {
    ipcRenderer.send('set-menu-bar-visible', visible);
  },

  // Cleanup
  removeMenuListeners: () => {
    ipcRenderer.removeAllListeners('menu-new');
    ipcRenderer.removeAllListeners('menu-open');
    ipcRenderer.removeAllListeners('menu-save');
  },

  // ── Recording pipeline ──────────────────────────────────────────────────

  requestRecordingPaths: (ts: string, saveDataJson: string) =>
    ipcRenderer.invoke('request-recording-paths', ts, saveDataJson),

  openWriteStream: (filePath: string) =>
    ipcRenderer.invoke('open-write-stream', filePath),

  writeStreamChunk: (filePath: string, chunk: Uint8Array) =>
    ipcRenderer.send('write-stream-chunk', filePath, chunk),

  closeWriteStream: (filePath: string) =>
    ipcRenderer.invoke('close-write-stream', filePath),

  saveMidi: (filePath: string, data: Uint8Array) =>
    ipcRenderer.invoke('save-midi', filePath, data),

  // ── Replay ─────────────────────────────────────────────────────────────

  getFilePath: (file: File) =>
    webUtils.getPathForFile(file),

  readFileBinary: (filePath: string) =>
    ipcRenderer.invoke('read-file-binary', filePath),

  openRecording: () =>
    ipcRenderer.invoke('open-recording'),
});
