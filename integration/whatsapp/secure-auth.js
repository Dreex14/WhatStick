'use strict';
// Sesión del dispositivo vinculado cifrada en disco.
// Igual que useMultiFileAuthState de Baileys (MIT), pero cada archivo se guarda cifrado con
// la función que recibe (en WhatStick, DPAPI de Windows mediante safeStorage de Electron:
// solo se puede descifrar con tu usuario de Windows en este PC).
// Los archivos sin cifrar de versiones anteriores se cifran y se borran al cargar.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ENC = '.enc';
const locks = new Map();
function locked(file, fn) {
  const prev = locks.get(file) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(file, next.catch(() => {}));
  return next;
}
const fixName = (f) => f.replace(/\//g, '__').replace(/:/g, '-');

function hasSession(dir) {
  return fs.existsSync(path.join(dir, 'creds.json' + ENC)) || fs.existsSync(path.join(dir, 'creds.json'));
}

// Sobrescribe y borra un archivo con datos de sesión en claro.
function shred(file) {
  try { fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size)); } catch (e) { /* ignorar */ }
  fs.rmSync(file, { force: true });
}

/**
 * @param {string} dir carpeta de la sesión
 * @param {{ encrypt(s: string): Promise<Buffer>|Buffer, decrypt(b: Buffer): Promise<string>|string }} cipher
 * @param {object} B módulo de Baileys (BufferJSON, initAuthCreds, proto)
 */
async function useEncryptedAuthState(dir, cipher, B) {
  const { BufferJSON, initAuthCreds, proto } = B;
  await fsp.mkdir(dir, { recursive: true });

  // migración: cifrar los archivos en claro que haya
  for (const f of await fsp.readdir(dir)) {
    if (!f.endsWith('.json')) continue;
    const plain = path.join(dir, f);
    const data = await fsp.readFile(plain, 'utf8');
    await fsp.writeFile(plain + ENC, await cipher.encrypt(data));
    shred(plain);
  }

  const file = (name) => path.join(dir, fixName(name) + ENC);
  const write = (data, name) => locked(file(name), async () => fsp.writeFile(file(name), await cipher.encrypt(JSON.stringify(data, BufferJSON.replacer))));
  const read = (name) => locked(file(name), async () => {
    try { return JSON.parse(await cipher.decrypt(await fsp.readFile(file(name))), BufferJSON.reviver); } catch (e) { return null; }
  });
  const remove = (name) => locked(file(name), () => fsp.rm(file(name), { force: true }));

  const creds = (await read('creds.json')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}.json`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat in data) for (const id in data[cat]) {
            const v = data[cat][id];
            tasks.push(v ? write(v, `${cat}-${id}.json`) : remove(`${cat}-${id}.json`));
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds.json'),
  };
}

module.exports = { useEncryptedAuthState, hasSession };
