const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ── Configuration ────────────────────────────────────────────
const WEB_PORT = 8900;
const WEB_URL = `http://localhost:${WEB_PORT}`;
let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

// ── Backend Lifecycle ────────────────────────────────────────

function getBackendCommand() {
  // Packaged app: look for bundled PyInstaller binary
  if (app.isPackaged) {
    const binPath = path.join(process.resourcesPath, 'prism-backend', 'prism');
    if (fs.existsSync(binPath)) {
      return { cmd: binPath, args: [] };
    }
  }

  // Development: try `prism` from PATH first, then python -m prism
  const whichPrism = require('child_process').spawnSync('which', ['prism']);
  if (whichPrism.status === 0) {
    return { cmd: 'prism', args: ['start', '--no-open', '--web-port', String(WEB_PORT)] };
  }

  // Fallback: use python directly from the project
  const projectRoot = path.join(__dirname, '..');
  return {
    cmd: process.platform === 'win32' ? 'python' : 'python3',
    args: ['-m', 'prism.cli', 'start', '--no-open', '--web-port', String(WEB_PORT)],
    env: { PYTHONPATH: projectRoot },
  };
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const result = getBackendCommand();
    const { cmd, args } = result;
    console.log(`[prism] Starting backend: ${cmd} ${args.join(' ')}`);

    const spawnOpts = {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(result.env || {}), HDC_BIN: process.env.HDC_BIN || '' },
    };
    backendProcess = spawn(cmd, args, spawnOpts);

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) reject(new Error('Backend startup timed out'));
    }, 15000);

    const onOutput = (data) => {
      const text = data.toString();
      console.log(`[prism] ${text.trim()}`);
      if (!started && text.includes('Uvicorn running')) {
        started = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    backendProcess.stdout.on('data', onOutput);
    backendProcess.stderr.on('data', onOutput);

    backendProcess.on('error', (err) => {
      if (!started) {
        clearTimeout(timeout);
        reject(err);
      }
      console.error(`[prism:err] ${err.message}`);
    });

    backendProcess.on('exit', (code) => {
      console.log(`[prism] Backend exited with code ${code}`);
      backendProcess = null;
      if (!isQuitting) {
        // Unexpected exit — show dialog
        dialog.showErrorBox(
          'Backend Stopped',
          `Prism server exited unexpectedly (code ${code}). Check the logs or restart the app.`
        );
      }
    });
  });
}

function stopBackend() {
  return new Promise((resolve) => {
    if (!backendProcess) return resolve();
    console.log('[prism] Stopping backend...');
    backendProcess.on('exit', () => resolve());
    backendProcess.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill('SIGKILL');
        resolve();
      }
    }, 5000);
  });
}

// ── Window ────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 500,
    title: 'Prism HTTP Debugger',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(WEB_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
  });
}

// ── Tray ──────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Prism HTTP Debugger');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Prism',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ── App Lifecycle ─────────────────────────────────────────────

// ── Auto-update ──────────────────────────────────────────────
if (app.isPackaged) {
  autoUpdater.checkForUpdatesAndNotify();
}

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startBackend();
    createTray();
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      'Failed to Start',
      `Could not start the Prism backend:\n\n${err.message}\n\n` +
      'Make sure prism is installed and the Python environment is active.'
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
});

app.on('before-quit', async () => {
  isQuitting = true;
  await stopBackend();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});
