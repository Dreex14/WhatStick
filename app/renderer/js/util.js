import { icon } from './icons.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  const el = t.content.firstElementChild;
  icons(el);
  return el;
}

// Añade el icono indicado en data-icon al principio del elemento.
export function icons(root = document) {
  const list = root.matches && root.matches('[data-icon]') ? [root, ...$$('[data-icon]', root)] : $$('[data-icon]', root);
  for (const el of list) {
    if (el.__ico) continue;
    el.__ico = true;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
  }
}

export function setIcon(el, name) {
  const svg = el.querySelector('svg.ico');
  if (svg) svg.outerHTML = icon(name);
  else el.insertAdjacentHTML('afterbegin', icon(name));
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtTime(s) {
  s = Math.max(0, Number(s) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, '0')}`;
}

// Acepta «1:02.5», «62.5», «62,5» o «0:05».
export function parseTime(str) {
  const t = String(str).trim().replace(',', '.');
  if (!t) return NaN;
  const parts = t.split(':').map(Number);
  if (parts.some((n) => isNaN(n) || n < 0)) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export const kb = (b) => `${(b / 1024).toFixed(b < 10240 ? 1 : 0).replace('.', ',')} KB`;

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// ---------------------------------------------------------------- avisos
export function toast(text, type = 'info', { ms = 3800, progress = false } = {}) {
  const ico = { info: 'check', error: 'triangle-alert', warn: 'triangle-alert', busy: 'loader-circle' }[type] || 'info';
  const el = h(`<div class="toast ${type}">${icon(ico, type === 'busy' ? 'spin' : '')}<div style="flex:1"><div class="t">${esc(text)}</div>${progress ? '<div class="bar"><i></i></div>' : ''}</div></div>`);
  $('#toasts').append(el);
  let timer = ms ? setTimeout(() => el.remove(), ms) : null;
  return {
    set(t) { $('.t', el).textContent = t; },
    progress(f) { const b = $('.bar i', el); if (b) b.style.width = `${Math.round(clamp(f, 0, 1) * 100)}%`; },
    close(after = 0) { clearTimeout(timer); timer = setTimeout(() => el.remove(), after); },
  };
}

export function errorText(e) {
  return String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------------------------------------------------------------- diálogo
export function confirmDialog({ title, text, ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const back = $('#modal');
    const box = $('#modal-box');
    box.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p><div class="row">${cancel ? `<button class="btn" data-r="0">${esc(cancel)}</button>` : ''}<button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`;
    back.hidden = false;
    const done = (r) => { back.hidden = true; document.removeEventListener('keydown', key, true); resolve(r); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } if (e.key === 'Enter') { e.stopPropagation(); done(true); } };
    document.addEventListener('keydown', key, true);
    box.onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) done(b.dataset.r === '1'); };
    $('[data-r="1"]', box).focus();
  });
}

// Pinta el progreso de un input range (relleno a la izquierda del tirador).
export function paintRange(r) {
  const p = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty('--p', `${p}%`);
}
