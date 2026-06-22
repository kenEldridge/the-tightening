import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
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
  mainWindow.setTitle(`${fileName} — Chord Walk`);
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
              mainWindow?.webContents.send('menu-save', currentFilePath);
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
  mainWindow.webContents.send('menu-save', currentFilePath);
}

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
    title: 'Untitled — Chord Walk',
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
