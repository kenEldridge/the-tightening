import { contextBridge, ipcRenderer } from 'electron';
import log from 'electron-log';

// Expose safe APIs for renderer process communication
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // Log file access
  getLogPath: () => {
    return log.transports.file.getFile().path;
  },

  openLogFolder: () => {
    ipcRenderer.send('open-log-folder');
  }
});
