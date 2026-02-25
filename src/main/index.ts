import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { initializeLogger, loggers } from '../utils/logger';
import log from 'electron-log';
import { getYouTubeExtractor, type ExtractionProgress } from './YouTubeExtractor';
import {
  createProject,
  loadProject,
  listProjects,
  setProjectAudioPath,
  saveProjectTimeline,
  deleteProject,
} from './projectStorage';
import { classifyError } from './extractionErrors';

// Create require for CommonJS modules (midi is a native addon)
const require = createRequire(import.meta.url);

// Try to load midi module - it's optional (may fail if native module version mismatch)
let midi: any = null;
try {
  midi = require('midi');
} catch (err) {
  console.warn('[Main] MIDI module failed to load - MIDI input disabled:', (err as Error).message);
}

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
  if (!midi) {
    loggers.main.warn('MIDI module not available - using microphone input instead');
    mainWindow?.webContents.send('midi-status', { connected: false, message: 'MIDI unavailable - use microphone' });
    return;
  }

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
    const testMode = process.env.TEST_MODE;
    const url = testMode ? `http://localhost:5173/?test=${testMode}` : 'http://localhost:5173';
    loggers.main.debug('Loading dev server', { url, testMode });
    mainWindow.loadURL(url);
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

// ============================================
// YouTube Extraction IPC Handlers
// ============================================

// Get video info without downloading
ipcMain.handle('youtube-get-info', async (_event, url: string) => {
  const extractor = getYouTubeExtractor();
  return await extractor.getVideoInfo(url);
});

// Extract audio from YouTube URL
ipcMain.handle('youtube-extract-audio', async (event, url: string) => {
  const extractor = getYouTubeExtractor();

  const result = await extractor.extractAudio(url, (progress: ExtractionProgress) => {
    // Send progress updates to renderer
    event.sender.send('youtube-extraction-progress', progress);
  });

  return result;
});

// Get the extracted audio directory (for loading files)
ipcMain.handle('youtube-get-output-dir', () => {
  const extractor = getYouTubeExtractor();
  return extractor.getOutputDir();
});

// Clean up old extracted files
ipcMain.handle('youtube-cleanup', async (_event, maxAgeHours: number = 24) => {
  const extractor = getYouTubeExtractor();
  extractor.cleanupOldFiles(maxAgeHours);
  return true;
});

// ============================================
// Analysis Cache IPC Handlers
// ============================================

// Save analysis results to cache
ipcMain.handle('analysis-cache-save', async (_event, videoId: string, data: any) => {
  try {
    const extractor = getYouTubeExtractor();
    const cacheDir = path.join(extractor.getOutputDir(), 'cache');

    // Ensure cache directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const cachePath = path.join(cacheDir, `${videoId}.json`);
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));

    loggers.main.info('[AnalysisCache] Saved', { videoId, path: cachePath });
    return true;
  } catch (err) {
    const error = err as Error;
    loggers.main.error('[AnalysisCache] Save failed', { videoId, error: error.message });
    return false;
  }
});

// Load analysis results from cache
ipcMain.handle('analysis-cache-load', async (_event, videoId: string) => {
  try {
    const extractor = getYouTubeExtractor();
    const cachePath = path.join(extractor.getOutputDir(), 'cache', `${videoId}.json`);

    if (!fs.existsSync(cachePath)) {
      loggers.main.debug('[AnalysisCache] Cache miss', { videoId });
      return null;
    }

    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    loggers.main.info('[AnalysisCache] Cache hit', { videoId, noteCount: data.notes?.length });
    return data;
  } catch (err) {
    const error = err as Error;
    loggers.main.error('[AnalysisCache] Load failed', { videoId, error: error.message });
    return null;
  }
});

// Check if analysis cache exists
ipcMain.handle('analysis-cache-exists', async (_event, videoId: string) => {
  const extractor = getYouTubeExtractor();
  const cachePath = path.join(extractor.getOutputDir(), 'cache', `${videoId}.json`);
  return fs.existsSync(cachePath);
});

// Read audio file and return as base64 (for renderer to use with Web Audio API)
ipcMain.handle('read-audio-file', async (_event, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) {
      loggers.main.error('[ReadAudioFile] File not found', { filePath });
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    loggers.main.info('[ReadAudioFile] File read', { filePath, size: buffer.length });
    return base64;
  } catch (err) {
    const error = err as Error;
    loggers.main.error('[ReadAudioFile] Failed', { filePath, error: error.message });
    return null;
  }
});

// ============================================
// Video & Frame Extraction IPC Handlers
// ============================================

// Download video file (for frame extraction)
ipcMain.handle('youtube-download-video', async (event, url: string) => {
  const extractor = getYouTubeExtractor();
  return await extractor.downloadVideo(url, (progress) => {
    event.sender.send('youtube-extraction-progress', progress);
  });
});

// Extract frames from video at specific timestamps
ipcMain.handle('extract-frames', async (_event, videoPath: string, timestamps: number[]) => {
  const extractor = getYouTubeExtractor();
  return await extractor.extractFrames(videoPath, timestamps);
});

// Get video path if already downloaded
ipcMain.handle('get-video-path', async (_event, url: string) => {
  const extractor = getYouTubeExtractor();
  return extractor.getVideoPath(url);
});

// ============================================
// Debug Screenshot IPC Handler
// ============================================

let screenshotCounter = 0;
const screenshotDir = path.join(app.getPath('userData'), '..', '..', '..', 'projects', 'the-tightening', 'visuals_for_claude', 'captures');

ipcMain.handle('debug-screenshot', async (_event, label?: string) => {
  try {
    // Ensure directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // Capture the window
    if (!mainWindow) return null;

    const image = await mainWindow.webContents.capturePage();
    const filename = `capture_${screenshotCounter.toString().padStart(4, '0')}_${label || 'frame'}.png`;
    const filepath = path.join(screenshotDir, filename);

    fs.writeFileSync(filepath, image.toPNG());
    screenshotCounter++;

    loggers.main.info('[Screenshot] Captured', { filename, label });
    return filepath;
  } catch (err) {
    loggers.main.error('[Screenshot] Failed', { error: (err as Error).message });
    return null;
  }
});

// Reset screenshot counter
ipcMain.handle('debug-screenshot-reset', async () => {
  screenshotCounter = 0;
  // Clear old captures
  if (fs.existsSync(screenshotDir)) {
    const files = fs.readdirSync(screenshotDir);
    for (const file of files) {
      if (file.endsWith('.png')) {
        fs.unlinkSync(path.join(screenshotDir, file));
      }
    }
  }
  loggers.main.info('[Screenshot] Reset counter and cleared old captures');
  return true;
});

// Read image file as base64 (for displaying frames)
ipcMain.handle('read-image-file', async (_event, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    return null;
  }
});

// ============================================
// Project Storage IPC Handlers (Rhythm Core)
// ============================================

ipcMain.handle('project-create-lite', async (_event, input: {
  name: string;
  sourceType: 'youtube' | 'local_file';
  sourceUri: string;
  sourceTitle: string;
  sourceDuration?: number;
}) => {
  try {
    return { ok: true, project: createProject(input) };
  } catch (err) {
    return { ok: false, error: classifyError(err as Error) };
  }
});

ipcMain.handle('project-load-lite', async (_event, projectId: string) => {
  const project = loadProject(projectId);
  if (!project) {
    return { ok: false, error: { code: 'file_not_found', message: 'Project not found', recoverable: false } };
  }
  return { ok: true, project };
});

ipcMain.handle('project-list', async () => {
  return listProjects();
});

ipcMain.handle('project-delete', async (_event, projectId: string) => {
  return deleteProject(projectId);
});

ipcMain.handle('project-save-timeline', async (_event, projectId: string, timeline: any) => {
  return saveProjectTimeline(projectId, timeline);
});

// ============================================
// Local Media Import IPC Handler
// ============================================

ipcMain.handle('project-import-local-media', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Import Audio or Video File',
      filters: [
        { name: 'Audio/Video', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'mp4', 'mkv', 'webm', 'avi'] },
        { name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'ogg', 'm4a'] },
        { name: 'Video', extensions: ['mp4', 'mkv', 'webm', 'avi'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    return {
      ok: true,
      filePath,
      fileName,
      isVideo: ['.mp4', '.mkv', '.webm', '.avi'].includes(ext),
    };
  } catch (err) {
    return { ok: false, error: classifyError(err as Error) };
  }
});

// ============================================
// Audio Normalization IPC Handler
// ============================================

ipcMain.handle('normalize-audio-to-wav', async (_event, inputPath: string, projectId: string) => {
  try {
    const outputDir = path.join(app.getPath('userData'), 'rhythm-projects', 'audio');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${projectId}.wav`);

    // Skip if already normalized
    if (fs.existsSync(outputPath)) {
      loggers.main.info('[Normalize] Using cached normalized audio', { outputPath });
      setProjectAudioPath(projectId, outputPath);
      return { ok: true, audioPath: outputPath };
    }

    // Use ffmpeg to normalize to mono 44100Hz 16-bit WAV
    const cmd = `ffmpeg -i "${inputPath}" -ac 1 -ar 44100 -sample_fmt s16 "${outputPath}" -y`;
    loggers.main.info('[Normalize] Running ffmpeg', { inputPath, outputPath });
    execSync(cmd, { stdio: 'pipe', timeout: 120000 });

    if (!fs.existsSync(outputPath)) {
      return { ok: false, error: classifyError(new Error('ffmpeg produced no output')) };
    }

    setProjectAudioPath(projectId, outputPath);
    loggers.main.info('[Normalize] Audio normalized', {
      outputPath,
      size: fs.statSync(outputPath).size,
    });

    return { ok: true, audioPath: outputPath };
  } catch (err) {
    const error = err as Error;
    loggers.main.error('[Normalize] Failed', { error: error.message });
    return { ok: false, error: classifyError(error) };
  }
});

ipcMain.handle('project-set-audio-path', async (_event, projectId: string, audioPath: string) => {
  return setProjectAudioPath(projectId, audioPath);
});
