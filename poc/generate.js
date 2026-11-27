'use strict';
// Genera los tres tipos de sticker con el motor a partir de un vídeo (o uno de prueba).
// Uso: node poc/generate.js [vídeo]
const fs = require('node:fs');
const path = require('node:path');
const { ffmpeg } = require('../engine/ffmpeg');
const P = require('../engine/project');
const { render, validate } = require('../engine/render');
const { importFile } = require('../engine/importer');

const OUT = path.join(__dirname, 'out');

async function generate(srcPath) {
  fs.mkdirSync(OUT, { recursive: true });
  if (!srcPath) {
    srcPath = path.join(OUT, 'fuente-prueba.mp4');
    if (!fs.existsSync(srcPath)) {
      // 4 s con contador y un pitido al empezar cada segundo (para comprobar la sincronía)
      await ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
        '-f', 'lavfi', '-i', "sine=frequency=880:sample_rate=48000:duration=4,volume='if(lt(mod(t,1),0.15),1,0)':eval=frame",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', srcPath]);
    }
  }
  const src = await importFile(srcPath);
  const base = P.defaults(src);
  const res = {};
  for (const type of ['static', 'animated', 'sound']) {
    const p = { ...base, type, frameTime: Math.min(1, src.duration / 2) };
    if (type === 'sound' && !src.hasAudio) continue;
    const names = { static: 'estatico', animated: 'animado', sound: 'sonido' };
    const r = await render(p, { outDir: OUT, base: names[type] });
    const v = validate(r.webp.file, type);
    res[type] = { kb: +(r.webp.bytes / 1024).toFixed(1), fps: r.webp.fps, calidad: r.webp.quality,
      ms: r.webp.durationMs, audioKb: r.audio ? +(r.audio.bytes / 1024).toFixed(1) : null, ok: v.ok, problemas: v.problems, avisos: r.warnings };
  }
  return res;
}

if (require.main === module) {
  generate(process.argv[2]).then((r) => console.log(JSON.stringify(r, null, 2)), (e) => { console.error(e); process.exit(1); });
}
module.exports = { generate };
