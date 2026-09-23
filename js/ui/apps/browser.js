/*
 * Navegador web del escritorio: accede a las VMs del laboratorio como lo haría
 * el navegador de tu equipo (respeta bind address y firewall de cada VM).
 * Y monitor de recursos con gráficas por VM.
 */
(function (L) {
  'use strict';
  const { h, esc, toast } = L.ui;
  const U = L.util;

  L.ui.apps.browser = {
    title: 'Navegador', icon: 'browser',
    open(desk, o) {
      o = o || {};
      const lab = desk.lab;
      const first = Array.from(lab.vms.values()).find(v => v.state === 'running');
      const win = desk.wm.create({ title: 'Navegador', icon: 'browser', width: 920, height: 600 });
      win.body.innerHTML = '<div class="browser"><div class="toolbar"><button class="btn sm back">←</button><button class="btn sm rel">↻</button><input type="text" class="url" style="flex:1;font-family:var(--mono)"><button class="btn sm primary go">Ir</button></div><div class="view" style="flex:1;display:flex;min-height:0"></div></div>';
      const url = win.body.querySelector('.url'), view = win.body.querySelector('.view');
      const hist = [];
      url.value = o.url || (first ? 'http://' + first.ip + ':8080/' : 'http://10.0.0.11:8080/');
      const errPage = (title, code, detail) => { view.innerHTML = '<div class="errpage"><div style="font-size:48px">☹</div><h2>' + title + '</h2><p style="color:#5f6368">' + detail + '</p><p style="color:#80868b;font-size:12px">' + code + '</p></div>'; };
      const load = (u, push) => {
        if (!/^https?:\/\//.test(u)) u = 'http://' + u;
        url.value = u;
        if (push !== false) hist.push(u);
        win.setTitle('Navegador — ' + u);
        const r = lab.hostHttp(u, {});
        if (!r.ok) {
          const m = /^https?:\/\/([^/:]+)(?::(\d+))?/.exec(u) || [];
          const host = m[1], port = m[2] || 80;
          if (r.error === 'unknown') return errPage('No se puede acceder a este sitio', 'DNS_PROBE_FINISHED_NXDOMAIN', 'No se encontró la dirección IP del servidor de <b>' + esc(host) + '</b>. El laboratorio no tiene salida a Internet: use la IP o el nombre de una VM (p. ej. ' + (first ? first.ip : '10.0.0.11') + ').');
          if (r.error === 'refused-host') return errPage('No se puede acceder a este sitio', 'ERR_CONNECTION_REFUSED', '<b>localhost</b> es tu propio equipo, no la VM. Use la IP de la VM.');
          if (r.error === 'timeout') return errPage('No se puede acceder a este sitio', 'ERR_CONNECTION_TIMED_OUT', '<b>' + esc(host) + '</b> tardó demasiado en responder. ¿La VM está encendida?');
          if (r.error === 'unreachable') return errPage('No se puede acceder a este sitio', 'ERR_ADDRESS_UNREACHABLE', 'El firewall de la VM bloquea el puerto <b>' + port + '</b>. En la VM: <code>sudo firewall-cmd --add-port=' + port + '/tcp</code> (y --permanent para que persista).');
          if (r.error === 'refused') return errPage('No se puede acceder a este sitio', 'ERR_CONNECTION_REFUSED', '<b>' + esc(host) + '</b> rechazó la conexión en el puerto ' + port + '.' + (r.localOnly ? '<br>El servicio escucha solo en <b>127.0.0.1</b> dentro de la VM. Inicie JBoss con <code>-b 0.0.0.0</code>.' : ' ¿Está iniciado el servicio?'));
          return errPage('Error', r.error, '');
        }
        if (r.status === 302 && r.headers && r.headers.Location) return load(u.replace(/^(https?:\/\/[^/]+).*$/, '$1') + r.headers.Location, false);
        const ifr = h('iframe', { sandbox: '', referrerpolicy: 'no-referrer' });
        view.innerHTML = '';
        view.appendChild(ifr);
        let body = r.body || '';
        if (!/html/.test(r.type || '') && body) body = '<pre style="font:13px monospace;white-space:pre-wrap">' + esc(body) + '</pre>';
        ifr.srcdoc = body || '<p style="font-family:sans-serif;color:#666">(' + r.status + ' sin contenido)</p>';
      };
      win.body.querySelector('.go').onclick = () => load(url.value.trim());
      win.body.querySelector('.rel').onclick = () => load(url.value.trim(), false);
      win.body.querySelector('.back').onclick = () => { if (hist.length > 1) { hist.pop(); load(hist[hist.length - 1], false); } };
      url.onkeydown = (e) => { if (e.key === 'Enter') load(url.value.trim()); };
      load(url.value);
      return win;
    }
  };

  // ================= Monitor =================
  L.ui.apps.monitor = {
    title: 'Monitor', icon: 'monitor',
    open(desk) {
      const lab = desk.lab;
      const win = desk.wm.create({ title: 'Monitor de recursos', icon: 'monitor', width: 980, height: 620 });
      win.body.innerHTML = '<div class="mon"><div class="hostsum card"></div><div class="mongrid"></div></div>';
      const grid = win.body.querySelector('.mongrid'), sum = win.body.querySelector('.hostsum');
      const series = {};
      const draw = (canvas, data, color, max) => {
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, hh = canvas.clientHeight;
        canvas.width = w * dpr; canvas.height = hh * dpr;
        const g = canvas.getContext('2d');
        g.scale(dpr, dpr);
        g.clearRect(0, 0, w, hh);
        g.strokeStyle = '#3d4250'; g.lineWidth = 1;
        for (let y = 0; y <= 4; y++) { g.beginPath(); g.moveTo(0, hh * y / 4 + 0.5); g.lineTo(w, hh * y / 4 + 0.5); g.stroke(); }
        if (!data.length) return;
        const step = w / 59;
        g.beginPath();
        data.forEach((v, i) => { const x = w - (data.length - 1 - i) * step, y = hh - (v / max) * (hh - 4) - 2; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); });
        g.strokeStyle = color; g.lineWidth = 2; g.stroke();
        g.lineTo(w, hh); g.lineTo(w - (data.length - 1) * step, hh); g.closePath();
        g.fillStyle = color + '33'; g.fill();
      };
      const tick = () => {
        const a = lab.allocated();
        sum.innerHTML = '<b>Host</b> · vCPU en uso ' + a.runCpu + '/' + lab.host.cpu + ' · RAM en uso ' + (a.runRam / 1024).toFixed(1) + '/' + (lab.host.ramMB / 1024) + ' GB · Disco asignado ' + Math.round(a.disk / 1024) + '/' + lab.host.diskGB + ' GB';
        const running = Array.from(lab.vms.values()).filter(v => v.state === 'running');
        if (!running.length) { grid.innerHTML = '<div class="empty">No hay VMs encendidas.</div>'; return; }
        for (const vm of running) {
          const s = series[vm.id] = series[vm.id] || { cpu: [], mem: [] };
          const ms = vm.memStats();
          s.cpu.push(vm.cpuPercent()); s.mem.push(ms.used / ms.total * 100);
          if (s.cpu.length > 60) { s.cpu.shift(); s.mem.shift(); }
          let c = grid.querySelector('[data-vm="' + vm.id + '"]');
          if (!c) {
            c = h('div', { class: 'card', 'data-vm': vm.id }, '<h3 style="margin:0 0 8px;font-size:14px"></h3><div class="small muted">CPU %</div><canvas class="cpu"></canvas><div class="small muted" style="margin-top:6px">Memoria %</div><canvas class="mem"></canvas><div class="info small" style="margin-top:8px"></div><table class="t procs" style="margin-top:8px"></table>');
            grid.appendChild(c);
          }
          c.querySelector('h3').textContent = vm.name + ' (' + vm.ip + ')';
          draw(c.querySelector('.cpu'), s.cpu, '#3fb950', 100);
          draw(c.querySelector('.mem'), s.mem, '#58a6ff', 100);
          const ds = vm.diskStats();
          c.querySelector('.info').innerHTML = 'CPU ' + vm.cpuPercent().toFixed(1) + '% · load ' + vm.loadAvg().map(x => x.toFixed(2)).join(' ') + '<br>RAM ' + ms.used + '/' + ms.total + ' MB · Disco ' + ds.pct + '% (' + U.human(ds.used) + '/' + U.human(ds.total) + ')<br>Puertos: ' + (vm.listeners.map(l => l.addr + ':' + l.port).join(', ') || '—');
          const top = Array.from(vm.procs.values()).sort((x, y) => y.memMB - x.memMB).slice(0, 5);
          c.querySelector('.procs').innerHTML = '<tr><th>PID</th><th>Usuario</th><th>MB</th><th>Proceso</th></tr>' + top.map(p => '<tr><td>' + p.pid + '</td><td>' + esc(p.user) + '</td><td>' + Math.round(p.memMB) + '</td><td class="mono small">' + esc(p.name) + '</td></tr>').join('');
        }
        grid.querySelectorAll('[data-vm]').forEach(c => { if (!running.some(v => v.id === c.dataset.vm)) c.remove(); });
      };
      tick();
      const t = setInterval(tick, 2000);
      win.onClose = () => clearInterval(t);
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
