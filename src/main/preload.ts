import { contextBridge } from 'electron';

// Phase 0: No IPC needed, but preload must exist for security
// Future: Expose safe APIs here for renderer process communication

contextBridge.exposeInMainWorld('electronAPI', {
  // Placeholder for future APIs
  platform: process.platform
});
