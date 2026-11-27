'use strict';
// Proceso principal de WhatStick.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, dialog, protocol, clipboard, shell, screen, Menu, safeStorage, nativeImage } = require('electron');

app.setName('WhatStick');
app.setPath('userData', path.join(app.getPath('appData'), 'WhatStick'));
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const temp = require('../engine/temp');
const P = require('../engine/project');
const importer = require('../engine/importer');
const timeline = require('../engine/timeline');
const { render, renderMp4, validate } = require('../engine/render');
const { previewFor } = require('../engine/preview');
const ytdlp = require('../engine/ytdlp');
const settings = require('./settings');
const library = require('./library');
const wa = require('../integration/whatsapp/baileys');

const BIN_DIR = path.join(app.getPath('userData'), 'bin');
const WA_DIR = path.join(app.getPath('userData'), 'whatsapp');
let win = null;

// ---------------------------------------------------------------- protocolo media://
// El editor solo puede leer archivos que la aplicación ha registrado (fuentes, vistas previas, resultados).
protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
const allowed = new Map(); // id → ruta
function mediaUrl(file) {
  const id = crypto.createHash('sha1').update(file).digest('hex').slice(0, 16);
  allowed.set(id, file);
  return `media://f/${id}/${encodeURIComponent(path.basename(file))}?v=${fs.statSync(file).mtimeMs | 0}`;
}
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac' };

function serveMedia(req) {
  const u = new URL(req.url);
  const id = u.pathname.split('/')[1];
  const file = allowed.get(id);
  if (!file || !fs.existsSync(file)) return new Response('No encontrado', { status: 404 });
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  const stream = (s, e) => require('node:stream').Readable.toWeb(fs.createReadStream(file, { start: s, end: e }));
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    return new Response(stream(start, end), { status: 206, headers: {
      'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(stream(0, size - 1), { headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) } });
}

// ---------------------------------------------------------------- ventana (recuerda tamaño y posición)
const STATE_FILE = path.join(app.getPath('userData'), 'ventana.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    const visible = b.x < area.x + area.width - 100 && b.y < area.y + area.height - 100 && b.x + b.width > area.x + 100 && b.y > area.y - 20;
    return visible ? b : { width: b.width, height: b.height, maximized: b.maximized };
  } catch (e) { return { width: 1360, height: 860 }; }
}
function saveBounds() {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 980, minHeight: 640,
    title: 'WhatStick', backgroundColor: '#0e1014', show: false,
    icon: path.join(__dirname, 'icon', 'icon.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0e1014', symbolColor: '#c9ced6', height: 40 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.argv.includes('--whatstick-test') ? { query: { test: '1' } } : {});
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const progress = (task, value, text) => send('progress', { task, value, text });

// ---------------------------------------------------------------- IPC: importación
const AUDIO_FILTER = { name: 'Audio', extensions: importer.AUDIO_EXT.map((e) => e.slice(1)) };
const MEDIA_FILTER = { name: 'Imágenes y vídeos', extensions: [...importer.IMAGE_EXT, ...importer.VIDEO_EXT].map((e) => e.slice(1)) };

async function importPaths(paths) {
  const out = [];
  for (const p of paths) {
    try { out.push({ ok: true, source: await importer.importFile(p) }); }
    catch (e) { out.push({ ok: false, name: path.basename(p), error: e.message }); }
  }
  return out;
}

ipcMain.handle('import:dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Elegir imágenes o vídeos', properties: ['openFile', 'multiSelections'], filters: [MEDIA_FILTER, { name: 'Todos', extensions: ['*'] }] });
  return r.canceled ? [] : importPaths(r.filePaths);
});
ipcMain.handle('import:paths', (e, paths) => importPaths(paths.filter((p) => typeof p === 'string')));
ipcMain.handle('import:clipboard', async () => {
  const img = clipboard.readImage();
  if (img.isEmpty()) {
    const files = clipboard.readBuffer('FileNameW').toString('ucs2').replace(/\0+$/, '');
    if (files && fs.existsSync(files)) return importPaths([files]);
    throw new Error('El portapapeles no contiene ninguna imagen');
  }
  return [{ ok: true, source: await importer.importImageBuffer(img.toPNG(), 'Imagen pegada') }];
});
ipcMain.handle('import:audio-dialog', async () => {
  const both = [...importer.AUDIO_EXT, ...importer.VIDEO_EXT].map((e) => e.slice(1));
  const r = await dialog.showOpenDialog(win, { title: 'Elegir audio o vídeo (se usa solo su sonido)', properties: ['openFile'],
    filters: [{ name: 'Audio o vídeo', extensions: both }, AUDIO_FILTER, { name: 'Vídeos (se usa su sonido)', extensions: importer.VIDEO_EXT.map((e) => e.slice(1)) }] });
  return r.canceled ? null : importer.importAudio(r.filePaths[0]);
});
ipcMain.handle('import:audio-path', (e, p) => importer.importAudio(p));

let urlAbort = null;
ipcMain.handle('ytdlp:status', () => ({ installed: ytdlp.installed(BIN_DIR) }));
ipcMain.handle('ytdlp:install', () => ytdlp.install(BIN_DIR, { onProgress: (f) => progress('ytdlp', f, 'Descargando yt-dlp…') }));
ipcMain.handle('import:url', async (e, url) => {
  urlAbort && urlAbort.abort();
  urlAbort = new AbortController();
  return importer.importUrl(url, {
    ytdlp: ytdlp.installed(BIN_DIR) ? ytdlp.binPath(BIN_DIR) : null, signal: urlAbort.signal,
    onProgress: (f) => progress('url', f, 'Descargando vídeo…'),
  });
});
ipcMain.handle('import:url-cancel', () => { urlAbort && urlAbort.abort(); });

// ---------------------------------------------------------------- IPC: editor
ipcMain.handle('media:preview', async (e, source) => {
  const r = await previewFor(source, { onProgress: (t) => progress('preview', null, t) });
  return { kind: r.kind, url: mediaUrl(r.path) };
});
ipcMain.handle('media:url', (e, file) => mediaUrl(file));
ipcMain.handle('media:thumbnails', async (e, source, count) => {
  const th = await timeline.thumbnails(source, { count, height: 72 });
  return th.map((t) => ({ t: t.t, src: 'data:image/jpeg;base64,' + Buffer.from(t.jpeg).toString('base64') }));
});
ipcMain.handle('media:waveform', (e, file, bars) => timeline.waveform(file, { bars }));
ipcMain.handle('project:defaults', (e, source) => P.defaults(source));

// Render de la vista previa real: cada petición nueva cancela la anterior.
let renderAbort = null;
let lastRender = null;
async function writeOverlay(dataUrl) {
  if (!dataUrl) return null;
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const file = temp.job('texto').file('texto.png');
  fs.writeFileSync(file, buf);
  return file;
}
ipcMain.handle('render', async (e, project, overlay) => {
  renderAbort && renderAbort.abort();
  const ac = (renderAbort = new AbortController());
  const job = temp.job('render');
  try {
    const st = settings.get();
    const p = { ...project, overlay: await writeOverlay(overlay),
      output: { ...project.output, packName: st.packName, author: st.author, maxBytes: st.allowLarge ? 990 * 1000 : null } };
    const r = await render(p, { outDir: job.dir, base: 'sticker', signal: ac.signal,
      onProgress: (s) => progress('render', null, s.stage === 'audio' ? 'Preparando el audio…' : `Ajustando calidad (${s.fps} fps, calidad ${s.quality})…`) });
    if (lastRender) lastRender.dispose();
    lastRender = job;
    const v = validate(r.webp.file, r.type, r.webp.limit);
    return { ...r, webpUrl: mediaUrl(r.webp.file), oggUrl: r.audio ? mediaUrl(r.audio.file) : null, validation: v };
  } catch (err) {
    job.dispose();
    if (err.name === 'AbortError') return { cancelled: true };
    throw err;
  }
});

async function exportFiles(webpFile, oggFile, name) {
  const safe = String(name || 'sticker').replace(/[\\/:*?"<>|]/g, '').trim() || 'sticker';
  const r = await dialog.showSaveDialog(win, { title: 'Exportar sticker', defaultPath: `${safe}.webp`, filters: [{ name: 'Sticker WebP', extensions: ['webp'] }] });
  if (r.canceled) return null;
  fs.copyFileSync(webpFile, r.filePath);
  const files = [r.filePath];
  if (oggFile) {
    const ogg = r.filePath.replace(/\.webp$/i, '') + '.ogg';
    fs.copyFileSync(oggFile, ogg);
    files.push(ogg);
  }
  return files;
}
ipcMain.handle('export', (e, result, name) => exportFiles(result.webp.file, result.audio && result.audio.file, name));
ipcMain.handle('reveal', (e, file) => shell.showItemInFolder(file));

// ---------------------------------------------------------------- IPC: pasar a WhatsApp sin vincular
// Vía de reserva que solo usa funciones normales de WhatsApp (arrastrar un archivo .webp a un
// chat o crear un sticker desde un vídeo en el móvil): no depende del protocolo no oficial.
const safeName = (n) => String(n || 'sticker').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'sticker';
const dragIcon = () => nativeImage.createFromPath(path.join(__dirname, 'icon', 'icon.png')).resize({ width: 64, height: 64 });
ipcMain.on('drag-out', (e, file, name, ogg) => {
  if (!file || !fs.existsSync(file) || !/\.webp$/i.test(file)) return;
  // copias con un nombre legible; si tiene sonido se arrastran el sticker y su audio juntos
  const job = temp.job('arrastre');
  const files = [job.file(`${safeName(name)}.webp`)];
  fs.copyFileSync(file, files[0]);
  if (ogg && fs.existsSync(ogg) && /\.ogg$/i.test(ogg)) { files.push(job.file(`${safeName(name)}.ogg`)); fs.copyFileSync(ogg, files[1]); }
  e.sender.startDrag({ file: files[0], files, icon: dragIcon() });
});

// Extensión para el navegador: se copia a una carpeta fija para cargarla en Chrome, Edge o Brave.
const EXT_SRC = app.isPackaged ? path.join(process.resourcesPath, 'extension') : path.join(__dirname, '..', 'extension');
const EXT_DIR = path.join(app.getPath('userData'), 'extension');
ipcMain.handle('ext:prepare', async () => {
  fs.rmSync(EXT_DIR, { recursive: true, force: true });
  fs.cpSync(EXT_SRC, EXT_DIR, { recursive: true });
  await shell.openPath(EXT_DIR);
  return EXT_DIR;
});
ipcMain.handle('open-whatsapp', async () => {
  try { await shell.openExternal('whatsapp://'); return 'app'; }
  catch (err) { await shell.openExternal('https://web.whatsapp.com/'); return 'web'; }
});
async function saveMp4(project, name) {
  const r = await dialog.showSaveDialog(win, { title: 'Exportar vídeo para crear el sticker en el móvil', defaultPath: `${safeName(name)}.mp4`, filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }] });
  if (r.canceled) return null;
  progress('mp4', null, 'Creando el vídeo…');
  const st = settings.get();
  await renderMp4({ ...project, output: { ...project.output, packName: st.packName, author: st.author } }, { out: r.filePath });
  return r.filePath;
}
ipcMain.handle('export-mp4', (e, project, overlay) => writeOverlay(overlay).then((ov) => saveMp4({ ...project, overlay: ov }, project.name)));
ipcMain.handle('library:export-mp4', async (e, id) => {
  const p = library.project(id);
  const source = await importer.importFile(p.source.path);
  return saveMp4({ ...p, source }, p.name);
});

// ---------------------------------------------------------------- IPC: biblioteca
const withUrls = (it) => it && ({ ...it, webpUrl: mediaUrl(it.webp), thumbUrl: fs.existsSync(it.thumb) ? mediaUrl(it.thumb) : null, oggUrl: it.ogg ? mediaUrl(it.ogg) : null });
ipcMain.handle('library:list', () => library.list().map(withUrls));
ipcMain.handle('library:save', async (e, { id, project, result }) => withUrls(await library.save({ id, project, result })));
ipcMain.handle('library:rename', (e, id, name) => library.rename(id, name));
ipcMain.handle('library:favorite', (e, id, v) => library.favorite(id, v));
ipcMain.handle('library:remove', (e, id) => library.remove(id));
ipcMain.handle('library:open', async (e, id) => {
  const p = library.project(id);
  const source = await importer.importFile(p.source.path); // regenera vistas intermedias
  return { project: { ...p, source }, libraryId: id };
});
ipcMain.handle('library:export', async (e, id) => {
  const it = library.list().find((x) => x.id === id);
  if (!it) throw new Error('No existe ese sticker');
  return exportFiles(it.webp, it.ogg, it.name);
});
ipcMain.handle('library:reveal', (e, id) => shell.openPath(library.folder(id)));

// ---------------------------------------------------------------- IPC: ajustes
ipcMain.handle('settings:get', () => ({ ...settings.get(), ytdlp: ytdlp.installed(BIN_DIR), version: app.getVersion() }));
ipcMain.handle('settings:set', (e, patch) => {
  const r = settings.set(patch);
  if ('keepConnected' in patch) { if (r.keepConnected && wa.linked(WA_DIR)) wa.start(WA_DIR).catch(() => {}); else scheduleIdle(); }
  return r;
});
ipcMain.handle('settings:library-dir', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta de la biblioteca', properties: ['openDirectory', 'createDirectory'], defaultPath: settings.get().libraryDir });
  if (r.canceled) return null;
  const count = library.list().length;
  let move = false;
  if (count) {
    const a = await dialog.showMessageBox(win, { type: 'question', buttons: ['Mover los stickers', 'Empezar vacía', 'Cancelar'], defaultId: 0, cancelId: 2,
      title: 'Cambiar carpeta', message: `¿Mover tus ${count} stickers a la nueva carpeta?` });
    if (a.response === 2) return null;
    move = a.response === 0;
  }
  return library.setRoot(r.filePaths[0], move);
});
ipcMain.handle('settings:open-library', () => { fs.mkdirSync(settings.get().libraryDir, { recursive: true }); return shell.openPath(settings.get().libraryDir); });
ipcMain.handle('ytdlp:version', () => (ytdlp.installed(BIN_DIR) ? ytdlp.version(ytdlp.binPath(BIN_DIR)) : null));
ipcMain.handle('ytdlp:update', () => ytdlp.update(ytdlp.binPath(BIN_DIR)));
ipcMain.handle('ytdlp:remove', () => { fs.rmSync(ytdlp.binPath(BIN_DIR), { force: true }); return true; });

// ---------------------------------------------------------------- IPC: WhatsApp (módulo aislado)
// Modo por defecto «conectar solo para enviar»: la conexión se abre al enviar (o al vincular)
// y se cierra tras unos minutos sin uso. Con «mantener conectado» queda abierta.
const IDLE_MS = 3 * 60 * 1000;
let idleTimer = null;
function scheduleIdle() {
  clearTimeout(idleTimer);
  if (settings.get().keepConnected) return;
  idleTimer = setTimeout(() => { if (wa.status().ready) wa.stop().catch(() => {}); }, IDLE_MS);
}
const waStatus = () => ({ ...wa.status(), linked: wa.linked(WA_DIR), keepConnected: settings.get().keepConnected });
ipcMain.handle('wa:status', waStatus);
ipcMain.handle('wa:connect', async () => { const r = await wa.start(WA_DIR); scheduleIdle(); return r; });
ipcMain.handle('wa:disconnect', () => { clearTimeout(idleTimer); return wa.stop(); });
ipcMain.handle('wa:unlink', async () => { clearTimeout(idleTimer); await wa.stop({ logout: true }); fs.rmSync(WA_DIR, { recursive: true, force: true }); return true; });
ipcMain.handle('wa:send', async (e, { webp, ogg, seconds, animated }) => {
  if (!wa.linked(WA_DIR)) throw new Error('Vincula WhatsApp en Ajustes');
  if (!wa.status().ready) {
    send('wa-status', { ...waStatus(), status: 'conectando' });
    await wa.start(WA_DIR);
    if (!await wa.waitReady(30000)) throw new Error('No se ha podido conectar con WhatsApp. Comprueba tu conexión a internet.');
  }
  clearTimeout(idleTimer);
  const r = await wa.send({ webp: fs.readFileSync(webp), ogg: ogg ? fs.readFileSync(ogg) : null, seconds, animated });
  scheduleIdle();
  if (!r.ok) throw new Error('WhatsApp no ha aceptado el envío: ' + r.error);
  return r;
});
wa.onChange((st) => { send('wa-status', waStatus()); if (st.ready) scheduleIdle(); });

// ---------------------------------------------------------------- arranque
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('media', serveMedia);
  temp.session();
  createWindow();
  // sesión cifrada con DPAPI de Windows: solo tu usuario puede leerla en este PC
  wa.configure({ cipher: {
    encrypt: async (s) => { if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('El cifrado de Windows no está disponible'); return safeStorage.encryptStringAsync(s); },
    decrypt: async (b) => (await safeStorage.decryptStringAsync(b)).result,
  } });
  if (wa.linked(WA_DIR) && settings.get().keepConnected) wa.start(WA_DIR).catch(() => {});
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { temp.cleanup(); wa.stop().catch(() => {}); });
