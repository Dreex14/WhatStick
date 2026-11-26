'use strict';
// Módulo de integración con WhatsApp Web (proceso principal de Electron).
// Abre WhatsApp Web en una ventana propia con una sesión persistente y separada
// (se vincula una vez con el QR, como cualquier dispositivo). La aplicación nunca lee
// esa sesión: los datos los guarda Chromium en su perfil local, igual que un navegador.
// Si WhatsApp cambia y esto deja de funcionar, el resto de la aplicación sigue funcionando.
const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, session, shell } = require('electron');

const URL = 'https://web.whatsapp.com/';
const PARTITION = 'persist:whatsapp';
const ADAPTER = fs.readFileSync(path.join(__dirname, 'adapter.js'), 'utf8');

let win = null;

function chromeUserAgent(ua) {
  // WhatsApp Web solo admite navegadores conocidos: se presenta como el Chrome equivalente.
  return ua.replace(/\s(Electron|whatstick)\/\S+/gi, '');
}

function open({ show = true } = {}) {
  if (win && !win.isDestroyed()) { if (show) win.show(); return win; }
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(chromeUserAgent(ses.getUserAgent()));
  // Solo se conceden los permisos que WhatsApp Web usa normalmente.
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(['notifications', 'clipboard-sanitized-write', 'media'].includes(perm)));
  win = new BrowserWindow({
    width: 1100, height: 800, show, title: 'WhatsApp Web · WhatStick',
    autoHideMenuBar: true, backgroundColor: '#111b21',
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(URL)) e.preventDefault(); });
  win.on('close', (e) => { e.preventDefault(); win.hide(); }); // se mantiene vinculada en segundo plano
  win.loadURL(URL);
  return win;
}

async function exec(code) {
  const w = open({ show: false });
  if (w.webContents.isLoading()) await new Promise((r) => w.webContents.once('did-finish-load', r));
  await w.webContents.executeJavaScript(ADAPTER, true);
  return w.webContents.executeJavaScript(code, true);
}

const status = () => exec('window.__whatstick.status()').catch((e) => ({ ready: false, reason: e.message }));
const selfChatLabel = () => exec('window.__whatstick.selfChatLabel()');
const recentSelf = (n) => exec(`window.__whatstick.recentSelf(${Number(n) || 8})`);

// job: { webp: Buffer, ogg?: Buffer, seconds?, animated, target?, allowLocalSoundFlag? }
function send(job) {
  const payload = {
    webp: job.webp.toString('base64'),
    ogg: job.ogg ? job.ogg.toString('base64') : null,
    seconds: job.seconds || 0,
    animated: !!job.animated,
    target: job.target || 'self',
    allowLocalSoundFlag: !!job.allowLocalSoundFlag,
    emojis: job.emojis || [],
  };
  return exec(`window.__whatstick.send(${JSON.stringify(payload)})`);
}

function destroy() { if (win && !win.isDestroyed()) { win.removeAllListeners('close'); win.destroy(); } win = null; }

module.exports = { open, status, send, selfChatLabel, recentSelf, destroy };
