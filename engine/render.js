'use strict';
// Genera el sticker final a partir de un proyecto: aplica la edición con FFmpeg, ajusta
// calidad y fps para no pasar del límite de peso y añade los metadatos de WhatsApp.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ffmpeg } = require('./ffmpeg');
const webp = require('./webp');
const P = require('./project');

const S = P.LIMITS.size;
const sec = (n) => Math.max(0, Number(n)).toFixed(3);
const hex = (c) => '0x' + String(c).replace('#', '').slice(0, 6);
const num = (n) => Number(n).toFixed(4).replace(/\.?0+$/, '') || '0';

// ---------------------------------------------------------------- vídeo
function inputPath(p) { return p.source.proxy || p.source.path; }

function videoInputs(p, { still }) {
  const src = inputPath(p);
  const args = [];
  if (p.source.kind === 'image' && still) args.push('-i', src);
  else if (p.source.kind === 'image') args.push('-loop', '1', '-framerate', '1', '-t', sec(p.trim.end), '-i', src);
  else if (still) args.push('-ss', sec(p.frameTime), '-i', src);
  else args.push('-ss', sec(p.trim.start), '-t', sec(p.trim.end - p.trim.start), '-i', src);
  if (p.overlay) args.push('-i', p.overlay);
  return args;
}

// Grafo de filtros: orientación → recorte → ajustes → croma → velocidad → fps → encaje → fondo → textos.
function videoGraph(p, { fps, still }) {
  const g = [];
  let cur = '[0:v]';
  let n = 0;
  const step = (filters) => { const out = `[v${n++}]`; g.push(`${cur}${filters}${out}`); cur = out; };

  const pre = ['format=rgba'];
  const t = p.transform;
  if (t.rotate === 90) pre.push('transpose=1');
  if (t.rotate === 180) pre.push('hflip', 'vflip');
  if (t.rotate === 270) pre.push('transpose=2');
  if (t.flipH) pre.push('hflip');
  if (t.flipV) pre.push('vflip');
  if (p.crop) pre.push(`crop=${p.crop.w}:${p.crop.h}:${p.crop.x}:${p.crop.y}`);
  step(pre.join(','));

  const a = p.adjust;
  if (a.brightness !== 0 || a.contrast !== 1 || a.saturation !== 1) {
    // eq no conserva el canal alfa: se separa y se vuelve a unir.
    g.push(`${cur}split[c${n}][a${n}]`);
    g.push(`[a${n}]alphaextract[al${n}]`);
    g.push(`[c${n}]eq=brightness=${num(a.brightness)}:contrast=${num(a.contrast)}:saturation=${num(a.saturation)},format=rgb24[e${n}]`);
    g.push(`[e${n}][al${n}]alphamerge,format=rgba[v${n}]`);
    cur = `[v${n++}]`;
  }
  if (p.colorKey) {
    const k = p.colorKey;
    step(`colorkey=${hex(k.color)}:${num(k.similarity ?? 0.15)}:${num(k.blend ?? 0.05)}`);
  }

  const post = [];
  if (!still) post.push(`setpts=(PTS-STARTPTS)/${num(p.speed)}`, `fps=${fps}`);
  if (p.fit === 'cover') {
    post.push(`scale=${S}:${S}:force_original_aspect_ratio=increase:flags=lanczos`, `crop=${S}:${S}`);
  } else {
    post.push(`scale=${S}:${S}:force_original_aspect_ratio=decrease:flags=lanczos`,
      `pad=${S}:${S}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`);
  }
  post.push('format=rgba');
  step(post.join(','));

  if (p.background) {
    g.push(`color=c=${hex(p.background)}:s=${S}x${S}:r=${fps || 25},format=rgba[bg${n}]`);
    g.push(`[bg${n}]${cur}overlay=shortest=1:format=auto,format=rgba[v${n}]`);
    cur = `[v${n++}]`;
  }
  if (p.overlay) {
    g.push(`${cur}[1:v]overlay=0:0:format=auto,format=rgba[v${n}]`);
    cur = `[v${n++}]`;
  }
  g.push(`${cur}null[out]`);
  return g.join(';');
}

async function encodeStill(p, out, q, signal) {
  await ffmpeg([...videoInputs(p, { still: true }), '-filter_complex', videoGraph(p, { still: true }),
    '-map', '[out]', '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '6',
    '-q:v', String(q), out], { signal });
  return fs.statSync(out).size;
}

// every: si se indica, solo se codifica uno de cada «every» cuadros (muestra para estimar el peso).
async function encodeAnim(p, out, fps, q, signal, every = 0) {
  // Cada cuadro se codifica completo (libwebp, no libwebp_anim): sin restos del cuadro anterior.
  let graph = videoGraph(p, { fps, still: false });
  if (every > 1) graph += `;[out]select='not(mod(n\\,${every}))'[smp]`;
  await ffmpeg([...videoInputs(p, { still: false }), '-filter_complex', graph,
    '-map', every > 1 ? '[smp]' : '[out]', '-an', '-c:v', 'libwebp', '-lossless', '0', '-compression_level', '4',
    '-q:v', String(q), '-loop', '0', out], { signal });
  return fs.statSync(out).size;
}

const STILL_Q = [92, 85, 78, 70, 60, 50, 40, 30, 20];
const ANIM_Q = [80, 70, 60, 50, 40, 32, 25, 18, 12];

function fpsLadder(duration, sourceFps) {
  const base = duration <= 3 ? [25, 20, 15, 12, 10, 8] : duration <= 6 ? [20, 15, 12, 10, 8, 6] : [15, 12, 10, 8, 6, 5];
  const cap = sourceFps && sourceFps > 0 ? Math.max(5, Math.round(sourceFps)) : 30;
  const l = base.filter((f) => f <= cap);
  return l.length ? l : [Math.min(cap, base[base.length - 1])];
}

// Busca la mejor combinación fps × calidad que cabe en el límite. El peso crece de forma
// lineal con el número de cuadros (cada cuadro es independiente), así que basta medir el
// peso por cuadro de cada calidad para predecir el resto de combinaciones.
async function fitAnimated(p, out, limit, signal, onProgress) {
  const dur = P.outputDuration(p);
  // una imagen fija con sonido no necesita fluidez: pocos cuadros iguales
  const fpsList = p.source.kind === 'image' ? [1, 0.5, 0.25].filter((f) => f * dur >= 1 || f === 0.25) : fpsLadder(dur, p.source.fps * p.speed);
  const frames = (f) => Math.max(1, Math.round(dur * f));
  const f0 = fpsList[0];
  const n0 = frames(f0);

  // 1) Muestra: ~24 cuadros repartidos por todo el clip, codificados con cada calidad.
  //    Como los cuadros son independientes, el peso medio por cuadro de la muestra
  //    predice el del clip entero con cualquier fps.
  const every = n0 > 36 ? Math.floor(n0 / 24) : 0;
  const perFrame = new Map(); // calidad → bytes por cuadro
  onProgress && onProgress({ stage: 'video', attempt: 0, fps: f0, quality: 'muestra' });
  const qs = [...ANIM_Q];
  const sampleOut = (q) => `${out}.m${q}.webp`;
  await Promise.all([0, 1, 2].map(async (w) => {
    for (let i = w; i < qs.length; i += 3) {
      const size = await encodeAnim(p, sampleOut(qs[i]), f0, qs[i], signal, every);
      const n = every > 1 ? Math.ceil(n0 / every) : n0;
      perFrame.set(qs[i], size / n);
      fs.rmSync(sampleOut(qs[i]), { force: true });
    }
  }));

  // 2) Candidatos ordenados de mejor a peor; se prueba el mejor que se prevé que quepa.
  let factor = 1; // corrección si la predicción se queda corta
  const est = (f, q) => perFrame.get(q) * frames(f) * factor;
  const cands = [];
  for (const f of fpsList) for (const q of ANIM_Q) cands.push({ f, q, s: score(f, q) });
  cands.sort((a, b) => b.s - a.s);
  const tried = new Set();
  let last = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const c = cands.find((x) => !tried.has(`${x.f}/${x.q}`) && est(x.f, x.q) <= limit * 0.95);
    if (!c) break;
    tried.add(`${c.f}/${c.q}`);
    onProgress && onProgress({ stage: 'video', attempt, fps: c.f, quality: c.q });
    const size = await encodeAnim(p, out, c.f, c.q, signal);
    last = { fps: c.f, q: c.q, size };
    if (size <= limit) {
      // si sobra espacio, una mejora con la predicción ya calibrada por este resultado
      if (size < limit * 0.88) {
        const k = size / (perFrame.get(c.q) * frames(c.f));
        const up = cands.find((x) => x.s > c.s && !tried.has(`${x.f}/${x.q}`) && perFrame.get(x.q) * frames(x.f) * k <= limit * 0.97);
        if (up) {
          fs.copyFileSync(out, out + '.ok');
          onProgress && onProgress({ stage: 'video', attempt: attempt + 1, fps: up.f, quality: up.q });
          const s2 = await encodeAnim(p, out, up.f, up.q, signal);
          if (s2 <= limit) { fs.rmSync(out + '.ok', { force: true }); return { fps: up.f, q: up.q, size: s2, fits: true }; }
          fs.renameSync(out + '.ok', out);
        }
      }
      return { ...last, fits: true };
    }
    factor = Math.max(factor, (size / est(c.f, c.q)) * factor * 1.02); // ajustar y probar el siguiente
  }
  // 3) Último recurso: la versión más ligera posible (avisa si aun así no cabe)
  const f = fpsList[fpsList.length - 1], q = ANIM_Q[ANIM_Q.length - 1];
  const size = await encodeAnim(p, out, f, q, signal);
  return { fps: f, q, size, fits: size <= limit };
}

// Preferencia: fluidez primero hasta 10 fps, luego calidad; por debajo de calidad 30 se penaliza.
function score(fps, q) {
  return Math.min(fps, 10) * 12 + Math.max(0, Math.min(fps, 15) - 10) * 3 + Math.max(0, fps - 15)
    + Math.min(q, 60) + Math.max(0, q - 60) * 0.5 - (q < 30 ? (30 - q) * 2 : 0);
}

async function fitStill(p, out, limit, signal) {
  let r = null;
  for (const q of STILL_Q) {
    const size = await encodeStill(p, out, q, signal);
    r = { q, size };
    if (size <= limit) return { ...r, fits: true };
  }
  return { ...r, fits: false };
}

// ---------------------------------------------------------------- audio
function atempoChain(speed) {
  const f = [];
  let s = speed;
  while (s > 2) { f.push('atempo=2'); s /= 2; }
  while (s < 0.5) { f.push('atempo=0.5'); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-6) f.push(`atempo=${num(s)}`);
  return f;
}

// Audio del sticker con sonido: Opus mono 48 kHz, exactamente de la duración de la animación.
async function renderAudio(p, out, seconds, signal) {
  const args = [];
  const filters = [];
  if (p.audio.mode === 'file') {
    args.push('-ss', sec(p.audio.offset || 0), '-i', p.audio.file);
  } else {
    args.push('-ss', sec(p.trim.start), '-t', sec(p.trim.end - p.trim.start), '-i', inputPath(p));
    filters.push(...atempoChain(p.speed));
  }
  filters.push('aresample=48000:first_pts=0');
  // igualar volumen: sonoridad estándar (EBU R128, -16 LUFS como en el móvil)
  if (p.audio.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11', 'aresample=48000');
  filters.push(`volume=${num(p.audio.volume)}`,
    // limitador: al subir el volumen los picos no se recortan ni distorsionan
    'alimiter=limit=0.89:level=false:attack=5:release=60:latency=true',
    `apad=whole_dur=${sec(seconds)}`, `atrim=0:${sec(seconds)}`,
    'afade=t=in:d=0.008', `afade=t=out:st=${sec(Math.max(0, seconds - 0.008))}:d=0.008`);
  await ffmpeg([...args, '-map', '0:a:0', '-vn', '-af', filters.join(','), '-ac', '1',
    '-c:a', 'libopus', '-b:a', '48k', '-application', 'audio', '-map_metadata', '-1', out], { signal });
  let bytes = fs.statSync(out).size;
  if (bytes > P.LIMITS.audioBytes) { // solo ocurre con audios larguísimos: se reduce el bitrate
    await ffmpeg([...args, '-map', '0:a:0', '-vn', '-af', filters.join(','), '-ac', '1',
      '-c:a', 'libopus', '-b:a', '24k', '-map_metadata', '-1', out], { signal });
    bytes = fs.statSync(out).size;
  }
  return { file: out, bytes, seconds, fits: bytes <= P.LIMITS.audioBytes };
}

// ---------------------------------------------------------------- principal
function stickerMeta(p, soundSha256) {
  const m = {
    'sticker-pack-id': crypto.randomUUID(),
    // WhatsApp muestra «paquete · autor» debajo del sticker
    'sticker-pack-name': p.output.packName || 'Mis stickers',
    'sticker-pack-publisher': p.output.author || '',
    emojis: p.output.emojis && p.output.emojis.length ? p.output.emojis : ['😀'],
  };
  if (soundSha256) m['sound-sha256'] = soundSha256;
  return m;
}

/**
 * Genera el sticker. Devuelve { webp, audio?, warnings }.
 * opts: { outDir, base = 'sticker', signal, onProgress }
 */
async function render(project, { outDir, base = 'sticker', signal, onProgress } = {}) {
  const p = JSON.parse(JSON.stringify(project));
  const warnings = P.normalize(p);
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${base}.webp`);
  const limit = P.limitFor(p);
  const t0 = Date.now();

  let enc;
  if (p.type === 'static') enc = await fitStill(p, out, limit, signal);
  else enc = await fitAnimated(p, out, limit, signal, onProgress);

  let buf = fs.readFileSync(out);
  const info = webp.inspect(buf);
  let audio = null;
  let soundSha256 = null;
  if (p.type === 'sound') {
    onProgress && onProgress({ stage: 'audio' });
    // el audio dura exactamente lo mismo que la animación generada
    audio = await renderAudio(p, path.join(outDir, `${base}.ogg`), info.durationMs / 1000, signal);
    soundSha256 = crypto.createHash('sha256').update(fs.readFileSync(audio.file)).digest('base64');
    if (!audio.fits) warnings.push('El audio supera 1 MB');
  }
  buf = webp.setExif(buf, stickerMeta(p, soundSha256));
  fs.writeFileSync(out, buf);
  if (!enc.fits || buf.length > limit) {
    warnings.push(`El sticker pesa ${(buf.length / 1024).toFixed(0)} KB y supera el límite de ${(limit / 1024).toFixed(0)} KB`);
  }
  return {
    type: p.type,
    webp: { file: out, bytes: buf.length, limit, fps: enc.fps || null, quality: enc.q, ...info },
    audio,
    soundSha256,
    warnings,
    ms: Date.now() - t0,
  };
}

// Comprueba un sticker ya generado frente a los requisitos de WhatsApp.
function validate(file, type, limit) {
  const buf = fs.readFileSync(file);
  const i = webp.inspect(buf);
  const max = limit || (type === 'static' ? P.LIMITS.staticBytes : P.LIMITS.animatedBytes);
  const problems = [];
  if (i.width !== S || i.height !== S) problems.push(`mide ${i.width}×${i.height}, debe medir 512×512`);
  if (buf.length > max) problems.push(`pesa ${(buf.length / 1024).toFixed(1)} KB; el máximo es ${(max / 1024).toFixed(0)} KB`);
  if (type !== 'static' && !i.animated) problems.push('no está animado');
  if (type === 'static' && i.animated) problems.push('está animado');
  if (i.minFrameMs != null && i.minFrameMs < P.LIMITS.minFrameMs) problems.push(`tiene cuadros de ${i.minFrameMs} ms (mínimo 8 ms)`);
  if (i.durationMs > P.LIMITS.maxSeconds * 1000 + 50) problems.push(`dura ${(i.durationMs / 1000).toFixed(2)} s (máximo 10 s)`);
  const exif = webp.readExif(buf);
  if (!exif) problems.push('le faltan los metadatos de WhatsApp');
  if (type === 'sound' && !(exif && exif['sound-sha256'])) problems.push('falta el enlace con el audio (sound-sha256)');
  return { ...i, bytes: buf.length, exif, ok: problems.length === 0, problems };
}

/**
 * Vídeo MP4 cuadrado (512×512, H.264 + AAC) del sticker con su sonido, para crear el sticker
 * desde el móvil con la función «Crear sticker» de WhatsApp. No depende de la vinculación.
 * El MP4 no admite transparencia: se usa el color de fondo elegido o blanco.
 */
async function renderMp4(project, { out, signal } = {}) {
  const p = JSON.parse(JSON.stringify(project));
  if (p.type === 'static') p.type = p.source.kind === 'image' ? 'static' : 'animated';
  if (p.type === 'static') throw new Error('El vídeo solo tiene sentido para stickers animados o con sonido');
  P.normalize(p);
  if (!p.background) p.background = '#ffffff';
  const dur = P.outputDuration(p);
  const fps = p.source.kind === 'image' ? 25 : Math.min(30, Math.round((p.source.fps || 30) * p.speed) || 30);
  const args = videoInputs(p, { still: false });
  let audioFile = null;
  if (p.type === 'sound') {
    audioFile = out.replace(/\.mp4$/i, '') + '.tmp.ogg';
    await renderAudio(p, audioFile, dur, signal);
    args.push('-i', audioFile);
  }
  const audioIndex = args.filter((a) => a === '-i').length - 1;
  try {
    await ffmpeg([...args, '-filter_complex', videoGraph(p, { fps, still: false }), '-map', '[out]',
      ...(audioFile ? ['-map', `${audioIndex}:a:0`, '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-t', sec(dur), out], { signal });
  } finally {
    if (audioFile) fs.rmSync(audioFile, { force: true });
  }
  return { file: out, bytes: fs.statSync(out).size, seconds: dur };
}

module.exports = { render, renderMp4, validate, videoGraph, atempoChain, fpsLadder };
