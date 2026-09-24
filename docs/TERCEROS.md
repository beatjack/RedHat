# Componentes de terceros incluidos

Todos se distribuyen dentro de `vendor/` para que el laboratorio funcione sin Internet.

| Componente | Versión | Licencia | Origen | Archivos |
|---|---|---|---|---|
| xterm.js | 6.0.0 | MIT | npm `@xterm/xterm` | `vendor/xterm/xterm.js`, `xterm.css`, `LICENSE` |
| @xterm/addon-fit | 0.11.0 | MIT | npm `@xterm/addon-fit` | `vendor/xterm/addon-fit.js` |
| v86 | 0.5.462 | BSD-2-Clause | npm `v86` / github.com/copy/v86 | `vendor/v86/libv86.js`, `LICENSE`; `v86-wasm.js` (contiene `v86.wasm` en base64) |
| SeaBIOS / VGA BIOS | rel-1.16.2 (según la cadena de arranque) | LGPLv3 (proyecto SeaBIOS) | github.com/copy/v86/tree/master/bios | `vendor/v86/v86-bios.js` (`seabios.bin` y `vgabios.bin` en base64) |

El `.wasm` y las BIOS se embeben en base64 porque los navegadores no permiten `fetch()` de archivos locales cuando la página se abre con `file://`.

## Marcas

JBoss, JBoss EAP, WildFly, Red Hat y Red Hat Enterprise Linux son marcas de Red Hat, Inc. Rocky Linux es marca de la Rocky Enterprise Software Foundation. Este proyecto es una simulación educativa independiente: no contiene ni redistribuye software de esos productos.
