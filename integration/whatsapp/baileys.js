'use strict';
// Envío a WhatsApp: WhatStick se vincula como dispositivo con Baileys (cliente no oficial
// del protocolo multidispositivo) y manda el sticker a tu propio chat.
//
// Seguridad:
// - La sesión del dispositivo se guarda cifrada (ver secure-auth.js) y se puede revocar
//   desde el móvil (Dispositivos vinculados). No se lee ninguna otra sesión.
// - Los mensajes que llegan no se guardan ni se muestran en ningún sitio. (No se rechazan:
//   responder con error a WhatsApp puede hacer que desvincule el dispositivo.)
// - No se pide el historial completo ni se marca «en línea». (La sincronización mínima de
//   WhatsApp se mantiene: sin ella la sesión se vuelve inestable y WhatsApp la da de baja.)
// - send() solo puede enviar a tu propio número.
//
// Parche de protobuf basado en SonoSticker (MIT, github.com/ThatChip2000/SonoSticker).
const fs = require('node:fs');
const { useEncryptedAuthState, hasSession } = require('./secure-auth');

let B = null; // módulo baileys (ESM, se importa bajo demanda)
let sock = null;
let state = { status: 'desconectado', qr: null, me: null, error: null };
let authDir = null;
let cipher = null;
let debugLog = null;
let manualStop = false;
let starting = null;
let retries = 0;
const listeners = new Set();
const sent = new Map(); // id → mensaje enviado (solo en memoria, 10 min) para reenvíos

/** cipher: { encrypt(string): Buffer, decrypt(Buffer): string } para la sesión en disco. */
function configure(opts) { cipher = opts.cipher; debugLog = opts.debugLog || null; }

/** fn(status) se llama en cada cambio de estado (QR nuevo, conectado, desconectado…). */
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setState(next) {
  state = next;
  for (const fn of listeners) { try { fn(status()); } catch (e) { /* ignorar */ } }
}
/** ¿Hay una sesión vinculada guardada en esa carpeta? */
const linked = (dir) => hasSession(dir);

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
  if (!cipher) throw new Error('Falta el cifrado de la sesión');
  authDir = dir;
  manualStop = false;
  const L = await lib();
  const { default: makeWASocket, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser } = L;
  const QRCode = require('qrcode');
  const pino = require('pino');
  const { state: auth, saveCreds } = await useEncryptedAuthState(dir, cipher, L);
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch (e) { /* usa la incluida */ }
  setState({ status: 'conectando', qr: null, me: null, error: null });

  const s = makeWASocket({
    ...(version ? { version } : {}), auth,
    // por defecto, silencio
    // registro de diagnóstico: solo en desarrollo (puede contener datos técnicos de la sesión)
    logger: debugLog ? pino({ level: 'debug' }, pino.destination(debugLog)) : pino({ level: 'silent' }),
    browser: ['WhatStick', 'Desktop', '1.0'],
    markOnlineOnConnect: false, syncFullHistory: false, emitOwnEvents: false,
    getMessage: async (key) => sent.get(key.id),
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

/** Espera a que la conexión esté lista (para el modo «conectar solo al enviar»). */
function waitReady(ms = 25000) {
  if (state.status === 'conectado') return Promise.resolve(true);
  return new Promise((resolve) => {
    const off = onChange((st) => { if (st.ready || st.status === 'qr' || (st.status === 'desconectado' && st.error)) { off(); clearTimeout(t); resolve(st.ready); } });
    const t = setTimeout(() => { off(); resolve(false); }, ms);
  });
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
    // destino fijo: tu propio número
    const id = await sock.relayMessage(state.me.jid, message, {});
    sent.set(id, message);
    setTimeout(() => sent.delete(id), 10 * 60 * 1000);
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
  sent.clear();
  setState({ status: 'desconectado', qr: null, me: null, error: null });
}

module.exports = { configure, start, status, send, stop, onChange, linked, waitReady };
