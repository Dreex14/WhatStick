'use strict';
// Copia los iconos de Lucide (ISC) que usa la interfaz a app/renderer/js/icons.js.
const fs = require('node:fs');
const path = require('node:path');
const NAMES = ['plus', 'image-plus', 'link', 'clipboard-paste', 'film', 'library', 'settings', 'crop', 'sliders-horizontal',
  'type', 'paint-bucket', 'music', 'volume-2', 'volume-x', 'gauge', 'undo-2', 'redo-2', 'rotate-ccw', 'rotate-cw',
  'flip-horizontal-2', 'flip-vertical-2', 'maximize', 'minimize', 'square', 'scan', 'play', 'pause', 'repeat',
  'chevron-left', 'chevron-right', 'chevrons-left', 'chevrons-right', 'save', 'download', 'send', 'trash-2', 'star',
  'x', 'check', 'triangle-alert', 'loader-circle', 'refresh-ccw', 'pipette', 'image', 'sticker', 'eye', 'folder-open',
  'upload', 'zoom-in', 'zoom-out', 'file-music', 'search', 'sparkles', 'pencil', 'grid-3x3', 'circle-help', 'camera',
  'square-dashed', 'scissors', 'audio-lines', 'eraser', 'smartphone', 'unlink', 'qr-code', 'external-link', 'info'];
const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const out = {};
for (const n of NAMES) {
  const svg = fs.readFileSync(path.join(dir, `${n}.svg`), 'utf8');
  out[n] = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>')).replace(/\s+/g, ' ').trim();
}
fs.writeFileSync(path.join(__dirname, '..', 'app', 'renderer', 'js', 'icons.js'),
  `// Iconos de Lucide (https://lucide.dev), licencia ISC. Generado por scripts/icons.js.\n` +
  `export const ICONS = ${JSON.stringify(out, null, 0)};\n` +
  `export function icon(name, cls = '') {\n  return \`<svg class="ico \${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">\${ICONS[name] || ''}</svg>\`;\n}\n`);
console.log(Object.keys(out).length, 'iconos');
