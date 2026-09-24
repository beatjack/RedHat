/*
 * "Linux real": emulador x86 v86 (BSD-2-Clause, github.com/copy/v86)
 * ejecutado 100% en el navegador, igual que JSLinux. El .wasm y la BIOS van
 * embebidos en base64 (vendor/v86/*.js) para funcionar también con file://.
 * El usuario elige una imagen ISO / bzImage / disco desde su propio equipo.
 */
(function (L) {
  'use strict';
  const { h, esc, toast } = L.ui;

  let loading = null;
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar ' + src)); document.head.appendChild(s); });
  }
  function ensureV86() {
    if (window.V86 && window.V86_WASM_B64 && window.V86_SEABIOS_B64) return Promise.resolve();
    if (!loading) loading = Promise.all([loadScript('vendor/v86/libv86.js'), loadScript('vendor/v86/v86-wasm.js'), loadScript('vendor/v86/v86-bios.js')]);
    return loading;
  }
  function b64ToBuf(b64) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  L.ui.apps.realvm = {
    title: 'Linux real (v86)', icon: 'linux',
    open(desk) {
      const win = desk.wm.create({ title: 'Linux real — emulador x86 (v86)', icon: 'linux', width: 900, height: 660 });
      win.body.innerHTML = '<div class="v86"><div class="toolbar"></div><div class="setup pad"></div><div class="screen" style="display:none"><div></div><canvas style="display:none"></canvas></div></div>';
      const tb = win.body.querySelector('.toolbar'), setup = win.body.querySelector('.setup'), screen = win.body.querySelector('.screen');
      let emu = null;
      setup.innerHTML =
        '<div class="notice info"><b>Emulación real de hardware x86</b> dentro del navegador (como <a href="https://bellard.org/jslinux/" target="_blank" rel="noopener">JSLinux</a>). Ejecuta un kernel Linux de verdad: todos los comandos son reales. ' +
        'Es ideal para practicar Linux; <b>no</b> es apto para JBoss (CPU de 32 bits emulada y sin aceleración: Java sería extremadamente lento). Para JBoss usa las VMs del Gestor.</div>' +
        '<h3>1. Elige una imagen desde tu equipo</h3>' +
        '<div class="grid2"><label class="f"><span>Tipo de imagen</span><select name="kind"><option value="cdrom">ISO (CD-ROM)</option><option value="bzimage">Kernel bzImage</option><option value="hda">Disco duro (.img)</option><option value="fda">Disquete (.img)</option></select></label>' +
        '<label class="f"><span>Archivo</span><input type="file" name="file"></label>' +
        '<label class="f"><span>Memoria RAM</span><select name="ram"><option>32</option><option>64</option><option selected>128</option><option>256</option><option>512</option></select></label>' +
        '<label class="f"><span>Línea de comandos del kernel (solo bzImage)</span><input type="text" name="cmd" value="tsc=reliable mitigations=off random.trust_cpu=on"></label></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary start">▶ Arrancar</button><span class="muted small status"></span></div>' +
        '<h3>2. Imágenes recomendadas (descárgalas una vez y quedan en tu equipo)</h3>' +
        '<table class="t"><tr><th>Imagen</th><th>Tamaño aprox.</th><th>Notas</th></tr>' +
        '<tr><td>Buildroot Linux de v86 (<code>linux4.iso</code>)</td><td>~7 MB</td><td>Muy ligera; arranca en segundos. Disponible en el repositorio de imágenes del proyecto v86.</td></tr>' +
        '<tr><td>Alpine Linux "virt" x86 (32 bits)</td><td>~50 MB</td><td>alpinelinux.org → Downloads → x86. Arrancar como ISO con 256–512 MB de RAM. Login: root.</td></tr>' +
        '<tr><td>Tiny Core Linux (Core)</td><td>~17 MB</td><td>tinycorelinux.net. Modo texto, 128 MB de RAM.</td></tr></table>' +
        '<p class="muted small">Requisitos: imagen x86 de 32 bits (i386/i686). Las imágenes de 64 bits (x86_64) como RHEL/Rocky no arrancan en v86. Todo se ejecuta localmente: el archivo nunca se sube a Internet.</p>';
      const status = setup.querySelector('.status');
      const B = (label, fn) => { const b = h('button', { class: 'btn sm' }, label); b.onclick = fn; tb.appendChild(b); return b; };
      tb.innerHTML = '<span class="muted small" style="margin-right:auto">Haz clic en la pantalla para capturar el teclado</span>';
      const ctrlAltDel = B('Ctrl+Alt+Supr', () => emu && emu.keyboard_send_scancodes([0x1D, 0x38, 0x53, 0x53 | 0x80, 0x38 | 0x80, 0x1D | 0x80]));
      const pause = B('Pausar', () => { if (!emu) return; if (emu.is_running()) { emu.stop(); pause.textContent = 'Reanudar'; } else { emu.run(); pause.textContent = 'Pausar'; } });
      const reset = B('Reiniciar', () => emu && emu.restart());
      const full = B('Pantalla completa', () => emu && emu.screen_go_fullscreen());
      const stopB = B('Apagar', () => destroy());
      [ctrlAltDel, pause, reset, full, stopB].forEach(b => b.disabled = true);
      const destroy = () => {
        if (emu) { try { emu.destroy(); } catch (e) { } emu = null; }
        screen.style.display = 'none'; setup.style.display = '';
        screen.querySelector('div').textContent = '';
        [ctrlAltDel, pause, reset, full, stopB].forEach(b => b.disabled = true);
      };
      setup.querySelector('.start').onclick = async () => {
        const file = setup.querySelector('[name=file]').files[0];
        if (!file) { toast('Selecciona un archivo de imagen primero', 'warn'); return; }
        status.textContent = 'Cargando el emulador (~3 MB)…';
        try { await ensureV86(); } catch (e) { status.textContent = e.message; return; }
        const kind = setup.querySelector('[name=kind]').value;
        const opts = {
          wasm_fn: async (imports) => { const { instance } = await WebAssembly.instantiate(b64ToBuf(window.V86_WASM_B64), imports); return instance.exports; },
          memory_size: +setup.querySelector('[name=ram]').value * 1024 * 1024,
          vga_memory_size: 8 * 1024 * 1024,
          screen_container: screen,
          bios: { buffer: b64ToBuf(window.V86_SEABIOS_B64) },
          vga_bios: { buffer: b64ToBuf(window.V86_VGABIOS_B64) },
          autostart: true,
          disable_speaker: true
        };
        opts[kind] = { buffer: file };
        if (kind === 'bzimage') opts.cmdline = setup.querySelector('[name=cmd]').value;
        try {
          emu = new window.V86(opts);
        } catch (e) { status.textContent = 'Error al iniciar: ' + e.message; return; }
        setup.style.display = 'none'; screen.style.display = '';
        [ctrlAltDel, pause, reset, full, stopB].forEach(b => b.disabled = false);
        emu.add_listener('emulator-ready', () => toast('Emulador listo: arrancando ' + file.name, 'ok'));
        // el teclado solo va a la VM cuando su ventana tiene el foco
        const setKb = (on) => { try { emu && emu.keyboard_set_enabled(on); } catch (e) { } };
        win.onFocus = () => setKb(true);
        screen.addEventListener('mousedown', () => setKb(true));
        desk.onFocusChange = (w) => { if (w !== win) setKb(false); };
      };
      win.onClose = () => destroy();
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
