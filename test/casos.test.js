'use strict';
// Casos especiales: rutas raras, vídeo vertical, archivos dañados, extremos de tamaño y duración.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');
sharp.cache(false);
const { ffmpeg } = require('../engine/ffmpeg');
const temp = require('../engine/temp');
const P = require('../engine/project');
const { render, validate } = require('../engine/render');
const I = require('../engine/importer');
const { previewFor } = require('../engine/preview');

const job = temp.job('casos');
const f = (n) => job.file(n);
test.after(() => job.dispose());

async function ok(file, type, edit = {}) {
  const src = await I.importFile(file);
  const p = Object.assign(P.defaults(src), edit);
  if (type) p.type = type;
  const r = await render(p, { outDir: job.dir, base: `r${Math.random().toString(36).slice(2, 7)}` });
  const v = validate(r.webp.file, p.type);
  assert.ok(v.ok, v.problems.join('; '));
  return { src, r, v };
}

test('ruta con espacios, tildes, ñ y emoji', async () => {
  const file = f('Vídeo de prueba ñandú 😀 (1).mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  const { src } = await ok(file, 'sound');
  assert.equal(src.name, 'Vídeo de prueba ñandú 😀 (1)');
});

test('vídeo vertical de móvil (metadatos de rotación)', async () => {
  const base = f('horizontal.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', base]);
  const file = f('vertical.mp4');
  await ffmpeg(['-display_rotation', '90', '-i', base, '-c', 'copy', file]);
  const { src } = await ok(file, 'animated');
  assert.equal(src.width, 360);
  assert.equal(src.height, 640);
});

test('archivo dañado o que no es multimedia', async () => {
  const bad = f('roto.mp4');
  fs.writeFileSync(bad, Buffer.from('esto no es un vídeo'.repeat(100)));
  await assert.rejects(I.importFile(bad), /no compatible|dañado|no contiene/i);
  const txt = f('texto.png');
  fs.writeFileSync(txt, 'hola');
  await assert.rejects(I.importFile(txt));
  await assert.rejects(I.importFile(f('no-existe.mp4')));
});

test('clip muy corto (0,3 s)', async () => {
  const file = f('corto.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const { v } = await ok(file, 'animated');
  assert.ok(v.frames >= 2);
});

test('GIF de un solo cuadro se trata como imagen', async () => {
  const file = f('uno.gif');
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=100x100:d=0.1', '-frames:v', '1', file]);
  const src = await I.importFile(file);
  assert.equal(src.kind, 'image');
});

test('imagen diminuta (20×20) se amplía a 512×512', async () => {
  const file = f('mini.png');
  await sharp({ create: { width: 20, height: 20, channels: 4, background: '#3366ff' } }).png().toFile(file);
  await ok(file);
});

test('imagen enorme con mucho detalle cabe en 100 KB', async () => {
  const file = f('enorme.png');
  const raw = Buffer.alloc(3000 * 2000 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; // ruido
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).png().toFile(file);
  const { r } = await ok(file);
  assert.ok(r.webp.bytes <= 100 * 1024);
});

test('formato que Chromium no reproduce: se crea una vista previa', async () => {
  const file = f('antiguo.avi');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=1', '-c:v', 'mpeg4', file]);
  const src = await I.importFile(file);
  const pv = await previewFor(src);
  assert.equal(pv.kind, 'video');
  assert.ok(pv.path.endsWith('.mp4') && fs.existsSync(pv.path));
  await ok(file, 'animated');
});

test('recorte con medidas impares y fuera de rango se corrige', async () => {
  const file = f('impar.mp4');
  await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=641x359:rate=25:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  await ok(file, 'animated', { crop: { x: -50, y: 13, w: 9999, h: 333 } });
});
