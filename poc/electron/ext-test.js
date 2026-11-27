'use strict';
// Banco de pruebas de la extensión: abre WhatsApp Web y le inyecta los mismos archivos que la
// extensión (extension/wa.js y extension/panel.js) en el contexto de la página.
// Uso: npx electron poc/electron/ext-test.js --remote-debugging-port=9334
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, session } = require('electron');

const EXT = path.join(__dirname, '..', '..', 'extension');
app.setPath('userData', path.join(app.getPath('appData'), 'WhatStick-prueba-extension'));

app.whenReady().then(() => {
  const ses = session.fromPartition('persist:wa-ext');
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|whatstick)\/\S+/gi, ''));
  const win = new BrowserWindow({ width: 1200, height: 860, title: 'Prueba de la extensión · WhatsApp Web', autoHideMenuBar: true,
    webPreferences: { partition: 'persist:wa-ext', contextIsolation: true, sandbox: true } });
  const inject = () => {
    for (const f of ['wa.js', 'panel.js']) win.webContents.executeJavaScript(fs.readFileSync(path.join(EXT, f), 'utf8'), true).catch(() => {});
  };
  win.webContents.on('did-finish-load', () => setTimeout(inject, 1500));
  win.loadURL('https://web.whatsapp.com/');
});
app.on('window-all-closed', () => app.quit());
