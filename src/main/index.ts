import { app, BrowserWindow, Menu, dialog, ipcMain, session, powerSaveBlocker } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let currentFilePath: string | null = null;

function updateTitle() {
  if (!mainWindow) return;
  const fileName = currentFilePath ? path.basename(currentFilePath) : 'Untitled';
  mainWindow.setTitle(`${fileName} — The Tightening`);
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            currentFilePath = null;
            updateTitle();
            mainWindow?.webContents.send('menu-new');
          },
        },
        { type: 'separator' },
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return;
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Open Chord Walk File',
              filters: [
                { name: 'Chord Walk', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] },
              ],
              properties: ['openFile'],
            });
            if (result.canceled || result.filePaths.length === 0) return;
            const filePath = result.filePaths[0];
            try {
              const data = fs.readFileSync(filePath, 'utf-8');
              const parsed = JSON.parse(data);
              currentFilePath = filePath;
              updateTitle();
              mainWindow?.webContents.send('menu-open', parsed);
            } catch (err) {
              dialog.showErrorBox('Open Failed', `Could not read file:\n${(err as Error).message}`);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            // Send the current file path (or '' if none yet) to the renderer.
            // The renderer owns the state and generates the smart default filename.
            mainWindow?.webContents.send('menu-save', currentFilePath ?? '', false);
          },
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            mainWindow?.webContents.send('menu-save', '', true);
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


ipcMain.handle('file-save-as', async (_event, defaultPath: string, data: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Chord Walk File',
    defaultPath,
    filters: [
      { name: 'Chord Walk', extensions: ['json'] },
    ],
  });
  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, data, 'utf-8');
    currentFilePath = result.filePath;
    updateTitle();
    console.log('[Main] File saved:', result.filePath);
    return result.filePath;
  } catch (err) {
    dialog.showErrorBox('Save Failed', `Could not write file:\n${(err as Error).message}`);
    return null;
  }
});

ipcMain.on('set-menu-bar-visible', (_event, visible: boolean) => {
  if (!mainWindow) return;
  mainWindow.setMenuBarVisibility(visible);
  mainWindow.autoHideMenuBar = !visible;
});

// Keep the system awake while MIDI is active; sleep again after 5 min of silence.
let _psbId: number | null = null;
let _psbTimer: ReturnType<typeof setTimeout> | null = null;
const MIDI_IDLE_MS = 5 * 60 * 1000;

ipcMain.on('midi-activity', () => {
  if (_psbId === null) {
    _psbId = powerSaveBlocker.start('prevent-display-sleep');
  }
  if (_psbTimer) clearTimeout(_psbTimer);
  _psbTimer = setTimeout(() => {
    if (_psbId !== null) {
      powerSaveBlocker.stop(_psbId);
      _psbId = null;
    }
    _psbTimer = null;
  }, MIDI_IDLE_MS);
});

// IPC handler: renderer sends file data to write
ipcMain.on('file-write', (_event, filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    console.log('[Main] File saved:', filePath);
  } catch (err) {
    dialog.showErrorBox('Save Failed', `Could not write file:\n${(err as Error).message}`);
  }
});

// ── Recording pipeline ──────────────────────────────────────────────────────

const activeWriteStreams = new Map<string, ReturnType<typeof fs.createWriteStream>>();

ipcMain.handle('request-recording-paths', async (_event, ts: string, saveDataJson: string) => {
  if (!mainWindow) return null;
  // Ask user to pick a parent folder; we create the recording sub-directory inside it.
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose folder to save recording',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const recordingDir = path.join(result.filePaths[0], `recording_${ts}`);
  fs.mkdirSync(recordingDir, { recursive: true });

  // Write the cwalk snapshot immediately — no IPC round-trip needed for JSON.
  fs.writeFileSync(path.join(recordingDir, 'recording.cwalk.json'), saveDataJson, 'utf-8');

  return {
    polishedPath: path.join(recordingDir, 'recording.wav'),
    midiPath:     path.join(recordingDir, 'recording.mid'),
  };
});

ipcMain.handle('open-write-stream', (_event, filePath: string) => {
  const ws = fs.createWriteStream(filePath + '.part');
  ws.on('error', err => console.error('[recording] write stream error:', filePath, err));
  activeWriteStreams.set(filePath, ws);
});

ipcMain.on('write-stream-chunk', (_event, filePath: string, chunk: Buffer) => {
  activeWriteStreams.get(filePath)?.write(chunk);
});

ipcMain.handle('close-write-stream', (_event, filePath: string) => {
  const ws = activeWriteStreams.get(filePath);
  if (!ws) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    ws.end(() => {
      activeWriteStreams.delete(filePath);
      try {
        fs.renameSync(filePath + '.part', filePath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

ipcMain.handle('save-midi', (_event, filePath: string, data: Buffer) => {
  fs.writeFileSync(filePath, data);
});

ipcMain.handle('read-file-binary', (_event, filePath: string) => {
  return fs.readFileSync(filePath);
});

ipcMain.handle('open-recording', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Recording',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const dir = result.filePaths[0];
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return null; }

  const find = (ext: string) => {
    const f = files.find(n => n.toLowerCase().endsWith(ext.toLowerCase()));
    return f ? path.join(dir, f) : null;
  };

  const audioPath = find('.wav') ?? find('.mp3') ?? find('.flac') ?? find('.ogg');
  if (!audioPath) return null;

  const midiPath   = find('.mid') ?? find('.midi');
  const cwalkPath  = find('.cwalk.json');
  const cwalkData  = cwalkPath ? fs.readFileSync(cwalkPath, 'utf-8') : null;

  return { audioPath, midiPath, cwalkData };
});

const createWindow = () => {
  console.log('[Main] Creating main window');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Untitled — The Tightening',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  buildMenu();

  if (!app.isPackaged) {
    const url = 'http://localhost:5174';
    console.log('[Main] Loading dev server:', url);
    mainWindow.loadURL(url);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    for (const ws of activeWriteStreams.values()) ws.destroy();
    activeWriteStreams.clear();
    console.log('[Main] Main window closed');
    mainWindow = null;
  });

  console.log('[Main] Main window created successfully');
};

app.whenReady().then(() => {
  console.log('[Main] Electron app ready');

  // Grant permission requests (mic/audio for line-in recording, MIDI, etc.).
  // Safe here: the window only ever loads our own trusted UI, no remote content.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
