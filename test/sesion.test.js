'use strict';
// Sesión de WhatsApp cifrada: migración desde archivos en claro y lectura idéntica.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const temp = require('../engine/temp');
const { useEncryptedAuthState, hasSession } = require('../integration/whatsapp/secure-auth');

// Cifrado de prueba (en la app se usa DPAPI de Windows): XOR + marca, async como safeStorage.
const cipher = {
  encrypt: async (s) => Buffer.concat([Buffer.from('ENC1'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
  decrypt: async (b) => { assert.equal(b.subarray(0, 4).toString(), 'ENC1'); return Buffer.from(b.subarray(4)).map((x) => x ^ 0x5a).toString('utf8'); },
};

test('migra una sesión en claro, no deja archivos legibles y devuelve los mismos datos', async () => {
  const B = await import('@whiskeysockets/baileys');
  const job = temp.job('sesion');
  const dir = job.dir;
  try {
    // sesión «antigua» sin cifrar, escrita por Baileys
    const plain = await B.useMultiFileAuthState(dir);
    await plain.saveCreds();
    await plain.state.keys.set({ 'pre-key': { 1: { public: Buffer.alloc(32, 7), private: Buffer.alloc(32, 9) } } });
    const credsBefore = JSON.stringify(plain.state.creds, B.BufferJSON.replacer);
    assert.ok(hasSession(dir));

    const enc = await useEncryptedAuthState(dir, cipher, B);
    const files = fs.readdirSync(dir);
    assert.equal(files.filter((f) => f.endsWith('.json')).length, 0, 'no deben quedar archivos en claro');
    assert.ok(files.every((f) => f.endsWith('.json.enc')));
    for (const f of files) assert.ok(!fs.readFileSync(path.join(dir, f)).includes('noiseKey'), `${f} contiene texto legible`);
    assert.equal(JSON.stringify(enc.state.creds, B.BufferJSON.replacer), credsBefore);
    const k = await enc.state.keys.get('pre-key', ['1']);
    assert.deepEqual(Buffer.from(k['1'].private), Buffer.alloc(32, 9));

    // escrituras y borrados posteriores también cifrados
    await enc.state.keys.set({ 'pre-key': { 2: { public: Buffer.alloc(32, 1), private: Buffer.alloc(32, 2) }, 1: null } });
    assert.ok(fs.existsSync(path.join(dir, 'pre-key-2.json.enc')));
    assert.ok(!fs.existsSync(path.join(dir, 'pre-key-1.json.enc')));
    assert.ok(hasSession(dir));
  } finally { job.dispose(); }
});
