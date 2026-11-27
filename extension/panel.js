// WhatStick para WhatsApp Web: panel flotante para enviar stickers creados con WhatStick.
// Suelta (o elige) el sticker .webp y, si tiene sonido, su audio .ogg. Se envía al chat
// que tengas abierto, después de confirmarlo.
(() => {
  if (window.__whatstickPanel) return;
  window.__whatstickPanel = true;

  const ICON = '<svg viewBox="0 0 256 256" width="26" height="26"><defs><linearGradient id="wsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#43f2ad"/><stop offset="1" stop-color="#1497c9"/></linearGradient></defs><rect x="8" y="8" width="240" height="240" rx="62" fill="url(#wsg)"/><path d="M90 60H170A30 30 0 0 1 200 90V146L146 200H90A30 30 0 0 1 60 170V90A30 30 0 0 1 90 60Z" fill="#fff"/><path d="M200 146L146 200V170A24 24 0 0 1 170 146Z" fill="#cfeee6"/><g fill="#1fb58f"><rect x="86" y="112" width="16" height="44" rx="8"/><rect x="112" y="92" width="16" height="84" rx="8"/><rect x="138" y="104" width="16" height="60" rx="8"/></g></svg>';

  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; right: 22px; bottom: 86px; z-index: 2147483000; width: 50px; height: 50px; border-radius: 16px; border: 0; padding: 0;
      background: #1d2129; box-shadow: 0 6px 20px rgba(0,0,0,.35); cursor: pointer; display: grid; place-items: center; }
    .fab:hover { transform: translateY(-1px); }
    .panel { position: fixed; right: 22px; bottom: 146px; z-index: 2147483000; width: 320px; padding: 16px; border-radius: 16px;
      background: #171a21; color: #e8ebf0; border: 1px solid #323845; box-shadow: 0 12px 40px rgba(0,0,0,.45); font-size: 13.5px; }
    .panel[hidden] { display: none; }
    h3 { margin: 0 0 4px; font-size: 15px; } .sub { color: #8b95a1; font-size: 12px; margin-bottom: 12px; }
    .drop { border: 1.5px dashed #3c4352; border-radius: 12px; padding: 18px 12px; text-align: center; color: #a3abb8; cursor: pointer; }
    .drop.over { border-color: #2fe0a1; background: rgba(47,224,161,.07); }
    .prev { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
    .prev[hidden] { display: none; }
    .prev img { width: 84px; height: 84px; object-fit: contain; border-radius: 10px;
      background: conic-gradient(#232831 25%, #1a1e25 0 50%, #232831 0 75%, #1a1e25 0) 0 0/14px 14px; }
    .meta { flex: 1; min-width: 0; } .meta b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta span { color: #8b95a1; font-size: 12px; }
    .to { margin-top: 12px; color: #a3abb8; } .to b { color: #e8ebf0; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    button.b { flex: 1; height: 34px; border-radius: 9px; border: 1px solid #323845; background: #1d2129; color: #e8ebf0; cursor: pointer; font-weight: 600; font-size: 13px; }
    button.b.p { background: #2fe0a1; border-color: #2fe0a1; color: #062418; }
    button.b:disabled { opacity: .45; cursor: default; }
    .msg { margin-top: 10px; font-size: 12.5px; min-height: 16px; } .msg.err { color: #ff6b6b; } .msg.ok { color: #2fe0a1; }
    .foot { margin-top: 10px; color: #6f7886; font-size: 11px; line-height: 1.4; }
  `;

  const host = document.createElement('div');
  host.id = 'whatstick-ext';
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  root.adoptedStyleSheets = [sheet];
  root.innerHTML = `
    <button class="fab" title="WhatStick: enviar un sticker">${ICON}</button>
    <div class="panel" hidden>
      <h3>Enviar sticker de WhatStick</h3>
      <div class="sub">Suelta aquí el sticker (.webp) y, si tiene sonido, su audio (.ogg). Se envía al chat abierto.</div>
      <div class="drop">Arrastra los archivos o <u>haz clic para elegirlos</u></div>
      <input type="file" multiple accept=".webp,.ogg,.opus,image/webp,audio/ogg" hidden>
      <div class="prev" hidden><img alt=""><div class="meta"><b></b><span></span></div></div>
      <div class="to"></div>
      <div class="row"><button class="b" data-a="clear">Quitar</button><button class="b p" data-a="send" disabled>Enviar</button></div>
      <div class="msg"></div>
      <div class="foot">Extensión no oficial de WhatStick. Puede dejar de funcionar si WhatsApp cambia. No guarda ni envía tus datos a ningún sitio.</div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const panel = $('.panel'), drop = $('.drop'), input = $('input'), msg = $('.msg'), sendBtn = $('[data-a=send]');
  let webp = null, ogg = null, seconds = 0, animated = false, confirmTarget = null, url = null;

  const say = (t, cls = '') => { msg.textContent = t; msg.className = 'msg ' + cls; };
  const kb = (b) => `${(b / 1024).toFixed(0)} KB`;

  function refreshTarget() {
    confirmTarget = null;
    sendBtn.textContent = 'Enviar';
    const wa = window.__whatstickWA;
    const name = wa && wa.ready() ? wa.activeChat() : null;
    $('.to').innerHTML = '';
    const t = document.createElement('span');
    if (!wa || !wa.ready()) t.textContent = 'Esperando a que cargue WhatsApp Web…';
    else if (!name) t.textContent = 'Abre el chat al que quieres enviarlo.';
    else { t.append('Se enviará a: '); const b = document.createElement('b'); b.textContent = name; t.append(b); }
    $('.to').append(t);
    sendBtn.disabled = !webp || !name;
  }

  async function take(files) {
    say('');
    for (const f of files) {
      const head = new Uint8Array(await f.slice(0, 32).arrayBuffer());
      const tag = String.fromCharCode(...head.slice(0, 4)) + String.fromCharCode(...head.slice(8, 12));
      if (tag === 'RIFFWEBP') {
        if (f.size > 1000 * 1000) { say(`${f.name} pesa más de 1 MB: WhatsApp lo rechazaría.`, 'err'); continue; }
        webp = f;
        const fourcc = String.fromCharCode(...head.slice(12, 16));
        animated = fourcc === 'VP8X' && !!(head[20] & 0x02);
      } else if (String.fromCharCode(...head.slice(0, 4)) === 'OggS') {
        if (f.size > 1000 * 1000) { say('El audio pesa más de 1 MB.', 'err'); continue; }
        ogg = f;
        seconds = await new Promise((res) => {
          const a = new Audio(URL.createObjectURL(f));
          a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : 0);
          a.onerror = () => res(0);
        });
      } else say(`${f.name}: solo se admiten el sticker .webp y el audio .ogg de WhatStick.`, 'err');
    }
    paint();
  }

  function paint() {
    $('.prev').hidden = !webp;
    if (webp) {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(webp);
      $('.prev img').src = url;
      $('.meta b').textContent = webp.name.replace(/\.webp$/i, '');
      $('.meta span').textContent = (ogg ? `Con sonido · ${seconds.toFixed(1).replace('.', ',')} s` : animated ? 'Animado' : 'Estático') +
        ` · ${kb(webp.size)}${ogg ? ` + audio ${kb(ogg.size)}` : ''}`;
    }
    if (ogg && !webp) say('Falta el sticker .webp que acompaña a este audio.');
    refreshTarget();
  }

  $('.fab').onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) refreshTarget(); };
  drop.onclick = () => input.click();
  input.onchange = () => { take([...input.files]); input.value = ''; };
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); take([...e.dataTransfer.files]); });
  $('[data-a=clear]').onclick = () => { webp = ogg = null; seconds = 0; say(''); paint(); };

  sendBtn.onclick = async () => {
    const wa = window.__whatstickWA;
    const name = wa && wa.activeChat();
    if (!webp || !name) return refreshTarget();
    // confirmación en dos pasos: el segundo clic envía
    if (confirmTarget !== name) {
      confirmTarget = name;
      sendBtn.textContent = `Confirmar envío a ${name.length > 18 ? name.slice(0, 17) + '…' : name}`;
      return;
    }
    sendBtn.disabled = true;
    say('Enviando…');
    try {
      const r = await wa.send({ webp, ogg, seconds, animated });
      say(`Enviado a ${r.chat}${r.withAudio ? ' con sonido' : ''}.`, 'ok');
      webp = ogg = null; seconds = 0; paint();
    } catch (e) {
      say(String(e && e.message || e), 'err');
      sendBtn.disabled = false;
    }
    confirmTarget = null;
    sendBtn.textContent = 'Enviar';
  };

  // si cambias de chat con el panel abierto, se actualiza el destino
  setInterval(() => { if (!panel.hidden && !confirmTarget) refreshTarget(); }, 1500);
  const mount = () => { if (!document.getElementById('whatstick-ext')) document.body.append(host); };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });
})();
