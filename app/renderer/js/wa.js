// Estado de WhatsApp y envío con confirmación. Si la integración falla, el resto sigue funcionando.
import { $, kb, toast, errorText, confirmDialog } from './util.js';

let status = { ready: false, status: 'desconectado', linked: false };
const subs = new Set();

export const getStatus = () => status;
export function onStatus(fn) { subs.add(fn); fn(status); return () => subs.delete(fn); }
function set(st) {
  status = st;
  const dot = document.querySelector('.rail-btn[data-view="settings"] .wa-dot');
  if (st.ready && !dot) document.querySelector('.rail-btn[data-view="settings"]').insertAdjacentHTML('beforeend', '<i class="wa-dot" title="WhatsApp conectado"></i>');
  if (!st.ready && dot) dot.remove();
  for (const fn of subs) fn(st);
}
window.ws.wa.status().then(set);
window.ws.wa.onStatus(set);

/**
 * Envía un sticker a tu chat después de confirmarlo.
 * f: { webp, ogg, seconds, animated, bytes, name }
 */
export async function sendSticker(f) {
  if (!status.linked) {
    if (await confirmDialog({ title: 'WhatsApp no está vinculado', text: 'Para enviar stickers, vincula WhatStick con tu WhatsApp escaneando un código QR desde el móvil.', ok: 'Ir a Ajustes' })) {
      (await import('./app.js')).show('settings');
    }
    return false;
  }
  if (status.status === 'qr') { toast('Termina de vincular WhatsApp en Ajustes', 'warn'); return false; }
  const what = f.ogg ? 'el sticker con sonido' : f.animated ? 'el sticker animado' : 'el sticker';
  const ok = await confirmDialog({
    title: 'Enviar a WhatsApp',
    text: `Se enviará ${what} «${f.name}» (${kb(f.bytes)}) a tu chat contigo mismo («${status.chat || 'Tú'}»). Desde allí podrás añadirlo a favoritos o reenviarlo.`,
    ok: 'Enviar',
  });
  if (!ok) return false;
  const t = toast(status.ready ? 'Enviando a WhatsApp…' : 'Conectando con WhatsApp y enviando…', 'busy', { ms: 0 });
  try {
    await window.ws.wa.send({ webp: f.webp, ogg: f.ogg || null, seconds: f.seconds || 0, animated: !!f.animated });
    t.close();
    toast('Enviado a tu chat de WhatsApp. Ábrelo y mantenlo pulsado para añadirlo a favoritos.', 'info', { ms: 6000 });
    return true;
  } catch (e) {
    t.close();
    toast(errorText(e), 'error', { ms: 7000 });
    return false;
  }
}
