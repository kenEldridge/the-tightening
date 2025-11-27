import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeLogger, loggers } from '../utils/logger';
import log from 'electron-log';

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

const createWindow = () => {
  loggers.main.info('Creating main window');

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // and load the index.html of the app.
  if (process.env.NODE_ENV !== 'production') {
    loggers.main.debug('Loading dev server', { url: 'http://localhost:5173' });
    mainWindow.loadURL('http://localhost:5173');
    // Open the DevTools in development.
    mainWindow.webContents.openDevTools();
    loggers.main.debug('Dev tools opened');
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    loggers.main.debug('Loading production build', { path: indexPath });
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    loggers.main.info('Main window closed');
    mainWindow = null;
  });

  loggers.main.info('Main window created successfully');
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
    app.quit();
  }
});

// IPC handler for opening log folder
ipcMain.on('open-log-folder', () => {
  const logPath = log.transports.file.getFile().path;
  shell.showItemInFolder(logPath);
  loggers.main.info('Opened log folder', { path: logPath });
});
