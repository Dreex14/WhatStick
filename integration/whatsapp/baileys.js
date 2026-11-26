'use strict';
// Vía alternativa: WhatStick se vincula como dispositivo con Baileys (cliente no oficial
// del protocolo multidispositivo) y envía el mensaje directamente, sin WhatsApp Web.
// La sesión del dispositivo vinculado se guarda solo en esta carpeta local y se puede
// revocar desde el móvil (Dispositivos vinculados). No se lee ninguna otra sesión.
// Parche de protobuf basado en SonoSticker (MIT, github.com/ThatChip2000/SonoSticker).
const fs = require('node:fs');
const path = require('node:path');

let B = null; // módulo baileys (ESM, se importa bajo demanda)
let sock = null;
let state = { status: 'desconectado', qr: null, me: null, error: null };
let authDir = null;
let manualStop = false;
let starting = null;
let retries = 0;
const listeners = new Set();

/** fn(status) se llama en cada cambio de estado (QR nuevo, conectado, desconectado…). */
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(next) {
  state = next;
  for (const fn of listeners) { try { fn(status()); } catch (e) { /* ignorar */ } }
}
/** ¿Hay una sesión vinculada guardada en esa carpeta? */
function linked(dir) { return fs.existsSync(path.join(dir, 'creds.json')); }

async function lib() {
  if (!B) {
    B = await import('@whiskeysockets/baileys');
    patchProto(B.proto);
  }
  return B;
}

// Baileys aún no conoce StickerMessage.audioMessage (26) ni Message.audioStickerMessage (134).
function patchProto(proto) {
  const M = proto.Message;
  const SM = M.StickerMessage;
  if (M.__whatstick) return;
  const smEncode = SM.encode;
  SM.encode = function (m, w) {
    w = smEncode.call(this, m, w);
    if (m && m.audioMessage) M.AudioMessage.encode(m.audioMessage, w.uint32((26 << 3) | 2).fork()).ldelim();
    return w;
  };
  const mEncode = M.encode;
  M.encode = function (m, w) {
    w = mEncode.call(this, m, w);
    if (m && m.audioStickerMessage) M.FutureProofMessage.encode(m.audioStickerMessage, w.uint32((134 << 3) | 2).fork()).ldelim();
    return w;
  };
  M.__whatstick = true;
}

function start(dir) {
  if (sock && authDir === dir) return Promise.resolve(status());
  if (!starting) starting = connect(dir).finally(() => { starting = null; });
  return starting;
}

async function connect(dir) {
  authDir = dir;
  manualStop = false;
  const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser } = await lib();
  const QRCode = require('qrcode');
  const pino = require('pino');
  fs.mkdirSync(dir, { recursive: true });
  const { state: auth, saveCreds } = await useMultiFileAuthState(dir);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) { /* usa la incluida */ }
  setState({ status: 'conectando', qr: null, me: null, error: null });
  const s = makeWASocket({
    ...(version ? { version } : {}), auth, logger: pino({ level: 'silent' }),
    browser: ['WhatStick', 'Desktop', '1.0'], markOnlineOnConnect: false, syncFullHistory: false,
  });
  sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (sock !== s) return;
    if (qr) setState({ ...state, status: 'qr', qr: await QRCode.toDataURL(qr, { width: 280, margin: 2 }) });
    if (connection === 'open') {
      retries = 0;
      setState({ status: 'conectado', qr: null, error: null,
        me: { jid: jidNormalizedUser(s.user.id), name: s.user.name || 'Tú' } });
    }
    if (connection === 'close') {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      sock = null;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync(dir, { recursive: true, force: true });
        setState({ status: 'desconectado', qr: null, me: null, error: 'La vinculación se ha cerrado desde el móvil' });
      } else if (code === DisconnectReason.connectionReplaced) {
        setState({ status: 'desconectado', qr: null, me: null, error: 'La sesión se ha abierto en otra copia de WhatStick' });
      } else if (!manualStop) {
        // reintentos con espera creciente (sin conexión a internet, servidor caído…)
        const wait = code === DisconnectReason.restartRequired ? 300 : Math.min(60000, 2000 * 2 ** retries++);
        setState({ ...state, status: 'conectando', qr: null, error: code === DisconnectReason.restartRequired ? null : 'Sin conexión con WhatsApp, reintentando…' });
        setTimeout(() => { if (!manualStop) start(dir).catch((e) => setState({ ...state, error: e.message })); }, wait);
      }
    }
  });
  return status();
}

function status() {
  return { ready: state.status === 'conectado', status: state.status, qr: state.qr,
    chat: state.me ? state.me.name : null, error: state.error };
}

// job: { webp: Buffer, ogg?: Buffer, seconds?, animated, wrapped? }
async function send(job) {
  if (!sock || state.status !== 'conectado') return { ok: false, error: 'No hay ningún dispositivo vinculado conectado' };
  try {
    const { prepareWAMessageMedia } = await lib();
    const up = { upload: sock.waUploadToServer };
    const st = await prepareWAMessageMedia({ sticker: job.webp, isAnimated: !!job.animated }, up);
    const stickerMessage = { ...st.stickerMessage, mimetype: 'image/webp', width: 512, height: 512, isAnimated: !!job.animated };
    let message = { stickerMessage };
    if (job.ogg) {
      const au = await prepareWAMessageMedia({ audio: job.ogg, mimetype: 'audio/ogg; codecs=opus',
        seconds: Math.max(1, Math.round(job.seconds || 1)), ptt: false }, up);
      stickerMessage.audioMessage = { ...au.audioMessage, mimetype: 'audio/ogg; codecs=opus' };
      // WhatsApp Web envuelve los stickers con sonido en audioStickerMessage (134).
      if (job.wrapped !== false) message = { audioStickerMessage: { message: { stickerMessage } } };
    }
    const id = await sock.relayMessage(state.me.jid, message, {});
    return { ok: true, chat: state.me.name, withAudio: !!job.ogg, id };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function stop({ logout = false } = {}) {
  manualStop = true;
  const s = sock;
  sock = null;
  if (s) {
    if (logout) { try { await s.logout(); } catch (e) { /* ya cerrada */ } }
    try { s.end(undefined); } catch (e) { /* ya cerrada */ }
  }
  if (logout && authDir) fs.rmSync(authDir, { recursive: true, force: true });
  setState({ status: 'desconectado', qr: null, me: null, error: null });
}

module.exports = { start, status, send, stop, onChange, linked };
