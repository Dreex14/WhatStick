// Escenario del editor: vista previa con zoom y desplazamiento, recorte y textos.
import { $, clamp } from './util.js';
import { S, on, update, commit } from './store.js';
import * as T from './texts.js';

const vp = $('#viewport');
const frame = $('#frame');
const box = $('#media-box');
const cropEl = $('#crop');
const layer = $('#text-layer');
const lctx = layer.getContext('2d');

let media = null; // <video> o <img>
let zoom = 1;
let pan = { x: 0, y: 0 };
let scale = 1; // píxeles de pantalla por píxel de la fuente

export const getMedia = () => media;

function oriented() {
  const { width: w, height: h } = S.source;
  return S.project.transform.rotate % 180 ? [h, w] : [w, h];
}
export function cropRect() {
  const [W, H] = oriented();
  return S.project.crop || { x: 0, y: 0, w: W, h: H };
}

// ---------------------------------------------------------------- fuente
export function setSource(preview) {
  box.innerHTML = '';
  if (preview.kind === 'video') {
    media = document.createElement('video');
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.playsInline = true;
    media.muted = true;
  } else {
    media = document.createElement('img');
    media.crossOrigin = 'anonymous';
    media.draggable = false;
  }
  media.src = preview.url;
  box.append(media);
  zoom = 1; pan = { x: 0, y: 0 };
  layoutStage();
  return media;
}

export function layoutStage() {
  if (!S.source || !media || !S.project) return;
  const [W, H] = oriented();
  const r = vp.getBoundingClientRect();
  const margin = 56;
  const fit = Math.min((r.width - margin * 2) / W, (r.height - margin * 2) / H);
  scale = Math.max(0.01, fit * zoom);
  const fw = W * scale, fh = H * scale;
  frame.style.width = `${fw}px`;
  frame.style.height = `${fh}px`;
  frame.style.transform = `translate(${(r.width - fw) / 2 + pan.x}px, ${(r.height - fh) / 2 + pan.y}px)`;
  const t = S.project.transform;
  media.style.width = `${S.source.width * scale}px`;
  media.style.height = `${S.source.height * scale}px`;
  media.style.transform = `translate(-50%, -50%) scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1}) rotate(${t.rotate}deg)`;
  const a = S.project.adjust;
  media.style.filter = `brightness(${1 + a.brightness}) contrast(${a.contrast}) saturate(${a.saturation})`;
  const c = cropRect();
  Object.assign(cropEl.style, { left: `${c.x * scale}px`, top: `${c.y * scale}px`, width: `${c.w * scale}px`, height: `${c.h * scale}px` });
  cropEl.classList.toggle('static', S.tool !== 'crop');
  // capa de textos: el cuadrado de 512 px del sticker sobre la zona recortada
  const q = S.project.fit === 'cover' ? Math.min(c.w, c.h) : Math.max(c.w, c.h);
  Object.assign(layer.style, { left: `${(c.x + c.w / 2 - q / 2) * scale}px`, top: `${(c.y + c.h / 2 - q / 2) * scale}px`, width: `${q * scale}px`, height: `${q * scale}px` });
  layer.classList.toggle('editing', S.tool === 'text');
  T.draw(lctx, S.project.texts, { selected: S.tool === 'text' ? S.textSel : null });
  $('#zoom-label').textContent = `${Math.round(zoom * 100)} %`;
}

export function setZoom(z, cx, cy) {
  const r = vp.getBoundingClientRect();
  const nz = clamp(z, 0.25, 8);
  if (cx != null) {
    // mantener fijo el punto bajo el cursor
    const [W, H] = oriented();
    const fit = scale / zoom;
    const left = (r.width - W * scale) / 2 + pan.x, top = (r.height - H * scale) / 2 + pan.y;
    const px = (cx - left) / scale, py = (cy - top) / scale;
    const ns = fit * nz;
    pan.x = cx - px * ns - (r.width - W * ns) / 2;
    pan.y = cy - py * ns - (r.height - H * ns) / 2;
  }
  zoom = nz;
  if (zoom === 1 && cx == null) pan = { x: 0, y: 0 };
  layoutStage();
}

// ---------------------------------------------------------------- interacción
vp.addEventListener('wheel', (e) => {
  if (!media) return;
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  setZoom(zoom * Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

function drag(e, onMove, onEnd) {
  e.preventDefault();
  const id = e.pointerId;
  const tgt = e.currentTarget;
  try { tgt.setPointerCapture(id); } catch (err) { /* evento sintético */ }
  const move = (ev) => onMove(ev);
  const up = (ev) => { tgt.removeEventListener('pointermove', move); tgt.removeEventListener('pointerup', up); tgt.removeEventListener('pointercancel', up); onEnd && onEnd(ev); };
  tgt.addEventListener('pointermove', move);
  tgt.addEventListener('pointerup', up);
  tgt.addEventListener('pointercancel', up);
}

// desplazar la vista: arrastrando fuera del recorte o con el botón central
vp.addEventListener('pointerdown', (e) => {
  if (!media || (e.target !== vp && e.target !== frame && e.target !== box && e.target !== media && e.button !== 1)) return;
  if (e.button === 2) return;
  const sx = e.clientX - pan.x, sy = e.clientY - pan.y;
  vp.classList.add('panning');
  drag(e, (ev) => { pan.x = ev.clientX - sx; pan.y = ev.clientY - sy; layoutStage(); }, () => vp.classList.remove('panning'));
});

// recorte: esquinas, bordes o mover
cropEl.addEventListener('pointerdown', (e) => {
  if (S.tool !== 'crop' || e.button !== 0) return;
  e.stopPropagation();
  const [W, H] = oriented();
  const c0 = { ...cropRect() };
  const cls = e.target.classList;
  const mode = cls.contains('h') || cls.contains('e') ? [...cls].find((k) => ['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'].includes(k) && k !== 'h') : 'move';
  const x0 = e.clientX, y0 = e.clientY;
  const square = S.cropAspect === 'square';
  const MIN = Math.max(16, Math.min(W, H) * 0.03);
  cropEl.classList.add('dragging');
  drag(e, (ev) => {
    const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
    let { x, y, w, h } = c0;
    if (mode === 'move') {
      x = clamp(c0.x + dx, 0, W - w); y = clamp(c0.y + dy, 0, H - h);
    } else {
      let l = c0.x, t = c0.y, r = c0.x + c0.w, b = c0.y + c0.h;
      if (mode.includes('w')) l = clamp(l + dx, 0, r - MIN);
      if (mode.includes('e')) r = clamp(r + dx, l + MIN, W);
      if (mode.includes('n')) t = clamp(t + dy, 0, b - MIN);
      if (mode.includes('s')) b = clamp(b + dy, t + MIN, H);
      if (square) {
        // lado común; el borde opuesto queda fijo
        let side = ['n', 's'].includes(mode) ? b - t : ['w', 'e'].includes(mode) ? r - l : Math.max(r - l, b - t);
        const ax = mode.includes('w') ? c0.x + c0.w : mode.includes('e') ? c0.x : c0.x + c0.w / 2;
        const ay = mode.includes('n') ? c0.y + c0.h : mode.includes('s') ? c0.y : c0.y + c0.h / 2;
        const maxX = mode.includes('w') ? ax : mode.includes('e') ? W - ax : 2 * Math.min(ax, W - ax);
        const maxY = mode.includes('n') ? ay : mode.includes('s') ? H - ay : 2 * Math.min(ay, H - ay);
        side = clamp(side, MIN, Math.min(maxX, maxY));
        l = mode.includes('w') ? ax - side : mode.includes('e') ? ax : ax - side / 2;
        t = mode.includes('n') ? ay - side : mode.includes('s') ? ay : ay - side / 2;
        r = l + side; b = t + side;
      }
      x = l; y = t; w = r - l; h = b - t;
    }
    update((p) => { p.crop = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }; }, { commit: false });
  }, () => { cropEl.classList.remove('dragging'); commit(); });
});

// textos: seleccionar y arrastrar
layer.addEventListener('pointerdown', (e) => {
  if (S.tool !== 'text' || e.button !== 0) return;
  e.stopPropagation();
  const r = layer.getBoundingClientRect();
  const k = 512 / r.width;
  const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
  const t = T.hit(lctx, S.project.texts, px, py);
  S.textSel = t ? t.id : null;
  import('./panels.js').then((m) => m.renderPanel());
  layoutStage();
  if (!t) return;
  const ox = t.x - px, oy = t.y - py;
  drag(e, (ev) => {
    const nx = (ev.clientX - r.left) * k + ox, ny = (ev.clientY - r.top) * k + oy;
    update((p) => { const tt = p.texts.find((x) => x.id === t.id); tt.x = Math.round(clamp(nx, 0, 512)); tt.y = Math.round(clamp(ny, 0, 512)); }, { commit: false });
  }, () => commit());
});

new ResizeObserver(() => layoutStage()).observe(vp);
on('change', layoutStage);
on('load', layoutStage);

// ---------------------------------------------------------------- utilidades para los paneles
export function squareCrop() {
  const [W, H] = oriented();
  const c = cropRect();
  const side = Math.min(c.w, c.h, W, H);
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return { x: Math.round(clamp(cx - side / 2, 0, W - side)), y: Math.round(clamp(cy - side / 2, 0, H - side)), w: Math.round(side), h: Math.round(side) };
}

// Gira o voltea manteniendo el recorte sobre la misma zona de la imagen.
export function transformCrop(kind) {
  const [W, H] = oriented();
  const c = S.project.crop;
  if (!c) return null;
  if (kind === 'cw') return { x: H - c.y - c.h, y: c.x, w: c.h, h: c.w };
  if (kind === 'ccw') return { x: c.y, y: W - c.x - c.w, w: c.h, h: c.w };
  if (kind === 'h') return { ...c, x: W - c.x - c.w };
  if (kind === 'v') return { ...c, y: H - c.y - c.h };
  return c;
}
