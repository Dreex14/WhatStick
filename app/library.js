'use strict';
// Biblioteca local. Cada sticker es una carpeta dentro de la carpeta de la biblioteca:
//   meta.json      nombre, tipo, favorito, fechas y tamaño
//   proyecto.json  edición no destructiva (para volver a editarlo)
//   sticker.webp   sticker generado      sticker.ogg  audio (si tiene sonido)
//   miniatura.png  primer fotograma      fuente.*     copia del archivo original
//   audio.*        copia del audio elegido (si se sustituyó el del vídeo)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { shell } = require('electron');
const settings = require('./settings');

const MAX_SOURCE_COPY = 500 * 1024 * 1024;
const root = () => settings.get().libraryDir;
const folder = (id) => {
  if (!/^[\w-]+$/.test(String(id))) throw new Error('Identificador no válido');
  return path.join(root(), id);
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); };

function list() {
  const dir = root();
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const f = path.join(dir, d.name);
    try {
      const meta = readJson(path.join(f, 'meta.json'));
      out.push({ ...meta, dir: f, webp: path.join(f, 'sticker.webp'), ogg: fs.existsSync(path.join(f, 'sticker.ogg')) ? path.join(f, 'sticker.ogg') : null, thumb: path.join(f, 'miniatura.png') });
    } catch (e) { /* carpeta ajena o incompleta */ }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

// Copia un archivo dentro de la carpeta del sticker si aún no está allí.
function adopt(file, dir, base) {
  if (!file || !fs.existsSync(file)) return file;
  if (path.dirname(path.resolve(file)) === path.resolve(dir)) return file;
  const dst = path.join(dir, base + path.extname(file).toLowerCase());
  fs.copyFileSync(file, dst);
  return dst;
}

/**
 * Guarda (o actualiza) un sticker. result es el último render del editor.
 * Devuelve la entrada de la biblioteca.
 */
async function save({ id, project, result }) {
  const isNew = !id;
  id = id || `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const dir = folder(id);
  fs.mkdirSync(dir, { recursive: true });
  const p = JSON.parse(JSON.stringify(project));

  // fuente: copia local para poder reeditar aunque se borre el original
  const src = p.source;
  if (src && src.path && fs.existsSync(src.path)) {
    const size = fs.statSync(src.path).size;
    if (size <= MAX_SOURCE_COPY) src.path = adopt(src.path, dir, 'fuente');
    else src.external = true; // demasiado grande: se enlaza el original
  }
  delete src.proxy; // se regenera al abrir
  if (p.audio && p.audio.file) p.audio.file = adopt(p.audio.file, dir, 'audio');
  if (p.audio) { delete p.audio.url; delete p.audio.peaks; }
  delete p.overlay;

  fs.copyFileSync(result.webp.file, path.join(dir, 'sticker.webp'));
  const ogg = path.join(dir, 'sticker.ogg');
  if (result.audio) fs.copyFileSync(result.audio.file, ogg);
  else if (fs.existsSync(ogg)) fs.rmSync(ogg);
  await require('sharp')(result.webp.file).resize(256, 256).png().toFile(path.join(dir, 'miniatura.png'));

  const prev = isNew ? null : (() => { try { return readJson(path.join(dir, 'meta.json')); } catch (e) { return null; } })();
  const meta = {
    id, name: p.name || 'Sticker', type: p.type,
    favorite: prev ? !!prev.favorite : false,
    created: prev ? prev.created : Date.now(), updated: Date.now(),
    bytes: result.webp.bytes, audioBytes: result.audio ? result.audio.bytes : 0,
    durationMs: result.webp.durationMs || 0, seconds: result.audio ? result.audio.seconds : 0,
    animated: !!result.webp.animated,
  };
  // rutas internas relativas: la biblioteca se puede mover de carpeta
  const rel = (f) => (f && path.dirname(path.resolve(f)) === path.resolve(dir) ? path.basename(f) : f);
  p.source.path = rel(p.source.path);
  if (p.audio && p.audio.file) p.audio.file = rel(p.audio.file);
  writeJson(path.join(dir, 'proyecto.json'), p);
  writeJson(path.join(dir, 'meta.json'), meta);
  return list().find((x) => x.id === id);
}

function patchMeta(id, patch) {
  const f = path.join(folder(id), 'meta.json');
  const meta = { ...readJson(f), ...patch };
  writeJson(f, meta);
  if (patch.name) {
    const pf = path.join(folder(id), 'proyecto.json');
    try { const p = readJson(pf); p.name = patch.name; writeJson(pf, p); } catch (e) { /* sin proyecto */ }
  }
  return meta;
}

const rename = (id, name) => patchMeta(id, { name: String(name).trim().slice(0, 60) || 'Sticker' });
const favorite = (id, value) => patchMeta(id, { favorite: !!value });

// A la papelera de Windows: se puede recuperar.
async function remove(id) { await shell.trashItem(folder(id)); }

function project(id) {
  const dir = folder(id);
  const p = readJson(path.join(dir, 'proyecto.json'));
  const abs = (f) => (f && !path.isAbsolute(f) ? path.join(dir, f) : f);
  p.source.path = abs(p.source.path);
  if (p.audio && p.audio.file) p.audio.file = abs(p.audio.file);
  if (!p.source || !fs.existsSync(p.source.path)) throw new Error('No se encuentra el archivo original de este sticker');
  return p;
}

// Cambia la carpeta de la biblioteca, moviendo los stickers si se pide.
function setRoot(dir, move) {
  const old = root();
  fs.mkdirSync(dir, { recursive: true });
  if (move && path.resolve(old) !== path.resolve(dir) && fs.existsSync(old)) {
    for (const item of list()) {
      const dst = path.join(dir, item.id);
      if (fs.existsSync(dst)) continue;
      try { fs.renameSync(item.dir, dst); } catch (e) { fs.cpSync(item.dir, dst, { recursive: true }); fs.rmSync(item.dir, { recursive: true, force: true }); }
    }
  }
  return settings.set({ libraryDir: dir });
}

module.exports = { list, save, rename, favorite, remove, project, setRoot, folder };
