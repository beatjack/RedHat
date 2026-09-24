/*
 * Gestor de máquinas virtuales: crear, encender/apagar, recursos, snapshots,
 * clonar, exportar/importar y límites del host.
 */
(function (L) {
  'use strict';
  const { h, esc, icon, toast, modal, confirmBox } = L.ui;
  const U = L.util;

  function statePill(vm) {
    const map = { running: ['run', 'Encendida'], stopped: ['stop', 'Apagada'], booting: ['boot', 'Arrancando'], stopping: ['boot', 'Apagando'] };
    const [c, t] = map[vm.state] || ['stop', vm.state];
    return '<span class="pill ' + c + '"><span class="dot"></span>' + t + '</span>';
  }
  function bar(pct, label, right) {
    const cls = pct > 90 ? 'err' : pct > 75 ? 'warn' : '';
    return '<div class="meterline"><span>' + label + '</span><div class="bar ' + cls + '"><i style="width:' + Math.min(100, pct).toFixed(1) + '%"></i></div><span>' + right + '</span></div>';
  }

  L.ui.apps.vmmanager = {
    title: 'Gestor de VMs', icon: 'vms', width: 980, height: 640,
    open(desk) {
      const lab = desk.lab;
      const win = desk.wm.create({ title: 'Gestor de máquinas virtuales', icon: 'vms', width: 1000, height: 660 });
      const body = win.body;
      body.innerHTML = '<div class="toolbar"></div><div class="hostinfo pad" style="padding-bottom:0"></div><div class="vmgrid"></div>';
      const tb = body.querySelector('.toolbar');
      tb.appendChild(h('button', { class: 'btn primary', onclick: () => createWizard() }, '+ Nueva VM'));
      tb.appendChild(h('button', { class: 'btn', onclick: () => importVm() }, 'Importar VM (.json)'));
      tb.appendChild(h('button', { class: 'btn', onclick: () => hostSettings() }, 'Recursos del host'));
      tb.appendChild(h('span', { class: 'muted small', style: 'margin-left:auto' }, 'Almacenamiento: <b>' + esc(lab.store.kind) + '</b>'));

      const hostInfo = body.querySelector('.hostinfo');
      const grid = body.querySelector('.vmgrid');
      const renderHost = () => {
        const a = lab.allocated();
        hostInfo.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between"><b>Host del laboratorio (recursos simulados)</b><span class="muted small">' + lab.vms.size + ' VMs · ' + Array.from(lab.vms.values()).filter(v => v.state !== 'stopped').length + ' encendidas</span></div>' +
          '<div class="grid2" style="margin-top:8px">' +
          '<div>' + bar(a.runCpu / lab.host.cpu * 100, 'vCPU', a.runCpu + ' / ' + lab.host.cpu + ' en uso') + '<div class="muted small">Asignadas en total: ' + a.cpu + ' (sobreasignación máx. 4:1)</div></div>' +
          '<div>' + bar(a.runRam / lab.host.ramMB * 100, 'RAM', (a.runRam / 1024).toFixed(1) + ' / ' + (lab.host.ramMB / 1024) + ' GB') + '<div class="muted small">Asignada en total: ' + (a.ram / 1024).toFixed(1) + ' GB (sin sobreasignar al encender)</div></div>' +
          '<div>' + bar(a.disk / (lab.host.diskGB * 1024) * 100, 'Disco', (a.disk / 1024).toFixed(0) + ' / ' + lab.host.diskGB + ' GB') + '<div class="muted small">Discos virtuales reservados</div></div>' +
          '</div></div>';
      };
      const render = () => {
        renderHost();
        grid.innerHTML = '';
        if (!lab.vms.size) {
          grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + icon('vms') + '<h3>No hay máquinas virtuales</h3><p>Crea tu primera VM con JBoss para empezar a practicar.</p></div>';
          grid.querySelector('.empty').appendChild(h('button', { class: 'btn primary', onclick: () => createWizard() }, '+ Crear VM'));
          return;
        }
        for (const vm of lab.vms.values()) grid.appendChild(card(vm));
      };
      const card = (vm) => {
        const c = h('div', { class: 'card vmcard' });
        const on = vm.state === 'running';
        const ms = vm.memStats(), ds = vm.diskStats();
        const servers = vm.servers.map(s => {
          const hb = s.doc ? (() => { try { return s.httpBinding(); } catch (e) { return null; } })() : null;
          return '<div class="small">' + icon('jboss') + ' <b>' + esc(s.dist.label) + '</b> ' + '<span class="pill ' + (s.state === 'running' ? 'run' : s.state === 'failed' ? 'fail' : 'boot') + '">' + esc(s.reloadRequired ? 'reload-required' : s.state) + '</span> ' + (hb ? '<span class="muted">' + esc(hb.addr) + ':' + hb.port + '</span>' : '') + '</div>';
        }).join('');
        c.innerHTML = '<h3>' + icon('vms') + esc(vm.name) + ' ' + statePill(vm) + '</h3>' +
          '<div class="spec"><b>SO</b><span>' + esc(vm.osInfo.prettyName) + '</span><b>Red</b><span class="mono">' + esc(vm.ip) + ' · ' + esc(vm.hostname) + '</span>' +
          '<b>Recursos</b><span>' + vm.cpu + ' vCPU · ' + (vm.ramMB >= 1024 ? (vm.ramMB / 1024) + ' GB' : vm.ramMB + ' MB') + ' RAM · ' + (vm.diskMB / 1024) + ' GB disco</span>' +
          '<b>JBoss</b><span>' + (vm.jboss.length ? vm.jboss.map(d => esc(L.jboss.DISTS[d].label)).join(', ') : '<span class="muted">—</span>') + '</span>' +
          '<b>Acceso</b><span class="mono small">' + esc(vm.login.user) + ' / ' + esc(vm.login.pass) + ' · root / ' + esc(vm.login.root) + ' <span class="muted">(iniciales)</span></span></div>' +
          (on ? bar(vm.cpuPercent(), 'CPU', vm.cpuPercent().toFixed(0) + '%') + bar(ms.used / ms.total * 100, 'RAM', ms.used + '/' + ms.total + ' MB') : '') +
          bar(ds.pct, 'Disco', U.human(ds.used) + '/' + U.human(ds.total)) +
          (servers ? '<div style="margin:8px 0">' + servers + '</div>' : '') +
          (vm.snapshots.length ? '<div class="muted small" style="margin:6px 0">' + vm.snapshots.length + ' snapshot(s)</div>' : '') +
          '<div class="acts"></div>';
        const acts = c.querySelector('.acts');
        const B = (label, cls, fn, dis) => { const b = h('button', { class: 'btn sm ' + (cls || '') }, label); b.disabled = !!dis; b.onclick = fn; acts.appendChild(b); };
        if (vm.state === 'stopped') B('▶ Encender', 'ok', () => power(vm, 'on'));
        else {
          B('■ Apagar', '', () => power(vm, 'off'), vm.state !== 'running');
          B('↻ Reiniciar', '', () => power(vm, 'reboot'), vm.state !== 'running');
          B('⏻ Forzar', 'danger', () => power(vm, 'force'));
        }
        B('Terminal', '', () => desk.open('terminal', { vmId: vm.id }));
        B('Archivos', '', () => desk.open('files', { vmId: vm.id }));
        B('Consola JBoss', '', () => desk.open('console', { vmId: vm.id }), !on);
        B('Recursos', '', () => editResources(vm));
        B('Snapshots', '', () => snapshots(vm));
        B('Clonar', '', () => cloneVm(vm));
        B('Exportar', '', () => exportVm(vm));
        B('Eliminar', 'danger', () => removeVm(vm));
        return c;
      };
      const power = async (vm, act) => {
        try {
          if (act === 'on') {
            const chk = lab.canStart(vm);
            if (!chk.ok) { toast(chk.msg, 'err', 7000); return; }
            desk.open('terminal', { vmId: vm.id, boot: true });
          } else if (act === 'off') { await vm.shutdown(null, false); toast(vm.name + ' apagada', 'ok'); }
          else if (act === 'reboot') { vm.shutdown(null, true); toast('Reiniciando ' + vm.name); }
          else if (act === 'force') { if (await confirmBox(body, 'Forzar apagado', 'Equivale a desconectar la corriente: los procesos (incluido JBoss) terminan sin apagado ordenado. ¿Continuar?', 'Forzar apagado', true)) vm.forceOff(); }
        } catch (e) { toast(e.message, 'err'); }
        render();
      };
      const createWizard = async () => {
        const dists = Object.values(L.jboss.DISTS);
        const n = lab.vms.size + 1;
        const html = '<div class="grid2">' +
          '<label class="f"><span>Nombre de la VM</span><input type="text" name="name" value="jboss0' + n + '"></label>' +
          '<label class="f"><span>Sistema operativo</span><select name="os">' + Object.values(L.os.OS_TEMPLATES).map(o => '<option value="' + o.id + '">' + esc(o.label) + '</option>').join('') + '</select></label>' +
          '<label class="f"><span>vCPU</span><select name="cpu">' + [1, 2, 4, 6, 8, 12, 16].filter(x => x <= lab.host.cpu).map(x => '<option' + (x === 2 ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></label>' +
          '<label class="f"><span>Memoria RAM</span><select name="ram">' + [512, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384].filter(x => x <= lab.host.ramMB).map(x => '<option value="' + x + '"' + (x === 2048 ? ' selected' : '') + '>' + (x >= 1024 ? x / 1024 + ' GB' : x + ' MB') + '</option>').join('') + '</select></label>' +
          '<label class="f"><span>Disco (GB)</span><input type="number" name="disk" value="20" min="4" max="100"></label>' +
          '<label class="f"><span>Usuario administrador</span><input type="text" name="user" value="admin"></label>' +
          '<label class="f"><span>Contraseña del usuario</span><input type="text" name="upass" value="redhat"></label>' +
          '<label class="f"><span>Contraseña de root</span><input type="text" name="rpass" value="redhat"></label></div>' +
          '<div><div class="muted small" style="margin-bottom:6px">Distribuciones JBoss a incluir</div><div class="row">' + dists.map((d, i) => '<label class="row small"><input type="checkbox" name="d_' + d.id + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(d.label) + ' <span class="muted">(Java ' + d.javaMin + '+)</span></label>').join('') + '</div></div>' +
          '<div><div class="muted small" style="margin-bottom:6px">Modo de instalación</div>' +
          '<label class="opt"><input type="radio" name="mode" value="installer" checked><span>Solo instaladores en <code>/opt/installers</code>: practicas todo (Java, unzip, usuario, permisos, arranque)</span></label>' +
          '<label class="opt"><input type="radio" name="mode" value="pre"><span>Preinstalado en <code>/opt</code> (Java, unzip y usuario <code>jboss</code> listos)</span></label></div>' +
          '<div class="notice info small">Los recursos se descuentan del host simulado. Al encender se valida que haya RAM libre (sin sobreasignación), como en un hipervisor real.</div><div class="err notice" style="display:none"></div>';
        const r = await modal(body, 'Nueva máquina virtual', html, [{ label: 'Cancelar', value: false }, {
          label: 'Crear VM', value: true, cls: 'primary', validate: async (m) => {
            const v = (n) => m.querySelector('[name=' + n + ']');
            const spec = { name: v('name').value.trim(), os: v('os').value, cpu: +v('cpu').value, ramMB: +v('ram').value, diskMB: Math.round(+v('disk').value * 1024), user: v('user').value.trim() || 'admin', userPassword: v('upass').value || 'redhat', rootPassword: v('rpass').value || 'redhat', jbossDists: dists.filter(d => v('d_' + d.id).checked).map(d => d.id), preinstall: m.querySelector('[name=mode]:checked').value === 'pre' };
            const errs = lab.validateSpec(spec);
            if (!/^[a-z_][a-z0-9_-]*$/.test(spec.user)) errs.push('Usuario inválido (minúsculas, números, - y _).');
            const box = m.querySelector('.err');
            if (errs.length) { box.style.display = ''; box.innerHTML = errs.map(esc).join('<br>'); return false; }
            try { await lab.create(spec); toast('VM ' + spec.name + ' creada', 'ok'); return true; }
            catch (e) { box.style.display = ''; box.textContent = e.message; return false; }
          }
        }]);
        if (r.value) render();
      };
      const editResources = async (vm) => {
        if (vm.state !== 'stopped') { toast('Apague la VM para cambiar sus recursos (como en un hipervisor real).', 'warn'); return; }
        const r = await modal(body, 'Recursos de ' + vm.name, '<div class="grid2">' +
          '<label class="f"><span>vCPU</span><input type="number" name="cpu" value="' + vm.cpu + '" min="1" max="' + lab.host.cpu + '"></label>' +
          '<label class="f"><span>RAM (MB)</span><input type="number" name="ram" value="' + vm.ramMB + '" min="512" step="256"></label>' +
          '<label class="f"><span>Disco (GB) — solo ampliar</span><input type="number" name="disk" value="' + vm.diskMB / 1024 + '" min="' + vm.diskMB / 1024 + '"></label></div>' +
          '<label class="f"><span>Notas</span><textarea name="notes" rows="3">' + esc(vm.notes) + '</textarea></label><div class="notice err" style="display:none"></div>',
          [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, cls: 'primary', validate: async (m) => {
            try { await lab.update(vm, { cpu: +m.querySelector('[name=cpu]').value, ramMB: +m.querySelector('[name=ram]').value, diskMB: Math.round(+m.querySelector('[name=disk]').value * 1024), notes: m.querySelector('[name=notes]').value }); return true; }
            catch (e) { const b = m.querySelector('.err'); b.style.display = ''; b.innerHTML = esc(e.message).replace(/\n/g, '<br>'); return false; }
          } }]);
        if (r.value) { toast('Recursos actualizados', 'ok'); render(); }
      };
      const snapshots = async (vm) => {
        const list = () => vm.snapshots.length ? '<table class="t"><tr><th>Nombre</th><th>Fecha</th><th></th></tr>' + vm.snapshots.map(s => '<tr><td>' + esc(s.name) + '</td><td class="small">' + esc(U.dateStr(s.created)) + '</td><td style="text-align:right"><button class="btn sm" data-rev="' + s.id + '">Revertir</button> <button class="btn sm danger" data-del="' + s.id + '">Borrar</button></td></tr>').join('') + '</table>' : '<div class="muted">Sin snapshots.</div>';
        const bg = h('div', { class: 'modal-bg' });
        const m = h('div', { class: 'modal' });
        const draw = () => {
          m.innerHTML = '<h3>Snapshots de ' + esc(vm.name) + '</h3><div class="mb"><div class="notice info small">Un snapshot guarda el disco completo de la VM. Revertir apaga la VM y restaura el disco a ese punto (útil antes de un cambio riesgoso).</div>' + list() + '<div class="row"><input type="text" placeholder="nombre del snapshot" class="sn" style="flex:1"><button class="btn primary take">Tomar snapshot</button></div></div><div class="mf"><button class="btn close">Cerrar</button></div>';
          m.querySelector('.close').onclick = () => { bg.remove(); render(); };
          m.querySelector('.take').onclick = async () => { await lab.snapshot(vm, m.querySelector('.sn').value.trim() || ('snap-' + (vm.snapshots.length + 1))); toast('Snapshot creado', 'ok'); draw(); };
          m.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => { if (await confirmBox(m, 'Revertir', 'Se perderán los cambios posteriores al snapshot y la VM se apagará. ¿Continuar?', 'Revertir', true)) { await lab.revert(vm, b.dataset.rev); toast('VM revertida', 'ok'); draw(); } });
          m.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await lab.deleteSnapshot(vm, b.dataset.del); draw(); });
        };
        draw();
        bg.appendChild(m); body.appendChild(bg);
      };
      const cloneVm = async (vm) => {
        if (vm.state !== 'stopped') { toast('Apague la VM para clonarla.', 'warn'); return; }
        const r = await modal(body, 'Clonar ' + vm.name, '<label class="f"><span>Nombre del clon</span><input type="text" name="n" value="' + esc(vm.name) + '-clon"></label><div class="notice info small">El clon recibe nueva IP y hostname. Se agrega a /etc/hosts de todas las VMs.</div><div class="notice err" style="display:none"></div>',
          [{ label: 'Cancelar', value: false }, { label: 'Clonar', value: true, cls: 'primary', validate: async (m) => { try { await lab.clone(vm, m.querySelector('[name=n]').value.trim()); return true; } catch (e) { const b = m.querySelector('.err'); b.style.display = ''; b.innerHTML = esc(e.message).replace(/\n/g, '<br>'); return false; } } }]);
        if (r.value) { toast('Clon creado', 'ok'); render(); }
      };
      const exportVm = (vm) => {
        const blob = new Blob([lab.exportVm(vm)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: vm.name + '.jlab-vm.json' });
        document.body.appendChild(a); a.click(); a.remove();
        toast('Exportada ' + vm.name + ' (' + U.human(blob.size) + ')', 'ok');
      };
      const importVm = () => {
        const inp = h('input', { type: 'file', accept: '.json,application/json' });
        inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return;
          try { const vm = await lab.importVm(await f.text()); toast('Importada ' + vm.name, 'ok'); render(); } catch (e) { toast(e.message, 'err', 7000); }
        };
        inp.click();
      };
      const removeVm = async (vm) => {
        if (await confirmBox(body, 'Eliminar ' + vm.name, 'Se eliminará la VM, su disco y sus snapshots de forma permanente. ¿Continuar?', 'Eliminar', true)) {
          await lab.remove(vm); toast('VM eliminada', 'ok'); render();
        }
      };
      const hostSettings = async () => {
        const r = await modal(body, 'Recursos del host del laboratorio', '<div class="notice info small">Define la capacidad del "hipervisor" simulado. No consume recursos reales de tu equipo: sirve para practicar la planificación de capacidad.</div><div class="grid2">' +
          '<label class="f"><span>CPU del host</span><input type="number" name="cpu" value="' + lab.host.cpu + '" min="1" max="64"></label>' +
          '<label class="f"><span>RAM del host (MB)</span><input type="number" name="ram" value="' + lab.host.ramMB + '" min="1024" step="1024"></label>' +
          '<label class="f"><span>Disco del host (GB)</span><input type="number" name="disk" value="' + lab.host.diskGB + '" min="20"></label></div><div class="notice err" style="display:none"></div>',
          [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, cls: 'primary', validate: async (m) => {
            const cpu = +m.querySelector('[name=cpu]').value, ram = +m.querySelector('[name=ram]').value, disk = +m.querySelector('[name=disk]').value;
            const a = lab.allocated();
            const errs = [];
            if (a.runRam > ram) errs.push('Hay ' + a.runRam + ' MB en uso por VMs encendidas.');
            if (a.disk > disk * 1024) errs.push('Los discos asignados (' + Math.round(a.disk / 1024) + ' GB) superan el nuevo tamaño.');
            if (Array.from(lab.vms.values()).some(v => v.cpu > cpu)) errs.push('Alguna VM tiene más vCPU que el nuevo total.');
            if (errs.length) { const b = m.querySelector('.err'); b.style.display = ''; b.innerHTML = errs.join('<br>'); return false; }
            lab.host = { cpu, ramMB: ram, diskGB: disk }; await lab.saveMeta(); return true;
          } }]);
        if (r.value) { toast('Host actualizado', 'ok'); render(); }
      };
      render();
      const off = lab.on('change', render);
      const t = setInterval(() => { if (!body.querySelector('.modal-bg')) render(); }, 2500);
      win.onClose = () => { off(); clearInterval(t); };
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
