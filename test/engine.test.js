'use strict';
// Pruebas del motor multimedia con fuentes generadas al vuelo. Uso: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
sharp.cache(false);
const { ffmpeg, probe } = require('../engine/ffmpeg');
const temp = require('../engine/temp');
const P = require('../engine/project');
const { render, validate } = require('../engine/render');
const I = require('../engine/importer');
const T = require('../engine/timeline');

const job = temp.job('pruebas');
const F = {};
const out = (n) => job.file(n);

test.before(async () => {
  // vídeo 16:9, 4 s, contador y un pitido de 150 ms al empezar cada segundo
  F.video = out('video.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-f', 'lavfi', '-i', "sine=frequency=880:sample_rate=48000:duration=4,volume='if(lt(mod(t,1),0.15),1,0)':eval=frame",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', F.video]);
  // vídeo largo con ruido (difícil de comprimir), sin audio
  F.long = out('largo.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=15,noise=alls=30:allf=t',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', F.long]);
  // PNG con transparencia: círculo rojo sobre fondo transparente
  F.png = out('circulo.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><circle cx="400" cy="300" r="250" fill="#e11"/></svg>')).png().toFile(F.png);
  F.gif = out('anim.gif');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=2', F.gif]);
  F.mp3 = out('tono.mp3');
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:a', 'libmp3lame', F.mp3]);
  F.overlay = out('texto.png');
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect x="0" y="440" width="512" height="72" fill="#00ff00"/></svg>')).png().toFile(F.overlay);
});

test.after(() => job.dispose());

async function pixel(file, x, y) {
  const { data, info } = await sharp(file).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [...data.subarray(i, i + 4)];
}

// Momento (s) del primer sonido audible de un archivo
async function firstSound(file) {
  const pcm = await ffmpeg(['-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { toBuffer: true });
  for (let i = 0; i < pcm.length / 2; i++) if (Math.abs(pcm.readInt16LE(i * 2)) > 3000) return i / 48000;
  return null;
}

test('importa los formatos habituales', async () => {
  const v = await I.importFile(F.video);
  assert.equal(v.kind, 'video'); assert.equal(v.hasAudio, true); assert.equal(v.width, 1280);
  const g = await I.importFile(F.gif);
  assert.equal(g.kind, 'animation');
  const p = await I.importFile(F.png);
  assert.equal(p.kind, 'image'); assert.equal(p.hasAlpha, true);
  await assert.rejects(I.importFile(F.mp3), /audio/);
});

test('estático desde PNG: 512×512, transparencia, ≤ 100 KB', async () => {
  const p = P.defaults(await I.importFile(F.png));
  const r = await render(p, { outDir: job.dir, base: 'png' });
  const v = validate(r.webp.file, 'static');
  assert.ok(v.ok, v.problems.join('; '));
  assert.equal((await pixel(r.webp.file, 2, 2))[3], 0, 'la esquina debe ser transparente');
  assert.ok((await pixel(r.webp.file, 256, 256))[0] > 200, 'el centro debe ser rojo');
});

test('estático desde un fotograma de vídeo y con color de fondo', async () => {
  const p = P.defaults(await I.importFile(F.video));
  p.type = 'static'; p.frameTime = 2; p.background = '#0000ff';
  const r = await render(p, { outDir: job.dir, base: 'frame' });
  assert.ok(validate(r.webp.file, 'static').ok);
  const px = await pixel(r.webp.file, 256, 10); // margen superior, rellenado de azul
  assert.ok(px[2] > 200 && px[3] === 255, `esperaba azul opaco, ${px}`);
});

test('animado con recorte, rotación, volteo, ajustes, croma, velocidad y texto', async () => {
  const p = P.defaults(await I.importFile(F.video));
  Object.assign(p, {
    type: 'animated', trim: { start: 0.5, end: 3.5 }, speed: 2,
    transform: { rotate: 90, flipH: true, flipV: false },
    crop: { x: 0, y: 100, w: 720, h: 720 },
    adjust: { brightness: 0.05, contrast: 1.2, saturation: 1.3 },
    colorKey: { color: '#ffffff', similarity: 0.1, blend: 0.05 },
    overlay: F.overlay,
  });
  const r = await render(p, { outDir: job.dir, base: 'edit' });
  const v = validate(r.webp.file, 'animated');
  assert.ok(v.ok, v.problems.join('; '));
  assert.ok(Math.abs(v.durationMs - 1500) < 120, `duración ${v.durationMs} ms, esperaba 1500`);
  const px = await pixel(r.webp.file, 256, 480); // franja verde del texto
  assert.ok(px[1] > 200 && px[0] < 80, `esperaba el texto verde, ${px}`);
});

test('vídeo largo y ruidoso: se acorta a 10 s y cabe en 500 KB', async () => {
  const p = P.defaults(await I.importFile(F.long));
  p.trim = { start: 0, end: 15 };
  const r = await render(p, { outDir: job.dir, base: 'largo' });
  const v = validate(r.webp.file, 'animated');
  assert.ok(v.ok, v.problems.join('; '));
  assert.ok(r.warnings.some((w) => /10 s/.test(w)));
  assert.ok(v.durationMs <= 10050);
  console.log(`   largo: ${r.webp.fps} fps, q${r.webp.quality}, ${(r.webp.bytes / 1024).toFixed(0)} KB, ${r.ms} ms`);
});

test('con sonido: audio sincronizado, misma duración y enlazado por SHA-256', async () => {
  const p = P.defaults(await I.importFile(F.video));
  p.trim = { start: 0.5, end: 3.5 };
  const r = await render(p, { outDir: job.dir, base: 'sonido' });
  const v = validate(r.webp.file, 'sound');
  assert.ok(v.ok, v.problems.join('; '));
  const a = await probe(r.audio.file);
  assert.equal(a.audioCodec, 'opus');
  assert.equal(a.raw.streams[0].channels, 1);
  assert.ok(Math.abs(a.duration - v.durationMs / 1000) < 0.03, `audio ${a.duration} s, animación ${v.durationMs} ms`);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(r.audio.file)).digest('base64');
  assert.equal(v.exif['sound-sha256'], sha);
  // el primer pitido del original está en 1,0 s; recortando desde 0,5 debe sonar a 0,5 s
  const t = await firstSound(r.audio.file);
  assert.ok(Math.abs(t - 0.5) < 0.03, `primer pitido a ${t} s, esperaba 0,5 s`);
});

async function peak(file) {
  const pcm = await ffmpeg(['-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { toBuffer: true });
  let m = 0;
  for (let i = 0; i < pcm.length / 2; i++) m = Math.max(m, Math.abs(pcm.readInt16LE(i * 2)) / 32768);
  return m;
}

test('volumen: el limitador evita la distorsión e «igualar» sube los audios flojos, sin desincronizar', async () => {
  const base = P.defaults(await I.importFile(F.video));
  base.trim = { start: 0.5, end: 3.5 };
  const r0 = await render(base, { outDir: job.dir, base: 'vol1' });
  const p0 = await peak(r0.audio.file);
  const loud = { ...base, audio: { ...base.audio, volume: 4, normalize: true }, trim: { ...base.trim } };
  const r1 = await render(loud, { outDir: job.dir, base: 'vol3' });
  const p1 = await peak(r1.audio.file);
  assert.ok(p1 <= 0.97, `pico ${p1.toFixed(3)} con igualado + volumen 400 %`);
  const norm = { ...base, audio: { ...base.audio, normalize: true }, trim: { ...base.trim } };
  const r2 = await render(norm, { outDir: job.dir, base: 'norm' });
  const p2 = await peak(r2.audio.file);
  assert.ok(p2 > p0 * 2, `igualar: pico ${p2.toFixed(3)} frente a ${p0.toFixed(3)}`);
  for (const r of [r1, r2]) {
    const t = await firstSound(r.audio.file);
    assert.ok(Math.abs(t - 0.5) < 0.03, `primer pitido a ${t} s, esperaba 0,5 s`);
  }
  console.log(`   picos: normal ${p0.toFixed(2)}, 400 % ${p1.toFixed(2)}, igualado ${p2.toFixed(2)}`);
});

test('con sonido a doble velocidad: el pitido se adelanta igual que la imagen', async () => {
  const p = P.defaults(await I.importFile(F.video));
  p.trim = { start: 0.5, end: 3.5 }; p.speed = 2;
  const r = await render(p, { outDir: job.dir, base: 'rapido' });
  const t = await firstSound(r.audio.file);
  assert.ok(Math.abs(t - 0.25) < 0.03, `primer pitido a ${t} s, esperaba 0,25 s`);
});

test('con sonido sustituyendo el audio por un archivo y desde un GIF', async () => {
  const src = await I.importFile(F.gif);
  const p = P.defaults(src);
  p.type = 'sound'; p.audio = { mode: 'file', file: F.mp3, offset: 1, volume: 0.5 };
  const r = await render(p, { outDir: job.dir, base: 'gifsonido' });
  assert.ok(validate(r.webp.file, 'sound').ok);
  assert.ok(r.audio.seconds > 1.8);
});

test('imagen fija con sonido (PNG + audio)', async () => {
  const p = P.defaults(await I.importFile(F.png));
  p.type = 'sound'; p.trim = { start: 0, end: 4 }; p.audio = { mode: 'file', file: F.mp3, offset: 2, volume: 1 };
  const r = await render(p, { outDir: job.dir, base: 'pngsonido' });
  const v = validate(r.webp.file, 'sound');
  assert.ok(v.ok, v.problems.join('; '));
  assert.ok(Math.abs(v.durationMs - 4000) < 50, `duración ${v.durationMs}`);
  assert.ok(Math.abs(r.audio.seconds - 4) < 0.05);
  assert.equal((await pixel(r.webp.file, 2, 2))[3], 0);
  console.log(`   png+sonido: ${v.frames} cuadros, ${(r.webp.bytes / 1024).toFixed(0)} KB`);
});

test('WebP animado como fuente', async () => {
  const p0 = P.defaults(await I.importFile(F.gif));
  const r0 = await render(p0, { outDir: job.dir, base: 'fuente-webp' });
  const src = await I.importFile(r0.webp.file);
  assert.equal(src.kind, 'animation');
  assert.ok(src.duration > 1.5);
  const r = await render(P.defaults(src), { outDir: job.dir, base: 'desde-webp' });
  assert.ok(validate(r.webp.file, 'animated').ok);
});

test('errores claros', async () => {
  const p = P.defaults(await I.importFile(F.long));
  p.type = 'sound';
  await assert.rejects(render(p, { outDir: job.dir }), /audio/);
  const img = P.defaults(await I.importFile(F.png));
  img.type = 'animated';
  await assert.rejects(render(img, { outDir: job.dir }), /imagen fija/);
  img.type = 'sound'; img.audio.mode = 'file';
  await assert.rejects(render(img, { outDir: job.dir }), /audio/);
  assert.throws(() => I.parseHttpUrl('http://localhost/x'), /locales/);
  assert.throws(() => I.parseHttpUrl('file:///C:/x'), /http/);
});

test('cancelación', async () => {
  const p = P.defaults(await I.importFile(F.long));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(render(p, { outDir: job.dir, base: 'cancel', signal: ac.signal }), /cancelada/);
});

test('miniaturas y forma de onda', async () => {
  const src = await I.importFile(F.video);
  const th = await T.thumbnails(src, { count: 8 });
  assert.equal(th.length, 8);
  assert.equal(th[0].jpeg[0], 0xff);
  const w = await T.waveform(F.video, { bars: 400 });
  assert.equal(w.peaks.length, 400);
  assert.ok(Math.abs(w.seconds - 4) < 0.1);
  assert.ok(w.peaks.some(([lo, hi]) => hi > 0.08) && w.peaks.some(([lo, hi]) => hi < 0.01));
});
