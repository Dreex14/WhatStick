'use strict';
// yt-dlp (Unlicense, github.com/yt-dlp/yt-dlp): descarga de vídeos desde enlaces.
// No se incluye en el instalador: se descarga de su release oficial la primera vez que se
// usa, se comprueba con el SHA-256 que publica el propio proyecto y se puede actualizar.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { FFMPEG } = require('./ffmpeg');
const temp = require('./temp');

const BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const EXE = 'yt-dlp.exe';

function binPath(dir) { return path.join(dir, EXE); }
function installed(dir) { return fs.existsSync(binPath(dir)); }

async function install(dir, { onProgress, signal } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const sums = await (await fetch(BASE + 'SHA2-256SUMS', { signal })).text();
  const line = sums.split('\n').find((l) => l.trim().endsWith(' ' + EXE));
  if (!line) throw new Error('No se ha encontrado la suma de comprobación de yt-dlp');
  const expected = line.trim().split(/\s+/)[0].toLowerCase();
  const res = await fetch(BASE + EXE, { signal });
  if (!res.ok) throw new Error(`No se ha podido descargar yt-dlp (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0;
  for await (const c of res.body) { chunks.push(c); got += c.length; if (total && onProgress) onProgress(got / total); }
  const buf = Buffer.concat(chunks);
  const actual = crypto.createHash('sha256').update(buf).digest('hex');
  if (actual !== expected) throw new Error('La descarga de yt-dlp no coincide con su suma de comprobación; no se usará');
  const tmp = binPath(dir) + '.part';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, binPath(dir));
  return { path: binPath(dir), sha256: actual, bytes: buf.length };
}

function run(bin, args, { onLine, signal } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    if (signal) signal.addEventListener('abort', () => p.kill(), { once: true });
    let err = '', buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l && onLine) onLine(l); }
    });
    p.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (buf.trim() && onLine) onLine(buf.trim());
      if (signal && signal.aborted) reject(new Error('Descarga cancelada'));
      else if (code === 0) resolve();
      else reject(new Error(friendlyError(err)));
    });
  });
}

function friendlyError(err) {
  const last = err.trim().split('\n').filter((l) => /ERROR/.test(l)).pop() || err.trim().split('\n').pop() || '';
  if (/Unsupported URL/i.test(last)) return 'Ese enlace no es compatible';
  if (/private|login|sign in|cookies/i.test(last)) return 'El vídeo es privado o requiere iniciar sesión';
  if (/not available|unavailable|removed/i.test(last)) return 'El vídeo no está disponible';
  if (/max-filesize|larger than max/i.test(last)) return 'El vídeo es demasiado grande';
  return 'No se ha podido descargar: ' + last.replace(/^ERROR:\s*/, '').slice(0, 200);
}

/** Descarga el vídeo (máx. 720p, sin listas de reproducción) y devuelve la ruta del archivo. */
async function download(bin, url, { onProgress, signal } = {}) {
  const job = temp.job('enlace');
  let file = null;
  await run(bin, [
    '--no-playlist', '--ignore-config', '--no-config-locations', '--no-plugin-dirs', '--no-exec',
    '--no-mtime', '--restrict-filenames', '--newline',
    '--max-filesize', '500M',
    '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--ffmpeg-location', path.dirname(FFMPEG),
    '-o', path.join(job.dir, '%(title).60B [%(id)s].%(ext)s'),
    '--progress-template', 'download:PROG %(progress._percent_str)s',
    '--print', 'after_move:FILE %(filepath)s',
    '--', url,
  ], {
    signal,
    onLine: (l) => {
      if (l.startsWith('PROG') && onProgress) { const v = parseFloat(l.slice(5)); if (!isNaN(v)) onProgress(v / 100); }
      if (l.startsWith('FILE ')) file = l.slice(5).trim();
    },
  });
  if (!file || !fs.existsSync(file)) throw new Error('yt-dlp no ha generado ningún archivo');
  return file;
}

async function version(bin) {
  let v = '';
  await run(bin, ['--version'], { onLine: (l) => { v = l; } });
  return v;
}

async function update(bin) { await run(bin, ['-U']); return version(bin); }

module.exports = { binPath, installed, install, download, version, update };
