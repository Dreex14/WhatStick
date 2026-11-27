// Estado del editor e historial (deshacer/rehacer) de la edición.
export const S = {
  source: null, // fuente importada
  preview: null, // { kind, url } reproducible en el editor
  project: null, // edición no destructiva
  tool: 'crop',
  mode: 'edit', // 'edit' | 'result'
  cropAspect: 'free', // 'free' | 'square' (solo interfaz)
  textSel: null,
  result: null, // último render real
};

const listeners = new Map();
export function on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); }
export function emit(ev, data) { for (const fn of listeners.get(ev) || []) fn(data); }

// Partes del proyecto que se pueden deshacer (la fuente no cambia).
const KEYS = ['name', 'type', 'trim', 'frameTime', 'transform', 'crop', 'fit', 'background', 'adjust', 'colorKey', 'speed', 'texts', 'audio'];
const snap = () => JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, S.project[k]])));

let undoStack = [];
let redoStack = [];
let base = null;

export function load(project) {
  S.project = project;
  undoStack = []; redoStack = [];
  base = snap();
  emit('load');
  emit('edited');
}

// Cambia el proyecto. Con commit:false (arrastres, deslizadores) no se guarda en el historial
// hasta llamar a commit().
export function update(fn, { commit: c = true } = {}) {
  fn(S.project);
  emit('change');
  if (c) commit();
}

export function commit() {
  const s = snap();
  if (s === base) return;
  undoStack.push(base);
  if (undoStack.length > 150) undoStack.shift();
  redoStack = [];
  base = s;
  emit('history');
  emit('edited');
}

function apply(s) {
  Object.assign(S.project, JSON.parse(s));
  base = s;
  emit('change');
  emit('restore');
  emit('history');
  emit('edited');
}

export function undo() { if (undoStack.length) { redoStack.push(base); apply(undoStack.pop()); } }
export function redo() { if (redoStack.length) { undoStack.push(base); apply(redoStack.pop()); } }
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

// Devuelve el proyecto con solo los datos editables (para guardarlo junto a la fuente).
export const editable = () => JSON.parse(snap());
