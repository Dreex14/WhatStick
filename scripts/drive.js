'use strict';
// Herramienta de pruebas: controla la app abierta con --remote-debugging-port=9333.
// Uso: node scripts/drive.js eval "<js>" | shot <archivo.png> | wait <ms>
const [cmd, arg] = process.argv.slice(2);
(async () => {
  const port = process.env.DRIVE_PORT || 9333;
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = list.find((t) => t.type === 'page' && new RegExp(process.env.DRIVE_URL || 'index\.html').test(t.url));
  if (!page) throw new Error('No se encuentra la ventana');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const call = (method, params = {}) => new Promise((res, rej) => {
    const my = ++id;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === my) { ws.removeEventListener('message', h); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  if (cmd === 'eval' || cmd === 'evalfile') {
    const expr = cmd === 'evalfile' ? require('fs').readFileSync(arg, 'utf8') : arg;
    const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.log('EXCEPCIÓN', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 1));
  } else if (cmd === 'reload') {
    await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
    await call('Page.reload', { ignoreCache: true });
    await new Promise((r) => setTimeout(r, Number(arg) || 2500));
    console.log('recargado');
  } else if (cmd === 'drag') {
    const [x1, y1, x2, y2] = arg.split(',').map(Number);
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 10; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
    console.log('arrastrado');
  } else if (cmd === 'size') {
    const [width, height] = arg.split('x').map(Number);
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 800));
    const r = await call('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(process.argv[4], Buffer.from(r.data, 'base64'));
    const w = await call('Runtime.evaluate', { expression: 'innerWidth+"x"+innerHeight', returnByValue: true });
    await call('Emulation.clearDeviceMetricsOverride');
    console.log('captura a', w.result.value);
  } else if (cmd === 'click') {
    const [x, y] = arg.split(',').map(Number);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    console.log('clic', x, y);
  } else if (cmd === 'dropfiles') {
    const [xy, ...files] = arg.split('|');
    const [x, y] = xy.split(',').map(Number);
    const data = { items: [], files, dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) await call('Input.dispatchDragEvent', { type, x, y, data });
    console.log('soltados', files.length);
  } else if (cmd === 'shot') {
    const r = await call('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('captura', arg);
  }
  ws.close();
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
