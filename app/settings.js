'use strict';
// Preferencias de la aplicación (%APPDATA%\WhatStick\ajustes.json).
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'ajustes.json');
const DEFAULTS = () => ({
  libraryDir: path.join(app.getPath('pictures'), 'WhatStick'),
  author: 'WhatStick', // autor que guarda el sticker en sus metadatos
  allowLarge: false, // hasta ~1 MB en vez de los límites oficiales
  connectOnStart: true, // conectar WhatsApp al abrir si ya está vinculado
});

let cache = null;
function get() {
  if (!cache) {
    try { cache = { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(FILE(), 'utf8')) }; }
    catch (e) { cache = DEFAULTS(); }
  }
  return { ...cache };
}
function set(patch) {
  const allowed = Object.keys(DEFAULTS());
  cache = { ...get(), ...Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))) };
  if (typeof cache.author !== 'string' || !cache.author.trim()) cache.author = 'WhatStick';
  cache.author = cache.author.trim().slice(0, 40);
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
  return get();
}

module.exports = { get, set };
