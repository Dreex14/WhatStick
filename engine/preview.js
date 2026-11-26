'use strict';
// Versión reproducible por Chromium de cada fuente, solo para la vista previa del editor.
// Se usa el original siempre que se puede; si no, se crea una copia ligera temporal.
const fs = require('node:fs');
const { ffmpeg } = require('./ffmpeg');
const temp = require('./temp');

const PLAYABLE_VIDEO = ['h264', 'vp8', 'vp9', 'av1'];
const PLAYABLE_EXT = ['.mp4', '.m4v', '.mov', '.webm', '.mkv'];
const PLAYABLE_IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];
const cache = new Map();

async function previewFor(source, { onProgress } = {}) {
  const key = source.path;
  if (cache.has(key) && fs.existsSync(cache.get(key).path)) return cache.get(key);
  let r;
  if (source.kind === 'image') {
    if (PLAYABLE_IMAGE.includes(source.ext)) r = { kind: 'image', path: source.path };
    else {
      const out = temp.job('vista').file('imagen.png');
      await require('sharp')(source.path).png().toFile(out);
      r = { kind: 'image', path: out };
    }
  } else if (source.kind === 'video' && PLAYABLE_VIDEO.includes(source.videoCodec) && PLAYABLE_EXT.includes(source.ext)) {
    r = { kind: 'video', path: source.path };
  } else {
    onProgress && onProgress('Preparando la vista previa…');
    const out = temp.job('vista').file(source.kind === 'animation' ? 'animacion.webm' : 'video.mp4');
    const input = source.proxy || source.path;
    if (source.kind === 'animation') {
      // VP9 con canal alfa: Chromium lo reproduce conservando la transparencia
      await ffmpeg(['-i', input, '-an', '-vf', 'scale=w=min(iw\\,1280):h=-2', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
        '-b:v', '0', '-crf', '32', '-deadline', 'realtime', '-cpu-used', '8', '-g', '1', out]);
    } else {
      await ffmpeg(['-i', input, '-vf', 'scale=w=min(iw\\,1280):h=-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]);
    }
    r = { kind: 'video', path: out };
  }
  cache.set(key, r);
  return r;
}

module.exports = { previewFor };
