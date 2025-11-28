import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { initializeLogger, loggers } from '../utils/logger';
import log from 'electron-log';

// Create require for CommonJS modules (midi is a native addon)
const require = createRequire(import.meta.url);
// @ts-ignore - midi package has no types
const midi = require('midi');

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize logging FIRST
initializeLogger();
loggers.main.info('The Tightening starting...', {
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Note: electron-squirrel-startup not installed for Phase 0
// if (require('electron-squirrel-startup')) {
//   app.quit();
// }

let mainWindow: BrowserWindow | null = null;
let midiInput: any = null;

// Initialize MIDI in main process
const initializeMidi = () => {
  try {
    midiInput = new midi.Input();
    const portCount = midiInput.getPortCount();

    loggers.main.info('MIDI initialization', { portCount });

    if (portCount === 0) {
      loggers.main.warn('No MIDI devices found');
      mainWindow?.webContents.send('midi-status', { connected: false, message: 'No MIDI devices found' });
      return;
    }

    // List all ports
    for (let i = 0; i < portCount; i++) {
      loggers.main.info('MIDI port found', { index: i, name: midiInput.getPortName(i) });
    }

    // Open the first port
    const portName = midiInput.getPortName(0);
    midiInput.openPort(0);
    loggers.main.info('MIDI port opened', { name: portName });

    // Send status to renderer
    mainWindow?.webContents.send('midi-status', { connected: true, message: `Connected: ${portName}` });

    // Handle MIDI messages
    midiInput.on('message', (_deltaTime: number, message: number[]) => {
      const [status, data1, data2] = message;

      // Note On (0x90-0x9F) with velocity > 0
      if (status >= 0x90 && status <= 0x9F && data2 > 0) {
        const channel = (status & 0x0F) + 1;
        loggers.main.debug('MIDI Note ON', { midi: data1, velocity: data2, channel });
        mainWindow?.webContents.send('midi-note-on', {
          note: data1,
          velocity: data2 / 127, // Normalize to 0-1
          channel
        });
      }
      // Note Off (0x80-0x8F) or Note On with velocity 0
      else if ((status >= 0x80 && status <= 0x8F) || (status >= 0x90 && status <= 0x9F && data2 === 0)) {
        loggers.main.debug('MIDI Note OFF', { midi: data1 });
        mainWindow?.webContents.send('midi-note-off', { note: data1 });
      }
    });

    loggers.main.info('MIDI event listener registered');
  } catch (err) {
    const error = err as Error;
    loggers.main.error('MIDI initialization failed', { error: error.message });
    mainWindow?.webContents.send('midi-status', { connected: false, message: `MIDI Error: ${error.message}` });
  }
};

// Cleanup MIDI on app quit
const cleanupMidi = () => {
  if (midiInput) {
    try {
      midiInput.closePort();
      loggers.main.info('MIDI port closed');
    } catch (err) {
      // Ignore cleanup errors
    }
  }
};

const createWindow = () => {
  loggers.main.info('Creating main window');

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // and load the index.html of the app.
  if (process.env.NODE_ENV !== 'production') {
    loggers.main.debug('Loading dev server', { url: 'http://localhost:5173' });
    mainWindow.loadURL('http://localhost:5173');
    // DevTools disabled - Claude reads logs from file instead
    // User can open manually with F12 if needed
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    loggers.main.debug('Loading production build', { path: indexPath });
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    loggers.main.info('Main window closed');
    mainWindow = null;
  });

  // Capture ALL console output from the renderer (web page context)
  const rendererLog = log.scope('Renderer');
  mainWindow.webContents.on('console-message', (_event, level, message, _line, _sourceId) => {
    // level: 0=debug, 1=info/log, 2=warning, 3=error
    const levelMap = ['debug', 'info', 'warn', 'error'] as const;
    const logLevel = levelMap[level] || 'info';
    (rendererLog as any)[logLevel](message);
  });

  loggers.main.info('Main window created successfully');

  // Initialize MIDI after window is ready to receive events
  mainWindow.webContents.on('did-finish-load', () => {
    loggers.main.info('Window finished loading, initializing MIDI');
    initializeMidi();
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  loggers.main.info('Electron app ready');
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    loggers.main.debug('App activated', {
      windowCount: BrowserWindow.getAllWindows().length
    });
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  loggers.main.info('All windows closed', { platform: process.platform });
  if (process.platform !== 'darwin') {
    loggers.main.info('Quitting application');
    cleanupMidi();
    app.quit();
  }
});

// Cleanup on quit
app.on('before-quit', () => {
  cleanupMidi();
});

// IPC handler for opening log folder
ipcMain.on('open-log-folder', () => {
  const logPath = log.transports.file.getFile().path;
  shell.showItemInFolder(logPath);
  loggers.main.info('Opened log folder', { path: logPath });
});

// IPC handler for renderer console logs - this is how we capture ALL renderer output!
const rendererLog = log.scope('Renderer');
ipcMain.on('renderer-log', (_event, { level, message }) => {
  // Map level to log method
  const logMethod = (rendererLog as any)[level] || rendererLog.info;
  logMethod.call(rendererLog, message);
});
