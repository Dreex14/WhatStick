'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poc', {
  openWa: () => ipcRenderer.invoke('open-wa'),
  status: () => ipcRenderer.invoke('status'),
  generate: (useVideo) => ipcRenderer.invoke('generate', useVideo),
  reveal: () => ipcRenderer.invoke('reveal'),
  send: (opts) => ipcRenderer.invoke('send', opts),
  blStart: () => ipcRenderer.invoke('bl-start'),
  blStatus: () => ipcRenderer.invoke('bl-status'),
  blLogout: () => ipcRenderer.invoke('bl-logout'),
});
