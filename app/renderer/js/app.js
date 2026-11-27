// Arranque de la interfaz: navegación, importación y lista de archivos importados.
import { $, $$, h, icons, esc, toast, errorText, confirmDialog } from './util.js';
import { S } from './store.js';
import * as editor from './editor.js';
import * as library from './library.js';
import * as settings from './settings.js';
import './wa.js';

icons();

// ---------------------------------------------------------------- navegación
export function show(view) {
  if (view === 'library') library.refresh();
  if (view === 'settings') settings.refresh();
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${view}`);
  for (const b of $$('.rail-btn')) b.classList.toggle('active', b.dataset.view === (view === 'editor' ? 'create' : view));
}
$('.rail').onclick = (e) => {
  const b = e.target.closest('.rail-btn');
  if (!b) return;
  if (b.dataset.view === 'create' && S.project && $('#view-create').classList.contains('active') === false && $('#view-editor').classList.contains('active')) return show('create');
  show(b.dataset.view);
};
$('#ed-back').onclick = () => { import('./timeline.js').then((m) => m.stop()); show('create'); };

// ---------------------------------------------------------------- archivos importados
const items = []; // { source, project, thumb }
let current = null;

const KIND = { image: 'Imagen', video: 'Vídeo', animation: 'Animación' };

function renderImports() {
  const list = $('#import-list');
  $('#imports').hidden = items.length === 0;
  list.innerHTML = '';
  for (const it of items) {
    const s = it.source;
    const meta = `${KIND[s.kind]} · ${s.width}×${s.height}${s.duration ? ` · ${s.duration.toFixed(1).replace('.', ',')} s` : ''}${s.hasAudio ? ' · con audio' : ''}`;
    const el = h(`<button class="import-item ${it === current ? 'current' : ''}"><div class="thumb"></div><div class="meta"><div class="n">${esc(s.name)}</div><div class="k">${esc(meta)}</div></div><span class="rm" title="Quitar de la lista" data-icon="x"></span></button>`);
    const th = $('.thumb', el);
    if (it.thumb) th.style.backgroundImage = `url("${it.thumb}")`;
    else th.innerHTML = '<svg class="ico spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
    el.onclick = (e) => {
      if (e.target.closest('.rm')) { e.stopPropagation(); items.splice(items.indexOf(it), 1); if (it === current) current = null; renderImports(); return; }
      openItem(it);
    };
    list.append(el);
  }
}

async function loadThumb(it) {
  try {
    if (it.source.kind === 'image') it.thumb = await window.ws.mediaUrl(it.source.path);
    else { const th = await window.ws.thumbnails(it.source, 1); it.thumb = th[0] && th[0].src; }
  } catch (e) { it.thumb = null; }
  renderImports();
}

async function openItem(it) {
  current = it;
  renderImports();
  show('editor');
  try {
    await editor.open(it);
    const pa = takePendingAudio();
    if (pa) { editor.setType('sound'); await (await import('./panels.js')).setAudioFile(pa); }
  } catch (e) { toast('No se ha podido abrir: ' + errorText(e), 'error'); show('create'); }
}

function addResults(results) {
  const ok = [];
  for (const r of results) {
    if (!r.ok) { toast(`${r.name}: ${r.error}`, 'error', { ms: 6000 }); continue; }
    const dup = items.find((x) => x.source.path === r.source.path);
    if (dup) { ok.push(dup); continue; }
    const it = { source: r.source, project: null, thumb: null };
    items.unshift(it);
    ok.push(it);
    loadThumb(it);
  }
  renderImports();
  if (ok.length === 1) openItem(ok[0]);
  else if (ok.length > 1) toast(`${ok.length} archivos importados. Elige uno para editarlo.`);
}

async function guarded(fn, busyText) {
  const t = busyText ? toast(busyText, 'busy', { ms: 0 }) : null;
  try { const r = await fn(); t && t.close(); return r; }
  catch (e) { t && t.close(); toast(errorText(e), 'error', { ms: 6000 }); return null; }
}

// ---------------------------------------------------------------- formas de importar
$('#btn-open').onclick = async () => { const r = await guarded(() => window.ws.importDialog()); if (r) addResults(r); };
const paste = async () => { const r = await guarded(() => window.ws.importClipboard(), 'Pegando…'); if (r) addResults(r); };
$('#btn-paste').onclick = paste;

document.addEventListener('paste', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if ($('#view-create').classList.contains('active')) { e.preventDefault(); paste(); }
});

const drop = $('#drop');
let depth = 0;
// Con la herramienta Audio abierta, lo que se suelta en el editor se usa como sonido.
const audioDropTarget = () => $('#view-editor').classList.contains('active') && S.project && S.tool === 'audio' && S.project.type === 'sound';
document.addEventListener('dragenter', (e) => {
  e.preventDefault(); depth++;
  if (audioDropTarget()) { $('#panel').classList.add('drop-audio'); return; }
  if (!$('#view-create').classList.contains('active')) show('create');
  drop.classList.add('over');
});
document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.classList.remove('over'); $('#panel').classList.remove('drop-audio'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  depth = 0;
  drop.classList.remove('over');
  const paths = [...e.dataTransfer.files].map((f) => window.ws.pathForFile(f)).filter(Boolean);
  if (audioDropTarget()) {
    $('#panel').classList.remove('drop-audio');
    if (!paths.length) return;
    const au = await guarded(() => window.ws.importAudioPath(paths[0]), 'Cargando el sonido…');
    if (au) (await import('./panels.js')).setAudioFile(au);
    return;
  }
  if (paths.length) { const r = await guarded(() => window.ws.importPaths(paths), paths.length > 1 ? `Importando ${paths.length} archivos…` : 'Importando…'); if (r) addResults(r); return; }
  const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (/^https?:\/\//i.test(url)) importUrl(url.trim());
});

// Instala yt-dlp (con confirmación) si aún no está. Devuelve false si el usuario no quiere.
export async function ensureYtdlp() {
  const st = await window.ws.ytdlpStatus();
  if (st.installed) return true;
  const ok = await confirmDialog({
    title: 'Descargar yt-dlp',
    text: 'Para importar vídeos desde enlaces, WhatStick usa yt-dlp (unos 24 MB). Se descargará una sola vez desde su página oficial en GitHub y se comprobará su firma. ¿Continuar?',
    ok: 'Descargar',
  });
  if (!ok) return false;
  const t = toast('Descargando yt-dlp…', 'busy', { ms: 0, progress: true });
  const off = window.ws.onProgress((p) => { if (p.task === 'ytdlp' && p.value != null) t.progress(p.value); });
  try { await window.ws.ytdlpInstall(); return true; } catch (e) { toast(errorText(e), 'error'); return false; } finally { t.close(); off(); }
}

// Vídeos importados que tienen sonido (para usar su audio en otro sticker).
export const importedWithAudio = () => items.filter((it) => it.source.hasAudio && it !== current).map((it) => it.source);

async function importUrl(url) {
  const isMI = /myinstants\.com/i.test(url);
  if (!isMI && !await ensureYtdlp()) return;
  const t = toast(isMI ? 'Descargando sonido…' : 'Descargando vídeo…', 'busy', { ms: 0, progress: !isMI });
  const off = window.ws.onProgress((p) => { if (p.task === 'url' && p.value != null) t.progress(p.value); });
  try {
    const r = await window.ws.importUrl(url);
    t.close();
    if (r.kind === 'audio') {
      toast('Es un sonido: ábrelo desde la herramienta Audio de un sticker con sonido, o elige ahora una imagen para él.', 'warn', { ms: 7000 });
      pendingAudio = r.audio;
      return;
    }
    $('#url-input').value = '';
    addResults([{ ok: true, source: r.source }]);
  } catch (e) { t.close(); toast(errorText(e), 'error', { ms: 7000 }); }
  finally { off(); }
}
let pendingAudio = null;

// Abre un sticker de la biblioteca en el editor con su edición guardada.
export async function openFromLibrary(id) {
  const t = toast('Abriendo…', 'busy', { ms: 0 });
  try {
    const r = await window.ws.library.open(id);
    t.close();
    let it = items.find((x) => x.libraryId === id);
    if (!it) { it = { source: r.project.source, project: r.project, libraryId: id, thumb: null }; items.unshift(it); loadThumb(it); }
    else { it.project = r.project; it.source = r.project.source; }
    openItem(it);
  } catch (e) { t.close(); toast(errorText(e), 'error', { ms: 6000 }); }
}
export const takePendingAudio = () => { const a = pendingAudio; pendingAudio = null; return a; };

$('#url-form').onsubmit = (e) => {
  e.preventDefault();
  const url = $('#url-input').value.trim();
  if (url) importUrl(url);
};
$('#url-input').addEventListener('keydown', (e) => e.stopPropagation());

// Atajo de teclado para pegar en la pantalla Crear
document.addEventListener('keydown', (e) => {
  if ($('#view-create').classList.contains('active') && e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#btn-open').click(); }
});

// Gancho para las pruebas automáticas (scripts/drive.js); solo con «--whatstick-test»
if (new URLSearchParams(location.search).has('test')) window.__test = { addResults, S };
