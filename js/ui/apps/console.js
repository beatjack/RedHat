/*
 * Consola web de administración de JBoss (estilo HAL).
 * Se conecta por la red del laboratorio como lo haría el navegador de tu
 * equipo: requiere que la interfaz de gestión escuche en una IP accesible
 * (-bmanagement 0.0.0.0), que el firewall permita el puerto y un usuario
 * creado con add-user.sh.
 */
(function (L) {
  'use strict';
  const { h, esc, toast, confirmBox } = L.ui;
  const U = L.util, X = L.xml;

  L.ui.apps.console = {
    title: 'Consola JBoss', icon: 'console',
    open(desk, o) {
      o = o || {};
      const lab = desk.lab;
      const vm0 = o.vmId ? lab.vms.get(o.vmId) : Array.from(lab.vms.values()).find(v => v.state === 'running');
      const win = desk.wm.create({ title: 'Consola de administración JBoss', icon: 'console', width: 1040, height: 680 });
      win.body.innerHTML = '<div class="hal"><div class="halhead"><b>Consola de administración</b><span class="prod muted"></span><span class="sp"></span><span class="who small"></span></div><div class="halnav"></div><div class="halbody"></div></div>';
      const head = win.body.querySelector('.prod'), who = win.body.querySelector('.who'), nav = win.body.querySelector('.halnav'), body = win.body.querySelector('.halbody');
      let srv = null, vm = null, user = null, page = 'home', timer = null;
      const model = () => new L.jboss.Model(vm, srv.home, srv);
      const exec = (address, operation, params) => {
        const r = model().execute({ address, operation, params: params || {}, user });
        if (r.outcome !== 'success') toast(String(r['failure-description']).slice(0, 400), 'err', 8000);
        return r;
      };
      const alive = () => srv && (srv.state === 'running' || srv.state === 'reloading' || srv.state === 'starting');

      // ---------- conexión ----------
      const connectPage = (msg) => {
        nav.innerHTML = ''; who.textContent = ''; head.textContent = '';
        const url = vm0 ? 'http://' + vm0.ip + ':9990' : 'http://10.0.0.11:9990';
        body.innerHTML = '<div class="login hcard"><h3>Conectar a la consola</h3>' + (msg ? '<div class="notice err small" style="margin-bottom:10px">' + msg + '</div>' : '') +
          '<label class="f"><span>URL de la interfaz de gestión</span><input type="text" name="url" value="' + esc(url) + '"></label>' +
          '<div class="row" style="margin-top:8px"><label class="f" style="flex:1"><span>Usuario</span><input type="text" name="u" value="admin"></label><label class="f" style="flex:1"><span>Contraseña</span><input type="password" name="p"></label></div>' +
          '<div class="row" style="margin-top:12px"><button class="btn primary go">Iniciar sesión</button></div>' +
          '<p class="muted small">La consola se abre desde tu equipo (fuera de la VM). Si JBoss se inició sin <code>-bmanagement 0.0.0.0</code>, la gestión solo escucha en 127.0.0.1 de la VM y no será accesible — igual que en un servidor real. También debe estar abierto el puerto 9990/tcp en firewalld y existir un usuario creado con <code>add-user.sh</code>.</p></div>';
        const go = async () => {
          const u = body.querySelector('[name=url]').value.trim();
          const m = /^(?:https?:\/\/)?([^/:]+)(?::(\d+))?/.exec(u);
          if (!m) return connectPage('URL inválida');
          const port = +(m[2] || 9990);
          const c = lab.hostConnect(m[1], port);
          if (!c.ok) {
            const why = {
              unknown: 'No se puede resolver el host <b>' + esc(m[1]) + '</b> (ERR_NAME_NOT_RESOLVED). Use la IP o el nombre de una VM del laboratorio.',
              'refused-host': '"localhost" es tu propio equipo, no la VM. Use la IP de la VM (p. ej. ' + (vm0 ? vm0.ip : '10.0.0.11') + ').',
              timeout: 'La VM <b>' + esc(m[1]) + '</b> no responde (ERR_CONNECTION_TIMED_OUT). ¿Está encendida?',
              unreachable: 'El firewall de la VM rechaza la conexión al puerto ' + port + ' (ERR_ADDRESS_UNREACHABLE).<br>Solución: <code>sudo firewall-cmd --permanent --add-port=' + port + '/tcp && sudo firewall-cmd --reload</code>',
              refused: 'Conexión rechazada en ' + esc(m[1]) + ':' + port + ' (ERR_CONNECTION_REFUSED).' + (c.localOnly ? '<br>JBoss está escuchando la gestión solo en <b>127.0.0.1</b>. Reinicie con <code>-bmanagement 0.0.0.0</code> o cambie la interfaz <code>management</code>.' : '<br>¿Está iniciado JBoss? (<code>ss -tlnp | grep ' + port + '</code>)')
            }[c.error] || c.error;
            return connectPage(why);
          }
          if (c.listener.kind !== 'management') return connectPage('El puerto ' + port + ' no es la interfaz de gestión de JBoss (' + esc(c.listener.kind || '') + ').');
          const s = c.listener.server;
          const us = s.mgmtUsers();
          if (!Object.keys(us).length) return connectPage('<b>Your ' + esc(s.dist.product) + ' is running.</b> However you have not yet added any users to be able to access the admin console.<br>Ejecute <code>$JBOSS_HOME/bin/add-user.sh</code> en la VM y vuelva a intentar.');
          const un = body.querySelector('[name=u]').value.trim(), pw = body.querySelector('[name=p]').value;
          if (!s.checkMgmtAuth(un, pw)) return connectPage('Credenciales inválidas (401 Unauthorized). Revise el usuario creado con add-user.sh en mgmt-users.properties.');
          srv = s; vm = c.vm; user = un;
          toast('Conectado a ' + vm.name + ' como ' + un, 'ok');
          layout();
        };
        body.querySelector('.go').onclick = go;
        body.querySelectorAll('input').forEach(i => i.onkeydown = (e) => { if (e.key === 'Enter') go(); });
      };

      // ---------- navegación ----------
      const pages = { home: 'Inicio', deployments: 'Despliegues', configuration: 'Configuración', runtime: 'Runtime', logs: 'Logs' };
      const layout = () => {
        head.textContent = srv.dist.consoleName + ' · ' + srv.dist.label;
        who.textContent = user + ' @ ' + vm.hostname;
        nav.innerHTML = '';
        for (const [k, t] of Object.entries(pages)) {
          const d = h('div', { class: page === k ? 'on' : '' }, t);
          d.onclick = () => { page = k; layout(); };
          nav.appendChild(d);
        }
        const out = h('div', { style: 'margin-left:auto' }, 'Cerrar sesión');
        out.onclick = () => { srv = null; connectPage(); };
        nav.appendChild(out);
        render();
      };
      const render = () => {
        if (!alive()) { srv = null; return connectPage('Se perdió la conexión con el servidor (¿se detuvo o se recargó?).'); }
        const fn = { home, deployments, configuration, runtime, logs }[page];
        body.innerHTML = '';
        if (srv.reloadRequired) {
          const n = h('div', { class: 'notice warn', style: 'margin-bottom:14px' }, '⚠ <b>reload-required</b>: hay cambios de configuración que requieren recargar el servidor. ');
          const b = h('button', { class: 'btn sm primary' }, 'Recargar ahora');
          b.onclick = doReload; n.appendChild(b); body.appendChild(n);
        }
        fn();
      };
      const card = (title, html) => { const c = h('div', { class: 'hcard' }, (title ? '<h3>' + title + '</h3>' : '') + (html || '')); body.appendChild(c); return c; };
      const doReload = async () => { exec([], 'reload'); toast('Recargando servidor…'); for (let i = 0; i < 50 && srv.state !== 'running'; i++) await U.sleep(200); render(); };

      function home() {
        const r = exec([], 'read-resource', { 'include-runtime': true }).result || {};
        const env = exec([['core-service', 'server-environment']], 'read-resource', { 'include-runtime': true }).result || {};
        const hb = srv.httpBinding(), mb = srv.mgmtBinding();
        card('Servidor', '<table class="t"><tr><th>Producto</th><td>' + esc(r['product-name']) + ' ' + esc(r['product-version']) + '</td></tr><tr><th>Release</th><td>' + esc(r['release-version']) + '</td></tr><tr><th>Estado</th><td><b>' + esc(r['server-state']) + '</b></td></tr><tr><th>Host</th><td>' + esc(vm.hostname) + ' (' + esc(vm.ip) + ')</td></tr><tr><th>Nodo</th><td>' + esc(env['node-name'] || '') + '</td></tr><tr><th>Configuración</th><td class="mono small">' + esc(env['config-file'] || '') + '</td></tr><tr><th>HTTP</th><td>' + esc(hb.addr + ':' + hb.port) + '</td></tr><tr><th>Gestión</th><td>' + esc(mb.addr + ':' + mb.port) + '</td></tr><tr><th>Java</th><td>' + esc(srv.java ? 'OpenJDK ' + srv.java.full : '') + ' · Heap ' + srv.xms + 'm–' + srv.xmx + 'm</td></tr><tr><th>Activo desde</th><td>' + esc(U.dateStr(srv.startedAt)) + '</td></tr></table>');
        const c = card('Acciones');
        const rb = h('button', { class: 'btn' }, 'Recargar (reload)'); rb.onclick = doReload;
        const sb = h('button', { class: 'btn danger' }, 'Apagar (shutdown)');
        sb.onclick = async () => { if (await confirmBox(win.body, 'Apagar servidor', '¿Detener JBoss en ' + esc(vm.name) + '? Tendrá que iniciarlo de nuevo desde la terminal.', 'Apagar', true)) { exec([], 'shutdown'); setTimeout(() => connectPage('Servidor detenido.'), 800); } };
        const snap = h('button', { class: 'btn' }, 'Snapshot de configuración'); snap.onclick = () => { const r = exec([], 'take-snapshot'); if (r.outcome === 'success') toast('Snapshot: ' + r.result, 'ok', 6000); };
        c.append(rb, ' ', snap, ' ', sb);
      }
      function deployments() {
        const t = model().types();
        const names = t.deployment.list();
        const rows = names.map(n => t.deployment.node(n));
        const c = card('Despliegues', rows.length ? '<table class="t"><tr><th>Nombre</th><th>Estado</th><th>Habilitado</th><th>Origen</th><th>Context root</th><th></th></tr>' + rows.map(d => '<tr><td><b>' + esc(d.name) + '</b></td><td>' + (d.status === 'OK' ? '<span style="color:#3e8635">● OK</span>' : d.status === 'FAILED' ? '<span style="color:#c9190b">● FAILED</span>' : '○ ' + esc(d.status)) + '</td><td>' + (d.enabled !== false ? 'sí' : 'no') + '</td><td class="small">' + (d.scanner ? 'deployment-scanner' : 'administrado (CLI/consola)') + '</td><td class="mono small">' + esc(d.contextRoot || '') + '</td><td data-n="' + esc(d.name) + '" style="text-align:right"></td></tr>' + (d.status === 'FAILED' && d.error ? '<tr><td colspan="6"><pre class="log" style="max-height:140px">' + esc(d.error) + '</pre></td></tr>' : '')).join('') + '</table>' : '<p class="muted">No hay despliegues.</p>');
        c.querySelectorAll('td[data-n]').forEach(td => {
          const d = t.deployment.node(td.dataset.n);
          const B = (l, cls, fn) => { const b = h('button', { class: 'btn sm ' + cls }, l); b.onclick = fn; td.append(b, ' '); };
          if (d.scanner) { td.innerHTML = '<span class="muted small">gestione en deployments/</span>'; return; }
          if (d.enabled === false || d.status !== 'OK') B('Habilitar', 'primary', () => { exec([['deployment', d.name]], 'deploy'); render(); });
          else B('Deshabilitar', '', () => { exec([['deployment', d.name]], 'undeploy'); render(); });
          B('Redesplegar', '', () => { exec([['deployment', d.name]], 'redeploy'); render(); });
          B('Quitar', 'danger', async () => { if (await confirmBox(win.body, 'Quitar despliegue', '¿Eliminar ' + esc(d.name) + ' del servidor?', 'Quitar', true)) { try { model().undeployManaged(d, false); } catch (e) { toast(e.dmr || e.message, 'err'); } render(); } });
        });
        let apps = [];
        try { apps = vm.fs.readdir('/opt/installers/apps').filter(f => /\.(war|ear|jar)$/.test(f)).map(f => '/opt/installers/apps/' + f); } catch (e) { }
        const add = card('Agregar despliegue', '<div class="row"><input type="text" name="p" list="jl-apps" placeholder="/ruta/en/la/vm/app.war" style="flex:1;min-width:240px"><datalist id="jl-apps">' + apps.map(a => '<option value="' + esc(a) + '">').join('') + '</datalist><label class="row small"><input type="checkbox" name="force"> reemplazar si existe</label><button class="btn primary">Desplegar</button></div><p class="muted small">Equivale a <code>deploy /ruta/app.war</code> en jboss-cli (despliegue administrado; se registra en &lt;deployments&gt; de standalone.xml).</p>');
        add.querySelector('button').onclick = () => {
          const p = add.querySelector('[name=p]').value.trim();
          if (!p) return;
          try { model().deploy(p, { force: add.querySelector('[name=force]').checked }); toast('Desplegado ' + p, 'ok'); } catch (e) { toast(e.dmr || e.message, 'err', 9000); }
          render();
        };
        const mk = card('Crear aplicación de prueba (.war)', '<div class="row"><label class="f"><span>Nombre</span><input type="text" name="n" value="demo"></label><label class="f"><span>Context root</span><input type="text" name="cr" value="/demo"></label><label class="f" style="flex:1;min-width:220px"><span>Mensaje en index.html</span><input type="text" name="msg" value="¡Mi primera app en JBoss!"></label><button class="btn">Crear y desplegar</button></div>');
        mk.querySelector('button').onclick = () => {
          const n = mk.querySelector('[name=n]').value.trim().replace(/[^\w-]/g, '') || 'demo';
          const cr = mk.querySelector('[name=cr]').value.trim() || '/' + n;
          const entries = L.jboss.appArchive({ 'index.html': '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(n) + '</title></head><body style="font-family:sans-serif;padding:40px"><h1>' + esc(mk.querySelector('[name=msg]').value) + '</h1><p>App <b>' + esc(n) + '.war</b> en ' + esc(vm.hostname) + '</p></body></html>\n', 'WEB-INF/web.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<web-app version="5.0"><display-name>' + esc(n) + '</display-name></web-app>\n', 'WEB-INF/jboss-web.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<jboss-web>\n    <context-root>' + esc(cr) + '</context-root>\n</jboss-web>\n' });
          const f = '/tmp/' + n + '.war';
          vm.fs.write(f, L.archive.encode('war', entries), { bin: true });
          try { model().deploy(f, { force: true }); toast('Desplegado ' + n + '.war en ' + cr, 'ok'); } catch (e) { toast(e.dmr || e.message, 'err', 9000); }
          render();
        };
      }
      function configuration() {
        const m = model();
        const T = m.types();
        // Datasources
        const dsNames = T['data-source'].list();
        const drivers = T['jdbc-driver'].list();
        const ds = card('Datasources', '<table class="t"><tr><th>Nombre</th><th>JNDI</th><th>Driver</th><th>URL</th><th>Estado</th><th></th></tr>' + dsNames.map(n => { const r = m.readAttrs({ def: T['data-source'], node: T['data-source'].node(n) }); const bound = srv.boundDs.has(r['jndi-name']); return '<tr><td><b>' + esc(n) + '</b></td><td class="mono small">' + esc(r['jndi-name']) + '</td><td>' + esc(r['driver-name']) + '</td><td class="mono small">' + esc(r['connection-url']) + '</td><td>' + (r.enabled ? (bound ? '<span style="color:#3e8635">● activo</span>' : '<span style="color:#c9190b">● sin enlazar</span>') : 'deshabilitado') + '</td><td data-ds="' + esc(n) + '" style="text-align:right"></td></tr>'; }).join('') + '</table>');
        ds.querySelectorAll('td[data-ds]').forEach(td => {
          const n = td.dataset.ds;
          const B = (l, cls, fn) => { const b = h('button', { class: 'btn sm ' + cls }, l); b.onclick = fn; td.append(b, ' '); };
          B('Probar conexión', '', () => { const r = exec([['subsystem', 'datasources'], ['data-source', n]], 'test-connection-in-pool'); if (r.outcome === 'success') toast('Conexión exitosa a ' + n, 'ok'); });
          B('Quitar', 'danger', async () => { if (await confirmBox(win.body, 'Quitar datasource', '¿Eliminar ' + esc(n) + '?', 'Quitar', true)) { exec([['subsystem', 'datasources'], ['data-source', n]], 'remove'); render(); } });
        });
        const add = card('Agregar datasource', '<div class="grid2"><label class="f"><span>Nombre (pool)</span><input name="n" value="AppDS"></label><label class="f"><span>JNDI</span><input name="j" value="java:jboss/datasources/AppDS"></label><label class="f"><span>Driver</span><select name="d">' + drivers.map(d => '<option>' + esc(d) + '</option>').join('') + '</select></label><label class="f"><span>URL de conexión</span><input name="u" value="jdbc:h2:mem:app;DB_CLOSE_DELAY=-1"></label><label class="f"><span>Usuario</span><input name="us" value="sa"></label><label class="f"><span>Contraseña</span><input name="pw" value="sa"></label></div><div class="row" style="margin-top:10px"><button class="btn primary">Agregar</button><span class="muted small">Para PostgreSQL/MySQL primero registre el módulo y el driver (module add + jdbc-driver:add) desde jboss-cli.</span></div>');
        add.querySelector('button').onclick = () => {
          const v = (k) => add.querySelector('[name=' + k + ']').value.trim();
          const r = exec([['subsystem', 'datasources'], ['data-source', v('n')]], 'add', { 'jndi-name': v('j'), 'driver-name': v('d'), 'connection-url': v('u'), 'user-name': v('us') || undefined, password: v('pw') || undefined });
          if (r.outcome === 'success') toast('Datasource ' + v('n') + ' agregado', 'ok');
          render();
        };
        card('Drivers JDBC', '<table class="t"><tr><th>Nombre</th><th>Módulo</th><th>Cargado</th></tr>' + drivers.map(d => { const n = T['jdbc-driver'].node(d); const mod = X.attr(n, 'module'); return '<tr><td>' + esc(d) + '</td><td class="mono small">' + esc(mod) + '</td><td>' + (srv.moduleExists(mod) ? 'sí' : '<span style="color:#c9190b">módulo no encontrado</span>') + '</td></tr>'; }).join('') + '</table>');
        // System properties
        const props = T['system-property'].list();
        const sp = card('Propiedades del sistema', '<table class="t"><tr><th>Nombre</th><th>Valor</th><th></th></tr>' + props.map(p => '<tr><td class="mono">' + esc(p) + '</td><td class="mono">' + esc(X.attr(T['system-property'].node(p), 'value')) + '</td><td data-sp="' + esc(p) + '" style="text-align:right"></td></tr>').join('') + '</table><div class="row" style="margin-top:10px"><input name="k" placeholder="nombre"><input name="v" placeholder="valor"><button class="btn primary">Agregar</button></div>');
        sp.querySelectorAll('td[data-sp]').forEach(td => { const b = h('button', { class: 'btn sm danger' }, 'Quitar'); b.onclick = () => { exec([['system-property', td.dataset.sp]], 'remove'); render(); }; td.appendChild(b); });
        sp.querySelector('.row button').onclick = () => { const k = sp.querySelector('[name=k]').value.trim(), v = sp.querySelector('[name=v]').value; if (k) exec([['system-property', k]], 'add', { value: v }); render(); };
        // Socket bindings
        const g = X.attr(srv.socketGroup(), 'name');
        const binds = srv.bindings();
        const sb = card('Socket bindings (grupo ' + esc(g) + ', port-offset ' + srv.portOffset() + ')', '<table class="t"><tr><th>Nombre</th><th>Puerto configurado</th><th>Puerto efectivo</th><th>Interfaz</th><th></th></tr>' + Object.values(binds).map(b => '<tr><td>' + esc(b.name) + '</td><td class="mono small">' + esc(X.attr(T['socket-binding'].node(b.name, srv.socketGroup()), 'port')) + '</td><td><b>' + b.port + '</b></td><td>' + esc(b.interface) + ' (' + esc(b.addr) + ')</td><td data-sb="' + esc(b.name) + '" style="text-align:right"></td></tr>').join('') + '</table><p class="muted small">Cambiar puertos o interfaces deja el servidor en <b>reload-required</b>.</p>');
        sb.querySelectorAll('td[data-sb]').forEach(td => {
          const i = h('input', { type: 'number', style: 'width:90px', placeholder: 'puerto' });
          const b = h('button', { class: 'btn sm' }, 'Cambiar');
          b.onclick = () => { if (!i.value) return; exec([['socket-binding-group', g], ['socket-binding', td.dataset.sb]], 'write-attribute', { name: 'port', value: +i.value }); render(); };
          td.append(i, ' ', b);
        });
        // Interfaces
        const itfs = T.interface.list();
        const ic = card('Interfaces', '<table class="t"><tr><th>Nombre</th><th>inet-address</th><th>Resuelta</th><th></th></tr>' + itfs.map(n => { const node = T.interface.node(n); const r = m.readAttrs({ def: T.interface, node }, true); return '<tr><td>' + esc(n) + '</td><td class="mono small">' + esc(r['inet-address'] || (r['any-address'] ? 'any-address' : '')) + '</td><td>' + esc(r['resolved-address']) + '</td><td data-if="' + esc(n) + '" style="text-align:right"></td></tr>'; }).join('') + '</table>');
        ic.querySelectorAll('td[data-if]').forEach(td => {
          const i = h('input', { type: 'text', style: 'width:220px', placeholder: '${jboss.bind.address:0.0.0.0}' });
          const b = h('button', { class: 'btn sm' }, 'Cambiar');
          b.onclick = () => { if (!i.value) return; exec([['interface', td.dataset.if]], 'write-attribute', { name: 'inet-address', value: i.value }); render(); };
          td.append(i, ' ', b);
        });
        // Logging
        const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF'];
        const root = T['root-logger'].node('ROOT');
        const loggers = T.logger.list();
        const lg = card('Logging', '<div class="row"><b>Root logger:</b><select name="root">' + levels.map(l => '<option' + (l === (root ? X.attr(X.kid(root, 'level'), 'name') : 'INFO') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div><table class="t" style="margin-top:10px"><tr><th>Categoría</th><th>Nivel</th><th></th></tr>' + loggers.map(n => '<tr><td class="mono small">' + esc(n) + '</td><td>' + esc(X.attr(X.kid(T.logger.node(n), 'level'), 'name')) + '</td><td data-lg="' + esc(n) + '" style="text-align:right"></td></tr>').join('') + '</table><div class="row" style="margin-top:10px"><input name="cat" placeholder="com.miempresa" style="flex:1"><select name="lvl">' + levels.map(l => '<option' + (l === 'DEBUG' ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><button class="btn primary">Agregar logger</button></div>');
        lg.querySelector('[name=root]').onchange = (e) => { exec([['subsystem', 'logging'], ['root-logger', 'ROOT']], 'write-attribute', { name: 'level', value: e.target.value }); toast('Nivel raíz: ' + e.target.value, 'ok'); };
        lg.querySelectorAll('td[data-lg]').forEach(td => { const b = h('button', { class: 'btn sm danger' }, 'Quitar'); b.onclick = () => { exec([['subsystem', 'logging'], ['logger', td.dataset.lg]], 'remove'); render(); }; td.appendChild(b); });
        lg.querySelector('.row:last-child button').onclick = () => { const c = lg.querySelector('[name=cat]').value.trim(); if (c) exec([['subsystem', 'logging'], ['logger', c]], 'add', { level: lg.querySelector('[name=lvl]').value }); render(); };
      }
      function runtime() {
        const mem = exec([['core-service', 'platform-mbean'], ['type', 'memory']], 'read-attribute', { name: 'heap-memory-usage' }).result || {};
        const pct = mem.max ? mem.used / mem.max * 100 : 0;
        const p = vm.proc(srv.pid);
        card('JVM', '<div class="row"><b>Heap:</b> ' + U.human(mem.used || 0) + ' usados / ' + U.human(mem.max || 0) + ' máx.</div><div class="bar" style="margin:8px 0;background:#e5e5e5"><i style="width:' + pct.toFixed(1) + '%;background:#0066cc"></i></div>' +
          '<table class="t"><tr><th>PID</th><td>' + srv.pid + ' (usuario ' + esc(srv.user) + ')</td></tr><tr><th>Memoria del proceso (RSS)</th><td>' + (p ? p.memMB + ' MB' : '—') + ' de ' + vm.ramMB + ' MB de la VM</td></tr><tr><th>Uptime</th><td>' + U.uptimeStr(Math.floor((Date.now() - srv.startedAt) / 1000)) + '</td></tr><tr><th>JAVA_OPTS</th><td class="mono small">' + esc(srv.javaOpts) + '</td></tr><tr><th>Carga de la VM</th><td>' + vm.loadAvg().map(x => x.toFixed(2)).join(', ') + ' (' + vm.cpu + ' vCPU)</td></tr></table>');
        const gc = card('');
        const b = h('button', { class: 'btn' }, 'Ejecutar GC (jcmd GC.run)'); b.onclick = () => { srv.heapUsed = Math.round((srv.heapUsed || 90) * 0.6); render(); };
        gc.appendChild(b);
        card('Datasources enlazados', srv.boundDs.size ? '<ul>' + Array.from(srv.boundDs.keys()).map(k => '<li class="mono">' + esc(k) + '</li>').join('') + '</ul>' : '<p class="muted">Ninguno</p>');
        card('Puertos en escucha (proceso ' + srv.pid + ')', '<table class="t"><tr><th>Puerto</th><th>Dirección</th><th>Uso</th></tr>' + vm.listeners.filter(l => l.pid === srv.pid).map(l => '<tr><td>' + l.port + '</td><td>' + esc(l.addr) + '</td><td>' + esc(l.kind) + '</td></tr>').join('') + '</table>');
      }
      function logs() {
        const c = card('server.log', '<div class="row"><input name="f" placeholder="filtrar (p. ej. ERROR, WFLYSRV0010)" style="flex:1"><select name="n"><option>100</option><option selected>300</option><option>1000</option></select><label class="row small"><input type="checkbox" name="auto" checked> auto-actualizar</label></div><pre class="log"></pre>');
        const pre = c.querySelector('pre');
        const draw = () => {
          let txt = '';
          try { txt = vm.fs.read(srv.logDir + '/server.log'); } catch (e) { txt = '(no se pudo leer server.log: ' + e.message + ')'; }
          const f = c.querySelector('[name=f]').value.trim().toLowerCase();
          let ls = txt.split('\n').filter(Boolean);
          if (f) ls = ls.filter(l => l.toLowerCase().includes(f));
          ls = ls.slice(-+c.querySelector('[name=n]').value);
          pre.innerHTML = ls.map(l => { const e = esc(l); return /\bERROR\b|FATAL/.test(l) ? '<span style="color:#ff7b72">' + e + '</span>' : /\bWARN\b/.test(l) ? '<span style="color:#f0ab00">' + e + '</span>' : e; }).join('\n');
          pre.scrollTop = pre.scrollHeight;
        };
        c.querySelector('[name=f]').oninput = draw; c.querySelector('[name=n]').onchange = draw;
        draw();
        clearInterval(timer);
        timer = setInterval(() => { if (page !== 'logs' || !document.body.contains(pre)) { clearInterval(timer); return; } if (c.querySelector('[name=auto]').checked) draw(); }, 2000);
      }
      connectPage();
      win.onClose = () => clearInterval(timer);
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
