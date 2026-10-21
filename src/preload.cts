const { contextBridge, ipcRenderer } = require('electron');
import type { Action, DesktopApi } from './types.js';
const desktopApi: DesktopApi = {
  call: (action: Action, payload?: unknown) => ipcRenderer.invoke('spire:call', action, payload),
};

contextBridge.exposeInMainWorld('spire', desktopApi);
