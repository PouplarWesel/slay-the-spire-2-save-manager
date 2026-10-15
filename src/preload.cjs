const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spire', {
  call: (action, payload) => ipcRenderer.invoke('spire:call', action, payload),
});
