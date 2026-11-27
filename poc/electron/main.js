'use strict';
// Fase 1: banco de pruebas de envío. Uso: npm run poc
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const wa = require('../alternativa-whatsapp-web');
const bl = require('../../integration/whatsapp/baileys');
bl.configure({ cipher: { encrypt: (s) => Buffer.from(s), decrypt: (b) => b.toString() } }); // prueba de concepto: sin cifrar

const OUT = path.join(__dirname, '..', 'out');
const LOG = path.join(OUT, 'registro-pruebas.json');
let panel;

function log(entry) {
  const all = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  all.push({ fecha: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG, JSON.stringify(all, null, 2));
}

const generate = (src) => require('../generate').generate(src);

ipcMain.handle('open-wa', () => { wa.open({ show: true }); return true; });
ipcMain.handle('status', () => wa.status());
ipcMain.handle('bl-start', () => bl.start(path.join(app.getPath('userData'), 'dispositivo-vinculado')));
ipcMain.handle('bl-status', () => bl.status());
ipcMain.handle('bl-logout', () => bl.stop({ logout: true }).then(() => 'Dispositivo desvinculado y sesión local borrada'));
ipcMain.handle('generate', async (e, useVideo) => {
  let src = null;
  if (useVideo) {
    const r = await dialog.showOpenDialog(panel, { properties: ['openFile'], filters: [{ name: 'Vídeo', extensions: ['mp4', 'mkv', 'mov', 'webm', 'gif'] }] });
    if (r.canceled) return null;
    src = r.filePaths[0];
  }
  return generate(src);
});
ipcMain.handle('reveal', () => shell.openPath(OUT));

ipcMain.handle('send', async (e, { kind, allowLocalSoundFlag, via, wrapped }) => {
  const viaB = via === 'baileys';
  const st = viaB ? bl.status() : await wa.status();
  if (!st.ready) return { ok: false, error: st.reason || st.error || 'No conectado' };
  const files = { static: 'estatico.webp', animated: 'animado.webp', sound: 'sonido.webp' };
  const webp = fs.readFileSync(path.join(OUT, files[kind]));
  const ogg = kind === 'sound' ? fs.readFileSync(path.join(OUT, 'sonido.ogg')) : null;
  const label = viaB ? st.chat : await wa.selfChatLabel().catch(() => 'tu chat personal');
  const names = { static: 'estático', animated: 'animado', sound: 'con sonido' };
  const ok = await dialog.showMessageBox(panel, {
    type: 'question', buttons: ['Enviar', 'Cancelar'], defaultId: 0, cancelId: 1,
    title: 'Confirmar envío', message: `¿Enviar el sticker ${names[kind]} a tu chat personal?`,
    detail: `Destino: ${label} (el chat contigo mismo). Vía: ${viaB ? 'dispositivo vinculado (Baileys)' : 'WhatsApp Web integrado'}.`,
  });
  if (ok.response !== 0) return { ok: false, error: 'Envío cancelado' };
  const job = { webp, ogg, seconds: 4, animated: kind !== 'static', allowLocalSoundFlag, wrapped };
  const res = viaB ? await bl.send(job) : await wa.send(job);
  log({ prueba: kind, via: viaB ? 'baileys' : 'whatsapp-web', envoltorio134: viaB && kind === 'sound' ? wrapped !== false : null, resultado: res.ok ? 'enviado' : 'error', error: res.error || null, conAudio: res.withAudio || false,
    mensajeConAudio: res.msgHasAudio ?? null, waVersion: st.waVersion || null, sonido: st.sound || null, modulos: st.modules || null });
  return res;
});

app.whenReady().then(() => {
  panel = new BrowserWindow({
    width: 520, height: 640, title: 'WhatStick · Prueba de concepto', autoHideMenuBar: true, backgroundColor: '#121418',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  panel.loadFile(path.join(__dirname, 'panel.html'));
  panel.on('closed', () => { wa.destroy(); bl.stop().finally(() => app.quit()); });
});
app.on('window-all-closed', () => app.quit());
