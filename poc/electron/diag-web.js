'use strict';
// Diagnóstico de WhatsApp Web integrado: qué módulos internos existen (sin leer datos).
const { app } = require('electron');
const wa = require('../alternativa-whatsapp-web');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const w = wa.open({ show: true });
  await new Promise((r) => setTimeout(r, 45000));
  const d = await w.webContents.executeJavaScript(`(() => {
    const out = { require: typeof window.require, importNamespace: typeof window.importNamespace, requireLazy: typeof window.requireLazy, __d: typeof window.__d,
      panelChats: !!document.querySelector('#pane-side'), qr: !!document.querySelector('canvas[aria-label], [data-ref]') };
    try { const dbg = window.require('__debug'); const keys = Object.keys(dbg.modulesMap || {}); out.totalModulos = keys.length;
      out.coinciden = keys.filter(k => /ChatCollection|MediaPrep|MeUser|SoundSticker|UploadManager|OpaqueData|FindChat|SendMsgResult|MmsMediaTypes|UploadOrigin/.test(k)).slice(0, 60);
    } catch (e) { out.debugError = e.message; }
    return out; })()`, true);
  console.log('DIAG ' + JSON.stringify(d));
  console.log('STATUS ' + JSON.stringify(await wa.status()));
  wa.destroy(); app.quit();
});
