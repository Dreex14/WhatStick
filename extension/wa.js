// WhatStick para WhatsApp Web: adaptador (se ejecuta dentro de web.whatsapp.com).
// NO OFICIAL: usa módulos internos de WhatsApp Web (window.require), que pueden cambiar con
// cualquier actualización de WhatsApp. Todo el acceso a WhatsApp está en este archivo.
// No lee, guarda ni envía a ningún sitio cookies, claves ni mensajes: solo envía al chat que
// tienes abierto el sticker que tú sueltas en el panel, cuando confirmas el envío.
(() => {
  if (window.__whatstickWA) return;

  function mod(name) {
    if (typeof window.importNamespace === 'function') {
      try { const m = window.importNamespace(name); if (m) return m; } catch (e) { /* siguiente */ }
    }
    return window.require(name);
  }
  const dflt = (name) => { const m = mod(name); return m && m.default !== undefined ? m.default : m; };
  const tryMod = (name) => { try { return mod(name); } catch (e) { return null; } };
  // Algunos módulos se cargan bajo demanda.
  async function need(names) {
    const missing = names.filter((n) => !tryMod(n));
    if (missing.length && typeof window.requireLazy === 'function') {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WhatsApp Web ha cambiado y faltan piezas: ' + missing.join(', '))), 15000);
        window.requireLazy(missing, () => { clearTimeout(t); resolve(); });
      });
    }
  }

  function toB64(v) {
    if (v == null || typeof v === 'string') return v;
    const u8 = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer || v);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  const sha256b64 = async (blob) => toB64(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));

  // La creación de stickers con sonido se activa por cuenta de forma gradual. Si tu cuenta aún
  // no la tiene, se activa solo en esta pestaña (es un interruptor de despliegue, no seguridad).
  function ensureSoundStickers() {
    const G = tryMod('WAWebSoundStickerGating');
    if (!G) return false;
    const ok = () => { try { return G.isSoundStickerCreationEnabled() === true; } catch (e) { return false; } };
    if (ok()) return true;
    for (const f of ['isSoundStickerCreationEnabled', 'isSoundStickerConsumptionEnabled', 'isSoundStickerPlaybackEnabled']) {
      try { G[f] = () => true; } catch (e) { /* módulo congelado */ }
    }
    return ok();
  }

  function ready() {
    if (typeof window.require !== 'function') return false;
    const CC = tryMod('WAWebChatCollection');
    return !!(CC && CC.ChatCollection && CC.ChatCollection.length > 0);
  }

  function activeChat() {
    try {
      const c = mod('WAWebChatCollection').ChatCollection.getActive();
      return c ? { chat: c, name: String(c.formattedTitle || c.name || 'chat') } : null;
    } catch (e) { return null; }
  }

  async function uploadAudio(blob, seconds, chat) {
    const MT = mod('WAWebMmsMediaTypes').MEDIA_TYPES;
    let uploadOrigin = 1;
    try { uploadOrigin = dflt('WAWebMediaGetUploadOriginForChat')(chat); } catch (e) { /* por defecto */ }
    const params = {
      blob, type: MT.AUDIO, signal: new AbortController().signal, uploadOrigin, userUploadAttemptCount: 0,
      forwardedFromWeb: false, isViewOnce: false, isHdPhoto: false, uploadQpl: new Proxy({}, { get: () => () => undefined }),
    };
    let res;
    try {
      const metrics = dflt('WAWebCreateMediaUploadMetrics')(params);
      res = await dflt('WAWebUploadManagerMainThread').encryptAndUpload(params, metrics);
    } catch (e) {
      res = await dflt('WAWebUploadManager').encryptAndUpload(params);
    }
    const audio = {
      deprecatedMms3Url: res.url || undefined, directPath: res.directPath,
      mediaKey: toB64(res.mediaKey), mediaKeyTimestamp: res.mediaKeyTimestamp,
      filehash: await sha256b64(blob), encFilehash: toB64(res.encFilehash),
      size: blob.size, mimetype: 'audio/ogg; codecs=opus', duration: seconds,
    };
    const U = tryMod('WAWebSoundStickerUtils');
    if (U && typeof U.isCompleteStickerAudio === 'function' && U.isCompleteStickerAudio(audio) !== true) {
      throw new Error('WhatsApp no da por válido el audio subido');
    }
    return audio;
  }

  // job: { webp: Blob, ogg?: Blob, seconds?, animated }
  async function send(job) {
    if (!ready()) throw new Error('Inicia sesión en WhatsApp Web');
    const ac = activeChat();
    if (!ac) throw new Error('Abre primero el chat al que quieres enviarlo');
    await need(['WAWebMediaPrep', 'WAWebMediaOpaqueData', 'WAWebSendMsgResultAction']
      .concat(job.ogg ? ['WAWebMmsMediaTypes', 'WAWebMediaGetUploadOriginForChat'] : []));
    let stickerAudio = null;
    if (job.ogg) {
      if (!ensureSoundStickers()) throw new Error('Este WhatsApp Web no admite stickers con sonido');
      stickerAudio = await uploadAudio(job.ogg, job.seconds, ac.chat);
    }
    const MediaPrep = dflt('WAWebMediaPrep');
    const opaque = await dflt('WAWebMediaOpaqueData').createFromData(job.webp, 'image/webp');
    const prep = new MediaPrep('sticker', Promise.resolve({
      type: 'sticker', mediaBlob: opaque, mimetype: 'image/webp', size: job.webp.size,
      fullWidth: 512, fullHeight: 512, isAnimated: !!job.animated, emojis: [],
    }));
    const res = await prep.sendToChat({ chat: ac.chat, options: stickerAudio ? { stickerAudio } : {} });
    const OK = mod('WAWebSendMsgResultAction').SendMsgResult.OK;
    if (!res || res.messageSendResult !== OK) throw new Error('WhatsApp no ha podido enviar el sticker (' + (res && res.messageSendResult) + ')');
    return { chat: ac.name, withAudio: !!stickerAudio };
  }

  window.__whatstickWA = { ready, activeChat: () => { const a = activeChat(); return a && a.name; }, send };
})();
