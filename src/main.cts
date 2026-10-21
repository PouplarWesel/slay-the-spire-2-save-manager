import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { Store } from './store.cjs';
import { SteamCloud } from './steam-cloud.cjs';
let win: BrowserWindow;
let store: Store;
if (process.env.SPIREKEEPER_DATA_DIR) {
  const isolatedData = path.join(process.env.SPIREKEEPER_DATA_DIR, 'electron-data');
  fs.mkdirSync(isolatedData, { recursive: true });
  app.setPath('userData', isolatedData);
}

function running() {
  try {
    return Boolean(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-Process | Where-Object { $_.ProcessName -match "^(sts2|SlayTheSpire2)$" } | Select-Object -ExpandProperty ProcessName',
        ],
        { windowsHide: true, timeout: 8000, encoding: 'utf8' },
      ).trim(),
    );
  } catch {
    throw new Error('Cannot check whether the game is running. Try refreshing.');
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(() => {
      store = new Store({
        dataDir:
          process.env.SPIREKEEPER_DATA_DIR || path.join(app.getPath('appData'), 'Spirekeeper'),
        saveRoot:
          process.env.SPIREKEEPER_SAVE_ROOT ||
          path.join(app.getPath('appData'), 'SlayTheSpire2', 'steam'),
        isGameRunning: running,
        cloud: new SteamCloud(),
      });
      ipcMain.handle('spire:call', async (event, action, payload) => {
        try {
          if (event.sender !== win.webContents || !event.senderFrame.url.startsWith('file:'))
            throw new Error('Untrusted request.');
          store.refresh();
          switch (action) {
            case 'state':
              return { ok: true, state: store.state() };
            case 'configure':
              return { ok: true, state: store.configure(payload) };
            case 'browse': {
              const r = await dialog.showOpenDialog(win, {
                title: 'Choose your profile’s saves folder',
                properties: ['openDirectory'],
              });
              return {
                ok: true,
                state: r.canceled ? store.state() : store.configure(r.filePaths[0]),
              };
            }
            case 'import': {
              const r = await dialog.showOpenDialog(win, {
                title: 'Import a multiplayer save',
                properties: ['openFile'],
                filters: [{ name: 'Multiplayer saves', extensions: ['save', 'spire'] }],
              });
              return {
                ok: true,
                state: r.canceled ? store.state() : store.importFile(r.filePaths[0]),
              };
            }
            case 'export': {
              const s = store.slot(payload);
              const r = await dialog.showSaveDialog(win, {
                defaultPath: s.name.replace(/[<>:"/\\|?*]/g, '_') + '.spire',
                filters: [{ name: 'Spirekeeper save', extensions: ['spire'] }],
              });
              return {
                ok: true,
                state: r.canceled ? store.state() : store.exportFile(payload, r.filePath),
              };
            }
            case 'openLibrary':
              await shell.openPath(store.dataDir);
              return { ok: true, state: store.state() };
            case 'openProfile':
              await shell.openPath(store.profile());
              return { ok: true, state: store.state() };
            case 'launch':
              await shell.openExternal('steam://rungameid/2868840');
              return { ok: true, state: store.state() };
            case 'capture':
            case 'updateSlot':
            case 'load':
            case 'unload':
            case 'restore':
            case 'recover':
            case 'edit':
            case 'remove':
            case 'resolveNames':
              return { ok: true, state: store[action](payload) };
            default:
              throw new Error('Unknown action.');
          }
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });
      win = new BrowserWindow({
        width: 960,
        height: 690,
        minWidth: 800,
        minHeight: 560,
        title: 'Slay the Spire 2 Save Manager',
        backgroundColor: '#f5f5f5',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('will-navigate', (e) => e.preventDefault());
      win.loadFile(path.join(__dirname, 'index.html'));
      win.once('ready-to-show', () => win.show());
    })
    .catch((e) => {
      dialog.showErrorBox('Spirekeeper could not start', e.message);
      app.quit();
    });
  app.on('window-all-closed', () => app.quit());
}
