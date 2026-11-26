'use strict';
// Fase 1: prueba automática de envío por las dos vías, con verificación en WhatsApp Web.
// Uso: npx electron poc/electron/auto-test.js
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const wa = require('../alternativa-whatsapp-web');
const bl = require('../../integration/whatsapp/baileys');

const OUT = path.join(__dirname, '..', 'out');
const RES = path.join(OUT, 'auto-test.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const say = (m) => console.log(`[${new Date().toLocaleTimeString('es-ES')}] ${m}`);
let qrWin;
const SOLO_B = process.argv.includes('--solo-b');

function showQr(dataUrl, text) {
  const html = `<body style="margin:0;background:#121418;color:#e6e8eb;font:15px Segoe UI;text-align:center;padding:18px">
    <h3 style="margin:4px">WhatStick · Prueba automática</h3><p>${text}</p>
    ${dataUrl ? `<img src="${dataUrl}" style="background:#fff;border-radius:8px">` : ''}</body>`;
  qrWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

async function waitFor(fn, ms, every = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn().catch(() => null); if (v) return v; await sleep(every); }
  return null;
}

async function lastSelf() {
  const r = await wa.recentSelf(1).catch((e) => [{ error: e.message }]);
  return r[r.length - 1] || null;
}

async function test(via, kind, opts = {}) {
  const files = { static: 'estatico.webp', animated: 'animado.webp', sound: 'sonido.webp' };
  const job = {
    webp: fs.readFileSync(path.join(OUT, files[kind])),
    ogg: kind === 'sound' ? fs.readFileSync(path.join(OUT, 'sonido.ogg')) : null,
    seconds: 4, animated: kind !== 'static', ...opts,
  };
  const before = SOLO_B ? null : await lastSelf();
  const res = via === 'B' ? await bl.send(job) : await wa.send(job);
  // Esperar a que el mensaje aparezca en WhatsApp Web (cliente oficial) y ver cómo lo interpreta.
  const seen = res.ok && !SOLO_B ? await waitFor(async () => {
    const m = await lastSelf();
    return m && (!before || m.t !== before.t || m.size !== before.size) && m.type ? m : null;
  }, 30000) : null;
  const r = { via, kind, opts, enviado: res.ok, error: res.error || null, recibidoEnWeb: seen };
  results.push(r);
  fs.writeFileSync(RES, JSON.stringify(results, null, 2));
  say(`${via} ${kind} ${JSON.stringify(opts)} → ${res.ok ? 'enviado' : 'ERROR ' + res.error}; en WhatsApp Web: ${seen ? `${seen.type}, animado=${seen.isAnimated}, audio=${seen.stickerAudio}` : 'no visto'}`);
  await sleep(4000);
}

app.on('window-all-closed', () => { /* seguir hasta terminar la prueba */ });
process.on('unhandledRejection', (e) => say('Error no controlado: ' + (e && e.stack || e)));
app.whenReady().then(async () => {
  qrWin = new BrowserWindow({ width: 420, height: 480, title: 'WhatStick · Vincular', autoHideMenuBar: true, backgroundColor: '#121418', alwaysOnTop: true });
  showQr(null, 'Iniciando…');
  if (!SOLO_B) wa.open({ show: true });
  await bl.start(path.join(app.getPath('userData'), 'dispositivo-vinculado'));
  say('Esperando vinculación (escanea los dos QR: este y el de la ventana de WhatsApp Web)…');

  const both = await waitFor(async () => {
    const b = bl.status();
    const w = SOLO_B ? { ready: true } : await wa.status();
    if (!b.ready) showQr(b.qr, `1) Escanea este QR (dispositivo Baileys).<br>${w.ready ? '✅ WhatsApp Web ya vinculado' : '2) Escanea también el de la ventana de WhatsApp Web.'}`);
    else showQr(null, `✅ Baileys vinculado.<br>${w.ready ? '✅ WhatsApp Web vinculado. Empezando…' : 'Falta escanear el QR de la ventana de WhatsApp Web.'}`);
    return b.ready && w.ready ? { b, w } : null;
  }, 10 * 60 * 1000, 2500);
  if (!both) { say('Tiempo agotado sin vincular.'); return finish(); }
  say(`Vinculado. WhatsApp Web ${both.w.waVersion}; stickers con sonido en la cuenta: ${JSON.stringify(both.w.sound)}`);
  results.push({ estado: { waVersion: both.w.waVersion, sonido: both.w.sound, modulos: both.w.modules } });
  await sleep(SOLO_B ? 5000 : 15000); // sincronización inicial

  await test('B', 'static');
  await test('B', 'animated');
  await test('B', 'sound', { wrapped: true });
  if (!SOLO_B) await test('B', 'sound', { wrapped: false });
  if (SOLO_B) { say('Fin de la prueba (solo vía B).'); return finish(); }
  await test('A', 'static');
  await test('A', 'animated');
  await test('A', 'sound');
  if (results[results.length - 1].error) await test('A', 'sound', { allowLocalSoundFlag: true });
  say('Fin de la prueba.');
  finish();
});

async function finish() {
  fs.writeFileSync(RES, JSON.stringify(results, null, 2));
  await bl.stop(); // se mantiene vinculado para pruebas posteriores
  wa.destroy();
  app.quit();
}
