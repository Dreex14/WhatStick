'use strict';
// Lectura de contenedores WebP (RIFF) y escritura del EXIF que usa WhatsApp.
// El EXIF es un bloque TIFF big-endian con un único tag 0x5741 cuyo valor es un JSON
// (sticker-pack-id, sticker-pack-name, sticker-pack-publisher, emojis y, en los
// stickers con sonido, sound-sha256).

function readChunks(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('El archivo no es un WebP válido');
  }
  const chunks = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    chunks.push({ fourcc, data: buf.subarray(off + 8, off + 8 + size) });
    off += 8 + size + (size & 1);
  }
  return chunks;
}

function chunk(fourcc, data) {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'ascii');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function exifWhatsApp(meta) {
  const json = Buffer.from(JSON.stringify(meta), 'utf8');
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4); // primer IFD
  tiff.writeUInt16BE(1, 8); // una entrada
  tiff.writeUInt16BE(0x5741, 10); // tag "WA"
  tiff.writeUInt16BE(7, 12); // tipo UNDEFINED
  tiff.writeUInt32BE(json.length, 14);
  tiff.writeUInt32BE(tiff.length, 18); // el valor va justo después del IFD
  tiff.writeUInt32BE(0, 22); // sin más IFD
  return Buffer.concat([tiff, json]);
}

// Dimensiones del lienzo, animación y número de cuadros.
function inspect(buf) {
  const chunks = readChunks(buf);
  const vp8x = chunks.find((c) => c.fourcc === 'VP8X');
  const frames = chunks.filter((c) => c.fourcc === 'ANMF');
  let width = 0, height = 0, animated = false, alpha = false;
  if (vp8x) {
    const f = vp8x.data[0];
    animated = !!(f & 0x02);
    alpha = !!(f & 0x10);
    width = 1 + vp8x.data.readUIntLE(4, 3);
    height = 1 + vp8x.data.readUIntLE(7, 3);
  } else {
    const vp8l = chunks.find((c) => c.fourcc === 'VP8L');
    const vp8 = chunks.find((c) => c.fourcc === 'VP8 ');
    if (vp8l) {
      const b = vp8l.data.readUInt32LE(1);
      width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; alpha = !!((b >> 28) & 1);
    } else if (vp8) {
      width = vp8.data.readUInt16LE(6) & 0x3fff; height = vp8.data.readUInt16LE(8) & 0x3fff;
    }
  }
  let durationMs = 0, minFrameMs = Infinity;
  for (const fr of frames) {
    const d = fr.data.readUIntLE(12, 3);
    durationMs += d;
    minFrameMs = Math.min(minFrameMs, d);
  }
  return {
    width, height, animated, alpha, frames: frames.length || 1,
    durationMs, minFrameMs: frames.length ? minFrameMs : null,
    hasExif: chunks.some((c) => c.fourcc === 'EXIF'),
  };
}

// Sustituye (o añade) el EXIF sin volver a codificar la imagen.
function setExif(buf, meta) {
  let chunks = readChunks(buf).filter((c) => c.fourcc !== 'EXIF');
  let vp8x = chunks.find((c) => c.fourcc === 'VP8X');
  if (!vp8x) {
    // WebP simple: hace falta un VP8X para poder llevar EXIF.
    const info = inspect(buf);
    const data = Buffer.alloc(10);
    data[0] = info.alpha ? 0x10 : 0;
    data.writeUIntLE(info.width - 1, 4, 3);
    data.writeUIntLE(info.height - 1, 7, 3);
    vp8x = { fourcc: 'VP8X', data };
    chunks = [vp8x, ...chunks];
  }
  const flags = Buffer.from(vp8x.data);
  flags[0] |= 0x08;
  // Un WebP con canal alfa en ALPH o VP8L debe declararlo.
  if (chunks.some((c) => c.fourcc === 'ALPH')) flags[0] |= 0x10;
  const body = Buffer.concat([
    Buffer.from('WEBP', 'ascii'),
    ...chunks.map((c) => chunk(c.fourcc, c === vp8x ? flags : c.data)),
    chunk('EXIF', exifWhatsApp(meta)),
  ]);
  const head = Buffer.alloc(8);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function readExif(buf) {
  const ex = readChunks(buf).find((c) => c.fourcc === 'EXIF');
  if (!ex) return null;
  const d = ex.data;
  const len = d.readUInt32BE(14);
  const off = d.readUInt32BE(18);
  return JSON.parse(d.subarray(off, off + len).toString('utf8'));
}

module.exports = { readChunks, inspect, setExif, readExif };
