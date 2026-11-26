// Panel lateral con los ajustes de la herramienta seleccionada.
import { $, $$, h, esc, paintRange, toast, errorText, fmtTime, clamp } from './util.js';
import { S, update, commit, on } from './store.js';
import { squareCrop, transformCrop, layoutStage, cropRect } from './stage.js';
import * as T from './texts.js';
import { applyAudio, redrawWave } from './timeline.js';

const panel = $('#panel');

const TITLES = {
  crop: ['Encuadre', 'Arrastra las esquinas para recortar. Rueda del ratón: zoom.'],
  adjust: ['Ajustes', 'Retoques básicos de color.'],
  text: ['Texto', 'Arrastra el texto sobre el sticker para colocarlo.'],
  background: ['Fondo', 'Transparencia, color de fondo y eliminación de fondos lisos.'],
  audio: ['Audio', 'Sonido del sticker.'],
};

// Deslizador conectado a una propiedad del proyecto
function slider({ label, min, max, step, get, set, fmt = (v) => v }) {
  const el = h(`<div class="slider"><div class="lbl"><span>${esc(label)}</span><output></output></div><input type="range" min="${min}" max="${max}" step="${step}"></div>`);
  const r = $('input', el), o = $('output', el);
  const show = () => { r.value = get(); o.textContent = fmt(Number(r.value)); paintRange(r); };
  r.addEventListener('input', () => { update((p) => set(p, Number(r.value)), { commit: false }); o.textContent = fmt(Number(r.value)); paintRange(r); });
  r.addEventListener('change', () => commit());
  r.addEventListener('dblclick', () => { r.value = r.defaultValue; });
  show();
  el.refresh = show;
  return el;
}

const pct = (v) => `${Math.round(v * 100)} %`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`;

// ---------------------------------------------------------------- encuadre
function cropPanel() {
  const isSq = S.cropAspect === 'square';
  const el = h(`<div class="group-wrap">
    <div class="group"><span class="group-title">Proporción</span>
      <div class="seg small" id="asp"><button data-a="free" class="${isSq ? '' : 'active'}">Libre</button><button data-a="square" class="${isSq ? 'active' : ''}">Cuadrado</button><button data-a="full">Todo</button></div>
    </div>
    <div class="group"><span class="group-title">Girar y voltear</span>
      <div class="row">
        <button class="icon-btn" data-r="ccw" data-icon="rotate-ccw" title="Girar a la izquierda"></button>
        <button class="icon-btn" data-r="cw" data-icon="rotate-cw" title="Girar a la derecha"></button>
        <button class="icon-btn" data-r="h" data-icon="flip-horizontal-2" title="Voltear horizontalmente"></button>
        <button class="icon-btn" data-r="v" data-icon="flip-vertical-2" title="Voltear verticalmente"></button>
      </div>
    </div>
    <div class="group"><span class="group-title">Ajuste al lienzo</span>
      <div class="seg small" id="fit"><button data-f="contain">Encajar entero</button><button data-f="cover">Rellenar</button></div>
      <p class="note">«Encajar entero» no recorta nada y deja márgenes transparentes; «Rellenar» ocupa todo el cuadrado.</p>
    </div>
    <button class="btn" id="reset-crop" data-icon="refresh-ccw">Restablecer encuadre</button>
  </div>`);
  $$('#fit button', el).forEach((b) => b.classList.toggle('active', b.dataset.f === S.project.fit));
  $('#asp', el).onclick = (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'full') { update((p) => { p.crop = null; }); S.cropAspect = 'free'; }
    else { S.cropAspect = a; if (a === 'square') update((p) => { p.crop = squareCrop(); }); }
    renderPanel(); layoutStage();
  };
  for (const b of $$('[data-r]', el)) b.onclick = () => {
    const k = b.dataset.r;
    update((p) => {
      const c = transformCrop(k);
      // con un solo volteo activo el giro visual va en sentido contrario en el proyecto
      const inv = p.transform.flipH !== p.transform.flipV ? -1 : 1;
      if (k === 'cw') p.transform.rotate = (p.transform.rotate + 90 * inv + 360) % 360;
      if (k === 'ccw') p.transform.rotate = (p.transform.rotate - 90 * inv + 360) % 360;
      if (k === 'h') p.transform.flipH = !p.transform.flipH;
      if (k === 'v') p.transform.flipV = !p.transform.flipV;
      p.crop = c;
    });
    layoutStage();
  };
  $('#fit', el).onclick = (e) => { const f = e.target.closest('button')?.dataset.f; if (f) { update((p) => { p.fit = f; }); renderPanel(); } };
  $('#reset-crop', el).onclick = () => { update((p) => { p.crop = null; p.transform = { rotate: 0, flipH: false, flipV: false }; p.fit = 'contain'; }); S.cropAspect = 'free'; renderPanel(); };
  return el;
}

// ---------------------------------------------------------------- ajustes
function adjustPanel() {
  const el = h('<div class="group-wrap"><div class="group" id="g"></div></div>');
  const g = $('#g', el);
  g.append(
    slider({ label: 'Brillo', min: -0.5, max: 0.5, step: 0.01, get: () => S.project.adjust.brightness, set: (p, v) => { p.adjust.brightness = v; }, fmt: signedPct }),
    slider({ label: 'Contraste', min: 0.5, max: 2, step: 0.01, get: () => S.project.adjust.contrast, set: (p, v) => { p.adjust.contrast = v; }, fmt: pct }),
    slider({ label: 'Saturación', min: 0, max: 2.5, step: 0.01, get: () => S.project.adjust.saturation, set: (p, v) => { p.adjust.saturation = v; }, fmt: pct }),
  );
  const reset = h('<button class="btn" data-icon="refresh-ccw">Restablecer ajustes</button>');
  reset.onclick = () => { update((p) => { p.adjust = { brightness: 0, contrast: 1, saturation: 1 }; }); renderPanel(); };
  el.append(reset);
  return el;
}

// ---------------------------------------------------------------- texto
function textPanel() {
  const p = S.project;
  const el = h(`<div class="group-wrap">
    <button class="btn primary" id="add-text" data-icon="plus">Añadir texto</button>
    <div class="text-items" id="items"></div>
    <div id="edit"></div>
  </div>`);
  const items = $('#items', el);
  for (const t of p.texts) {
    const it = h(`<div class="text-item ${S.textSel === t.id ? 'active' : ''}"><span>${esc(t.text || '(vacío)')}</span><button class="icon-btn small" data-icon="trash-2" title="Eliminar"></button></div>`);
    it.onclick = (e) => {
      if (e.target.closest('button')) { update((pp) => { pp.texts = pp.texts.filter((x) => x.id !== t.id); }); if (S.textSel === t.id) S.textSel = null; renderPanel(); return; }
      S.textSel = t.id; renderPanel(); layoutStage();
    };
    items.append(it);
  }
  $('#add-text', el).onclick = () => {
    const c = cropRect();
    const q = S.project.fit === 'cover' ? Math.min(c.w, c.h) : Math.max(c.w, c.h);
    const ch = S.project.fit === 'cover' ? q : c.h;
    const half = (512 * Math.min(ch, q)) / q / 2;
    const t = T.newText(p.texts.length, { top: 256 - half, bottom: 256 + half });
    update((pp) => { pp.texts.push(t); });
    S.textSel = t.id; renderPanel(); layoutStage();
    setTimeout(() => { const ta = $('#t-text'); if (ta) { ta.focus(); ta.select(); } }, 0);
  };
  const t = p.texts.find((x) => x.id === S.textSel);
  if (t) {
    const get = (k) => () => S.project.texts.find((x) => x.id === t.id)?.[k];
    const set = (k) => (pp, v) => { const x = pp.texts.find((y) => y.id === t.id); if (x) x[k] = v; };
    const ed = h(`<div class="group">
      <textarea class="inp" id="t-text" spellcheck="false">${esc(t.text)}</textarea>
      <div class="field"><select id="t-font">${T.FONTS.map((f) => `<option value="${f.id}" ${f.id === t.font ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
      <div class="field"><span class="note" style="flex:1">Color</span><input type="color" id="t-color" value="${t.color}"><span class="note" style="flex:1;text-align:right">Contorno</span><input type="color" id="t-stroke" value="${t.stroke}"></div>
    </div>`);
    const ta = $('#t-text', ed);
    ta.addEventListener('input', () => { update((pp) => set('text')(pp, ta.value), { commit: false }); $('.text-item.active span', el).textContent = ta.value || '(vacío)'; });
    ta.addEventListener('change', commit);
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    $('#t-font', ed).onchange = (e) => update((pp) => set('font')(pp, e.target.value));
    for (const [id, k] of [['#t-color', 'color'], ['#t-stroke', 'stroke']]) {
      const c = $(id, ed);
      c.addEventListener('input', () => update((pp) => set(k)(pp, c.value), { commit: false }));
      c.addEventListener('change', commit);
    }
    ed.append(
      slider({ label: 'Tamaño', min: 16, max: 200, step: 1, get: get('size'), set: set('size'), fmt: (v) => `${v} px` }),
      slider({ label: 'Grosor del contorno', min: 0, max: 20, step: 1, get: get('strokeWidth'), set: set('strokeWidth'), fmt: (v) => `${v} px` }),
    );
    const center = h('<button class="btn small" data-icon="scan">Centrar horizontalmente</button>');
    center.onclick = () => update((pp) => set('x')(pp, 256));
    ed.append(center);
    $('#edit', el).append(ed);
  } else if (p.texts.length) {
    $('#edit', el).append(h('<p class="note">Selecciona un texto de la lista o haz clic sobre él en la vista previa.</p>'));
  }
  return el;
}

// ---------------------------------------------------------------- fondo
const COLORS = ['#ffffff', '#000000', '#2fe0a1', '#ffd166', '#ff6b6b', '#4dabf7', '#b197fc'];
function backgroundPanel() {
  const p = S.project;
  const el = h(`<div class="group-wrap">
    <div class="group"><span class="group-title">Fondo</span>
      <div class="swatches" id="sw"><button class="swatch none ${p.background ? '' : 'active'}" data-c="" title="Transparente"></button>
      ${COLORS.map((c) => `<button class="swatch ${p.background === c ? 'active' : ''}" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}
      <input type="color" id="bg-custom" value="${p.background || '#ffffff'}" title="Otro color"></div>
      <p class="note">El fondo rellena los márgenes y las zonas transparentes. WhatsApp muestra los stickers sin fondo si lo dejas transparente.</p>
    </div>
    <div class="group"><span class="group-title">Quitar fondo de color liso</span>
      <label class="check"><input type="checkbox" id="ck-on" ${p.colorKey ? 'checked' : ''}> Hacer transparente un color</label>
      <div id="ck" ${p.colorKey ? '' : 'hidden'}>
        <div class="field" style="margin-bottom:8px"><input type="color" id="ck-color" value="${p.colorKey ? p.colorKey.color : '#00ff00'}"><button class="btn small" id="ck-pick" data-icon="pipette">Tomar de la imagen</button></div>
      </div>
      <p class="note">Funciona con fondos de un solo color (por ejemplo, croma verde o blanco). Compruébalo en «Resultado».</p>
    </div>
  </div>`);
  $('#sw', el).onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    update((pp) => { pp.background = b.dataset.c || null; });
    renderPanel();
  };
  const cc = $('#bg-custom', el);
  cc.addEventListener('change', () => { update((pp) => { pp.background = cc.value; }); renderPanel(); });
  const ck = $('#ck', el);
  if (p.colorKey) {
    ck.append(
      slider({ label: 'Tolerancia', min: 0.01, max: 0.6, step: 0.01, get: () => S.project.colorKey.similarity, set: (pp, v) => { pp.colorKey.similarity = v; }, fmt: pct }),
      slider({ label: 'Suavizado del borde', min: 0, max: 0.5, step: 0.01, get: () => S.project.colorKey.blend, set: (pp, v) => { pp.colorKey.blend = v; }, fmt: pct }),
    );
  }
  $('#ck-on', el).onchange = (e) => {
    update((pp) => { pp.colorKey = e.target.checked ? { color: $('#ck-color', el).value, similarity: 0.15, blend: 0.05 } : null; });
    renderPanel();
  };
  const ckc = $('#ck-color', el);
  ckc.addEventListener('change', () => update((pp) => { if (pp.colorKey) pp.colorKey.color = ckc.value; }));
  $('#ck-pick', el).onclick = async () => {
    if (!window.EyeDropper) { toast('El cuentagotas no está disponible', 'warn'); return; }
    try {
      const r = await new window.EyeDropper().open();
      ckc.value = r.sRGBHex;
      update((pp) => { if (pp.colorKey) pp.colorKey.color = r.sRGBHex; });
    } catch (e) { /* cancelado */ }
  };
  return el;
}

// ---------------------------------------------------------------- audio
function audioPanel() {
  const p = S.project;
  const isImage = S.source.kind === 'image';
  if (p.type !== 'sound') {
    const el = h(`<div class="group-wrap"><p class="note">Este sticker no tiene sonido. Elige «Con sonido» arriba para ${isImage ? 'añadirle un audio' : 'conservar el audio o añadir otro'}.</p>
      <button class="btn primary" data-icon="volume-2">Convertir en sticker con sonido</button></div>`);
    $('button', el).onclick = () => import('./editor.js').then((m) => m.setType('sound'));
    return el;
  }
  const a = p.audio;
  const el = h(`<div class="group-wrap">
    <div class="group"><span class="group-title">Origen del sonido</span>
      ${isImage ? '' : `<div class="seg small" id="amode"><button data-m="original" ${S.source.hasAudio ? '' : 'disabled'}>Audio del vídeo</button><button data-m="file">Otro audio</button></div>`}
      <div id="file-box"></div>
    </div>
    <div class="group" id="vol"></div>
    <button class="btn" id="mute" data-icon="volume-x">Quitar el sonido</button>
  </div>`);
  if (!isImage) $$('#amode button', el).forEach((b) => b.classList.toggle('active', b.dataset.m === a.mode));
  const amode = $('#amode', el);
  if (amode) amode.onclick = (e) => {
    const m = e.target.closest('button')?.dataset.m;
    if (!m || m === a.mode) return;
    update((pp) => { pp.audio.mode = m; });
    renderPanel(); redrawWave(); applyAudio();
  };
  const fb = $('#file-box', el);
  if (a.mode === 'file' || isImage) {
    fb.append(h(`<div class="group">
      ${a.file ? `<div class="audio-card"><span data-icon="file-music"></span><span class="n" title="${esc(a.file)}">${esc(a.fileName || a.file.split(/[\\/]/).pop())}</span></div>` : '<p class="note">Elige un archivo de audio o pega un enlace de MyInstants.</p>'}
      <div class="row"><button class="btn small" id="pick" data-icon="folder-open">${a.file ? 'Cambiar audio' : 'Elegir audio'}</button></div>
      <form class="field" id="mi"><input type="text" id="mi-url" placeholder="Enlace de MyInstants" spellcheck="false"><button class="btn small" type="submit">Usar</button></form>
    </div>`));
    $('#pick', fb).onclick = async () => {
      try { const au = await window.ws.importAudioDialog(); if (au) await setAudioFile(au); } catch (e) { toast(errorText(e), 'error'); }
    };
    $('#mi-url', fb).addEventListener('keydown', (e) => e.stopPropagation());
    $('#mi', fb).onsubmit = async (e) => {
      e.preventDefault();
      const url = $('#mi-url', fb).value.trim();
      if (!url) return;
      const tt = toast('Descargando sonido…', 'busy', { ms: 0 });
      try {
        const r = await window.ws.importUrl(url);
        if (r.kind !== 'audio') throw new Error('El enlace no es un sonido de MyInstants');
        await setAudioFile(r.audio);
        tt.close();
      } catch (err) { tt.close(); toast(errorText(err), 'error'); }
    };
    if (a.file) fb.append(windowEditor());
  }
  $('#vol', el).append(
    slider({ label: 'Volumen', min: 0, max: 2, step: 0.01, get: () => S.project.audio.volume, set: (pp, v) => { pp.audio.volume = v; applyAudio(); }, fmt: pct }),
    h(`<label class="check"><input type="checkbox" id="norm" ${a.normalize ? 'checked' : ''}> Igualar volumen</label>`),
    h('<p class="note">Ajusta los audios muy flojos o muy fuertes a un nivel estándar. Un limitador evita que el sonido distorsione al subir el volumen. Escúchalo en «Resultado».</p>'),
  );
  $('#norm', el).onchange = (e) => update((pp) => { pp.audio.normalize = e.target.checked; });
  $('#mute', el).onclick = () => import('./editor.js').then((m) => m.setType(isImage ? 'static' : 'animated'));
  return el;
}

export async function setAudioFile(au) {
  const url = await window.ws.mediaUrl(au.path);
  const wf = await window.ws.waveform(au.path, 400).catch(() => null);
  update((pp) => {
    pp.audio.mode = 'file';
    pp.audio.file = au.path;
    pp.audio.fileName = au.name;
    pp.audio.fileDuration = au.duration;
    pp.audio.url = url;
    pp.audio.peaks = wf ? wf.peaks : null;
    pp.audio.offset = 0;
    if (S.source.kind === 'image') { pp.trim.start = 0; pp.trim.end = Math.min(10, au.duration); }
  });
  applyAudio();
  renderPanel();
}

// Forma de onda del audio elegido con la ventana del fragmento que se usará (arrastrable).
function windowEditor() {
  const p = S.project;
  const a = p.audio;
  const isImage = S.source.kind === 'image';
  const outDur = () => (isImage ? S.project.trim.end : (S.project.trim.end - S.project.trim.start) / S.project.speed);
  const el = h(`<div class="group">
    <span class="group-title">Fragmento del audio</span>
    <div style="position:relative;height:56px;border-radius:8px;overflow:hidden;background:var(--bg2);cursor:grab" id="aw"><canvas style="width:100%;height:100%"></canvas><div id="awin" style="position:absolute;top:0;bottom:0;border:2px solid var(--accent);border-radius:6px;background:rgba(47,224,161,.12)"></div></div>
    <div class="field"><span class="note" id="aw-info" style="flex:1"></span><button class="icon-btn small" id="aw-play" data-icon="play" title="Escuchar el fragmento"></button></div>
  </div>`);
  const aw = $('#aw', el), win = $('#awin', el), cv = $('canvas', el);
  const D = a.fileDuration || 1;
  const paint = () => {
    const w = (cv.width = aw.clientWidth * devicePixelRatio || 600), hh = (cv.height = 56 * devicePixelRatio);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#56606f';
    const pk = S.project.audio.peaks;
    if (pk) for (let x = 0; x < w; x++) { const [lo, hi] = pk[Math.floor((x / w) * pk.length)] || [0, 0]; const v = Math.max(1, (hi - lo) * hh * 0.45); ctx.fillRect(x, hh / 2 - v / 2, 1, v); }
    const o = S.project.audio.offset || 0, d = Math.min(outDur(), D - o);
    win.style.left = `${(o / D) * 100}%`;
    win.style.width = `${(Math.max(0.05, d) / D) * 100}%`;
    $('#aw-info', el).textContent = `Desde ${fmtTime(o)} · ${outDur().toFixed(2).replace('.', ',')} s${outDur() > D - o + 0.01 ? ' (se rellena con silencio)' : ''}`;
  };
  aw.addEventListener('pointerdown', (e) => {
    const r = aw.getBoundingClientRect();
    const o0 = S.project.audio.offset || 0, x0 = e.clientX;
    try { aw.setPointerCapture(e.pointerId); } catch (err) { /* evento sintético */ }
    const inside = e.target === win;
    const mv = (ev) => {
      const t = inside ? o0 + ((ev.clientX - x0) / r.width) * D : ((ev.clientX - r.left) / r.width) * D - outDur() / 2;
      update((pp) => { pp.audio.offset = Math.round(clamp(t, 0, Math.max(0, D - Math.min(outDur(), D))) * 1000) / 1000; }, { commit: false });
      paint();
    };
    mv(e);
    const up = () => { aw.removeEventListener('pointermove', mv); aw.removeEventListener('pointerup', up); commit(); };
    aw.addEventListener('pointermove', mv);
    aw.addEventListener('pointerup', up);
  });
  const audio = $('#aux-audio');
  $('#aw-play', el).onclick = () => {
    if (isImage) {
      audio.currentTime = S.project.audio.offset || 0;
      audio.play();
      clearTimeout(audio.__stop);
      audio.__stop = setTimeout(() => audio.pause(), outDur() * 1000);
    } else import('./timeline.js').then((m) => m.play());
  };
  if (isImage) {
    el.append(slider({ label: 'Duración del sticker', min: 0.5, max: Math.min(10, D), step: 0.01,
      get: () => S.project.trim.end, set: (pp, v) => { pp.trim.end = v; pp.audio.offset = Math.min(pp.audio.offset || 0, Math.max(0, D - v)); paint(); },
      fmt: (v) => `${v.toFixed(2).replace('.', ',')} s` }));
  }
  requestAnimationFrame(paint);
  return el;
}

// ---------------------------------------------------------------- principal
const BUILDERS = { crop: cropPanel, adjust: adjustPanel, text: textPanel, background: backgroundPanel, audio: audioPanel };

export function renderPanel() {
  if (!S.project) return;
  const [title, sub] = TITLES[S.tool];
  panel.innerHTML = '';
  panel.append(h(`<div><h3>${esc(title)}</h3><div class="sub">${esc(sub)}</div></div>`));
  const body = BUILDERS[S.tool]();
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '18px';
  panel.append(body);
}

on('restore', renderPanel);
on('load', renderPanel);
