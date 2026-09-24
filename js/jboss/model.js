/*
 * Modelo de gestión (management model) simulado sobre standalone.xml.
 * Implementa operaciones DMR: read-resource, read-attribute, write-attribute,
 * add, remove, reload, shutdown, ... para los recursos más usados en la
 * administración diaria (system-property, interface, socket-binding,
 * datasources, jdbc-driver, undertow, logging, deployment-scanner,
 * deployment, core-service). Los cambios se persisten en el XML igual que
 * lo hace el controlador real.
 */
(function (L) {
  'use strict';
  const X = L.xml, P = L.path, U = L.util;

  class OpError extends Error { constructor(msg) { super(msg); this.dmr = msg; } }
  const fail = (m) => { throw new OpError(m); };
  const addrStr = (addr) => '[' + addr.map(([t, n]) => '("' + t + '" => "' + n + '")').join(',') + ']';
  const notFound = (addr) => fail('WFLYCTL0216: Management resource \'' + addrStr(addr) + '\' not found');
  const noAttr = (name) => fail('WFLYCTL0201: Unknown attribute \'' + name + '\'');
  const bool = (v) => v === true || v === 'true';

  // Crea un elemento a partir de texto con la indentación correcta
  function frag(s) { return X.fragment(s); }
  function ensureChild(parent, name, before) {
    let c = X.kid(parent, name);
    if (!c) { c = X.el(name); X.append(parent, c, before); }
    return c;
  }
  function levelOf(node) { return X.attr(X.kid(node, 'level'), 'name'); }
  function setLevel(node, v) { let l = X.kid(node, 'level'); if (!l) { l = X.el('level'); X.append(node, l, X.kids(node)[0]); } X.setAttr(l, 'name', String(v).toUpperCase()); }

  class Model {
    constructor(vm, home, server, embedded) {
      this.vm = vm; this.home = home; this.server = server;
      this.embedded = embedded || null;   // {doc, configPath, props}
      this.doc = server ? server.doc : embedded.doc;
    }
    get running() { return !!this.server; }
    get dist() { return this.server ? this.server.dist : this.embedded.dist; }
    expr(v) { return this.server ? this.server.expr(v) : X.expr(v, this.embedded.props || {}); }
    rootEl() { return X.root(this.doc); }
    persist() {
      if (this.server) this.server.saveConfig();
      else this.vm.fs.write(this.embedded.configPath, X.serialize(this.doc));
    }
    requireReload(res) {
      if (this.server) this.server.reloadRequired = true;
      res.headers = { 'operation-requires-reload': true, 'process-state': 'reload-required' };
    }

    // ================= Definición de recursos =================
    // Cada tipo: list(parent) -> nombres, get(parent, name) -> ctx, attrs, add, remove
    types() {
      const self = this;
      const root = this.rootEl();
      const subsystemEls = () => X.kids(X.kid(root, 'profile'), 'subsystem');
      const subName = (s) => { const m = /:domain:([\w-]+):|:wildfly:([\w-]+):/.exec(X.attr(s, 'xmlns') || ''); return m ? (m[1] || m[2]) : '?'; };
      const dsSub = () => X.subsystem(this.doc, 'datasources');
      const dsContainer = () => X.kid(dsSub(), 'datasources');
      const undertow = () => X.subsystem(this.doc, 'undertow');
      const logging = () => X.subsystem(this.doc, 'logging');
      return {
        '': {
          children: ['core-service', 'deployment', 'extension', 'interface', 'path', 'socket-binding-group', 'subsystem', 'system-property'],
          attrs: {
            'name': () => this.server ? this.server.serverName : this.vm.hostname.split('.')[0],
            'product-name': () => this.dist.product === 'WildFly' ? 'WildFly Full' : 'JBoss EAP',
            'product-version': () => this.dist.version,
            'release-codename': () => '',
            'release-version': () => this.dist.core.replace(/^WildFly Core /, ''),
            'launch-type': () => this.embedded ? 'EMBEDDED' : 'STANDALONE',
            'process-type': () => 'Server',
            'running-mode': () => this.embedded ? 'ADMIN_ONLY' : 'NORMAL',
            'server-state': () => this.server ? (this.server.reloadRequired ? 'reload-required' : this.server.state) : 'running',
            'suspend-state': () => 'RUNNING',
            'profile-name': () => undefined,
            'organization': () => undefined,
            'schema-locations': () => []
          }
        },
        'system-property': {
          parent: '',
          container: () => ensureChild(root, 'system-properties', X.kid(root, 'management')),
          list: () => X.kids(X.kid(root, 'system-properties'), 'property').map(p => X.attr(p, 'name')),
          node: (name) => X.kids(X.kid(root, 'system-properties'), 'property').find(p => X.attr(p, 'name') === name),
          attrs: { value: { get: (n) => X.attr(n, 'value'), set: (n, v) => { X.setAttr(n, 'value', v); if (self.server) self.server.props[X.attr(n, 'name')] = v; } } },
          add: (name, p) => {
            if (p.value === undefined) fail('WFLYCTL0155: \'value\' may not be null');
            const c = ensureChild(root, 'system-properties', X.kid(root, 'management'));
            X.append(c, frag('<property name="' + name + '" value="' + String(p.value).replace(/"/g, '&quot;') + '"/>'));
            if (self.server) self.server.props[name] = p.value;
          },
          remove: (n) => { X.remove(n); if (self.server) delete self.server.props[X.attr(n, 'name')]; }
        },
        'interface': {
          parent: '',
          list: () => X.kids(X.kid(root, 'interfaces'), 'interface').map(i => X.attr(i, 'name')),
          node: (name) => X.kids(X.kid(root, 'interfaces'), 'interface').find(i => X.attr(i, 'name') === name),
          attrs: {
            'inet-address': { get: (n) => { const ia = X.kid(n, 'inet-address'); return ia ? X.attr(ia, 'value') : undefined; }, set: (n, v) => { n.children = []; X.append(n, frag('<inet-address value="' + v + '"/>')); }, reload: true },
            'any-address': { get: (n) => X.kid(n, 'any-address') ? true : undefined, set: (n, v) => { n.children = []; if (bool(v)) X.append(n, frag('<any-address/>')); }, reload: true },
            'resolved-address': { get: (n) => { if (X.kid(n, 'any-address')) return '0.0.0.0'; const ia = X.kid(n, 'inet-address'); return ia ? self.expr(X.attr(ia, 'value')) : '127.0.0.1'; }, runtime: true }
          },
          add: (name, p) => {
            const c = ensureChild(root, 'interfaces', X.kid(root, 'socket-binding-group'));
            const inner = bool(p['any-address']) ? '<any-address/>' : '<inet-address value="' + (p['inet-address'] || '127.0.0.1') + '"/>';
            X.append(c, frag('<interface name="' + name + '">' + inner + '</interface>'));
          },
          addReload: true,
          remove: (n) => X.remove(n)
        },
        'socket-binding-group': {
          parent: '', children: ['socket-binding'],
          list: () => X.kids(root, 'socket-binding-group').map(g => X.attr(g, 'name')),
          node: (name) => X.kids(root, 'socket-binding-group').find(g => X.attr(g, 'name') === name),
          attrs: {
            'default-interface': { get: (n) => X.attr(n, 'default-interface'), set: (n, v) => X.setAttr(n, 'default-interface', v), reload: true },
            'port-offset': { get: (n) => X.attr(n, 'port-offset'), set: (n, v) => X.setAttr(n, 'port-offset', v), reload: true },
            'name': { get: (n) => X.attr(n, 'name') }
          }
        },
        'socket-binding': {
          parent: 'socket-binding-group',
          list: (g) => X.kids(g, 'socket-binding').map(s => X.attr(s, 'name')),
          node: (name, g) => X.kids(g, 'socket-binding').find(s => X.attr(s, 'name') === name),
          attrs: {
            port: { get: (n) => X.attr(n, 'port'), set: (n, v) => X.setAttr(n, 'port', v), reload: true },
            interface: { get: (n) => X.attr(n, 'interface'), set: (n, v) => X.setAttr(n, 'interface', v), reload: true },
            'fixed-port': { get: (n) => X.attr(n, 'fixed-port') === 'true', set: (n, v) => X.setAttr(n, 'fixed-port', bool(v) ? 'true' : undefined), reload: true },
            'bound-port': { get: (n) => { if (!self.server) return undefined; const b = self.server.bindings()[X.attr(n, 'name')]; return b && self.vm.listeners.some(l => l.pid === self.server.pid && l.port === b.port) ? b.port : undefined; }, runtime: true },
            'bound': { get: (n) => { if (!self.server) return false; const b = self.server.bindings()[X.attr(n, 'name')]; return !!(b && self.vm.listeners.some(l => l.pid === self.server.pid && l.port === b.port)); }, runtime: true }
          },
          add: (name, p, g) => {
            if (p.port === undefined) fail('WFLYCTL0155: \'port\' may not be null');
            X.append(g, frag('<socket-binding name="' + name + '" port="' + p.port + '"' + (p.interface ? ' interface="' + p.interface + '"' : '') + '/>'), X.kid(g, 'outbound-socket-binding'));
          },
          addReload: true,
          remove: (n) => X.remove(n)
        },
        'subsystem': {
          parent: '',
          list: () => subsystemEls().map(subName),
          node: (name) => subsystemEls().find(s => subName(s) === name),
          childrenOf: {
            datasources: ['data-source', 'jdbc-driver', 'xa-data-source'],
            undertow: ['server', 'servlet-container', 'buffer-cache'],
            logging: ['console-handler', 'periodic-rotating-file-handler', 'logger', 'root-logger', 'log-file', 'pattern-formatter'],
            'deployment-scanner': ['scanner']
          },
          attrs: {}
        },
        // ----- datasources -----
        'data-source': {
          parent: 'subsystem=datasources',
          list: () => X.kids(dsContainer(), 'datasource').map(d => X.attr(d, 'pool-name')),
          node: (name) => X.kids(dsContainer(), 'datasource').find(d => X.attr(d, 'pool-name') === name),
          attrs: {
            'jndi-name': { get: (n) => X.attr(n, 'jndi-name'), set: (n, v) => X.setAttr(n, 'jndi-name', v), reload: true },
            'enabled': { get: (n) => X.attr(n, 'enabled') !== 'false', set: (n, v) => X.setAttr(n, 'enabled', bool(v) ? 'true' : 'false') },
            'connection-url': { get: (n) => X.text(X.kid(n, 'connection-url')), set: (n, v) => X.setText(ensureChild(n, 'connection-url', X.kids(n)[0]), v), reload: true },
            'driver-name': { get: (n) => X.text(X.kid(n, 'driver')), set: (n, v) => X.setText(ensureChild(n, 'driver'), v), reload: true },
            'user-name': { get: (n) => { const s = X.kid(n, 'security'); return s ? (X.attr(s, 'user-name') || X.text(X.kid(s, 'user-name')) || undefined) : undefined; }, set: (n, v) => X.setAttr(ensureChild(n, 'security'), 'user-name', v), reload: true },
            'password': { get: (n) => { const s = X.kid(n, 'security'); return s ? (X.attr(s, 'password') || X.text(X.kid(s, 'password')) || undefined) : undefined; }, set: (n, v) => X.setAttr(ensureChild(n, 'security'), 'password', v), reload: true },
            'min-pool-size': { get: (n) => { const p = X.kid(n, 'pool'); return p ? +X.text(X.kid(p, 'min-pool-size')) || undefined : undefined; }, set: (n, v) => X.setText(ensureChild(ensureChild(n, 'pool'), 'min-pool-size'), v), reload: true },
            'max-pool-size': { get: (n) => { const p = X.kid(n, 'pool'); return p ? +X.text(X.kid(p, 'max-pool-size')) || undefined : undefined; }, set: (n, v) => X.setText(ensureChild(ensureChild(n, 'pool'), 'max-pool-size'), v), reload: true },
            'statistics-enabled': { get: (n) => X.attr(n, 'statistics-enabled') || false, set: (n, v) => X.setAttr(n, 'statistics-enabled', v) },
            'use-java-context': { get: (n) => X.attr(n, 'use-java-context') !== 'false' }
          },
          add: (name, p) => {
            for (const req of ['jndi-name', 'driver-name', 'connection-url']) if (p[req] === undefined) fail('WFLYCTL0155: \'' + req + '\' may not be null');
            if (!/^java:(jboss\/|\/)/.test(p['jndi-name'])) fail('WFLYJCA0066: Jndi name have to start with java:/ or java:jboss/');
            const drivers = X.kids(X.kid(dsContainer(), 'drivers'), 'driver').map(d => X.attr(d, 'name'));
            if (!drivers.includes(p['driver-name'])) fail('WFLYCTL0369: Required capabilities are not available:\n    org.wildfly.data-source.jdbc-driver.' + p['driver-name'] + '; Possible registration points for this dynamic capability: /subsystem=datasources/jdbc-driver=*');
            const sec = p['user-name'] ? '\n                    <security user-name="' + p['user-name'] + '"' + (p.password ? ' password="' + p.password + '"' : '') + '/>' : '';
            const pool = p['min-pool-size'] || p['max-pool-size'] ? '\n                    <pool>' + (p['min-pool-size'] ? '<min-pool-size>' + p['min-pool-size'] + '</min-pool-size>' : '') + (p['max-pool-size'] ? '<max-pool-size>' + p['max-pool-size'] + '</max-pool-size>' : '') + '</pool>' : '';
            const el = frag('<datasource jndi-name="' + p['jndi-name'] + '" pool-name="' + name + '" enabled="' + (p.enabled === undefined ? 'true' : String(bool(p.enabled))) + '">\n                    <connection-url>' + U.escapeHtml(p['connection-url']) + '</connection-url>\n                    <driver>' + p['driver-name'] + '</driver>' + pool + sec + '\n                </datasource>');
            X.append(dsContainer(), el, X.kid(dsContainer(), 'drivers'));
            if (self.server && self.server.state === 'running') {
              const ds = self.server.readDatasources().find(d => d.name === name);
              self.server.bindDatasource(ds, 'management-handler-thread - 1');
            }
          },
          remove: (n) => {
            if (self.server) { const jndi = X.attr(n, 'jndi-name'); if (self.server.boundDs.delete(jndi)) self.server.log('INFO', 'org.jboss.as.connector.subsystems.datasources', 'MSC service thread 1-3', 'WFLYJCA0010: Unbound data source [' + jndi + ']'); }
            X.remove(n);
          },
          ops: {
            'test-connection-in-pool': (n) => {
              if (!self.server) fail('WFLYJCA0040: failed to invoke operation: WFLYJCA0047: Connection is not valid');
              const jndi = X.attr(n, 'jndi-name');
              if (!self.server.boundDs.has(jndi)) fail('WFLYJCA0040: failed to invoke operation: WFLYJCA0042: failed to match pool. Check JndiName: ' + jndi);
              const url = X.text(X.kid(n, 'connection-url'));
              const m = /^jdbc:(\w+):(?:\/\/([^:/;]+)(?::(\d+))?)?/.exec(url || '');
              if (!m) fail('WFLYJCA0040: failed to invoke operation: WFLYJCA0047: Connection is not valid (URL inválida: ' + url + ')');
              if (m[1] !== 'h2' && m[2]) {
                const r = self.vm.lab ? self.vm.lab.resolve(self.vm, m[2]) : null;
                if (!r) fail('WFLYJCA0040: failed to invoke operation: WFLYJCA0047: Connection is not valid\n    Caused by: java.net.UnknownHostException: ' + m[2]);
              }
              return [true];
            },
            'flush-all-connection-in-pool': () => undefined,
            'enable': (n) => { X.setAttr(n, 'enabled', 'true'); if (self.server) { const ds = self.server.readDatasources().find(d => d.node === n); self.server.bindDatasource(ds, 'management-handler-thread - 1'); } self.persist(); },
            'disable': (n) => { X.setAttr(n, 'enabled', 'false'); if (self.server) self.server.boundDs.delete(X.attr(n, 'jndi-name')); self.persist(); }
          }
        },
        'jdbc-driver': {
          parent: 'subsystem=datasources',
          list: () => X.kids(X.kid(dsContainer(), 'drivers'), 'driver').map(d => X.attr(d, 'name')),
          node: (name) => X.kids(X.kid(dsContainer(), 'drivers'), 'driver').find(d => X.attr(d, 'name') === name),
          attrs: {
            'driver-name': { get: (n) => X.attr(n, 'name') },
            'driver-module-name': { get: (n) => X.attr(n, 'module') },
            'driver-class-name': { get: (n) => X.text(X.kid(n, 'driver-class')) || undefined },
            'driver-xa-datasource-class-name': { get: (n) => X.text(X.kid(n, 'xa-datasource-class')) || undefined }
          },
          add: (name, p) => {
            const mod = p['driver-module-name'];
            if (!mod) fail('WFLYCTL0155: \'driver-module-name\' may not be null');
            if (self.server && !self.server.moduleExists(mod)) fail('WFLYJCA0041: Failed to load module for driver [' + mod + ']');
            if (!self.server && !this.moduleExistsEmbedded(mod)) fail('WFLYJCA0041: Failed to load module for driver [' + mod + ']');
            const drivers = ensureChild(dsContainer(), 'drivers');
            X.append(drivers, frag('<driver name="' + name + '" module="' + mod + '">' + (p['driver-class-name'] ? '<driver-class>' + p['driver-class-name'] + '</driver-class>' : '') + (p['driver-xa-datasource-class-name'] ? '<xa-datasource-class>' + p['driver-xa-datasource-class-name'] + '</xa-datasource-class>' : '') + '</driver>'));
            if (self.server) {
              self.server.drivers = self.server.loadDrivers();
              self.server.log('INFO', 'org.jboss.as.connector.subsystems.datasources', 'management-handler-thread - 1', 'WFLYJCA0005: Deploying non-JDBC-compliant driver class ' + (p['driver-class-name'] || 'java.sql.Driver') + ' (version 42.7)');
            }
          },
          remove: (n) => { X.remove(n); if (self.server) self.server.drivers = self.server.loadDrivers(); }
        },
        // ----- undertow -----
        'server': {
          parent: 'subsystem=undertow', children: ['http-listener', 'https-listener', 'host'],
          list: () => X.kids(undertow(), 'server').map(s => X.attr(s, 'name')),
          node: (name) => X.kids(undertow(), 'server').find(s => X.attr(s, 'name') === name),
          attrs: { 'default-host': { get: (n) => X.attr(n, 'default-host') || 'default-host' } }
        },
        'http-listener': {
          parent: 'server',
          list: (s) => X.kids(s, 'http-listener').map(h => X.attr(h, 'name')),
          node: (name, s) => X.kids(s, 'http-listener').find(h => X.attr(h, 'name') === name),
          attrs: {
            'socket-binding': { get: (n) => X.attr(n, 'socket-binding'), set: (n, v) => X.setAttr(n, 'socket-binding', v), reload: true },
            'redirect-socket': { get: (n) => X.attr(n, 'redirect-socket'), set: (n, v) => X.setAttr(n, 'redirect-socket', v), reload: true },
            'enable-http2': { get: (n) => X.attr(n, 'enable-http2') === 'true', set: (n, v) => X.setAttr(n, 'enable-http2', String(bool(v))), reload: true },
            'enabled': { get: (n) => X.attr(n, 'enabled') !== 'false', set: (n, v) => X.setAttr(n, 'enabled', String(bool(v))), reload: true },
            'max-post-size': { get: (n) => +(X.attr(n, 'max-post-size') || 10485760), set: (n, v) => X.setAttr(n, 'max-post-size', v), reload: true }
          }
        },
        'https-listener': {
          parent: 'server',
          list: (s) => X.kids(s, 'https-listener').map(h => X.attr(h, 'name')),
          node: (name, s) => X.kids(s, 'https-listener').find(h => X.attr(h, 'name') === name),
          attrs: {
            'socket-binding': { get: (n) => X.attr(n, 'socket-binding'), set: (n, v) => X.setAttr(n, 'socket-binding', v), reload: true },
            'ssl-context': { get: (n) => X.attr(n, 'ssl-context'), set: (n, v) => X.setAttr(n, 'ssl-context', v), reload: true }
          }
        },
        'host': {
          parent: 'server',
          list: (s) => X.kids(s, 'host').map(h => X.attr(h, 'name')),
          node: (name, s) => X.kids(s, 'host').find(h => X.attr(h, 'name') === name),
          attrs: {
            'alias': { get: (n) => (X.attr(n, 'alias') || '').split(',').filter(Boolean), set: (n, v) => X.setAttr(n, 'alias', Array.isArray(v) ? v.join(',') : v), reload: true },
            'default-web-module': { get: (n) => X.attr(n, 'default-web-module') || 'ROOT.war', set: (n, v) => X.setAttr(n, 'default-web-module', v), reload: true }
          }
        },
        // ----- logging -----
        'root-logger': {
          parent: 'subsystem=logging',
          list: () => X.kid(logging(), 'root-logger') ? ['ROOT'] : [],
          node: (name) => name === 'ROOT' ? X.kid(logging(), 'root-logger') : null,
          attrs: {
            level: { get: levelOf, set: setLevel },
            handlers: { get: (n) => X.kids(X.kid(n, 'handlers'), 'handler').map(h => X.attr(h, 'name')) }
          }
        },
        'logger': {
          parent: 'subsystem=logging',
          list: () => X.kids(logging(), 'logger').map(l => X.attr(l, 'category')),
          node: (name) => X.kids(logging(), 'logger').find(l => X.attr(l, 'category') === name),
          attrs: {
            level: { get: levelOf, set: setLevel },
            category: { get: (n) => X.attr(n, 'category') },
            'use-parent-handlers': { get: (n) => X.attr(n, 'use-parent-handlers') !== 'false', set: (n, v) => X.setAttr(n, 'use-parent-handlers', String(bool(v))) }
          },
          add: (name, p) => {
            X.append(logging(), frag('<logger category="' + name + '">\n                <level name="' + String(p.level || 'INFO').toUpperCase() + '"/>\n            </logger>'), X.kid(logging(), 'root-logger'));
          },
          remove: (n) => X.remove(n)
        },
        'console-handler': {
          parent: 'subsystem=logging',
          list: () => X.kids(logging(), 'console-handler').map(h => X.attr(h, 'name')),
          node: (name) => X.kids(logging(), 'console-handler').find(h => X.attr(h, 'name') === name),
          attrs: { level: { get: (n) => levelOf(n) || 'ALL', set: setLevel }, enabled: { get: () => true } }
        },
        'periodic-rotating-file-handler': {
          parent: 'subsystem=logging',
          list: () => X.kids(logging(), 'periodic-rotating-file-handler').map(h => X.attr(h, 'name')),
          node: (name) => X.kids(logging(), 'periodic-rotating-file-handler').find(h => X.attr(h, 'name') === name),
          attrs: {
            file: { get: (n) => { const f = X.kid(n, 'file'); return f ? { 'relative-to': X.attr(f, 'relative-to'), path: X.attr(f, 'path') } : undefined; } },
            suffix: { get: (n) => X.attr(X.kid(n, 'suffix'), 'value'), set: (n, v) => X.setAttr(ensureChild(n, 'suffix'), 'value', v) },
            autoflush: { get: (n) => X.attr(n, 'autoflush') !== 'false' },
            level: { get: (n) => levelOf(n) || 'ALL', set: setLevel }
          }
        },
        'log-file': {
          parent: 'subsystem=logging',
          list: () => { if (!self.server) return []; try { return self.vm.fs.readdir(self.server.logDir).filter(f => /\.log/.test(f)); } catch (e) { return []; } },
          node: (name) => { if (!self.server) return null; return self.vm.fs.exists(self.server.logDir + '/' + name) ? { name } : null; },
          attrs: {
            'file-size': { get: (n) => { try { return self.vm.fs.read(self.server.logDir + '/' + n.name).length; } catch (e) { return 0; } }, runtime: true },
            'last-modified-time': { get: (n) => self.vm.fs.stat(self.server.logDir + '/' + n.name).mt, runtime: true },
            'stream': { get: () => undefined, runtime: true }
          },
          ops: {
            'read-log-file': (n, p) => {
              const lines = self.vm.fs.read(self.server.logDir + '/' + n.name).split('\n').filter(Boolean);
              const count = p.lines !== undefined ? +p.lines : 10;
              const tail = p.tail === undefined ? true : bool(p.tail);
              const sk = +(p.skip || 0);
              let sel = tail ? lines.slice(Math.max(0, lines.length - count - sk), lines.length - sk) : lines.slice(sk, sk + count);
              if (count === -1) sel = lines;
              return sel;
            }
          }
        },
        // ----- deployment-scanner -----
        'scanner': {
          parent: 'subsystem=deployment-scanner',
          list: () => X.kids(X.subsystem(this.doc, 'deployment-scanner'), 'deployment-scanner').map(s => X.attr(s, 'name') || 'default'),
          node: (name) => X.kids(X.subsystem(this.doc, 'deployment-scanner'), 'deployment-scanner').find(s => (X.attr(s, 'name') || 'default') === name),
          attrs: {
            path: { get: (n) => X.attr(n, 'path'), set: (n, v) => X.setAttr(n, 'path', v) },
            'relative-to': { get: (n) => X.attr(n, 'relative-to'), set: (n, v) => X.setAttr(n, 'relative-to', v) },
            'scan-interval': { get: (n) => +(X.attr(n, 'scan-interval') || 5000), set: (n, v) => X.setAttr(n, 'scan-interval', v) },
            'scan-enabled': { get: (n) => X.attr(n, 'scan-enabled') !== 'false', set: (n, v) => X.setAttr(n, 'scan-enabled', String(bool(v))) },
            'auto-deploy-zipped': { get: (n) => X.attr(n, 'auto-deploy-zipped') !== 'false', set: (n, v) => X.setAttr(n, 'auto-deploy-zipped', String(bool(v))) },
            'auto-deploy-exploded': { get: (n) => X.attr(n, 'auto-deploy-exploded') === 'true', set: (n, v) => X.setAttr(n, 'auto-deploy-exploded', String(bool(v))) }
          }
        },
        // ----- deployment -----
        'deployment': {
          parent: '',
          list: () => this.server ? Array.from(this.server.deployments.keys()) : X.kids(X.kid(root, 'deployments'), 'deployment').map(d => X.attr(d, 'name')),
          node: (name) => this.server ? this.server.deployments.get(name) : X.kids(X.kid(root, 'deployments'), 'deployment').find(d => X.attr(d, 'name') === name),
          attrs: {
            'name': { get: (d) => d.name || X.attr(d, 'name') },
            'runtime-name': { get: (d) => d.runtimeName || X.attr(d, 'runtime-name') },
            'enabled': { get: (d) => d.enabled !== undefined ? d.enabled : X.attr(d, 'enabled') !== 'false' },
            'status': { get: (d) => d.status || 'STOPPED', runtime: true },
            'persistent': { get: (d) => !d.scanner },
            'owner': { get: (d) => d.scanner ? [['subsystem', 'deployment-scanner'], ['scanner', 'default']] : undefined },
            'managed': { get: (d) => !d.scanner },
            'enabled-time': { get: (d) => d.deployedAt, runtime: true },
            'content': { get: (d) => d.sha ? [{ hash: 'bytes {' + d.sha.slice(0, 20) + '...}' }] : undefined }
          },
          remove: (d) => this.undeployManaged(d, false),
          ops: {
            'deploy': (d) => { d.enabled = true; this.server && this.server.deployNow(d, 'management-handler-thread - 1'); this.setXmlEnabled(d, true); return undefined; },
            'undeploy': (d) => { if (this.server && d.status === 'OK') this.server.undeployNow(d, 'management-handler-thread - 1'); d.enabled = false; this.setXmlEnabled(d, false); return undefined; },
            'redeploy': (d) => { if (this.server) { if (d.status === 'OK') this.server.undeployNow(d, 'management-handler-thread - 1'); this.server.deployNow(d, 'management-handler-thread - 1'); } return undefined; }
          }
        },
        'extension': {
          parent: '',
          list: () => X.kids(X.kid(root, 'extensions'), 'extension').map(e => X.attr(e, 'module')),
          node: (name) => X.kids(X.kid(root, 'extensions'), 'extension').find(e => X.attr(e, 'module') === name),
          attrs: { module: { get: (n) => X.attr(n, 'module') } }
        },
        'path': {
          parent: '',
          list: () => ['jboss.home.dir', 'jboss.server.base.dir', 'jboss.server.config.dir', 'jboss.server.data.dir', 'jboss.server.log.dir', 'jboss.server.temp.dir', 'user.home'],
          node: (name) => ({ name }),
          attrs: { path: { get: (n) => this.server ? this.server.props[n.name] : undefined }, 'read-only': { get: () => true } }
        },
        'core-service': {
          parent: '', children: ['type'],
          list: () => ['management', 'platform-mbean', 'server-environment'],
          node: (name) => ['management', 'platform-mbean', 'server-environment'].includes(name) ? { name } : null,
          attrs: {
            'base-dir': { get: (n) => n.name === 'server-environment' && this.server ? this.server.baseDir : undefined, runtime: true },
            'config-file': { get: (n) => n.name === 'server-environment' && this.server ? this.server.configPath : undefined, runtime: true },
            'home-dir': { get: (n) => n.name === 'server-environment' ? this.home : undefined, runtime: true },
            'log-dir': { get: (n) => n.name === 'server-environment' && this.server ? this.server.logDir : undefined, runtime: true },
            'node-name': { get: (n) => n.name === 'server-environment' && this.server ? this.server.nodeName : undefined, runtime: true },
            'server-name': { get: (n) => n.name === 'server-environment' && this.server ? this.server.serverName : undefined, runtime: true },
            'host-name': { get: (n) => n.name === 'server-environment' ? this.vm.hostname : undefined, runtime: true },
            'launch-type': { get: (n) => n.name === 'server-environment' ? 'STANDALONE' : undefined, runtime: true }
          }
        },
        'type': {
          parent: 'core-service=platform-mbean',
          list: () => ['memory', 'runtime', 'threading', 'operating-system'],
          node: (name) => ['memory', 'runtime', 'threading', 'operating-system'].includes(name) ? { name } : null,
          attrs: {
            'heap-memory-usage': { get: (n) => n.name === 'memory' && self.server ? { init: self.server.xms * 1048576, used: (self.server.heapUsed || 90) * 1048576, committed: self.server.xms * 1048576, max: self.server.xmx * 1048576 } : undefined, runtime: true },
            'non-heap-memory-usage': { get: (n) => n.name === 'memory' ? { init: 7667712, used: 98566144, committed: 110231552, max: -1 } : undefined, runtime: true },
            'uptime': { get: (n) => n.name === 'runtime' && self.server ? Date.now() - self.server.startedAt : undefined, runtime: true },
            'vm-name': { get: (n) => n.name === 'runtime' ? 'OpenJDK 64-Bit Server VM' : undefined, runtime: true },
            'spec-version': { get: (n) => n.name === 'runtime' && self.server && self.server.java ? String(self.server.java.major === 8 ? '1.8' : self.server.java.major) : undefined, runtime: true },
            'input-arguments': { get: (n) => n.name === 'runtime' && self.server ? self.server.javaOpts.split(/\s+/) : undefined, runtime: true },
            'thread-count': { get: (n) => n.name === 'threading' ? 90 + Math.floor(Math.random() * 20) : undefined, runtime: true },
            'available-processors': { get: (n) => n.name === 'operating-system' ? self.vm.cpu : undefined, runtime: true },
            'system-load-average': { get: (n) => n.name === 'operating-system' ? +self.vm.loadAvg()[0].toFixed(2) : undefined, runtime: true },
            'name': { get: (n) => n.name === 'operating-system' ? 'Linux' : undefined, runtime: true }
          }
        }
      };
    }

    moduleExistsEmbedded(mod) {
      const rel = mod.replace(/\./g, '/') + '/main/module.xml';
      return this.vm.fs.exists(this.home + '/modules/system/layers/base/' + rel) || this.vm.fs.exists(this.home + '/modules/' + rel);
    }
    setXmlEnabled(d, en) {
      const x = X.kids(X.kid(this.rootEl(), 'deployments'), 'deployment').find(e => X.attr(e, 'name') === d.name);
      if (x) { X.setAttr(x, 'enabled', en ? undefined : 'false'); this.persist(); }
    }

    // Resuelve una dirección a {type, def, node, parentNode}
    resolve(addr) {
      const T = this.types();
      if (!addr.length) return { key: '', def: T[''], node: this.rootEl() };
      let cur = { key: '', node: this.rootEl() };
      for (let i = 0; i < addr.length; i++) {
        const [type, name] = addr[i];
        const def = T[type];
        const prev = addr[i - 1];
        const parentOk = !!def && ((def.parent === '' && i === 0) || (!!prev && (def.parent === prev[0] || def.parent === prev[0] + '=' + prev[1])));
        if (!def || !parentOk) fail('WFLYCTL0030: No resource definition is registered for address ' + addrStr(addr.slice(0, i + 1)));
        const node = def.node(name, cur.node);
        if (!node) notFound(addr.slice(0, i + 1));
        cur = { key: type, def, node, parentNode: cur.node, name };
      }
      return cur;
    }
    childTypes(key, node, addr) {
      const T = this.types();
      if (key === 'subsystem') return (T.subsystem.childrenOf[addr[addr.length - 1][1]] || []).filter(t => T[t]);
      if (key === 'core-service') return addr[addr.length - 1][1] === 'platform-mbean' ? ['type'] : [];
      return (T[key] && T[key].children) || [];
    }
    childNames(type, cur, addr) {
      const T = this.types();
      const def = T[type];
      if (!def) return [];
      try { return def.list(cur.node) || []; } catch (e) { return []; }
    }
    readAttrs(cur, includeRuntime) {
      const out = {};
      const attrs = cur.def.attrs || {};
      for (const [k, a] of Object.entries(attrs)) {
        if (typeof a === 'function') { out[k] = a(); continue; }
        if (a.runtime && !includeRuntime) continue;
        try { out[k] = a.get(cur.node); } catch (e) { out[k] = undefined; }
      }
      return out;
    }
    readResource(addr, recursive, includeRuntime, depth) {
      const cur = this.resolve(addr);
      const out = this.readAttrs(cur, includeRuntime);
      for (const t of this.childTypes(cur.key, cur.node, addr)) {
        const names = this.childNames(t, cur, addr);
        if (!recursive || depth <= 0) { out[t] = names.length ? Object.fromEntries(names.map(n => [n, undefined])) : undefined; continue; }
        out[t] = names.length ? Object.fromEntries(names.map(n => [n, this.readResource(addr.concat([[t, n]]), recursive, includeRuntime, depth - 1)])) : undefined;
      }
      return out;
    }

    // ================= Ejecución de operaciones =================
    execute(op) {
      const res = { outcome: 'success' };
      try {
        const r = this._exec(op, res);
        if (r !== undefined) res.result = r;
      } catch (e) {
        if (!(e instanceof OpError)) { console.error(e); return { outcome: 'failed', 'failure-description': String(e.message || e), 'rolled-back': true }; }
        return { outcome: 'failed', 'failure-description': e.dmr, 'rolled-back': true };
      }
      return res;
    }
    _exec(op, res) {
      const { address, operation } = op;
      const p = op.params || {};
      const T = this.types();
      switch (operation) {
        case 'read-resource': {
          return this.readResource(address, bool(p.recursive), bool(p['include-runtime']), p['recursive-depth'] !== undefined ? +p['recursive-depth'] : 99);
        }
        case 'read-attribute': {
          const cur = this.resolve(address);
          const a = (cur.def.attrs || {})[p.name];
          if (a === undefined) noAttr(p.name);
          return typeof a === 'function' ? a() : a.get(cur.node);
        }
        case 'write-attribute': {
          const cur = this.resolve(address);
          const a = (cur.def.attrs || {})[p.name];
          if (a === undefined) noAttr(p.name);
          if (typeof a === 'function' || !a.set) fail('WFLYCTL0048: Attribute ' + p.name + ' is not writable');
          if (p.value === undefined) fail('WFLYCTL0155: \'value\' may not be null');
          a.set(cur.node, p.value);
          this.persist();
          if (a.reload && this.running) this.requireReload(res);
          return undefined;
        }
        case 'undefine-attribute': {
          const cur = this.resolve(address);
          const a = (cur.def.attrs || {})[p.name];
          if (a === undefined) noAttr(p.name);
          if (typeof a === 'function' || !a.set) fail('WFLYCTL0048: Attribute ' + p.name + ' is not writable');
          try { X.setAttr(cur.node, p.name, undefined); } catch (e) { }
          this.persist();
          if (a.reload && this.running) this.requireReload(res);
          return undefined;
        }
        case 'add': {
          if (!address.length) fail('WFLYCTL0031: No operation named \'add\' exists at address []');
          const [type, name] = address[address.length - 1];
          const parent = this.resolve(address.slice(0, -1));
          const def = T[type];
          if (!def || !def.add) fail('WFLYCTL0031: No operation named \'add\' exists at address ' + addrStr(address));
          try { this.resolve(address); fail('WFLYCTL0212: Duplicate resource ' + addrStr(address)); } catch (e) { if (!/WFLYCTL0216/.test(e.dmr)) throw e; }
          def.add(name, p, parent.node);
          this.persist();
          if (def.addReload && this.running) this.requireReload(res);
          return undefined;
        }
        case 'remove': {
          const cur = this.resolve(address);
          if (!cur.def.remove) fail('WFLYCTL0031: No operation named \'remove\' exists at address ' + addrStr(address));
          cur.def.remove(cur.node);
          this.persist();
          if (cur.def.addReload && this.running) this.requireReload(res);
          return undefined;
        }
        case 'read-children-names': {
          const cur = this.resolve(address);
          if (!p['child-type']) fail('WFLYCTL0155: \'child-type\' may not be null');
          if (!this.childTypes(cur.key, cur.node, address).includes(p['child-type'])) fail('WFLYCTL0158: No known child type named ' + p['child-type']);
          return this.childNames(p['child-type'], cur, address);
        }
        case 'read-children-types': {
          const cur = this.resolve(address);
          return this.childTypes(cur.key, cur.node, address);
        }
        case 'read-children-resources': {
          const cur = this.resolve(address);
          const t = p['child-type'];
          const out = {};
          for (const n of this.childNames(t, cur, address)) out[n] = this.readResource(address.concat([[t, n]]), bool(p.recursive), bool(p['include-runtime']), 99);
          return out;
        }
        case 'read-operation-names': {
          const cur = this.resolve(address);
          const base = ['read-attribute', 'read-children-names', 'read-children-resources', 'read-children-types', 'read-operation-description', 'read-operation-names', 'read-resource', 'read-resource-description', 'undefine-attribute', 'whoami', 'write-attribute'];
          if (cur.def.add) base.push('add');
          if (cur.def.remove) base.push('remove');
          if (!address.length) base.push('reload', 'shutdown', 'take-snapshot', 'list-snapshots', 'suspend', 'resume');
          return base.concat(Object.keys(cur.def.ops || {})).sort();
        }
        case 'read-resource-description': {
          const cur = this.resolve(address);
          const attributes = {};
          for (const [k, a] of Object.entries(cur.def.attrs || {})) attributes[k] = { type: 'STRING', 'access-type': typeof a === 'function' || !a.set ? 'read-only' : 'read-write', 'restart-required': a.reload ? 'all-services' : 'no-services' };
          return { description: 'Recurso ' + (cur.key || 'raíz') + ' (descripción simulada)', attributes };
        }
        case 'whoami': return { identity: { username: op.user || '$local', realm: 'ManagementRealm' } };
        case 'reload': {
          if (address.length) break;
          if (!this.server) fail('WFLYCTL0031: No operation named \'reload\' exists at address [] (servidor embebido)');
          this.server.reload();
          return undefined;
        }
        case 'shutdown': {
          if (address.length) break;
          if (!this.server) fail('WFLYCTL0031: servidor embebido: use stop-embedded-server');
          const srv = this.server;
          const restart = bool(p.restart);
          setTimeout(() => { srv.stop(restart).then(() => { if (restart && srv.onRestart) srv.onRestart(); }); }, 50);
          return undefined;
        }
        case 'take-snapshot': {
          const cfg = this.server ? this.server.configDir : P.dirname(this.embedded.configPath);
          const dir = cfg + '/standalone_xml_history/snapshot';
          this.vm.fs.mkdir(dir, { parents: true });
          const d = new Date();
          const stamp = d.getFullYear() + U.two(d.getMonth() + 1) + U.two(d.getDate()) + '-' + U.two(d.getHours()) + U.two(d.getMinutes()) + U.two(d.getSeconds()) + String(d.getMilliseconds()).padStart(3, '0');
          const file = dir + '/' + stamp + 'standalone.xml';
          this.vm.fs.write(file, X.serialize(this.doc));
          return file;
        }
        case 'list-snapshots': {
          const cfg = this.server ? this.server.configDir : P.dirname(this.embedded.configPath);
          const dir = cfg + '/standalone_xml_history/snapshot';
          let names = [];
          try { names = this.vm.fs.readdir(dir); } catch (e) { }
          return { directory: dir, names };
        }
        case 'suspend': case 'resume': return undefined;
      }
      // operaciones específicas del recurso
      const cur = this.resolve(address);
      const fn = cur.def.ops && cur.def.ops[operation];
      if (!fn) fail('WFLYCTL0031: No operation named \'' + operation + '\' exists at address ' + addrStr(address));
      return fn(cur.node, p);
    }

    // ================= Despliegues administrados =================
    deploy(file, opts) {
      const vfs = this.vm.fs;
      const name = opts.name || P.basename(file);
      const runtimeName = opts.runtimeName || name;
      let data;
      try { data = vfs.read(file); } catch (e) { fail('WFLYCTL0158: ' + file + ' (' + e.message + ')'); }
      const existing = this.server ? this.server.deployments.get(name) : null;
      const xmlDeps = ensureChild(this.rootEl(), 'deployments');
      const existingXml = X.kids(xmlDeps, 'deployment').find(d => X.attr(d, 'name') === name);
      if ((existing || existingXml) && !opts.force) fail('WFLYCTL0212: Duplicate resource [("deployment" => "' + name + '")]');
      if (existing && existing.scanner) fail('WFLYDS0014: The deployment "' + name + '" is owned by the deployment scanner');
      const sha = U.sha256(data).slice(0, 40);
      const dataDir = this.server ? this.server.dataDir : P.dirname(P.dirname(this.embedded.configPath)) + '/data';
      const contentFile = dataDir + '/content/' + sha.slice(0, 2) + '/' + sha.slice(2) + '/content';
      vfs.mkdir(P.dirname(contentFile), { parents: true });
      vfs.write(contentFile, data, { bin: true });
      if (existingXml) X.remove(existingXml);
      X.append(xmlDeps, frag('<deployment name="' + name + '" runtime-name="' + runtimeName + '"' + (opts.disabled ? ' enabled="false"' : '') + '>\n            <content sha1="' + sha + '"/>\n        </deployment>'));
      const dep = { name, runtimeName, managed: true, sha, file: contentFile, enabled: !opts.disabled, status: 'STOPPED' };
      if (this.server) {
        if (existing && existing.status === 'OK') this.server.undeployNow(existing, 'management-handler-thread - 1');
        this.server.deployments.set(name, dep);
        if (dep.enabled) {
          const ok = this.server.deployNow(dep, 'management-handler-thread - 1');
          if (!ok) {
            // rollback como el servidor real
            this.server.deployments.delete(name);
            X.remove(X.kids(xmlDeps, 'deployment').find(d => X.attr(d, 'name') === name));
            if (!X.kids(xmlDeps).length) X.remove(xmlDeps);
            this.persist();
            fail(dep.error);
          }
        }
      }
      this.persist();
      return dep;
    }
    undeployManaged(d, keepContent) {
      const name = d.name || X.attr(d, 'name');
      if (this.server) {
        const dep = this.server.deployments.get(name);
        if (dep && dep.scanner) fail('WFLYDS0014: The deployment "' + name + '" is owned by the deployment scanner (elimine el archivo de deployments/)');
        if (dep && dep.status === 'OK') this.server.undeployNow(dep, 'management-handler-thread - 1');
        this.server.deployments.delete(name);
      }
      if (!keepContent) {
        const xmlDeps = X.kid(this.rootEl(), 'deployments');
        const x = X.kids(xmlDeps, 'deployment').find(e => X.attr(e, 'name') === name);
        if (x) X.remove(x);
        if (xmlDeps && !X.kids(xmlDeps).length) X.remove(xmlDeps);
      }
      this.persist();
    }
  }

  // ---------- Formato DMR (salida de jboss-cli) ----------
  function dmr(v, ind) {
    ind = ind || '';
    const n = ind + '    ';
    if (v === undefined || v === null) return 'undefined';
    if (typeof v === 'boolean' || typeof v === 'number') return (typeof v === 'number' && Math.abs(v) > 2147483647) ? v + 'L' : String(v);
    if (typeof v === 'string') return /\$\{/.test(v) ? 'expression "' + v.replace(/"/g, '\\"') + '"' : '"' + v.replace(/"/g, '\\"') + '"';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      if (v.every(x => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string')) return '[' + v.map(x => '("' + x[0] + '" => ' + dmr(x[1]) + ')').join(',') + ']';
      return '[\n' + v.map(x => n + dmr(x, n)).join(',\n') + '\n' + ind + ']';
    }
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k => n + '"' + k + '" => ' + dmr(v[k], n)).join(',\n') + '\n' + ind + '}';
  }

  L.jboss = L.jboss || {};
  Object.assign(L.jboss, { Model, OpError, dmr, addrStr });
})(globalThis.JLab = globalThis.JLab || {});
