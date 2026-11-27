# Fase 1 · Viabilidad

Estado a 26/11/2026.

## Especificaciones de WhatsApp comprobadas

| | Estático | Animado | Con sonido |
|---|---|---|---|
| Formato | WebP 512×512 | WebP animado 512×512 | WebP animado 512×512 **+ Ogg/Opus aparte** |
| Peso (guía oficial) | ≤ 100 KB | ≤ 500 KB | ≤ 500 KB el WebP; audio ≤ 1 MB |
| Peso que acepta el servidor | ~1 MB (error 413 por encima) | ~1 MB | ~1 MB |
| Duración | — | ≤ 10 s, cuadros ≥ 8 ms | igual que el animado; el audio dura lo mismo |
| Metadatos | EXIF con JSON (tag 0x5741) | igual | igual + `sound-sha256` (SHA-256 del Ogg, en base64) |

Fuentes: [guía oficial](https://github.com/WhatsApp/stickers/blob/main/Android/README.md) y el análisis de stickers reales de [WA-audio-stickers](https://github.com/Shirtep/WA-audio-stickers/blob/main/docs/como-funciona.md).

**Un sticker con sonido no es un WebP con audio.** Son dos archivos en un mismo mensaje: el WebP y un audio subido como nota de voz. Van dentro de `audioStickerMessage` (campo 134), y el audio va en `StickerMessage.audioMessage` (campo 26). El WebP solo enlaza el audio por su hash. Por eso **solo se pueden enviar desde una integración**, no arrastrando un archivo. Además, WhatsApp está activando la creación cuenta por cuenta (despliegue gradual).

## Proyectos parecidos encontrados

Desde hace pocos días han aparecido decenas de proyectos. Estos son los relevantes:

| Proyecto | Qué es | Vía de envío | Licencia |
|---|---|---|---|
| [SonoSticker](https://github.com/ThatChip2000/SonoSticker) | App web local para PC (Node + Express) | Baileys | MIT |
| [Sticker Sound](https://github.com/YericoNR/sticker-sound) | Estudio web local, audios de MyInstants | Baileys | MIT |
| [Sound Sticker Studio](https://github.com/In-active-Dude/Sounded-Stickers-Whatsapp) | App de escritorio para Windows | Baileys | MIT |
| [whatsapp-sound-sticker-bot](https://github.com/DavidRamirez206/whatsapp-sound-sticker-bot) | Bot | Baileys | MIT |
| [WA-audio-stickers](https://github.com/Shirtep/WA-audio-stickers) y sus derivados ([stickers-con-audio](https://github.com/kahou234/stickers-con-audio), [stickervox](https://github.com/xebastian153/stickervox), [yapper](https://github.com/Kitsuneden02/yapper)…) | Extensión de navegador | Módulos internos de WhatsApp Web | PolyForm no comercial / derivados |

Ninguno cubre todo lo que pides (editor completo, biblioteca, tres tipos). Sí resuelven el envío, que es lo que reutilizo: el parche de protobuf de SonoSticker (MIT) y el conocimiento del formato de WA-audio-stickers, sin copiar su código.

## Integración: dos vías en prueba

Usas **WhatsApp Escritorio** (2.2645, basado en WebView2), que no admite extensiones ni ofrece una API. Hay dos vías posibles y la prueba de concepto permite probar ambas. Las dos son **no oficiales** y pueden romperse con una actualización. Están aisladas en `integration/whatsapp/`, y si fallan el editor y la exportación siguen funcionando.

| | A · WhatsApp Web integrado | B · Dispositivo vinculado (Baileys) |
|---|---|---|
| Cómo | WhatStick abre WhatsApp Web en su propia ventana y usa sus módulos internos | WhatStick se vincula como dispositivo y envía el mensaje con el protocolo |
| Sonido aunque tu cuenta no tenga la función | Solo forzando el interruptor de WhatsApp Web (opcional, no oficial) | **Sí**: el interruptor solo existe en la app; el servidor acepta el mensaje |
| Qué lo puede romper | Que WhatsApp renombre módulos internos (frecuente) | Cambios de protocolo; Baileys tiene mucha comunidad y se actualiza rápido |
| Consumo | Una ventana de WhatsApp Web oculta (~300 MB) | Ligero, sin navegador |
| Riesgo para la cuenta | Bajo (es el cliente oficial) | Bajo con uso personal y moderado; WhatsApp puede restringir clientes no oficiales |

En ambas vías:
- Se vincula una vez con el QR, como cualquier dispositivo. Convive con WhatsApp Escritorio y el móvil, y se puede revocar desde *Dispositivos vinculados*.
- La sesión de ese dispositivo nuevo se guarda solo en tu PC. No se pide ninguna credencial ni se lee la sesión de tu WhatsApp Escritorio.
- Cada envío pide confirmación y va a tu chat personal. No hay envíos masivos.
- Lo enviado aparece también en WhatsApp Escritorio y en el móvil, y desde ahí puedes marcarlo como favorito.

Se descartaron estas alternativas:
- **Extensión de navegador**: no sirve en WhatsApp Escritorio.
- **Inyectar código en WhatsApp Escritorio o en su base de datos**: manipula otra aplicación y es frágil.

## Resultados

| Prueba | Resultado |
|---|---|
| Generar estático (512×512, 10 KB, transparencia, EXIF) | ✅ comprobado |
| Generar animado (4 s, 20 fps, 484 KB) | ✅ comprobado |
| Generar con sonido (WebP + Opus mono 48 kHz, 4,006 s, `sound-sha256`) | ✅ comprobado |
| A · WhatsApp Web carga en la ventana integrada (se muestra el QR) | ✅ comprobado |
| B · Baileys conecta y genera el QR; el parche codifica los campos 134 y 26 | ✅ comprobado |
| **B · Enviar estático, animado y con sonido** (26/11/2026, 23:04) | ✅ **llegan como sticker a «Tú», se animan y suenan** en el móvil y en WhatsApp Escritorio (icono de altavoz). Funciona aunque WhatsApp Web indica que la cuenta no tiene activada la creación de stickers con sonido. Suenan las dos variantes, con y sin el envoltorio 134 |
| A · Enviar por WhatsApp Web integrado | ⏸️ no completada: la sesión se perdió al coincidir dos pruebas. Queda como alternativa de reserva |
| Arrastrar el `.webp` a WhatsApp Escritorio (alternativa sin integración) | ⏳ pendiente |
| Importar directamente a favoritos | ❌ no hay mecanismo comprobado; se marca a mano desde WhatsApp |

## Decisión

**Vía B (Baileys)** para la aplicación:
- Es la única comprobada de extremo a extremo.
- No depende del ajuste de despliegue gradual de la función.
- Es ligera.

Se envía con el envoltorio 134, igual que WhatsApp Web. La vía A queda documentada como reserva por si Baileys deja de funcionar.

Viabilidad de la fase 1: **confirmada para los tres tipos**.

## Prueba manual (referencia)

Abre una terminal en la carpeta del proyecto:

```powershell
cd WhatStick
```

Genera los stickers de prueba:

```powershell
npm run poc:generar
```

Abre el panel de pruebas:

```powershell
npm run poc
```

**Vía B (Baileys), primero:**
1. Marca la opción **B** y pulsa **Vincular / conectar**. Escanea el QR del panel desde el móvil (*Dispositivos vinculados → Vincular un dispositivo*).
2. Envía **Estático**, **Animado** y **Con sonido**, y confirma cada envío.
3. Si el de sonido no suena en el móvil, marca «sin envoltorio» y vuelve a enviarlo.

**Vía A (WhatsApp Web integrado):**
1. Marca la opción **A** y pulsa **Abrir WhatsApp Web**. Escanea su QR y espera a que carguen tus chats.
2. Pulsa **Comprobar estado**: `ready` debe salir `true`. Fíjate en `sound.creation`.
3. Envía los tres stickers. Si el de sonido dice que tu cuenta no tiene la función, marca la casilla (A) y repítelo.

**Comprobación:** en WhatsApp Escritorio y en el móvil, abre tu chat contigo mismo («Tú»). Comprueba que todo llega como sticker y se anima, y que el de sonido pita una vez por segundo, en sincronía con el contador. Prueba también a marcarlos como favoritos.

**Opcional:** arrastra `poc\out\animado.webp` a un chat de WhatsApp Escritorio y dime si lo envía como sticker.

Al terminar puedes pulsar **Desvincular** y quitar los dispositivos de prueba desde el móvil. Los resultados quedan en `poc\out\registro-pruebas.json`, que no guarda números ni mensajes. Dime qué ha funcionado en cada vía.
