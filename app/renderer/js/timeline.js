// Línea de tiempo: miniaturas, forma de onda, selección del fragmento, reproducción y fotograma.
import { $, clamp, fmtTime, parseTime, setIcon, toast, errorText } from './util.js';
import { S, on, update, commit } from './store.js';
import { getMedia } from './stage.js';

const tl = $('#timeline');
const track = $('#tl-track');
const sel = $('#tl-sel');
const head = $('#tl-head');
const wave = $('#tl-wave');
const mark = $('#tl-frame-mark');
const aux = $('#aux-audio');

let peaks = null;
let raf = 0;
let audioCtx = null;
const gains = new WeakMap();

const dur = () => S.source.duration || 0.001;
const fps = () => S.source.fps || 30;
const maxLen = () => 10 * S.project.speed;
const x2t = (x) => clamp(x / track.clientWidth, 0, 1) * dur();
const t2p = (t) => `${(clamp(t / dur(), 0, 1) * 100).toFixed(4)}%`;

// ---------------------------------------------------------------- carga
export async function setup() {
  stop();
  peaks = null;
  const video = S.source.kind !== 'image';
  tl.hidden = !video;
  $('#tl-thumbs').innerHTML = '';
  wave.getContext('2d').clearRect(0, 0, wave.width, wave.height);
  if (!video) return;
  const m = getMedia();
  m.loop = false;
  m.currentTime = S.project.trim.start || 0;
  refresh();
  const aspect = S.source.width / S.source.height || 1;
  const count = clamp(Math.round(track.clientWidth / (58 * aspect)), 6, 24);
  try {
    const th = await window.ws.thumbnails(S.source, count);
    $('#tl-thumbs').innerHTML = th.map((t) => `<img src="${t.src}" alt="">`).join('');
  } catch (e) { /* sin miniaturas */ }
  if (S.source.hasAudio) {
    try { peaks = (await window.ws.waveform(S.source.path, 800)).peaks; } catch (e) { peaks = null; }
  }
  drawWave();
}

function drawWave() {
  const c = wave;
  const w = (c.width = Math.round(c.clientWidth * devicePixelRatio));
  const hgt = (c.height = Math.round(c.clientHeight * devicePixelRatio));
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, hgt);
  if (!peaks) {
    ctx.fillStyle = '#3a414d';
    ctx.font = `${11 * devicePixelRatio}px Segoe UI`;
    ctx.fillText(S.source && S.source.kind !== 'image' && !S.source.hasAudio ? 'Sin audio' : '', 8 * devicePixelRatio, hgt * 0.68);
    return;
  }
  const mid = hgt / 2;
  const active = S.project.type === 'sound' && S.project.audio.mode === 'original';
  ctx.fillStyle = active ? '#2fe0a1' : '#56606f';
  const n = peaks.length;
  const top = Math.max(0.05, ...peaks.map(([lo, hi]) => hi - lo)); // normalizado: los audios flojos también se ven
  for (let x = 0; x < w; x++) {
    const [lo, hi] = peaks[Math.floor((x / w) * n)] || [0, 0];
    const a = Math.max(1, ((hi - lo) / top) * hgt * 0.9);
    ctx.fillRect(x, mid - a / 2, 1, a);
  }
}

// ---------------------------------------------------------------- pintar estado
export function refresh() {
  if (!S.source || S.source.kind === 'image') return;
  const p = S.project;
  const isStatic = p.type === 'static';
  sel.classList.toggle('static', isStatic);
  sel.style.left = t2p(p.trim.start);
  sel.style.width = `calc(${t2p(p.trim.end - p.trim.start)})`;
  $('#tl-shade-l').style.width = isStatic ? '0' : t2p(p.trim.start);
  $('#tl-shade-r').style.width = isStatic ? '0' : t2p(dur() - p.trim.end);
  mark.classList.toggle('on', isStatic);
  mark.style.left = t2p(p.frameTime);
  const out = (p.trim.end - p.trim.start) / p.speed;
  const durEl = $('#tl-dur');
  durEl.textContent = isStatic ? '' : `${out.toFixed(2).replace('.', ',')} s`;
  durEl.classList.toggle('bad', out > 10.001);
  durEl.title = isStatic ? '' : 'Duración del sticker';
  for (const [id, v] of [['#tl-start', p.trim.start], ['#tl-end', p.trim.end]]) {
    const el = $(id);
    if (document.activeElement !== el) el.value = fmtTime(v);
    el.disabled = isStatic;
  }
  $('#tl-speed').value = String(p.speed);
  $('#tl-speed').disabled = isStatic;
  $('#tl-frame').hidden = !isStatic;
  const m = getMedia();
  if (m && m.tagName === 'VIDEO') m.playbackRate = p.speed;
  applyAudio();
  updateHead();
}

function updateHead() {
  const m = getMedia();
  if (!m || m.tagName !== 'VIDEO') return;
  head.style.left = t2p(m.currentTime);
  $('#tl-time').textContent = fmtTime(m.currentTime);
}

// ---------------------------------------------------------------- audio de la vista previa
function gainFor(el) {
  if (!audioCtx) audioCtx = new AudioContext();
  if (!gains.has(el)) {
    const src = audioCtx.createMediaElementSource(el);
    const g = audioCtx.createGain();
    // limitador como el del sticker final, para que la vista previa no distorsione
    const lim = audioCtx.createDynamicsCompressor();
    lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.005; lim.release.value = 0.06;
    src.connect(g).connect(lim).connect(audioCtx.destination);
    gains.set(el, g);
  }
  return gains.get(el);
}

export function applyAudio() {
  const m = getMedia();
  const p = S.project;
  const sound = p.type === 'sound';
  if (m && m.tagName === 'VIDEO') {
    const orig = sound && p.audio.mode === 'original';
    m.muted = !orig;
    if (orig) gainFor(m).gain.value = p.audio.volume;
  }
  if (sound && p.audio.mode === 'file' && p.audio.url) {
    if (aux.dataset.url !== p.audio.url) { aux.src = p.audio.url; aux.dataset.url = p.audio.url; }
    gainFor(aux).gain.value = p.audio.volume;
  } else if (!aux.paused) aux.pause();
}

function syncAux() {
  const m = getMedia();
  const p = S.project;
  if (!(p.type === 'sound' && p.audio.mode === 'file' && p.audio.url)) return;
  const tau = (m.currentTime - p.trim.start) / p.speed;
  aux.currentTime = Math.max(0, (p.audio.offset || 0) + tau);
  if (!m.paused) aux.play().catch(() => {});
}

// ---------------------------------------------------------------- reproducción
export function isPlaying() { const m = getMedia(); return m && m.tagName === 'VIDEO' && !m.paused; }

export function play() {
  const m = getMedia();
  if (!m || m.tagName !== 'VIDEO') return;
  const p = S.project;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (p.type !== 'static' && (m.currentTime < p.trim.start || m.currentTime >= p.trim.end - 0.02)) m.currentTime = p.trim.start;
  m.play().then(() => { syncAux(); }).catch((e) => toast('No se puede reproducir: ' + errorText(e), 'error'));
  setIcon($('#tl-play'), 'pause');
  cancelAnimationFrame(raf);
  const loop = () => {
    if (m.paused) return;
    const pp = S.project;
    if (pp.type !== 'static' && m.currentTime >= pp.trim.end) {
      if ($('#tl-loop').classList.contains('on')) { m.currentTime = pp.trim.start; syncAux(); }
      else { stop(); m.currentTime = pp.trim.end; }
    }
    updateHead();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

export function stop() {
  const m = getMedia();
  if (m && m.tagName === 'VIDEO') m.pause();
  aux.pause();
  cancelAnimationFrame(raf);
  setIcon($('#tl-play'), 'play');
}

export function toggle() { isPlaying() ? stop() : play(); }

export function seek(t) {
  const m = getMedia();
  if (!m || m.tagName !== 'VIDEO') return;
  m.currentTime = clamp(t, 0, dur());
  syncAux();
  updateHead();
}

export function step(n) {
  const m = getMedia();
  if (!m || m.tagName !== 'VIDEO') return;
  stop();
  // al centro del fotograma siguiente/anterior, para que el navegador no muestre el anterior
  const f = Math.floor(m.currentTime * fps() + 1e-3) + n;
  seek((f + 0.5) / fps());
}

// ---------------------------------------------------------------- arrastres
function drag(e, move, end) {
  e.preventDefault();
  e.stopPropagation();
  const t = e.currentTarget;
  try { t.setPointerCapture(e.pointerId); } catch (err) { /* evento sintético */ }
  const mv = (ev) => move(ev);
  const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); end && end(); };
  t.addEventListener('pointermove', mv);
  t.addEventListener('pointerup', up);
}

track.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.tl-sel') && S.project.type !== 'static') return;
  const r = track.getBoundingClientRect();
  stop();
  seek(x2t(e.clientX - r.left));
  drag(e, (ev) => seek(x2t(ev.clientX - r.left)));
});

for (const hd of sel.querySelectorAll('.tl-h')) {
  hd.addEventListener('pointerdown', (e) => {
    const r = track.getBoundingClientRect();
    const isStart = hd.classList.contains('start');
    stop();
    drag(e, (ev) => {
      const t = x2t(ev.clientX - r.left);
      update((p) => {
        if (isStart) p.trim.start = clamp(t, Math.max(0, p.trim.end - maxLen()), p.trim.end - 0.1);
        else p.trim.end = clamp(t, p.trim.start + 0.1, Math.min(dur(), p.trim.start + maxLen()));
      }, { commit: false });
      seek(isStart ? S.project.trim.start : S.project.trim.end);
    }, () => { commit(); seek(S.project.trim.start); });
  });
}

sel.addEventListener('pointerdown', (e) => {
  if (e.target !== sel || S.project.type === 'static') return;
  const r = track.getBoundingClientRect();
  const t0 = x2t(e.clientX - r.left);
  const { start, end } = S.project.trim;
  const len = end - start;
  stop();
  sel.style.cursor = 'grabbing';
  drag(e, (ev) => {
    const d = x2t(ev.clientX - r.left) - t0;
    const s = clamp(start + d, 0, dur() - len);
    update((p) => { p.trim.start = s; p.trim.end = s + len; }, { commit: false });
    seek(s);
  }, () => { sel.style.cursor = ''; commit(); });
});

// ---------------------------------------------------------------- controles
$('#tl-play').onclick = toggle;
$('#tl-prev').onclick = () => step(-1);
$('#tl-next').onclick = () => step(1);
$('#tl-loop').onclick = (e) => e.currentTarget.classList.toggle('on');
$('#tl-speed').onchange = (e) => {
  const v = Number(e.target.value);
  update((p) => {
    p.speed = v;
    if ((p.trim.end - p.trim.start) / v > 10) p.trim.end = p.trim.start + 10 * v;
    p.trim.end = Math.min(p.trim.end, dur());
  });
};
for (const [id, key] of [['#tl-start', 'start'], ['#tl-end', 'end']]) {
  const el = $(id);
  el.addEventListener('change', () => {
    const t = parseTime(el.value);
    if (isNaN(t)) { el.value = fmtTime(S.project.trim[key]); toast('Escribe el tiempo como 0:01.250 o 1,25', 'warn'); return; }
    update((p) => {
      if (key === 'start') { p.trim.start = clamp(t, 0, dur() - 0.1); if (p.trim.end <= p.trim.start) p.trim.end = Math.min(dur(), p.trim.start + 1); }
      else { p.trim.end = clamp(t, 0.1, dur()); if (p.trim.start >= p.trim.end) p.trim.start = Math.max(0, p.trim.end - 1); }
      if ((p.trim.end - p.trim.start) / p.speed > 10) {
        if (key === 'start') p.trim.end = p.trim.start + 10 * p.speed; else p.trim.start = p.trim.end - 10 * p.speed;
        toast('El máximo son 10 segundos', 'warn');
      }
    });
    seek(S.project.trim[key]);
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.blur(); e.stopPropagation(); });
}
$('#tl-frame').onclick = () => {
  const m = getMedia();
  update((p) => { p.frameTime = m.currentTime; });
  toast(`Fotograma elegido: ${fmtTime(m.currentTime)}`);
};

on('change', refresh);
on('restore', () => { stop(); });
new ResizeObserver(() => { drawWave(); }).observe(track);
export const redrawWave = drawWave;
