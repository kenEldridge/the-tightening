import { contextBridge, ipcRenderer } from 'electron';
import log from 'electron-log';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// CONSOLE CAPTURE - Write all console output to file for debugging
// ============================================
const rendererLog = log.scope('Renderer');

// Intercept all console methods and write to both file and original console
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug
};

(['log', 'info', 'warn', 'error', 'debug'] as const).forEach(method => {
  (console as any)[method] = (...args: any[]) => {
    // Format message
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Write to electron-log (goes to renderer.log)
    (rendererLog as any)[method](message);

    // Also call original console for DevTools
    originalConsole[method].apply(console, args);
  };
});

console.log('[Preload] Console capture initialized - all output will be logged to renderer.log');

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
