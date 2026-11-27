'use strict';
// Prueba de importación por enlace: yt-dlp (vídeo con licencia libre) y MyInstants.
const path = require('node:path');
const os = require('node:os');
const Y = require('../engine/ytdlp');
const I = require('../engine/importer');
const P = require('../engine/project');
const { render, validate } = require('../engine/render');
const BIN = path.join(process.env.APPDATA || os.homedir(), 'Electron', 'bin');
const OUT = path.join(__dirname, 'out');
(async () => {
  if (!Y.installed(BIN)) { const r = await Y.install(BIN); console.log('yt-dlp instalado', (r.bytes / 1e6).toFixed(1), 'MB, sha256', r.sha256.slice(0, 16) + '…'); }
  console.log('versión yt-dlp', await Y.version(Y.binPath(BIN)));
  let last = -1;
  const v = await I.importUrl(process.argv[2], { ytdlp: Y.binPath(BIN), onProgress: (f) => { const p = Math.floor(f * 4); if (p !== last) { last = p; console.log('  descarga', Math.round(f * 100) + '%'); } } });
  const s = v.source;
  console.log('vídeo:', s.kind, `${s.width}×${s.height}`, s.duration.toFixed(2), 's, audio:', s.hasAudio, s.videoCodec);
  const p = P.defaults(s);
  const r = await render(p, { outDir: OUT, base: 'enlace' });
  const val = validate(r.webp.file, p.type);
  console.log('sticker', p.type, (r.webp.bytes / 1024).toFixed(0), 'KB', r.webp.fps, 'fps', 'ok:', val.ok, val.problems.join('; '), r.audio ? `audio ${(r.audio.bytes / 1024).toFixed(0)} KB` : '');
  // MyInstants: primer sonido de la portada
  const home = await (await fetch('https://www.myinstants.com/es/index/es/', { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const m = home.match(/href="(\/es\/instant\/[^"]+)"/);
  const url = 'https://www.myinstants.com' + m[1];
  const a = await I.importUrl(url);
  console.log('MyInstants:', a.kind, path.basename(a.audio.path), a.audio.duration.toFixed(2), 's', a.audio.codec);
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
