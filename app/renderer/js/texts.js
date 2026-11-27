// Textos del sticker. Se dibujan en un lienzo de 512×512 que se usa tanto en el editor
// como para generar la capa PNG que el motor superpone al sticker.
export const FONTS = [
  { id: 'impact', name: 'Impact', css: 'Impact, "Arial Black", sans-serif' },
  { id: 'black', name: 'Segoe Black', css: '"Segoe UI Black", "Arial Black", sans-serif' },
  { id: 'rounded', name: 'Redondeada', css: '"Segoe UI Variable Display Semib", "Segoe UI Semibold", "Arial Rounded MT Bold", sans-serif' },
  { id: 'comic', name: 'Cómic', css: '"Comic Sans MS", "Segoe Print", cursive' },
  { id: 'hand', name: 'Manuscrita', css: '"Segoe Print", "Ink Free", cursive' },
  { id: 'serif', name: 'Clásica', css: 'Georgia, "Times New Roman", serif' },
];
const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

// area: zona del lienzo de 512 px ocupada por la imagen { top, bottom }, para que el texto
// nuevo quede encima de la imagen y no en el margen transparente.
export function newText(n = 0, area = { top: 0, bottom: 512 }) {
  const size = Math.round(Math.max(28, Math.min(64, (area.bottom - area.top) / 5)));
  return {
    id: Math.random().toString(36).slice(2, 10),
    text: 'Texto', x: 256, y: Math.round(n % 2 ? area.top + size * 0.9 : area.bottom - size * 0.9), size,
    color: '#ffffff', stroke: '#000000', strokeWidth: 6, font: 'impact',
  };
}

function lines(t) { return String(t.text || '').split('\n'); }

function layout(ctx, t) {
  ctx.font = `${t.size}px ${fontCss(t.font)}`;
  const ls = lines(t);
  const lh = t.size * 1.08;
  const w = Math.max(...ls.map((l) => ctx.measureText(l).width), 10) + t.strokeWidth * 2;
  const h = ls.length * lh + t.strokeWidth * 2;
  return { ls, lh, box: { x: t.x - w / 2, y: t.y - h / 2, w, h } };
}

export function draw(ctx, texts, { selected = null } = {}) {
  ctx.clearRect(0, 0, 512, 512);
  for (const t of texts) {
    const { ls, lh, box } = layout(ctx, t);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const y0 = t.y - ((ls.length - 1) * lh) / 2;
    ls.forEach((l, i) => {
      if (t.strokeWidth > 0) {
        ctx.strokeStyle = t.stroke;
        ctx.lineWidth = t.strokeWidth * 2;
        ctx.strokeText(l, t.x, y0 + i * lh);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(l, t.x, y0 + i * lh);
    });
    if (selected === t.id) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#2fe0a1';
      ctx.strokeRect(box.x - 6, box.y - 4, box.w + 12, box.h + 8);
      ctx.restore();
    }
  }
}

export function hit(ctx, texts, x, y) {
  for (let i = texts.length - 1; i >= 0; i--) {
    const { box } = layout(ctx, texts[i]);
    if (x >= box.x - 8 && x <= box.x + box.w + 8 && y >= box.y - 8 && y <= box.y + box.h + 8) return texts[i];
  }
  return null;
}

// PNG transparente de 512×512 con los textos, o null si no hay ninguno.
export function overlayDataUrl(texts) {
  const visible = (texts || []).filter((t) => String(t.text).trim());
  if (!visible.length) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  draw(c.getContext('2d'), visible);
  return c.toDataURL('image/png');
}
