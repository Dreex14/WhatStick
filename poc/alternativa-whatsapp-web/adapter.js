// Adaptador de WhatsApp Web (se ejecuta dentro de la página web.whatsapp.com).
// NO OFICIAL: usa módulos internos de WhatsApp Web (window.require), que pueden cambiar
// con cualquier actualización. Todo el acceso a WhatsApp está concentrado en este archivo.
// No lee ni guarda cookies, claves ni mensajes: solo localiza tu chat y envía el sticker
// que la aplicación le entrega, cuando tú lo confirmas.
(() => {
  if (window.__whatstick) return;
  const VERSION = 1;

  const has = () => typeof window.require === 'function';
  function mod(name) {
    if (typeof window.importNamespace === 'function') {
      try { const m = window.importNamespace(name); if (m) return m; } catch (e) { /* siguiente */ }
    }
    return window.require(name);
  }
  const dflt = (name) => { const m = mod(name); return m && m.default !== undefined ? m.default : m; };
  const tryMod = (name) => { try { return mod(name); } catch (e) { return null; } };
  // Algunos módulos se cargan bajo demanda: se piden con requireLazy y se espera.
  async function need(names) {
    const missing = names.filter((n) => !tryMod(n));
    if (missing.length && typeof window.requireLazy === 'function') {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('No se han podido cargar: ' + missing.join(', '))), 15000);
        window.requireLazy(missing, () => { clearTimeout(t); resolve(); });
      });
    }
  }

  const MODULES = [
    'WAWebChatCollection', 'WAWebUserPrefsMeUser', 'WAWebFindChatAction', 'WAWebMediaPrep',
    'WAWebMediaOpaqueData', 'WAWebSendMsgResultAction', 'WAWebUploadManager', 'WAWebMmsMediaTypes',
    'WAWebSoundStickerGating', 'WAWebSoundStickerUtils', 'WAWebMediaGetUploadOriginForChat',
  ];

  function b64ToBlob(b64, type) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type });
  }
  function toB64(v) {
    if (v == null || typeof v === 'string') return v;
    const u8 = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer || v);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }
  async function sha256b64(blob) {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return toB64(d);
  }

  function soundGating() {
    const G = tryMod('WAWebSoundStickerGating');
    if (!G) return { available: false };
    const call = (f) => { try { return typeof G[f] === 'function' ? G[f]() : null; } catch (e) { return null; } };
    return {
      available: true,
      creation: call('isSoundStickerCreationEnabled'),
      consumption: call('isSoundStickerConsumptionEnabled'),
      playback: call('isSoundStickerPlaybackEnabled'),
    };
  }

  // Activa la función solo en esta ventana. Únicamente se usa si el usuario lo autoriza
  // en Configuración: es un interruptor de despliegue gradual de WhatsApp, no una medida de seguridad.
  function enableSoundLocally() {
    const G = tryMod('WAWebSoundStickerGating');
    if (!G) return false;
    for (const f of ['isSoundStickerCreationEnabled', 'isSoundStickerConsumptionEnabled', 'isSoundStickerPlaybackEnabled']) {
      try { G[f] = () => true; } catch (e) { /* módulo congelado */ }
    }
    return soundGating().creation === true;
  }

  function status() {
    if (!has()) return { ready: false, reason: 'WhatsApp Web todavía no ha cargado' };
    const CC = tryMod('WAWebChatCollection');
    const loggedIn = !!(CC && CC.ChatCollection && CC.ChatCollection.length > 0);
    const modules = {};
    for (const m of MODULES) modules[m] = !!tryMod(m);
    return {
      ready: loggedIn,
      reason: loggedIn ? null : 'Inicia sesión escaneando el código QR',
      waVersion: (window.Debug && window.Debug.VERSION) || null,
      modules,
      sound: soundGating(),
      adapter: VERSION,
    };
  }

  async function selfChat() {
    await need(['WAWebFindChatAction']).catch(() => {});
    const Me = mod('WAWebUserPrefsMeUser');
    const CC = mod('WAWebChatCollection').ChatCollection;
    let first = null;
    for (const g of ['getMaybeMePnUser', 'getMeUserOrThrow', 'getMaybeMeLidUser']) {
      try {
        const wid = typeof Me[g] === 'function' ? Me[g]() : null;
        if (!wid) continue;
        first = first || wid;
        const c = CC.get(wid) || CC.get(String(wid._serialized || wid));
        if (c) return c;
      } catch (e) { /* siguiente */ }
    }
    if (!first) throw new Error('No se ha podido identificar tu propio número');
    const r = await mod('WAWebFindChatAction').findOrCreateLatestChat(first);
    return (r && r.chat) || r;
  }

  function chatLabel(chat) {
    try { return String(chat.formattedTitle || chat.name || 'Tú'); } catch (e) { return 'Tú'; }
  }

  async function uploadAudio(blob, seconds, chat) {
    const MT = mod('WAWebMmsMediaTypes').MEDIA_TYPES;
    let uploadOrigin = 1;
    try { uploadOrigin = dflt('WAWebMediaGetUploadOriginForChat')(chat); } catch (e) { /* valor por defecto */ }
    const params = {
      blob, type: MT.AUDIO, signal: new AbortController().signal,
      uploadOrigin, userUploadAttemptCount: 0, forwardedFromWeb: false, isViewOnce: false,
      uploadQpl: new Proxy({}, { get: () => () => undefined }),
    };
    const res = await dflt('WAWebUploadManager').encryptAndUpload(params);
    const audio = {
      deprecatedMms3Url: res.url || undefined,
      directPath: res.directPath,
      mediaKey: toB64(res.mediaKey),
      mediaKeyTimestamp: res.mediaKeyTimestamp,
      filehash: await sha256b64(blob),
      encFilehash: toB64(res.encFilehash),
      size: blob.size,
      mimetype: 'audio/ogg; codecs=opus',
      duration: seconds,
    };
    const U = tryMod('WAWebSoundStickerUtils');
    if (U && typeof U.isCompleteStickerAudio === 'function' && U.isCompleteStickerAudio(audio) !== true) {
      throw new Error('WhatsApp no da por válido el audio subido');
    }
    return audio;
  }

  // Punto de entrada: { webp, ogg?, seconds?, animated, target: 'self' | 'active' }
  async function send(job) {
    const st = status();
    if (!st.ready) throw new Error(st.reason);
    await need(['WAWebFindChatAction', 'WAWebMediaPrep', 'WAWebMediaOpaqueData']
      .concat(job.ogg ? ['WAWebUploadManager', 'WAWebMediaGetUploadOriginForChat'] : []));
    const chat = job.target === 'active' ? mod('WAWebChatCollection').ChatCollection.getActive() : await selfChat();
    if (!chat) throw new Error('No hay ningún chat abierto');
    const webp = b64ToBlob(job.webp, 'image/webp');
    let stickerAudio = null;
    if (job.ogg) {
      if (soundGating().creation !== true && !(job.allowLocalSoundFlag && enableSoundLocally())) {
        throw new Error('Tu cuenta no tiene activada la creación de stickers con sonido');
      }
      stickerAudio = await uploadAudio(b64ToBlob(job.ogg, 'audio/ogg; codecs=opus'), job.seconds, chat);
    }
    const MediaPrep = dflt('WAWebMediaPrep');
    const opaque = await dflt('WAWebMediaOpaqueData').createFromData(webp, 'image/webp');
    const prep = new MediaPrep('sticker', Promise.resolve({
      type: 'sticker', mediaBlob: opaque, mimetype: 'image/webp', size: webp.size,
      fullWidth: 512, fullHeight: 512, isAnimated: !!job.animated, emojis: job.emojis || [],
    }));
    const res = await prep.sendToChat({ chat, options: stickerAudio ? { stickerAudio } : {} });
    const OK = mod('WAWebSendMsgResultAction').SendMsgResult.OK;
    if (!res || res.messageSendResult !== OK) {
      throw new Error('WhatsApp no ha podido enviar el sticker (' + (res && res.messageSendResult) + ')');
    }
    const msg = res.msg;
    return {
      chat: chatLabel(chat),
      withAudio: !!stickerAudio,
      msgHasAudio: msg ? !!(msg.stickerAudio || (msg.attributes && msg.attributes.stickerAudio)) : null,
    };
  }

  window.__whatstick = {
    status,
    send: (job) => send(job).then((r) => ({ ok: true, ...r }), (e) => ({ ok: false, error: String(e && e.message || e) })),
    selfChatLabel: async () => chatLabel(await selfChat()),
    // Diagnóstico: tipo de los últimos mensajes de tu chat propio (sin contenido).
    recentSelf: async (n = 8) => {
      const chat = await selfChat();
      const msgs = chat.msgs && chat.msgs.getModelsArray ? chat.msgs.getModelsArray() : [];
      return msgs.slice(-n).map((m) => ({
        t: m.t, type: m.type, isAnimated: m.isAnimated, size: m.size,
        stickerAudio: !!(m.stickerAudio || (m.attributes && m.attributes.stickerAudio)),
        audioSeconds: m.stickerAudio ? m.stickerAudio.duration || m.stickerAudio.seconds || null : null,
        fromMeDevice: m.id && m.id.fromMe, ack: m.ack, mediaStage: m.mediaData && m.mediaData.mediaStage,
      }));
    },
  };
})();
