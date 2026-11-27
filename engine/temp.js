'use strict';
// Archivos temporales: una carpeta por sesión en %TEMP%\whatstick, que se borra al salir.
// Al arrancar se eliminan las carpetas de sesiones anteriores de más de un día.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(os.tmpdir(), 'whatstick');
let sessionDir = null;

function session() {
  if (!sessionDir) {
    fs.mkdirSync(ROOT, { recursive: true });
    const day = 24 * 3600 * 1000;
    for (const d of fs.readdirSync(ROOT)) {
      const full = path.join(ROOT, d);
      // sesiones de procesos que ya no existen (cierre inesperado) o de hace más de un día
      const pid = Number((/^s(\d+)-/.exec(d) || [])[1]);
      let alive = false;
      if (pid) { try { process.kill(pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; } }
      try { if (!alive || Date.now() - fs.statSync(full).mtimeMs > day) fs.rmSync(full, { recursive: true, force: true }); } catch (e) { /* en uso */ }
    }
    sessionDir = fs.mkdtempSync(path.join(ROOT, `s${process.pid}-`));
    process.once('exit', cleanup);
  }
  return sessionDir;
}

// Carpeta temporal para un trabajo; devuelve { dir, file(nombre), dispose() }.
function job(prefix = 'job') {
  const dir = path.join(session(), `${prefix}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    file: (name) => path.join(dir, name),
    dispose: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function cleanup() {
  if (sessionDir) { try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (e) { /* ignorar */ } }
  sessionDir = null;
}

module.exports = { ROOT, session, job, cleanup };
