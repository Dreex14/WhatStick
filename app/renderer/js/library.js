// Biblioteca: stickers guardados, búsqueda, filtros, favoritos, reproducción y acciones.
import { $, $$, h, esc, kb, toast, errorText, confirmDialog } from './util.js';
import { icon } from './icons.js';
import { sendSticker } from './wa.js';

const grid = $('#lib-grid');
let items = [];
let filter = 'all';
let query = '';
const player = new Audio();
let playing = null;

const TYPE = { static: ['image', 'Estático'], animated: ['film', 'Animado'], sound: ['volume-2', 'Con sonido'] };

export async function refresh() {
  try { items = await window.ws.library.list(); } catch (e) { toast(errorText(e), 'error'); items = []; }
  paint();
}

function visible() {
  const q = query.trim().toLowerCase();
  return items.filter((it) => (filter === 'all' || (filter === 'fav' ? it.favorite : it.type === filter)) && (!q || it.name.toLowerCase().includes(q)));
}

function paint() {
  const list = visible();
  grid.innerHTML = '';
  $('#lib-empty').hidden = items.length > 0;
  if (items.length && !list.length) grid.append(h('<p class="note" style="grid-column:1/-1">No hay stickers que coincidan.</p>'));
  for (const it of list) grid.append(card(it));
}

function card(it) {
  const [ico, label] = TYPE[it.type] || TYPE.static;
  const dur = it.durationMs ? ` · ${(it.durationMs / 1000).toFixed(1).replace('.', ',')} s` : '';
  const el = h(`<div class="card-st">
    <div class="pic"><img alt="" draggable="false"><span class="kind">${icon(ico)}${label}</span>
      <button class="fav ${it.favorite ? 'on' : ''}" title="${it.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${icon('star')}</button>
      ${it.animated ? `<button class="play" title="${it.ogg ? 'Reproducir con sonido' : 'Reproducir'}">${icon('play')}</button>` : ''}
    </div>
    <div class="info"><div class="nm" title="Doble clic para renombrar">${esc(it.name)}</div><div class="sz">${kb(it.bytes)}${dur}</div></div>
    <div class="acts">
      <button class="icon-btn send" data-a="send" title="Enviar a WhatsApp">${icon('send')}</button>
      <button class="icon-btn" data-a="edit" title="Volver a editar">${icon('pencil')}</button>
      <button class="icon-btn" data-a="export" title="Exportar">${icon('download')}</button>
      <button class="icon-btn" data-a="folder" title="Abrir su carpeta">${icon('folder-open')}</button>
      <span class="spacer"></span>
      <button class="icon-btn" data-a="delete" title="Eliminar">${icon('trash-2')}</button>
    </div>
  </div>`);
  const img = $('img', el);
  // miniatura fija; el sticker animado solo se reproduce al pasar el ratón (ahorra CPU)
  img.src = it.thumbUrl || it.webpUrl;
  if (it.animated) {
    el.addEventListener('mouseenter', () => { img.src = it.webpUrl; });
    el.addEventListener('mouseleave', () => { if (playing !== it.id) img.src = it.thumbUrl || it.webpUrl; });
  }
  const play = $('.play', el);
  if (play) play.onclick = () => {
    img.src = `${it.webpUrl}&t=${Date.now()}`;
    if (it.oggUrl) {
      playing = it.id;
      player.src = it.oggUrl;
      player.currentTime = 0;
      player.play();
      player.onended = () => { playing = null; };
    }
  };
  $('.fav', el).onclick = async () => {
    it.favorite = !it.favorite;
    await window.ws.library.favorite(it.id, it.favorite);
    paint();
  };
  const nm = $('.nm', el);
  nm.ondblclick = () => {
    nm.contentEditable = 'true';
    nm.focus();
    document.getSelection().selectAllChildren(nm);
  };
  nm.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } if (e.key === 'Escape') { nm.textContent = it.name; nm.blur(); } };
  nm.onblur = async () => {
    if (nm.contentEditable !== 'true') return;
    nm.contentEditable = 'false';
    const name = nm.textContent.trim();
    if (!name || name === it.name) { nm.textContent = it.name; return; }
    try { await window.ws.library.rename(it.id, name); it.name = name.slice(0, 60); paint(); } catch (e) { toast(errorText(e), 'error'); }
  };
  $('.acts', el).onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    try {
      if (a === 'send') await sendSticker({ webp: it.webp, ogg: it.ogg, seconds: it.seconds, animated: it.animated, bytes: it.bytes, name: it.name });
      if (a === 'edit') (await import('./app.js')).openFromLibrary(it.id);
      if (a === 'export') { const f = await window.ws.library.exportItem(it.id); if (f) toast('Sticker exportado'); }
      if (a === 'folder') window.ws.library.reveal(it.id);
      if (a === 'delete') {
        if (!await confirmDialog({ title: 'Eliminar sticker', text: `«${it.name}» se moverá a la papelera de Windows, desde donde podrás recuperarlo.`, ok: 'Eliminar', danger: true })) return;
        await window.ws.library.remove(it.id);
        items = items.filter((x) => x !== it);
        paint();
        toast('Sticker movido a la papelera');
      }
    } catch (err) { toast(errorText(err), 'error'); }
  };
  return el;
}

$('#lib-search').addEventListener('input', (e) => { query = e.target.value; paint(); });
$('#lib-search').addEventListener('keydown', (e) => e.stopPropagation());
$('#lib-filter').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  filter = b.dataset.f;
  for (const x of $$('#lib-filter button')) x.classList.toggle('active', x === b);
  paint();
};
$('#lib-folder').onclick = () => window.ws.settings.openLibrary();
