import { app, BrowserWindow, shell, nativeImage } from 'electron';
import path from 'path';
import { initDatabase } from './db/connection';
import { registerThemeHandlers } from './ipc/themes';
import { registerFileHandlers } from './ipc/files';
import { registerSystemHandlers } from './ipc/system';
import { registerInstallHandlers } from './ipc/installer';
import { loadBuiltinThemes } from './services/builtin-themes';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// This is only needed for Windows, skip on macOS
if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (require('electron-squirrel-startup')) {
      app.quit();
    }
  } catch {
    // Module not installed, ignore
  }
}

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow(): void {
  // Get icon path
  const iconPath = isDev
    ? path.join(app.getAppPath(), 'resources/icons/icon.png')
    : path.join(process.resourcesPath, 'icon.icns');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#1a1625',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for better-sqlite3
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize app
app.whenReady().then(async () => {
  // Set app name
  app.setName('ShellShade');

  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = isDev
      ? path.join(app.getAppPath(), 'resources/icons/icon.png')
      : path.join(process.resourcesPath, 'icon.icns');
    try {
      const icon = nativeImage.createFromPath(dockIconPath);
      if (!icon.isEmpty()) {
        app.dock.setIcon(icon);
      }
    } catch {
      // Dock icon not critical, ignore errors
    }
  }

  // Initialize database
  await initDatabase();

  // Load builtin themes on first run
  await loadBuiltinThemes();

  // Register IPC handlers
  registerThemeHandlers();
  registerFileHandlers();
  registerSystemHandlers();
  registerInstallHandlers();

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

// Security: Prevent new window creation
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost:5173') && !url.startsWith('file://')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});
