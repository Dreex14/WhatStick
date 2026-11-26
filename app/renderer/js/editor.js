// Editor: barra superior, herramientas, vista previa real (render) y exportación.
import { $, $$, h, kb, toast, errorText, debounce, setIcon, confirmDialog } from './util.js';
import { S, on, load, update, undo, redo, canUndo, canRedo } from './store.js';
import * as stage from './stage.js';
import * as timeline from './timeline.js';
import { renderPanel } from './panels.js';
import { overlayDataUrl } from './texts.js';

const badge = $('#size-badge');
let renderSeq = 0;
let rendering = null; // promesa del render en curso
let editVersion = 0;
let renderedVersion = -1;

// ---------------------------------------------------------------- abrir
export async function open(item) {
  const { source } = item;
  S.source = source;
  S.item = item;
  S.libraryId = item.libraryId || null;
  S.result = null;
  S.textSel = null;
  S.cropAspect = 'free';
  $('#stage-busy').hidden = false;
  $('#stage-busy-text').textContent = 'Cargando…';
  try {
    S.preview = await window.ws.preview(source);
  } catch (e) {
    $('#stage-busy').hidden = true;
    throw e;
  }
  const project = item.project || await window.ws.defaults(source);
  item.project = project; // se conserva al cambiar de archivo
  project.source = source;
  if (project.audio && project.audio.file && !project.audio.url) {
    // proyecto de la biblioteca: preparar el audio elegido para la vista previa
    project.audio.url = await window.ws.mediaUrl(project.audio.file);
    project.audio.peaks = (await window.ws.waveform(project.audio.file, 400).catch(() => null))?.peaks || null;
  }
  const m = stage.setSource(S.preview);
  await new Promise((res) => {
    const done = () => res();
    if (m.tagName === 'VIDEO') { m.onloadeddata = done; m.onerror = done; } else { m.onload = done; m.onerror = done; }
    setTimeout(done, 8000);
  });
  $('#stage-busy').hidden = true;
  if (!project.name || project.name === 'Sticker') project.name = source.name.slice(0, 60);
  load(project);
  $('#ed-name').value = project.name;
  setMode('edit');
  selectTool(S.project.type === 'sound' && source.kind === 'image' && !S.project.audio.file ? 'audio' : 'crop');
  stage.layoutStage();
  await timeline.setup();
}

// ---------------------------------------------------------------- tipo de sticker
export function setType(type) {
  const src = S.source;
  if (type === 'animated' && src.kind === 'image') return;
  update((p) => {
    p.type = type;
    if (type === 'sound') {
      if (src.kind !== 'image' && !src.hasAudio && p.audio.mode === 'original') p.audio.mode = 'file';
      if (src.kind === 'image') p.audio.mode = 'file';
    }
    if (type !== 'static' && src.kind !== 'image' && (p.trim.end - p.trim.start) / p.speed > 10) p.trim.end = p.trim.start + 10 * p.speed;
  });
  if (type === 'sound' && ((src.kind === 'image') || !src.hasAudio) && !S.project.audio.file) selectTool('audio');
  else renderPanel();
  timeline.redrawWave();
}

function paintType() {
  const src = S.source;
  for (const b of $$('#type-seg button')) {
    b.classList.toggle('active', b.dataset.type === S.project.type);
    b.disabled = b.dataset.type === 'animated' && src.kind === 'image';
    b.title = b.disabled ? 'Una imagen fija no se puede animar (sí puede llevar sonido)' : '';
  }
  $('[data-tool="audio"]').classList.toggle('dim', S.project.type !== 'sound');
}

// ---------------------------------------------------------------- herramientas y modo
export function selectTool(tool) {
  S.tool = tool;
  for (const b of $$('#tools .tool')) b.classList.toggle('active', b.dataset.tool === tool);
  renderPanel();
  stage.layoutStage();
}

function setMode(mode) {
  S.mode = mode;
  for (const b of $$('#stage-mode button')) b.classList.toggle('active', b.dataset.mode === mode);
  $('#viewport').hidden = mode !== 'edit';
  $('.zoom-ctl').hidden = mode !== 'edit';
  $('#result').hidden = mode !== 'result';
  if (mode === 'result') { timeline.stop(); showResult(); if (!S.result && !rendering) renderNow(); }
  else $('#result-audio')?.pause?.();
}

// ---------------------------------------------------------------- render real
const resultAudio = new Audio();
function showResult() {
  const r = S.result;
  const img = $('#result-img');
  const info = $('#result-info');
  if (!r) { img.removeAttribute('src'); info.textContent = rendering ? 'Generando el sticker…' : ''; $('#result-play').hidden = true; return; }
  img.src = r.webpUrl;
  const v = r.webp;
  const parts = [`<b>${kb(v.bytes)}</b> de ${kb(v.limit)}`];
  if (v.animated) parts.push(`${(v.durationMs / 1000).toFixed(2).replace('.', ',')} s`, `${v.frames} cuadros${v.fps ? ` · ${v.fps} fps` : ''}`);
  if (r.audio) parts.push(`audio ${kb(r.audio.bytes)}`);
  info.innerHTML = parts.join(' · ') + (r.warnings.length ? `<div class="warn">${r.warnings.map((w) => w.replace(/</g, '&lt;')).join('<br>')}</div>` : '');
  $('#result-play').hidden = !v.animated;
  setIcon($('#result-play'), 'play');
  $('#result-play').lastChild.textContent = r.audio ? ' Reproducir con sonido' : ' Reproducir desde el principio';
}

$('#result-play').onclick = () => {
  const r = S.result;
  if (!r) return;
  const img = $('#result-img');
  img.src = r.webpUrl + '&t=' + Date.now(); // reinicia la animación
  if (r.oggUrl) { resultAudio.src = r.oggUrl; resultAudio.currentTime = 0; resultAudio.play(); }
};

function paintBadge(state) {
  badge.className = 'size-badge';
  if (state === 'busy') { badge.innerHTML = '<svg class="ico spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Calculando'; return; }
  if (state === 'error') { badge.classList.add('bad'); badge.textContent = 'Error'; return; }
  const r = S.result;
  if (!r) { badge.textContent = ''; return; }
  const ok = r.webp.bytes <= r.webp.limit && r.validation.ok;
  badge.classList.add(ok ? 'ok' : 'bad');
  badge.textContent = `${kb(r.webp.bytes)} / ${kb(r.webp.limit)}`;
  badge.title = ok ? 'El sticker cumple los límites de WhatsApp' : (r.validation.problems.join('. ') || 'Supera el límite');
}

async function renderNow() {
  const seq = ++renderSeq;
  const version = editVersion;
  paintBadge('busy');
  if (S.mode === 'result') { $('#result-info').textContent = 'Generando el sticker…'; }
  const project = JSON.parse(JSON.stringify(S.project));
  delete project.audio.peaks;
  const job = window.ws.render(project, overlayDataUrl(project.texts));
  rendering = job;
  try {
    const r = await job;
    if (seq !== renderSeq || r.cancelled) return;
    S.result = r;
    renderedVersion = version;
    paintBadge();
    if (S.mode === 'result') showResult();
  } catch (e) {
    if (seq !== renderSeq) return;
    S.result = null;
    paintBadge('error');
    badge.title = errorText(e);
    if (S.mode === 'result') $('#result-info').textContent = errorText(e);
  } finally {
    if (seq === renderSeq) rendering = null;
  }
}
const scheduleRender = debounce(renderNow, 900);

// Espera a que el resultado corresponda a la edición actual.
export async function freshResult() {
  scheduleRender.cancel();
  if (rendering) await rendering.catch(() => {});
  if (!S.result || renderedVersion !== editVersion) await renderNow();
  return S.result;
}

on('edited', () => {
  editVersion++;
  if (S.project.type === 'sound' && S.project.audio.mode === 'file' && !S.project.audio.file) { scheduleRender.cancel(); badge.textContent = ''; return; }
  scheduleRender();
});
on('change', () => { paintType(); paintHistory(); });
on('history', paintHistory);
on('load', () => { paintType(); paintHistory(); S.result = null; paintBadge(); });

function paintHistory() { $('#undo').disabled = !canUndo(); $('#redo').disabled = !canRedo(); }

// ---------------------------------------------------------------- controles
$('#type-seg').onclick = (e) => { const b = e.target.closest('button'); if (b && !b.disabled) setType(b.dataset.type); };
$('#tools').onclick = (e) => { const b = e.target.closest('.tool'); if (b) selectTool(b.dataset.tool); };
$('#stage-mode').onclick = (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); };
$('#undo').onclick = undo;
$('#reset-all').onclick = () => resetAll();
$('#redo').onclick = redo;
$('#zoom-in').onclick = () => stage.setZoom(zoomOf() * 1.25);
$('#zoom-out').onclick = () => stage.setZoom(zoomOf() / 1.25);
$('#zoom-fit').onclick = () => stage.setZoom(1);
const zoomOf = () => parseInt($('#zoom-label').textContent, 10) / 100 || 1;
const name = $('#ed-name');
name.addEventListener('change', () => update((p) => { p.name = name.value.trim().slice(0, 60) || 'Sticker'; }));
name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); });

$('#btn-export').onclick = async () => {
  const t = toast('Preparando el sticker…', 'busy', { ms: 0 });
  try {
    const r = await freshResult();
    t.close();
    if (!r) throw new Error('No se ha podido generar el sticker');
    const files = await window.ws.exportSticker(r, S.project.name);
    if (files) toast(files.length > 1 ? 'Exportados el sticker (.webp) y su audio (.ogg)' : 'Sticker exportado');
  } catch (e) { t.close(); toast(errorText(e), 'error'); }
};
$('#btn-save').onclick = () => saveToLibrary();
$('#btn-send').onclick = async () => {
  const t = toast('Preparando el sticker…', 'busy', { ms: 0 });
  let r;
  try { r = await freshResult(); t.close(); } catch (e) { t.close(); toast(errorText(e), 'error'); return; }
  if (!r) { toast('No se ha podido generar el sticker', 'error'); return; }
  if (!r.validation.ok) {
    const go = await confirmDialog({ title: 'El sticker no cumple los límites', text: r.validation.problems.join('. ') + '. WhatsApp podría rechazarlo. ¿Enviarlo igualmente?', ok: 'Enviar igualmente' });
    if (!go) return;
  }
  const { sendSticker } = await import('./wa.js');
  await sendSticker({ webp: r.webp.file, ogg: r.audio && r.audio.file, seconds: r.audio ? r.audio.seconds : 0,
    animated: !!r.webp.animated, bytes: r.webp.bytes, name: S.project.name });
};

// Guarda el sticker en la biblioteca (o actualiza el que se está editando).
export async function saveToLibrary() {
  const t = toast('Guardando…', 'busy', { ms: 0 });
  try {
    const r = await freshResult();
    if (!r) throw new Error('No se ha podido generar el sticker');
    const project = JSON.parse(JSON.stringify(S.project));
    const saved = await window.ws.library.save({ id: S.libraryId || null, project, result: r });
    S.libraryId = saved.id;
    if (S.item) S.item.libraryId = saved.id;
    t.close();
    toast('Guardado en la biblioteca');
  } catch (e) { t.close(); toast(errorText(e), 'error'); }
}

// Restablecer toda la edición
export async function resetAll() {
  if (!await confirmDialog({ title: 'Restablecer la edición', text: 'Se perderán el recorte, los textos y los ajustes de este sticker.', ok: 'Restablecer', danger: true })) return;
  const d = await window.ws.defaults(S.source);
  update((p) => { Object.assign(p, { ...d, name: p.name, source: p.source }); });
  S.cropAspect = 'free'; S.textSel = null;
  renderPanel();
}

// ---------------------------------------------------------------- teclado
document.addEventListener('keydown', (e) => {
  if (!$('#view-editor').classList.contains('active') || !$('#modal').hidden) return;
  const tag = document.activeElement && document.activeElement.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 's') { e.preventDefault(); saveToLibrary(); }
  else if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
  else if (typing) return;
  else if (k === ' ') { e.preventDefault(); timeline.toggle(); }
  else if (k === 'arrowleft') { e.preventDefault(); timeline.step(e.shiftKey ? -10 : -1); }
  else if (k === 'arrowright') { e.preventDefault(); timeline.step(e.shiftKey ? 10 : 1); }
  else if ((k === 'delete' || k === 'backspace') && S.tool === 'text' && S.textSel) {
    update((p) => { p.texts = p.texts.filter((t) => t.id !== S.textSel); }); S.textSel = null; renderPanel();
  }
});
