'use strict';
// Proyecto de sticker: descripción no destructiva de la edición. El archivo original nunca
// se modifica; el sticker se vuelve a generar a partir de esto cada vez.

const LIMITS = Object.freeze({
  size: 512,
  staticBytes: 100 * 1024, // guía oficial de WhatsApp
  animatedBytes: 500 * 1024, // guía oficial de WhatsApp
  serverBytes: 1000 * 1000, // el servidor rechaza más (HTTP 413)
  audioBytes: 1000 * 1000,
  maxSeconds: 10,
  minFrameMs: 8,
});

const TYPES = ['static', 'animated', 'sound'];

function defaults(source) {
  const animatedSource = source.kind !== 'image';
  const end = animatedSource ? Math.min(source.duration || 0, LIMITS.maxSeconds) : 3;
  return {
    version: 1,
    name: 'Sticker',
    type: !animatedSource ? 'static' : source.hasAudio ? 'sound' : 'animated',
    source,
    trim: { start: 0, end },
    frameTime: 0, // fotograma para el sticker estático hecho desde un vídeo
    transform: { rotate: 0, flipH: false, flipV: false },
    crop: null, // { x, y, w, h } en píxeles del fotograma ya rotado/volteado; null = todo
    fit: 'contain', // contain: encaja con márgenes; cover: rellena recortando
    background: null, // null = transparente; '#rrggbb' = color de fondo
    adjust: { brightness: 0, contrast: 1, saturation: 1 },
    colorKey: null, // { color: '#rrggbb', similarity: 0.15, blend: 0.05 }
    speed: 1,
    texts: [], // datos editables de los textos (los dibuja la interfaz)
    overlay: null, // PNG 512×512 con los textos ya dibujados
    audio: { mode: source.hasAudio ? 'original' : 'file', file: null, fileDuration: 0, offset: 0, volume: 1, normalize: false },
    output: { maxBytes: null, emojis: ['😀'], author: 'WhatStick' },
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Corrige valores fuera de rango y devuelve los avisos para mostrarlos al usuario.
function normalize(p) {
  const warnings = [];
  const src = p.source;
  if (!TYPES.includes(p.type)) throw new Error(`Tipo de sticker desconocido: ${p.type}`);
  if (p.type === 'animated' && src.kind === 'image') throw new Error('Una imagen fija no puede ser un sticker animado; elige «Con sonido» para añadirle audio');
  p.speed = clamp(Number(p.speed) || 1, 0.25, 4);
  if (src.kind === 'image' && p.type === 'sound') {
    // imagen + sonido: la imagen se mantiene mientras dura el fragmento de audio elegido
    p.speed = 1;
    p.trim.start = 0;
    p.trim.end = clamp(Number(p.trim.end) || 3, 0.1, LIMITS.maxSeconds);
    if (p.audio.mode !== 'file') throw new Error('Elige un audio para la imagen');
  } else if (src.kind !== 'image') {
    const dur = src.duration || 0;
    p.trim.start = clamp(Number(p.trim.start) || 0, 0, Math.max(0, dur - 0.05));
    p.trim.end = clamp(Number(p.trim.end) || dur, p.trim.start + 0.05, dur || p.trim.start + 0.05);
    p.frameTime = clamp(Number(p.frameTime) || 0, 0, dur);
    const out = outputDuration(p);
    if (p.type !== 'static' && out > LIMITS.maxSeconds + 1e-6) {
      p.trim.end = p.trim.start + LIMITS.maxSeconds * p.speed;
      warnings.push(`El fragmento se ha acortado a ${LIMITS.maxSeconds} s, el máximo de WhatsApp`);
    }
  }
  if (p.type === 'sound') {
    if (p.audio.mode === 'none') throw new Error('Un sticker con sonido necesita audio');
    if (p.audio.mode === 'original' && !src.hasAudio) throw new Error('El vídeo no tiene audio: elige un archivo de audio');
    if (p.audio.mode === 'file' && !p.audio.file) throw new Error('Falta el archivo de audio');
    p.audio.volume = clamp(Number(p.audio.volume), 0, 4);
  }
  // colores: solo #rrggbb (se usan dentro de los filtros de FFmpeg)
  const color = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
  p.background = color(p.background);
  if (p.colorKey) {
    const c = color(p.colorKey.color);
    p.colorKey = c ? { color: c, similarity: clamp(Number(p.colorKey.similarity) || 0.15, 0.01, 1), blend: clamp(Number(p.colorKey.blend) || 0, 0, 1) } : null;
  }
  p.fit = p.fit === 'cover' ? 'cover' : 'contain';
  if (p.overlay != null && typeof p.overlay !== 'string') p.overlay = null;
  const t = p.transform;
  t.rotate = ((Math.round((Number(t.rotate) || 0) / 90) * 90) % 360 + 360) % 360;
  const a = p.adjust;
  a.brightness = clamp(Number(a.brightness) || 0, -1, 1);
  a.contrast = clamp(Number(a.contrast) || 1, 0, 3);
  a.saturation = clamp(a.saturation == null ? 1 : Number(a.saturation), 0, 3);
  if (p.crop) {
    const [w, h] = orientedSize(p);
    const c = p.crop;
    c.x = clamp(Math.round(c.x), 0, w - 2);
    c.y = clamp(Math.round(c.y), 0, h - 2);
    c.w = clamp(Math.round(c.w), 2, w - c.x);
    c.h = clamp(Math.round(c.h), 2, h - c.y);
  }
  return warnings;
}

function orientedSize(p) {
  const { width, height } = p.source;
  return p.transform.rotate % 180 ? [height, width] : [width, height];
}

function outputDuration(p) {
  if (p.type === 'static') return 0;
  return (p.trim.end - p.trim.start) / p.speed;
}

function limitFor(p) {
  return p.output.maxBytes || (p.type === 'static' ? LIMITS.staticBytes : LIMITS.animatedBytes);
}

module.exports = { LIMITS, TYPES, defaults, normalize, orientedSize, outputDuration, limitFor };
