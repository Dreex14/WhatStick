// Ajustes: WhatsApp, almacenamiento, stickers y yt-dlp.
import { $, h, toast, errorText, confirmDialog, esc } from './util.js';
import { onStatus } from './wa.js';

let cfg = null;

export async function refresh() {
  cfg = await window.ws.settings.get();
  $('#set-dir').value = cfg.libraryDir;
  $('#set-author').value = cfg.author;
  $('#set-large').checked = cfg.allowLarge;
  $('#set-connect').checked = cfg.connectOnStart;
  $('#app-version').textContent = cfg.version;
  paintYtdlp();
}

async function save(patch) {
  try { cfg = await window.ws.settings.set(patch); toast('Ajuste guardado'); } catch (e) { toast(errorText(e), 'error'); }
}

$('#set-author').addEventListener('change', (e) => save({ author: e.target.value }));
$('#set-author').addEventListener('keydown', (e) => e.stopPropagation());
$('#set-large').onchange = (e) => save({ allowLarge: e.target.checked });
$('#set-connect').onchange = (e) => save({ connectOnStart: e.target.checked });
$('#set-dir-btn').onclick = async () => {
  try {
    const r = await window.ws.settings.chooseLibraryDir();
    if (r) { cfg = r; $('#set-dir').value = r.libraryDir; toast('Carpeta de la biblioteca cambiada'); (await import('./library.js')).refresh(); }
  } catch (e) { toast(errorText(e), 'error'); }
};
$('#set-dir-open').onclick = () => window.ws.settings.openLibrary();

// ---------------------------------------------------------------- WhatsApp
const STATES = {
  conectado: ['ok', (s) => `Conectado como <b>${esc(s.chat || 'tu cuenta')}</b>. Los stickers se envían a tu chat «Tú».`],
  conectando: ['busy', (s) => s.error ? esc(s.error) : 'Conectando con WhatsApp…'],
  qr: ['busy', () => 'Escanea el código QR con tu móvil para vincular WhatStick.'],
  desconectado: ['', (s) => s.error ? `<span style="color:var(--danger)">${esc(s.error)}</span>` : s.linked ? 'Vinculado, pero desconectado.' : 'No vinculado.'],
};

onStatus((s) => {
  const [cls, text] = STATES[s.status] || STATES.desconectado;
  $('#wa-state').innerHTML = `<span class="dot ${cls}"></span><span>${text(s)}</span>`;
  $('#wa-qr').hidden = !(s.status === 'qr' && s.qr);
  if (s.qr) $('#wa-qr-img').src = s.qr;
  const acts = $('#wa-actions');
  acts.innerHTML = '';
  if (s.status === 'desconectado') {
    const b = h(`<button class="btn primary" data-icon="qr-code">${s.linked ? 'Conectar' : 'Vincular WhatsApp'}</button>`);
    b.onclick = () => window.ws.wa.connect().catch((e) => toast(errorText(e), 'error'));
    acts.append(b);
  }
  if (s.linked || s.status === 'conectado') {
    const u = h('<button class="btn" data-icon="unlink">Desvincular</button>');
    u.onclick = async () => {
      if (!await confirmDialog({ title: 'Desvincular WhatsApp', text: 'Se cerrará la sesión de WhatStick en tu cuenta y se borrará de este PC. Para volver a enviar stickers tendrás que escanear otra vez el QR.', ok: 'Desvincular', danger: true })) return;
      try { await window.ws.wa.unlink(); toast('WhatsApp desvinculado'); } catch (e) { toast(errorText(e), 'error'); }
    };
    acts.append(u);
  }
  if (s.status === 'qr') {
    const c = h('<button class="btn" data-icon="x">Cancelar</button>');
    c.onclick = () => window.ws.wa.unlink();
    acts.append(c);
  }
});

// ---------------------------------------------------------------- yt-dlp
async function paintYtdlp() {
  const row = $('#ytdlp-row');
  row.innerHTML = '';
  if (!cfg.ytdlp) {
    row.append(h('<p class="note">No está instalado. Se descargará automáticamente la primera vez que pegues un enlace de vídeo.</p>'));
    return;
  }
  const v = await window.ws.settings.ytdlpVersion().catch(() => '?');
  row.append(h(`<span class="note" style="flex:1">yt-dlp ${esc(v)} instalado</span>`));
  const up = h('<button class="btn small" data-icon="refresh-ccw">Buscar actualización</button>');
  up.onclick = async () => {
    const t = toast('Actualizando yt-dlp…', 'busy', { ms: 0 });
    try { const nv = await window.ws.settings.ytdlpUpdate(); t.close(); toast(`yt-dlp ${nv}`); paintYtdlp(); } catch (e) { t.close(); toast(errorText(e), 'error'); }
  };
  const rm = h('<button class="btn small" data-icon="trash-2">Quitar</button>');
  rm.onclick = async () => { await window.ws.settings.ytdlpRemove(); cfg.ytdlp = false; paintYtdlp(); };
  row.append(up, rm);
}
