import { contextBridge, ipcRenderer } from 'electron';

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

  // Cleanup
  removeMenuListeners: () => {
    ipcRenderer.removeAllListeners('menu-new');
    ipcRenderer.removeAllListeners('menu-open');
    ipcRenderer.removeAllListeners('menu-save');
  },
});
