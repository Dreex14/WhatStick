'use strict';
// Importación de contenido: archivos locales, imágenes del portapapeles, audio y enlaces.
const fs = require('node:fs');
const path = require('node:path');
const { ffmpeg, probe } = require('./ffmpeg');
const temp = require('./temp');

// Sin caché de sharp: si no, Windows mantiene bloqueados los archivos del usuario.
require('sharp').cache(false);

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.avif', '.tif', '.tiff'];
const VIDEO_EXT = ['.mp4', '.mkv', '.mov', '.webm', '.avi', '.m4v', '.3gp', '.wmv', '.flv', '.ts', '.mts'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.opus', '.m4a', '.aac', '.flac', '.wma'];
const MAX_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

function frameRate(stream) {
  if (!stream) return 0;
  for (const k of ['avg_frame_rate', 'r_frame_rate']) {
    const [a, b] = String(stream[k] || '0/0').split('/').map(Number);
    if (a > 0 && b > 0 && a / b < 240) return a / b;
  }
  return 0;
}

// Las animaciones WebP no las lee FFmpeg 6: se convierten con sharp a un vídeo intermedio
// sin pérdida (PNG en MOV, con transparencia) que solo se usa para procesar.
async function animatedWebpProxy(file) {
  const sharp = require('sharp');
  const meta = await sharp(file, { animated: true }).metadata();
  if (!meta.pages || meta.pages < 2) return null;
  const job = temp.job('webp');
  const h = meta.pageHeight || meta.height;
  const lines = ['ffconcat version 1.0'];
  for (let i = 0; i < meta.pages; i++) {
    const out = job.file(`f${String(i).padStart(5, '0')}.png`);
    await sharp(file, { page: i }).png({ compressionLevel: 1 }).toFile(out);
    const d = Math.max(10, (meta.delay && meta.delay[i]) || 100) / 1000;
    lines.push(`file '${path.basename(out)}'`, `duration ${d.toFixed(3)}`);
  }
  lines.push(`file 'f${String(meta.pages - 1).padStart(5, '0')}.png'`); // necesario para respetar la última duración
  fs.writeFileSync(job.file('lista.txt'), lines.join('\n'));
  const proxy = job.file('animacion.mov');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', job.file('lista.txt'), '-fps_mode', 'vfr',
    '-c:v', 'png', '-pix_fmt', 'rgba', proxy]);
  const total = (meta.delay || []).reduce((s, d) => s + Math.max(10, d || 100), 0) / 1000;
  return { proxy, width: meta.width, height: h, duration: total, fps: meta.pages / total };
}

/** Analiza un archivo y devuelve la descripción de la fuente para un proyecto. */
async function importFile(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('No es un archivo');
  if (st.size > MAX_IMPORT_BYTES) throw new Error('El archivo es demasiado grande (máximo 2 GB)');
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file, ext);
  const base = { path: file, name, ext, bytes: st.size };

  if (ext === '.webp' || ext === '.png' || ext === '.avif') {
    // WebP/APNG animados: FFmpeg no los decodifica bien, se preparan con sharp.
    if (ext === '.webp') {
      const anim = await animatedWebpProxy(file).catch(() => null);
      if (anim) return { ...base, kind: 'animation', hasAudio: false, hasAlpha: true, ...anim };
    }
    const sharp = require('sharp');
    const m = await sharp(file).metadata();
    if (ext !== '.png' || !(m.pages > 1)) {
      return { ...base, kind: 'image', width: m.width, height: m.height, duration: 0, fps: 0, hasAudio: false, hasAlpha: !!m.hasAlpha };
    }
  }

  let gifMeta = null;
  if (ext === '.gif') {
    // FFprobe no da la duración de los GIF: se calcula con los retardos de cada cuadro.
    const m = await require('sharp')(file, { animated: true }).metadata();
    const total = (m.delay || []).reduce((s, d) => s + (d > 10 ? d : 100), 0) / 1000;
    gifMeta = { pages: m.pages || 1, duration: total, fps: total ? (m.pages || 1) / total : 0 };
  }
  let info;
  try { info = await probe(file); } catch (e) { throw new Error('Formato no compatible o archivo dañado'); }
  if (!info.hasVideo) {
    if (info.hasAudio) throw new Error('Es un archivo de audio: añádelo desde la sección de audio');
    throw new Error('El archivo no contiene imagen ni vídeo');
  }
  const v = info.raw.streams.find((s) => s.codec_type === 'video');
  const fps = gifMeta ? gifMeta.fps : frameRate(v);
  const frames = gifMeta ? gifMeta.pages : Number(v.nb_frames) || 0;
  if (gifMeta) info.duration = gifMeta.pages > 1 ? gifMeta.duration : 0;
  const isStill = IMAGE_EXT.includes(ext) && ext !== '.gif' ? true : (info.duration === 0 || frames === 1);
  let width = info.width, height = info.height;
  // vídeos de móvil grabados en vertical: FFmpeg los gira al decodificar
  const rot = Math.abs(Number((v.side_data_list || []).find((d) => d.rotation != null)?.rotation || v.tags?.rotate || 0));
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  return {
    ...base,
    kind: isStill ? 'image' : ext === '.gif' ? 'animation' : 'video',
    width, height,
    duration: isStill ? 0 : info.duration,
    fps,
    hasAudio: info.hasAudio,
    hasAlpha: /a|rgba|bgra|argb|pal8/.test(v.pix_fmt || '') && !/yuv420p$/.test(v.pix_fmt || ''),
    videoCodec: info.videoCodec,
  };
}

/** Guarda una imagen del portapapeles (PNG) y la importa. */
async function importImageBuffer(buffer, name = 'Portapapeles') {
  const job = temp.job('pegado');
  const file = job.file(`${name}.png`);
  await require('sharp')(buffer).png().toFile(file);
  return importFile(file);
}

/** Audio para sustituir el original. */
async function importAudio(file) {
  const info = await probe(file);
  if (!info.hasAudio) throw new Error('El archivo no tiene audio');
  return { path: file, name: path.basename(file), duration: info.duration, codec: info.audioCodec };
}

// ---------------------------------------------------------------- enlaces
const MYINSTANTS_HOSTS = ['www.myinstants.com', 'myinstants.com'];

function parseHttpUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (e) { throw new Error('El enlace no es válido'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Solo se admiten enlaces http y https');
  if (u.username || u.password) throw new Error('El enlace no puede llevar usuario ni contraseña');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':') || h.endsWith('.local')) {
    throw new Error('No se admiten direcciones locales ni IP');
  }
  return u;
}

const isMyInstants = (u) => MYINSTANTS_HOSTS.includes(u.hostname.toLowerCase());

// MyInstants: la página contiene la ruta /media/sounds/…; se descarga ese audio.
// Basado en el extractor de StikSound (MIT/Apache-2.0, github.com/SilverFeit/StikSound).
async function downloadMyInstants(u, { signal } = {}) {
  let media, title;
  if (/^\/media\/sounds\/[^/]+\.(mp3|wav|ogg|m4a)$/i.test(u.pathname)) {
    media = u;
    title = decodeURIComponent(path.basename(u.pathname, path.extname(u.pathname)));
  } else {
    const res = await fetch(u, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`MyInstants respondió ${res.status}`);
    const html = (await res.text()).slice(0, 2_000_000);
    const m = html.match(/(\/media\/sounds\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.(?:mp3|wav|ogg|m4a))/i);
    if (!m) throw new Error('No se ha encontrado el sonido en la página de MyInstants');
    media = new URL(m[1], 'https://www.myinstants.com');
    title = (html.match(/property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] || 'MyInstants';
  }
  title = title.replace(/\s*[-|].*$/, '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'MyInstants';
  const r2 = await fetch(media, { signal, redirect: 'error' });
  if (!r2.ok) throw new Error(`No se ha podido descargar el sonido (${r2.status})`);
  if (Number(r2.headers.get('content-length')) > 25 * 1024 * 1024) throw new Error('El sonido es demasiado grande');
  const buf = Buffer.from(await r2.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('El sonido es demasiado grande');
  const file = temp.job('myinstants').file(`${title}${path.extname(media.pathname)}`);
  fs.writeFileSync(file, buf);
  return file;
}

/**
 * Importa un enlace. Devuelve { kind: 'audio', audio } para MyInstants o la fuente de vídeo.
 * opts: { ytdlp (ruta a yt-dlp.exe), onProgress(0..1), signal }
 */
async function importUrl(raw, { ytdlp, onProgress, signal } = {}) {
  const u = parseHttpUrl(raw);
  if (isMyInstants(u)) {
    if (!/^\/([a-z]{2}(-[a-z]{2})?\/)?instant\//i.test(u.pathname) && !/^\/media\/sounds\//.test(u.pathname)) throw new Error('Pega el enlace de un sonido concreto de MyInstants');
    const file = await downloadMyInstants(u, { signal });
    return { kind: 'audio', audio: await importAudio(file) };
  }
  if (!ytdlp) throw new Error('Falta yt-dlp para descargar enlaces de vídeo');
  const file = await require('./ytdlp').download(ytdlp, u.toString(), { onProgress, signal });
  return { kind: 'source', source: await importFile(file) };
}

module.exports = { importFile, importImageBuffer, importAudio, importUrl, parseHttpUrl, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT };
