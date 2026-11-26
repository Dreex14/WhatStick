'use strict';
// Genera icon.png e icon.ico (16–256 px) a partir de app/icon/icon.svg.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const dir = path.join(__dirname, '..', 'app', 'icon');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'));
(async () => {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: Math.max(72, (s / 256) * 72 * 4) }).resize(s, s).png().toBuffer()));
  fs.writeFileSync(path.join(dir, 'icon.png'), await sharp(svg, { density: 300 }).resize(512, 512).png().toBuffer());
  // ICO: cabecera + directorio + imágenes PNG
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  const dirs = []; let off = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const d = Buffer.alloc(16);
    d[0] = s >= 256 ? 0 : s; d[1] = s >= 256 ? 0 : s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6);
    d.writeUInt32LE(pngs[i].length, 8); d.writeUInt32LE(off, 12); off += pngs[i].length; dirs.push(d);
  });
  fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...dirs, ...pngs]));
  console.log('icon.png e icon.ico generados');
})();
