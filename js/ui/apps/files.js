/*
 * Explorador de archivos de una VM (actúa con las credenciales del usuario
 * elegido, respetando permisos) y editor de texto gráfico.
 */
(function (L) {
  'use strict';
  const { h, esc, icon, toast, modal, confirmBox } = L.ui;
  const P = L.path, U = L.util;

  function fileIcon(name, n) {
    if (n.t === 'd') return 'folder';
    if (n.t === 'l') return 'link';
    if (/\.(xml|xsd)$/.test(name)) return 'xml';
    if (/\.(zip|tar|gz|war|ear|jar|rpm)$/.test(name)) return 'archive';
    if (n.m & 0o111) return 'exec';
    return 'file';
  }

  L.ui.apps.files = {
    title: 'Archivos', icon: 'files',
    open(desk, o) {
      o = o || {};
      const lab = desk.lab;
      let vm = o.vmId ? lab.vms.get(o.vmId) : Array.from(lab.vms.values())[0];
      if (!vm) { toast('Primero crea una VM', 'warn'); return null; }
      const win = desk.wm.create({ title: 'Archivos — ' + vm.name, icon: 'files', width: 900, height: 560 });
      let user = 'root';
      let cwd = o.path || '/opt';
      let sel = null;
      const hist = [];
      win.body.innerHTML = '<div class="fm"><div class="toolbar"></div><div class="list"></div><div class="status"></div></div>';
      const tb = win.body.querySelector('.toolbar'), list = win.body.querySelector('.list'), status = win.body.querySelector('.status');
      const vmSel = h('select', { title: 'Máquina virtual' });
      const userSel = h('select', { title: 'Actuar como usuario' });
      const pathIn = h('input', { type: 'text', class: 'pathbar' });
      const btn = (t, fn, title) => { const b = h('button', { class: 'btn sm', title: title || t }, t); b.onclick = fn; return b; };
      tb.append(vmSel, btn('←', () => { if (hist.length) { cwd = hist.pop(); render(); } }, 'Atrás'), btn('↑', () => go(P.dirname(cwd)), 'Subir'), btn('⌂', () => go(cred().home || '/'), 'Home'), pathIn,
        btn('+ Carpeta', () => newItem(true)), btn('+ Archivo', () => newItem(false)), btn('Renombrar', () => rename()), btn('Permisos', () => perms()), btn('Eliminar', () => del()), btn('Subir archivo', () => upload(), 'Copiar un archivo de tu equipo a la VM'), btn('Descargar', () => download(), 'Descargar a tu equipo'), btn('Terminal aquí', () => desk.open('terminal', { vmId: vm.id })), h('span', { class: 'muted small' }, 'como'), userSel);
      const fillVms = () => { vmSel.innerHTML = Array.from(lab.vms.values()).map(v => '<option value="' + v.id + '"' + (v === vm ? ' selected' : '') + '>' + esc(v.name) + '</option>').join(''); };
      const fillUsers = () => { const us = L.os.users.passwd(vm.fs).filter(u => u.uid === 0 || u.uid >= 1000); userSel.innerHTML = us.map(u => '<option' + (u.name === user ? ' selected' : '') + '>' + esc(u.name) + '</option>').join(''); };
      vmSel.onchange = () => { vm = lab.vms.get(vmSel.value); win.setTitle('Archivos — ' + vm.name); cwd = '/'; fillUsers(); render(); };
      userSel.onchange = () => { user = userSel.value; render(); };
      pathIn.onkeydown = (e) => { if (e.key === 'Enter') go(pathIn.value.trim()); };
      const cred = () => L.os.users.cred(vm.fs, user) || L.fsutil.ROOT_CRED;
      const go = (p) => { const np = P.resolve(cwd, p); if (!vm.fs.isDir(np)) { toast('No es un directorio: ' + np, 'err'); return; } hist.push(cwd); cwd = np; sel = null; render(); };
      const full = (n) => (cwd === '/' ? '' : cwd) + '/' + n;
      const render = () => {
        pathIn.value = cwd;
        let names;
        try { names = vm.fs.readdir(cwd, cred()); }
        catch (e) { list.innerHTML = '<div class="empty">⛔ ' + esc(e.message) + ' (' + esc(cwd) + ') — pruebe como root</div>'; status.textContent = ''; return; }
        const rows = names.map(n => ({ n, node: vm.fs.lstat(full(n)) })).sort((a, b) => (b.node.t === 'd') - (a.node.t === 'd') || a.n.localeCompare(b.n));
        list.innerHTML = '<table class="t"><thead><tr><th>Nombre</th><th>Tamaño</th><th>Permisos</th><th>Dueño</th><th>Modificado</th></tr></thead><tbody></tbody></table>';
        const tbody = list.querySelector('tbody');
        for (const r of rows) {
          const tr = h('tr', { class: r.n === sel ? 'sel' : '' });
          tr.innerHTML = '<td><div class="fname">' + icon(fileIcon(r.n, r.node)) + '<span>' + esc(r.n) + (r.node.t === 'l' ? ' <span class="muted">→ ' + esc(r.node.tg) + '</span>' : '') + '</span></div></td><td class="small">' + (r.node.t === 'd' ? '—' : U.human(vm.fs.nodeSize(r.node))) + '</td><td class="mono small">' + L.fsutil.modeString(r.node) + '</td><td class="small">' + esc(L.os.users.userName(vm.fs, r.node.u)) + ':' + esc(L.os.users.groupName(vm.fs, r.node.g)) + '</td><td class="small">' + esc(U.lsDate(r.node.mt)) + '</td>';
          tr.onclick = () => { sel = r.n; list.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); status.textContent = full(r.n); };
          tr.ondblclick = () => {
            const p = full(r.n);
            if (vm.fs.isDir(p)) go(p);
            else desk.open('editor', { vmId: vm.id, path: p, user });
          };
          tbody.appendChild(tr);
        }
        const ds = vm.diskStats();
        status.textContent = rows.length + ' elementos · disco: ' + U.human(ds.used) + ' usados de ' + U.human(ds.total) + ' (' + ds.pct + '%)';
      };
      const newItem = async (dir) => {
        const r = await modal(win.body, dir ? 'Nueva carpeta' : 'Nuevo archivo', '<label class="f"><span>Nombre</span><input type="text" name="n"></label>', [{ label: 'Cancelar', value: false }, { label: 'Crear', value: true, cls: 'primary' }]);
        if (!r.value) return;
        const n = r.el.querySelector('[name=n]').value.trim();
        if (!n) return;
        try { if (dir) vm.fs.mkdir(full(n), { cred: cred() }); else vm.fs.write(full(n), '', { cred: cred() }); render(); }
        catch (e) { toast(e.message, 'err'); }
      };
      const rename = async () => {
        if (!sel) return toast('Seleccione un elemento', 'warn');
        const r = await modal(win.body, 'Renombrar', '<label class="f"><span>Nuevo nombre</span><input type="text" name="n" value="' + esc(sel) + '"></label>', [{ label: 'Cancelar', value: false }, { label: 'Renombrar', value: true, cls: 'primary' }]);
        if (!r.value) return;
        try { vm.fs.rename(full(sel), full(r.el.querySelector('[name=n]').value.trim()), cred()); sel = null; render(); } catch (e) { toast(e.message, 'err'); }
      };
      const perms = async () => {
        if (!sel) return toast('Seleccione un elemento', 'warn');
        const n = vm.fs.stat(full(sel));
        const r = await modal(win.body, 'Permisos de ' + sel, '<div class="grid2"><label class="f"><span>Modo octal</span><input type="text" name="m" value="' + (n.m & 0o7777).toString(8).padStart(3, '0') + '"></label><label class="f"><span>Propietario:grupo (solo root)</span><input type="text" name="o" value="' + esc(L.os.users.userName(vm.fs, n.u) + ':' + L.os.users.groupName(vm.fs, n.g)) + '"></label></div><div class="muted small">r=4 w=2 x=1 · dueño/grupo/otros · ejemplo: 750 = rwxr-x---</div>', [{ label: 'Cancelar', value: false }, { label: 'Aplicar', value: true, cls: 'primary' }]);
        if (!r.value) return;
        try {
          vm.fs.chmod(full(sel), parseInt(r.el.querySelector('[name=m]').value, 8), cred());
          const [u, g] = r.el.querySelector('[name=o]').value.split(':');
          const uu = L.os.users.byName(vm.fs, u), gg = L.os.users.groups(vm.fs).find(x => x.name === g);
          if (uu && (uu.uid !== n.u || (gg && gg.gid !== n.g))) vm.fs.chown(full(sel), uu.uid, gg ? gg.gid : null, cred());
          render();
        } catch (e) { toast(e.message, 'err'); }
      };
      const del = async () => {
        if (!sel) return toast('Seleccione un elemento', 'warn');
        if (!await confirmBox(win.body, 'Eliminar', '¿Eliminar <b>' + esc(full(sel)) + '</b>? No hay papelera.', 'Eliminar', true)) return;
        const errs = vm.fs.rmrf(full(sel), cred());
        if (errs.length) toast(errs[0].message + ': ' + (errs[0].path || ''), 'err');
        sel = null; render();
      };
      const upload = () => {
        const inp = h('input', { type: 'file', multiple: 'multiple' });
        inp.onchange = async () => {
          for (const f of inp.files) {
            try {
              const isText = f.size < 2 * 1048576 && !/\.(zip|jar|war|ear|gz|tgz|png|jpg|pdf|class|exe)$/i.test(f.name);
              if (isText) vm.fs.write(full(f.name), await f.text(), { cred: cred() });
              else { vm.fs.write(full(f.name), '(binario importado: ' + f.name + ')', { cred: cred(), vsize: f.size, bin: true }); toast(f.name + ': los binarios reales se guardan como marcador de tamaño (el laboratorio no ejecuta Java real).', 'warn', 7000); }
            } catch (e) { toast(f.name + ': ' + e.message, 'err'); }
          }
          render();
        };
        inp.click();
      };
      const download = () => {
        if (!sel) return toast('Seleccione un archivo', 'warn');
        try {
          const data = vm.fs.read(full(sel), cred());
          const a = h('a', { href: URL.createObjectURL(new Blob([data])), download: sel });
          document.body.appendChild(a); a.click(); a.remove();
        } catch (e) { toast(e.message, 'err'); }
      };
      fillVms(); fillUsers(); render();
      const off = lab.on('change', fillVms);
      const t = setInterval(() => { if (!win.body.querySelector('.modal-bg') && document.activeElement !== pathIn) render(); }, 3000);
      win.onClose = () => { off(); clearInterval(t); };
      return win;
    }
  };

  // ================= Editor de texto =================
  L.ui.apps.editor = {
    title: 'Editor', icon: 'editor',
    open(desk, o) {
      o = o || {};
      const lab = desk.lab;
      const vm = o.vmId ? lab.vms.get(o.vmId) : Array.from(lab.vms.values())[0];
      if (!vm) { toast('Primero crea una VM', 'warn'); return null; }
      let path = o.path || null;
      const user = o.user || 'root';
      const cred = () => L.os.users.cred(vm.fs, user) || L.fsutil.ROOT_CRED;
      const win = desk.wm.create({ title: 'Editor — ' + (path ? P.basename(path) : 'nuevo'), icon: 'editor', width: 860, height: 580 });
      win.body.innerHTML = '<div class="ed"><div class="toolbar"></div><div class="area"><div class="gutter"></div><textarea spellcheck="false"></textarea></div><div class="status"></div></div>';
      const ta = win.body.querySelector('textarea'), gut = win.body.querySelector('.gutter'), st = win.body.querySelector('.status'), tb = win.body.querySelector('.toolbar');
      let dirty = false, ro = false;
      const pathLbl = h('span', { class: 'mono small', style: 'flex:1' });
      const saveBtn = h('button', { class: 'btn sm primary' }, 'Guardar (Ctrl+S)');
      const saveAs = h('button', { class: 'btn sm' }, 'Guardar como…');
      const validate = h('button', { class: 'btn sm' }, 'Validar XML');
      const reload = h('button', { class: 'btn sm' }, 'Recargar');
      tb.append(pathLbl, validate, reload, saveAs, saveBtn);
      const lines = () => { const n = ta.value.split('\n').length; gut.innerHTML = Array.from({ length: n }, (_, i) => i + 1).join('<br>'); gut.scrollTop = ta.scrollTop; };
      const status = (extra) => {
        const before = ta.value.slice(0, ta.selectionStart).split('\n');
        st.innerHTML = '<span>Línea ' + before.length + ', Col ' + (before[before.length - 1].length + 1) + '</span><span>' + (dirty ? '● modificado' : 'guardado') + '</span><span>' + esc(vm.name) + ' · como ' + esc(user) + (ro ? ' · <b style="color:var(--warn)">solo lectura</b>' : '') + '</span>' + (extra ? '<span>' + extra + '</span>' : '');
      };
      const load = () => {
        pathLbl.textContent = path || '(sin guardar)';
        if (!path) { ta.value = ''; lines(); status(); return; }
        try {
          ta.value = vm.fs.read(path, cred());
          const n = vm.fs.stat(path);
          ro = !vm.fs.can(n, cred(), 'w');
          if (n.bin && L.archive.isArchive(ta.value)) { const a = L.archive.decode(ta.value); ta.value = '# Archivo empaquetado (' + a.format + ') con ' + a.entries.length + ' entradas:\n' + a.entries.map(e => (e.t === 'd' ? 'd ' : '- ') + e.p).join('\n'); ro = true; ta.readOnly = true; }
          dirty = false;
        } catch (e) { ta.value = ''; toast(e.message, 'err'); }
        lines(); status();
        win.setTitle('Editor — ' + (path ? P.basename(path) : 'nuevo'));
      };
      const checkXml = (quiet) => {
        if (!/\.xml$/i.test(path || '') && quiet) return true;
        try { L.xml.parse(ta.value); if (!quiet) toast('XML bien formado ✔', 'ok'); status('<span style="color:var(--ok)">XML válido</span>'); return true; }
        catch (e) { status('<span style="color:var(--err)">XML: línea ' + e.line + ', col ' + e.col + ': ' + esc(e.message) + '</span>'); if (!quiet) toast('Error XML en línea ' + e.line + ': ' + e.message, 'err', 7000); return false; }
      };
      const save = async (asPath) => {
        let target = asPath || path;
        if (!target) {
          const r = await modal(win.body, 'Guardar como', '<label class="f"><span>Ruta completa</span><input type="text" name="p" value="' + esc(cred().home || '/root') + '/nuevo.txt"></label>', [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, cls: 'primary' }]);
          if (!r.value) return;
          target = r.el.querySelector('[name=p]').value.trim();
        }
        if (/\.xml$/i.test(target) && !checkXml(true)) {
          if (!await confirmBox(win.body, 'XML mal formado', 'El documento tiene errores de sintaxis XML. Si es standalone.xml, JBoss no arrancará (WFLYCTL0085). ¿Guardar de todos modos?', 'Guardar igual', true)) return;
        }
        try { vm.fs.write(target, ta.value, { cred: cred() }); path = target; dirty = false; pathLbl.textContent = path; toast('Guardado ' + path, 'ok'); status(); win.setTitle('Editor — ' + P.basename(path)); }
        catch (e) { toast('No se pudo guardar: ' + e.message + (e.code === 'EACCES' ? ' (abra el archivo como root o como su propietario)' : ''), 'err', 7000); }
      };
      saveBtn.onclick = () => save();
      saveAs.onclick = async () => { const r = await modal(win.body, 'Guardar como', '<label class="f"><span>Ruta completa</span><input type="text" name="p" value="' + esc(path || '/tmp/nuevo.txt') + '"></label>', [{ label: 'Cancelar', value: false }, { label: 'Guardar', value: true, cls: 'primary' }]); if (r.value) save(r.el.querySelector('[name=p]').value.trim()); };
      validate.onclick = () => checkXml(false);
      reload.onclick = async () => { if (!dirty || await confirmBox(win.body, 'Recargar', 'Se descartarán los cambios sin guardar.', 'Recargar', true)) load(); };
      ta.addEventListener('input', () => { dirty = true; lines(); status(); });
      ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
      ta.addEventListener('click', () => status());
      ta.addEventListener('keyup', () => status());
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
        if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = s + 4; dirty = true; }
      });
      win.onClose = () => { if (dirty && !window.confirm('Hay cambios sin guardar en ' + (path || 'el documento') + '. ¿Cerrar de todos modos?')) return false; };
      load();
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
