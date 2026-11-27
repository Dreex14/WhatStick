'use strict';
// Ejecución de FFmpeg y FFprobe (binarios locales, sin shell).
const { spawn } = require('node:child_process');

// En la app empaquetada los binarios están fuera del archivo app.asar.
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const FFMPEG = process.env.WHATSTICK_FFMPEG || unpacked(require('ffmpeg-static'));
const FFPROBE = process.env.WHATSTICK_FFPROBE || unpacked(require('ffprobe-static').path);

function run(bin, args, { toBuffer = false, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError());
    const p = spawn(bin, args, { windowsHide: true });
    const onAbort = () => { p.kill(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) reject(abortError());
      else if (code === 0) resolve(toBuffer ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'));
      else reject(new Error(`${bin.split(/[\\/]/).pop()} terminó con código ${code}: ${err.trim().split('\n').slice(-4).join(' | ')}`));
    });
  });
}

function abortError() { const e = new Error('Operación cancelada'); e.name = 'AbortError'; return e; }

const ffmpeg = (args, opts) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);

async function probe(file) {
  const json = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(json);
  const v = info.streams.find((s) => s.codec_type === 'video');
  const a = info.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(info.format.duration) || 0,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    hasVideo: !!v,
    hasAudio: !!a,
    videoCodec: v && v.codec_name,
    audioCodec: a && a.codec_name,
    raw: info,
  };
}

module.exports = { ffmpeg, probe, FFMPEG, FFPROBE };
