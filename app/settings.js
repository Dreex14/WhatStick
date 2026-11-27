'use strict';
// Preferencias de la aplicación (%APPDATA%\WhatStick\ajustes.json).
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

const FILE = () => path.join(app.getPath('userData'), 'ajustes.json');
const DEFAULTS = () => ({
  libraryDir: path.join(app.getPath('pictures'), 'WhatStick'),
  packName: 'Mis stickers', // WhatsApp lo muestra debajo del sticker: «paquete · autor»
  author: 'WhatStick',
  allowLarge: false, // hasta ~1 MB en vez de los límites oficiales
  keepConnected: false, // false: WhatsApp se conecta solo para enviar y se desconecta a los 3 min
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
  for (const k of ['packName', 'author']) cache[k] = String(cache[k] || '').trim().slice(0, 40);
  if (!cache.packName) cache.packName = 'Mis stickers';
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2));
  return get();
}

module.exports = { get, set };
