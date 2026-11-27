// «Pasar a WhatsApp sin vincular»: vías de reserva que no dependen de la vinculación de WhatStick.
//  1. Extensión de WhatStick para WhatsApp Web (Chrome, Edge o Brave): se arrastra el sticker
//     (y su audio) desde aquí a su panel, y se envía al chat abierto, también con sonido.
//  2. Vídeo MP4 con sonido para crear el sticker en el móvil con «Stickers → Crear» de WhatsApp.
import { $, h, toast, errorText } from './util.js';
import { icon } from './icons.js';

/**
 * it: { webp, ogg?, webpUrl, name, sound, animated, mp4: () => Promise<ruta|null> }
 */
export function openManual(it) {
  const back = $('#modal');
  const box = $('#modal-box');
  box.classList.add('wide');
  box.innerHTML = '';
  box.append(h(`<div>
    <h3>Pasar a WhatsApp sin vincular</h3>
    <p>Sirve aunque la vinculación de WhatStick deje de funcionar.</p>
    <div class="manual-sec" style="border-top:0;padding-top:0">
      <p><b>Con la extensión para WhatsApp Web</b> (Chrome, Edge o Brave). Envía el sticker al chat abierto${it.sound ? ', también con sonido' : ''}.</p>
      <div class="manual">
        <div class="drag-tile" draggable="true" title="Arrástrame al panel de WhatStick en WhatsApp Web"><img alt=""></div>
        <ol>
          <li>Abre WhatsApp Web en el navegador y entra en un chat (por ejemplo, «Tú»).</li>
          <li>Pulsa el botón de WhatStick, abajo a la derecha.</li>
          <li><b>Arrastra el sticker</b> de la izquierda a ese panel${it.sound ? ' (se llevan el sticker y su sonido)' : ''} y pulsa Enviar.</li>
        </ol>
      </div>
      <details class="note" style="margin-bottom:12px"><summary style="cursor:pointer">¿No tienes la extensión? Instálala una vez</summary>
        <ol style="margin:8px 0 0;padding-left:18px;line-height:1.7">
          <li>Pulsa <b>Preparar la extensión</b>: se abrirá su carpeta.</li>
          <li>En el navegador abre <b>chrome://extensions</b> (o edge://extensions, brave://extensions).</li>
          <li>Activa el <b>Modo de desarrollador</b>, pulsa <b>Cargar descomprimida</b> y elige esa carpeta.</li>
          <li>Recarga WhatsApp Web.</li>
        </ol>
      </details>
      <div class="row left"><button class="btn small" id="m-ext">${icon('folder-open')} Preparar la extensión</button><button class="btn small" id="m-open">${icon('external-link')} Abrir WhatsApp Web</button></div>
    </div>
    ${it.animated ? `<div class="manual-sec" style="margin-top:16px">
      <p><b>Con el móvil</b>: exporta el vídeo, pásalo al teléfono y en WhatsApp ve a <b>Stickers → Crear</b> y elige el vídeo. Esta función de WhatsApp aún no está en todas las cuentas.</p>
      <button class="btn small" id="m-mp4">${icon('smartphone')} Exportar vídeo${it.sound ? ' con sonido' : ''} (MP4)…</button>
    </div>` : ''}
    <p class="note" style="margin-top:14px">Arrastrar el archivo directamente a WhatsApp Escritorio no sirve: WhatsApp lo envía como imagen.</p>
    <div class="row" style="margin-top:12px"><button class="btn" id="m-close">Cerrar</button></div>
  </div>`));
  $('.drag-tile img', box).src = it.webpUrl;
  $('.drag-tile', box).addEventListener('dragstart', (e) => { e.preventDefault(); window.ws.dragOut(it.webp, it.name, it.ogg); });
  $('#m-open', box).onclick = () => window.open('https://web.whatsapp.com/', '_blank');
  $('#m-ext', box).onclick = async () => {
    try { const dir = await window.ws.prepareExtension(); toast(`Extensión lista en ${dir}`, 'info', { ms: 8000 }); }
    catch (e) { toast(errorText(e), 'error'); }
  };
  const mp4 = $('#m-mp4', box);
  if (mp4) mp4.onclick = async () => {
    const t = toast('Creando el vídeo…', 'busy', { ms: 0 });
    try { const f = await it.mp4(); t.close(); if (f) toast('Vídeo exportado. Pásalo al móvil para crear el sticker.', 'info', { ms: 6000 }); }
    catch (e) { t.close(); toast(errorText(e), 'error'); }
  };
  const close = () => { back.hidden = true; box.classList.remove('wide'); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', key, true);
  $('#m-close', box).onclick = close;
  back.hidden = false;
}
