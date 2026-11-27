# Software de terceros

WhatStick usa estos programas y bibliotecas, cada uno con su propia licencia.

| Componente | Uso en WhatStick | Licencia | Código fuente |
|---|---|---|---|
| Electron (incluye Chromium y Node.js) | Aplicación de escritorio | MIT (Chromium: BSD y otras) | https://github.com/electron/electron |
| FFmpeg 6.1.1 (compilación de gyan.dev, vía ffmpeg-static) | Conversión de vídeo, imagen y audio | **GPL-3.0** | https://ffmpeg.org/download.html · https://github.com/FFmpeg/FFmpeg (etiqueta n6.1.1) · configuración: https://www.gyan.dev/ffmpeg/builds/ |
| FFprobe (vía ffprobe-static) | Análisis de archivos multimedia | GPL (FFmpeg) | https://github.com/joshwnj/ffprobe-static |
| sharp / libvips | Imágenes, WebP animados y miniaturas | Apache-2.0 / LGPL-2.1 | https://github.com/lovell/sharp · https://github.com/libvips/libvips |
| Baileys | Envío a WhatsApp como dispositivo vinculado (no oficial) | MIT | https://github.com/WhiskeySockets/Baileys |
| node-qrcode | Código QR de vinculación | MIT | https://github.com/soldair/node-qrcode |
| pino | Registro interno de Baileys | MIT | https://github.com/pinojs/pino |
| Lucide | Iconos | ISC | https://github.com/lucide-icons/lucide |
| yt-dlp | Descarga de vídeos desde enlaces. **No se incluye**: se descarga de su página oficial la primera vez que se usa | Unlicense | https://github.com/yt-dlp/yt-dlp |

FFmpeg y FFprobe se ejecutan como programas independientes. WhatStick no los modifica ni se enlaza con ellos, así que su licencia GPL no se aplica al código de WhatStick. Puedes obtener el código fuente de FFmpeg en los enlaces de la tabla.

## Código e ideas reutilizados

- **SonoSticker** (MIT, https://github.com/ThatChip2000/SonoSticker): parche de protobuf para enviar stickers con sonido con Baileys.
- **StikSound** (MIT/Apache-2.0, https://github.com/SilverFeit/StikSound): extracción de sonidos de MyInstants y validación de sus enlaces.
- **whatsapp-sound-sticker-bot** (MIT, https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot): idea de codificar cada cuadro completo y estimar el peso por cuadro.
- **WA-audio-stickers** (https://github.com/Shirtep/WA-audio-stickers): solo su documentación del formato de los stickers con sonido. No se usa su código.
