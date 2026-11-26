'use strict';
// Datos para la línea de tiempo: miniaturas reales del vídeo y forma de onda del audio.
const { ffmpeg } = require('./ffmpeg');

const src = (s) => s.proxy || s.path;

function splitJpegs(buf) {
  const out = [];
  let start = -1;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && start < 0) start = i;
    else if (buf[i] === 0xff && buf[i + 1] === 0xd9 && start >= 0) { out.push(buf.subarray(start, i + 2)); start = -1; i++; }
  }
  return out;
}

/** Un fotograma en JPEG en el instante t (búsqueda precisa). */
async function frameAt(source, t, { height = 360 } = {}) {
  const buf = await ffmpeg(['-ss', Math.max(0, t).toFixed(3), '-i', src(source), '-frames:v', '1',
    '-vf', `scale=-2:${height}`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'], { toBuffer: true });
  return buf;
}

/** count miniaturas repartidas por la duración, en paralelo (4 a la vez). */
async function thumbnails(source, { count = 12, height = 72, signal } = {}) {
  const d = source.duration || 0;
  if (!d) return [await frameAt(source, 0, { height })];
  const times = Array.from({ length: count }, (_, i) => (d * (i + 0.5)) / count);
  const out = new Array(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      out[i] = await ffmpeg(['-ss', times[i].toFixed(3), '-i', src(source), '-frames:v', '1',
        '-vf', `scale=-2:${height}`, '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '6', '-'], { toBuffer: true, signal })
        .catch(() => null);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out.map((b, i) => ({ t: times[i], jpeg: b && splitJpegs(b)[0] })).filter((x) => x.jpeg);
}

/** Forma de onda: `bars` pares [mín, máx] entre -1 y 1 de toda la pista de audio. */
async function waveform(file, { bars = 600, signal } = {}) {
  const pcm = await ffmpeg(['-i', file, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
    { toBuffer: true, signal });
  const n = Math.floor(pcm.length / 2);
  const per = Math.max(1, Math.floor(n / bars));
  const peaks = [];
  for (let b = 0; b < bars && b * per < n; b++) {
    let lo = 0, hi = 0;
    const end = Math.min(n, (b + 1) * per);
    for (let i = b * per; i < end; i++) {
      const v = pcm.readInt16LE(i * 2) / 32768;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks.push([+lo.toFixed(3), +hi.toFixed(3)]);
  }
  return { peaks, seconds: n / 8000 };
}

module.exports = { thumbnails, frameAt, waveform };
