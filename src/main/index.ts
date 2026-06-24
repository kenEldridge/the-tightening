import { app, BrowserWindow, Menu, dialog, ipcMain, session } from 'electron';
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
            if (currentFilePath) {
              mainWindow?.webContents.send('menu-save', currentFilePath, false);
            } else {
              // No file yet — do Save As
              doSaveAs();
            }
          },
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            doSaveAs();
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

async function doSaveAs() {
  if (!mainWindow) return;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Chord Walk File',
    defaultPath: currentFilePath || 'untitled.cwalk.json',
    filters: [
      { name: 'Chord Walk', extensions: ['json'] },
    ],
  });
  if (result.canceled || !result.filePath) return;
  currentFilePath = result.filePath;
  updateTitle();
  mainWindow.webContents.send('menu-save', currentFilePath, true);
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

// IPC handler: renderer sends file data to write
ipcMain.on('file-write', (_event, filePath: string, data: string) => {
  try {
    fs.writeFileSync(filePath, data, 'utf-8');
    console.log('[Main] File saved:', filePath);
  } catch (err) {
    dialog.showErrorBox('Save Failed', `Could not write file:\n${(err as Error).message}`);
  }
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

  if (process.env.NODE_ENV !== 'production') {
    const url = 'http://localhost:5174';
    console.log('[Main] Loading dev server:', url);
    mainWindow.loadURL(url);
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
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
