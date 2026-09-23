/*
 * Terminal (xterm.js) conectada a la consola de una VM: arranque, login,
 * shell interactivo y cierre de sesión.
 */
(function (L) {
  'use strict';
  const { h, esc, toast } = L.ui;
  const U = L.util;
  let ttySeq = 1;

  function makeXterm(container) {
    const xt = new window.Terminal({
      cursorBlink: true, fontSize: 14, lineHeight: 1.15, scrollback: 5000, allowProposedApi: true,
      fontFamily: '"DejaVu Sans Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
      theme: { background: '#0c0c0c', foreground: '#d0d0d0', cursor: '#e8e8e8', selectionBackground: '#44475a', red: '#ff5f56', green: '#5af78e', yellow: '#f3f99d', blue: '#57c7ff', magenta: '#ff6ac1', cyan: '#9aedfe' }
    });
    const fit = new window.FitAddon.FitAddon();
    xt.loadAddon(fit);
    xt.open(container);
    // Copiar/pegar con Ctrl+Shift+C / Ctrl+Shift+V
    xt.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') { const s = xt.getSelection(); if (s && navigator.clipboard) navigator.clipboard.writeText(s); return false; }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') { if (navigator.clipboard) navigator.clipboard.readText().then(t => xt.paste(t)); return false; }
      return true;
    });
    return { xt, fit };
  }

  L.ui.apps.terminal = {
    title: 'Terminal', icon: 'term',
    open(desk, o) {
      o = o || {};
      const lab = desk.lab;
      let vm = o.vmId ? lab.vms.get(o.vmId) : (Array.from(lab.vms.values()).find(v => v.state === 'running') || Array.from(lab.vms.values())[0]);
      if (!vm) { toast('Primero crea una VM en el Gestor de VMs', 'warn'); desk.open('vmmanager'); return null; }
      const win = desk.wm.create({ title: 'Terminal — ' + vm.name, icon: 'term', width: 860, height: 520 });
      const wrap = h('div', { class: 'termwrap' });
      win.body.appendChild(wrap);
      const { xt, fit } = makeXterm(wrap);
      const backend = { write: (s) => xt.write(s), get cols() { return xt.cols; }, get rows() { return xt.rows; }, onData: (cb) => xt.onData(cb) };
      const term = new L.Terminal(backend);
      const tty = 'pts/' + (ttySeq++);
      let closed = false, session = null;
      const doFit = () => { try { fit.fit(); } catch (e) { } };
      win.onResize = doFit;
      win.onFocus = () => setTimeout(() => xt.focus(), 10);
      setTimeout(doFit, 30);
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(doFit) : null;
      if (ro) ro.observe(wrap);

      const waitKey = () => new Promise((res) => { const rel = term.raw((k) => { rel(); res(k); }); });
      const loop = async () => {
        while (!closed) {
          if (vm.state === 'stopped') {
            term.write('\r\n\x1b[33mLa VM "' + vm.name + '" está apagada.\x1b[0m Pulse \x1b[1mEnter\x1b[0m para encenderla (o use el Gestor de VMs).\r\n');
            if (!o.boot) { const k = await waitKey(); if (closed) return; if (k !== '\r') { continue; } }
            o.boot = false;
            if (vm.state === 'stopped') {
              xt.clear();
              const ok = await vm.boot((s) => term.write(s));
              if (!ok) { await U.sleep(500); continue; }
              await vm.restoreServers();
            }
          }
          if (vm.state === 'booting' || vm.state === 'stopping') { term.write('\r\nEsperando a la VM (' + vm.state + ')...\r\n'); while (vm.state === 'booting' || vm.state === 'stopping') await U.sleep(300); continue; }
          // login
          term.write('\r\n\x1b[2m(Credenciales iniciales: ' + esc(vm.login.user) + ' / ' + esc(vm.login.pass) + '   ·   root / ' + esc(vm.login.root) + ')\x1b[0m\r\n');
          const user = await term.readLine({ prompt: vm.hostname.split('.')[0] + ' login: ' });
          if (closed) return;
          if (user === null || vm.state !== 'running') continue;
          if (!user.trim()) continue;
          const pw = await term.readLine({ prompt: 'Password: ', hidden: true });
          if (closed) return;
          if (pw === null || vm.state !== 'running') continue;
          const u = L.os.users.byName(vm.fs, user.trim());
          if (!u || !L.os.users.checkPassword(vm.fs, user.trim(), pw) || /nologin|false/.test(u.shell)) {
            await U.sleep(900);
            term.write('Login incorrect\r\n');
            vm.logSys('login[' + vm.nextPid + ']', 'FAILED LOGIN 1 FROM ' + tty + ' FOR ' + user.trim() + ', Authentication failure', '/var/log/secure');
            continue;
          }
          vm.logSys('systemd-logind[1]', 'New session of user ' + u.name + '.');
          term.write('Last login: ' + U.dateStr(Date.now() - 1800e3) + ' on ' + tty + '\r\n');
          try { const motd = vm.fs.read('/etc/motd'); if (motd) term.write(motd.replace(/\n/g, '\r\n')); } catch (e) { }
          win.setTitle(u.name + '@' + vm.hostname.split('.')[0] + ' — Terminal');
          const shell = new L.Shell(vm, { user: u.name, login: true, term, tty });
          session = { user: u.name, tty, since: Date.now(), hangup: () => term.hangup() };
          vm.sessions.add(session);
          try { await shell.interactive(term); } catch (e) { console.error(e); }
          vm.sessions.delete(session); session = null;
          vm.reap(shell.pid);
          win.setTitle('Terminal — ' + vm.name);
          if (vm.state !== 'running') term.write('\r\n\x1b[33mConexión cerrada: la VM se apagó.\x1b[0m\r\n');
        }
      };
      const offState = vm.on('state', () => { if (vm.state === 'stopped' && session) term.hangup(); });
      win.onClose = () => { closed = true; offState(); if (ro) ro.disconnect(); if (session) vm.sessions.delete(session); term.hangup(); xt.dispose(); };
      loop();
      setTimeout(() => xt.focus(), 50);
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
