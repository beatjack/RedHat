/*
 * Scripts de JBoss: standalone.sh, jboss-cli.sh, add-user.sh, jdr.sh,
 * domain.sh, launch.sh. Se ejecutan cuando el shell detecta el marcador
 * #JLAB-SCRIPT: en el archivo (el resto del script es texto normal).
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, S = L.scripts, X = L.xml, OS = L.os;
  const { dmr, Model } = L.jboss;

  function homeOf(c) { return P.dirname(P.dirname(c.fs.realpath(c.path))); }
  function distOf(c, home) { const d = L.jboss.detectHome(c.fs, home + '/bin/x'); return d ? d.dist : L.jboss.DISTS.eap74; }

  // ---------------- standalone.sh ----------------
  S.standalone = async (c) => {
    const home = homeOf(c);
    const dist = distOf(c, home);
    const args = c.args.slice();
    const po = L.jboss.parseArgs(args);
    if (po.help) {
      c.println('Usage: standalone.sh [args...]\nwhere args include:\n    --admin-only                        Set the server\'s running type to ADMIN_ONLY\n    -b <value>, -b=<value>              Set system property jboss.bind.address to the given value\n    -bmanagement=<value>                Set system property jboss.bind.address.management to the given value\n    -c <config>, -c=<config>            Name of the server configuration file to use (default is "standalone.xml")\n    -D<name>[=<value>]                  Set a system property\n    -h, --help                          Display this message and exit\n    -P <url>                            Load system properties from the given url\n    -v, -V, --version                   Print version and exit');
      return 0;
    }
    if (po.version) { c.println(dist.startLine.replace(/\s*\(.*$/, '') + ' (' + dist.core + ')'); return 0; }
    // permisos de escritura sobre standalone/{log,data,tmp,configuration}
    const base = po.props['jboss.server.base.dir'] || home + '/standalone';
    for (const d of ['log', 'data', 'tmp', 'configuration']) {
      const p = base + '/' + d;
      try {
        if (!c.fs.exists(p)) { c.fs.mkdir(p, { cred: c.cred }); continue; }
        const n = c.fs.stat(p);
        if (!c.fs.can(n, c.cred, 'w') || !c.fs.can(n, c.cred, 'x')) {
          c.out('=========================================================================\n\n  JBoss Bootstrap Environment\n\n  JBOSS_HOME: ' + home + '\n\n=========================================================================\n\n');
          c.err('java.lang.IllegalStateException: WFLYSRV0137: No directory ' + p + ' was found and it could not be created, or the directory is not writable by user \'' + c.user + '\'\n\tat org.jboss.as.server.ServerEnvironment.<init>(ServerEnvironment.java:...)\n\tat org.jboss.as.server.Main.determineEnvironment(Main.java:...)\n');
          c.err('(Pista: revise el propietario con "ls -ld ' + p + '" y corrija con chown -R <usuario>:<grupo> ' + home + ')\n');
          return 1;
        }
      } catch (e) { c.err('Error: ' + p + ': ' + e.message + '\n'); return 1; }
    }
    if (po.errors.length) { c.err('WFLYSRV0145: Invalid option \'' + po.errors[0] + '\'\nUsage: standalone.sh [args...]\n'); return 1; }
    const out = c.io.stdout;
    const { server, promise } = await c.vm.lab.startJBoss(c.vm, home, args, c.user, { env: c.sh.exportedEnv(), console: (s) => out.write(s), ppid: c.sh.pid });
    c.sh._lastServer = server;
    // espera a que el servidor termine (Ctrl+C lo detiene con apagado ordenado)
    const code = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      server.on('exit', (code) => finish(code));
      promise.then(code => { if (code !== 0 && server.state === 'failed') finish(code); });
      const fg = c.sh.fg;
      if (fg) (fg.waiters = fg.waiters || []).push(() => { server.stop().then(() => finish(130)); });
      if (server.state === 'failed') finish(server.exitCode);
    });
    return code;
  };
  S.launch = async (c) => {
    // launch.sh [standalone|domain] [config] [bind]
    const [mode = 'standalone', cfg = 'standalone.xml', bind = '0.0.0.0'] = c.args;
    if (mode === 'domain') return S.domain(c);
    const sp = homeOf(c) + '/bin/standalone.sh';
    return c.sh.execCommand([sp, '-c', cfg, '-b', bind], c.io);
  };
  S.domain = (c) => {
    c.println('=========================================================================\n\n  JBoss Bootstrap Environment\n\n  JBOSS_HOME: ' + homeOf(c) + '\n\n=========================================================================\n');
    c.err('[Laboratorio] El modo dominio (domain.sh) no está simulado. Use bin/standalone.sh.\n');
    return 1;
  };
  S['elytron-tool'] = (c) => { c.err('[Laboratorio] elytron-tool.sh no está simulado.\n'); return 1; };
  S.vault = S['elytron-tool'];

  // ---------------- add-user.sh ----------------
  function checkPassword(user, pw) {
    const errs = [];
    if (['root', 'admin', 'administrator'].includes(pw)) errs.push('Password should not be one of the following restricted values {root, admin, administrator}');
    if (pw === user) errs.push('The password should be different from the username');
    if (pw.length < 8) errs.push('Password must have at least 8 characters!');
    if (!/[A-Za-z]/.test(pw)) errs.push('Password must have at least 1 alphanumeric character.');
    if (!/\d/.test(pw)) errs.push('Password must have at least 1 digit.');
    if (!/[^A-Za-z0-9]/.test(pw)) errs.push('Password must have at least 1 non-alphanumeric symbol.');
    return errs;
  }
  function addUserTo(c, file, user, line) {
    let txt = '';
    try { txt = c.fs.read(file, c.cred); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const ls = txt.split('\n');
    const idx = ls.findIndex(l => l.startsWith(user + '='));
    if (idx >= 0) { ls[idx] = line; txt = ls.join('\n'); return { updated: true, txt }; }
    return { updated: false, txt: txt.replace(/\n?$/, '\n') + line + '\n' };
  }
  S['add-user'] = async (c) => {
    const home = homeOf(c);
    const { opts, rest } = L.cmdutil.getopt(c.args, { flags: 'asde', values: 'upgr', long: { user: 'u=', password: 'p=', group: 'g=', realm: 'r=', silent: 's', 'display-secret': 'ds' } });
    const appUser = !!opts.a;
    const realm = opts.r || (appUser ? 'ApplicationRealm' : 'ManagementRealm');
    const files = appUser ? ['application-users.properties', 'application-roles.properties'] : ['mgmt-users.properties', 'mgmt-groups.properties'];
    const dirs = [home + '/standalone/configuration', home + '/domain/configuration'];
    let user = opts.u, pw = opts.p, groups = opts.g || '';
    const say = (s) => { if (!opts.s) c.println(s); };
    if (!user || pw === undefined) {
      if (!c.term) return c.fail('se requiere terminal o -u/-p');
      if (!opts.a) {
        c.println('\nWhat type of user do you wish to add? \n a) Management User (mgmt-users.properties) \n b) Application User (application-users.properties)');
        const t = await c.prompt('(a): ');
        if (t === 'b') return S['add-user'](Object.assign({}, c, { args: ['-a'].concat(c.args) }));
      }
      c.println('\nEnter the details of the new user to add.\nUsing realm \'' + realm + '\' as discovered from the existing property files.');
      user = await c.prompt('Username : ');
      if (!user) { c.println(' * Error * \nNo Username entered, exiting.'); return 1; }
      if (['admin', 'administrator', 'root'].includes(user)) {
        c.println('The username \'' + user + '\' is easy to guess');
        const ok = await c.prompt('Are you sure you want to add user \'' + user + '\' yes/no? ');
        if (ok !== 'yes' && ok !== 'y') return 1;
      }
      c.println('Password recommendations are listed below. To modify these restrictions edit the add-user.properties configuration file.\n - The password should be different from the username\n - The password should not be one of the following restricted values {root, admin, administrator}\n - The password should contain at least 8 characters, 1 alphabetic character(s), 1 digit(s), 1 non-alphanumeric symbol(s)');
      while (true) {
        pw = await c.prompt('Password : ', true);
        const errs = checkPassword(user, pw || '');
        if (errs.length) {
          c.println(' * Error * \n' + errs[0]);
          const ok = await c.prompt('Are you sure you want to use the password entered yes/no? ');
          if (ok !== 'yes' && ok !== 'y') continue;
        }
        const pw2 = await c.prompt('Re-enter Password : ', true);
        if (pw2 !== pw) { c.println(' * Error * \nThe passwords do not match.'); continue; }
        break;
      }
      groups = await c.prompt('What groups do you want this user to belong to? (Please enter a comma separated list, or leave blank for none)[  ]: ') || '';
      c.println('About to add user \'' + user + '\' for realm \'' + realm + '\'');
      const ok = await c.prompt('Is this correct yes/no? ');
      if (ok !== 'yes' && ok !== 'y') return 1;
    } else {
      const errs = checkPassword(user, pw);
      if (errs.length) { c.err(' * Error * \n' + errs[0] + '\n'); return 1; }
    }
    const hash = U.md5(user + ':' + realm + ':' + pw);
    try {
      for (const d of dirs) {
        const f = d + '/' + files[0];
        if (!c.fs.exists(d)) continue;
        const r = addUserTo(c, f, user, user + '=' + hash);
        c.fs.write(f, r.txt, { cred: c.cred });
        say((r.updated ? 'Updated' : 'Added') + ' user \'' + user + '\' ' + (r.updated ? 'to' : 'to') + ' file \'' + f + '\'');
      }
      for (const d of dirs) {
        const f = d + '/' + files[1];
        if (!c.fs.exists(d)) continue;
        const r = addUserTo(c, f, user, user + '=' + groups);
        c.fs.write(f, r.txt, { cred: c.cred });
        say((r.updated ? 'Updated' : 'Added') + ' user \'' + user + '\' with groups ' + groups + ' to file \'' + f + '\'');
      }
    } catch (e) { c.err(' * Error * \n' + (e.path || '') + ' (' + e.message + ')\n'); return 1; }
    if (!opts.u && c.term) {
      await c.prompt('Is this new user going to be used for one AS process to connect to another AS process? \ne.g. for a slave host controller connecting to the master or for a Remoting connection for server to server Jakarta Enterprise Beans calls.\nyes/no? ');
    }
    return 0;
  };

  // ---------------- jdr.sh ----------------
  S.jdr = async (c) => {
    const home = homeOf(c);
    const srv = c.vm.servers.find(s => s.home === home && s.state === 'running');
    c.println('Initializing JBoss Diagnostic Reporter...');
    if (!srv) c.println('Trying to connect to localhost:9990\nWFLYJDR0005: No server running, collecting offline data');
    await c.sleep(600);
    const d = new Date();
    const name = 'jdr_' + String(d.getFullYear()).slice(2) + U.two(d.getMonth() + 1) + U.two(d.getDate()) + '_' + U.clock().replace(/:/g, '') + '_' + c.vm.hostname.split('.')[0] + '.zip';
    const out = home + '/standalone/tmp/' + name;
    try {
      const items = ['standalone/configuration', 'standalone/log', 'bin/standalone.conf', 'version.txt'].filter(p => c.fs.exists(home + '/' + p));
      L.archive.create(c.fs, out, 'zip', home, items, c.cred);
    } catch (e) { return c.fail(e.message); }
    c.println('JDR started\n\nJDR completed successfully.\nJDR report written to ' + out);
    return 0;
  };

  // ---------------- jboss-cli.sh ----------------
  // Parser de direcciones y operaciones: /a=b/c=d:op(k=v,...) {headers}
  function splitTop(s, sep) {
    const out = []; let depth = 0, q = null, cur = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { cur += ch; if (ch === q && s[i - 1] !== '\\') q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim() || out.length) out.push(cur);
    return out;
  }
  function parseValue(v) {
    v = v.trim();
    if (/^".*"$/s.test(v) || /^'.*'$/s.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
    if (v === 'true') return true; if (v === 'false') return false;
    if (v === 'undefined') return undefined;
    if (/^-?\d+L?$/.test(v)) return parseInt(v, 10);
    if (/^\[.*\]$/s.test(v)) return splitTop(v.slice(1, -1), ',').filter(x => x.trim()).map(parseValue);
    if (/^\{.*\}$/s.test(v)) { const o = {}; for (const kv of splitTop(v.slice(1, -1), ',')) { const m = /^\s*"?([\w.-]+)"?\s*=>?\s*(.*)$/s.exec(kv); if (m) o[m[1]] = parseValue(m[2]); } return o; }
    return v;
  }
  function parseAddress(str, base) {
    let addr = str.startsWith('/') ? [] : base.slice();
    for (const seg of str.split('/').filter(Boolean)) {
      if (seg === '..') { addr.pop(); continue; }
      if (seg === '.') continue;
      const m = /^([\w.-]+)=(.*)$/.exec(seg);
      if (!m) throw new Error('Node type is not complete at index ' + str.indexOf(seg) + ' in \'' + str + '\'');
      addr.push([m[1], m[2].replace(/^"|"$/g, '')]);
    }
    return addr;
  }
  function parseOp(line, base) {
    // separa dirección y operación (el ':' fuera de valores)
    let depth = 0, q = null, idx = -1;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === q) q = null; continue; }
      if (ch === '"') { q = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (ch === ':' && depth === 0) { idx = i; break; }
    }
    if (idx < 0) throw new Error('Operation name is missing or the format of the operation request is wrong');
    const address = parseAddress(line.slice(0, idx).trim(), base);
    const rest = line.slice(idx + 1).trim();
    const m = /^([\w-]+)\s*(\((.*)\))?\s*(\{.*\})?\s*$/s.exec(rest);
    if (!m) throw new Error('The operation name is not complete');
    const params = {};
    if (m[3] && m[3].trim()) {
      for (const kv of splitTop(m[3], ',')) {
        const mm = /^\s*([\w.-]+)\s*=\s*(.*)$/s.exec(kv);
        if (!mm) throw new Error('Parameter value is not specified: ' + kv.trim());
        params[mm[1]] = parseValue(mm[2]);
      }
    }
    return { address, operation: m[1], params };
  }
  function fmtResponse(res, opts) {
    const o = {};
    o.outcome = res.outcome;
    if (res.outcome === 'failed') { o['failure-description'] = res['failure-description']; o['rolled-back'] = true; }
    if ('result' in res || opts.showResult) o.result = res.result;
    if (res.headers) o['response-headers'] = res.headers;
    if (Object.keys(o).length === 1) return '{"outcome" => "' + res.outcome + '"}';
    return dmr(o);
  }

  class CliSession {
    constructor(c) {
      this.c = c; this.vm = c.vm; this.home = homeOf(c);
      this.server = null; this.embedded = null; this.cwd = []; this.cwdType = null;
      this.controller = 'localhost:9990'; this.batch = null; this.history = [];
      this.user = null; this.pass = null;
    }
    get connected() { return !!(this.server && (this.server.state === 'running' || this.server.state === 'reloading' || this.server.state === 'starting')) || !!this.embedded; }
    model() {
      if (this.embedded) return new Model(this.vm, this.home, null, this.embedded);
      return new Model(this.vm, this.server.home, this.server);
    }
    prompt() {
      if (this.embedded) return '[standalone@embedded ' + this.pathStr() + '] ';
      if (!this.connected) return '[disconnected /] ';
      return '[standalone@' + this.controller + ' ' + this.pathStr() + '] ';
    }
    pathStr() { return '/' + this.cwd.map(([t, n]) => t + '=' + n).join('/') + (this.cwdType ? (this.cwd.length ? '/' : '') + this.cwdType + '=' : ''); }
    async connect(ctrl) {
      const c = this.c;
      let host = 'localhost', port = 9990;
      const target = ctrl || this.controller;
      const m = /^(?:(?:remote\+)?https?:\/\/|remote:\/\/)?([^:]+)(?::(\d+))?$/.exec(target);
      if (m) { host = m[1]; if (m[2]) port = +m[2]; }
      const conn = this.vm.lab.connect(this.vm, host, port);
      if (!conn.ok || conn.listener.kind !== 'management') {
        c.err('Failed to connect to the controller: The controller is not available at ' + host + ':' + port + ': java.net.ConnectException: WFLYPRT0053: Could not connect to remote+http://' + host + ':' + port + '. The connection failed: ' + (conn.error === 'noroute' ? 'No route to host' : 'Connection refused') + '\n');
        return false;
      }
      const srv = conn.listener.server;
      const local = conn.vm === this.vm && (c.cred.uid === 0 || c.user === srv.user);
      if (!local) {
        let u = this.user, p = this.pass;
        if (!u || p == null) {
          if (!c.term || !c.stdinTTY) { c.err('Failed to connect to the controller: Unable to authenticate against controller at ' + host + ':' + port + ': Authentication failed: none of the mechanisms presented by the server (DIGEST-MD5) are supported\n'); return false; }
          c.println('Authenticating against security realm: ManagementRealm');
          u = await c.prompt('Username: ');
          p = await c.prompt('Password: ', true);
        }
        if (!srv.checkMgmtAuth(u, p)) { c.err('Failed to connect to the controller: Unable to authenticate against controller at ' + host + ':' + port + ': Authentication failed: all available authentication mechanisms failed:\n   DIGEST-MD5: Server rejected authentication\n'); return false; }
        this.user = u;
      }
      this.server = srv; this.controller = host + ':' + port; this.cwd = []; this.cwdType = null;
      return true;
    }
    need() {
      if (!this.connected) { this.c.err('You are disconnected at the moment. Type \'connect\' to connect to the server or \'help\' for the list of supported commands.\n'); return false; }
      return true;
    }
    async exec(line) {
      const c = this.c;
      line = line.trim();
      if (!line || line.startsWith('#')) return 0;
      this.history.push(line);
      if (this.batch && !/^(run-batch|discard-batch|list-batch|batch)\b/.test(line)) { this.batch.push(line); c.println('#' + this.batch.length + ' ' + line); return 0; }
      if (line.startsWith('/') || line.startsWith(':') || line.startsWith('./') || /^[\w.-]+=[^\s]*:/.test(line)) {
        if (!this.need()) return 1;
        let op;
        try { op = parseOp(line, this.cwd); } catch (e) { c.err(e.message + '\n'); return 1; }
        op.user = this.user;
        const model = this.model();
        const res = model.execute(op);
        const showResult = ['reload', 'shutdown'].includes(op.operation);
        c.println(fmtResponse(res, { showResult }));
        if (op.operation === 'reload' && res.outcome === 'success') await this.waitReload();
        if (op.operation === 'shutdown' && res.outcome === 'success') { await U.sleep(400); this.server = null; }
        return res.outcome === 'success' ? 0 : 1;
      }
      const [cmd, ...args] = line.match(/"[^"]*"|\S+/g);
      const argStr = line.slice(cmd.length).trim();
      const flag = (n) => args.some(a => a === '--' + n || a.startsWith('--' + n + '='));
      const fval = (n) => { const a = args.find(x => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3).replace(/^"|"$/g, '') : null; };
      switch (cmd) {
        case 'connect': return (await this.connect(args[0])) ? 0 : 1;
        case 'disconnect': this.server = null; return 0;
        case 'quit': case 'exit': case 'q': throw { cliExit: true };
        case 'version': {
          const d = this.server ? this.server.dist : distOf(c, this.home);
          c.println('JBoss Admin Command-line Interface\nJBOSS_HOME: ' + this.home + '\nRelease: ' + d.core.replace('WildFly Core ', '') + '\nProduct: ' + (d.product === 'WildFly' ? 'WildFly Full ' : 'JBoss EAP ') + d.version + '\nJAVA_HOME: /usr/lib/jvm\njava.version: ' + ((this.server && this.server.java) ? this.server.java.full : '17.0.11') + '\njava.vm.vendor: Red Hat, Inc.\njava.vm.version: ' + ((this.server && this.server.java) ? this.server.java.build : '') + '\nos.name: Linux\nos.version: ' + this.vm.osInfo.kernel);
          return 0;
        }
        case 'help': {
          c.println('Descripción de comandos disponibles en jboss-cli (laboratorio):\n\n  connect [host:puerto]      conectar al controlador (por defecto localhost:9990)\n  embed-server [--server-config=standalone.xml]  servidor embebido (offline)\n  stop-embedded-server       detener el servidor embebido\n  cd <ruta> / ls [ruta] [-l] / pwd   navegar el modelo de gestión\n  :read-resource(recursive=true)     operación sobre el nodo actual\n  /subsystem=datasources:read-resource\n  /system-property=foo:add(value=bar)\n  /socket-binding-group=standard-sockets/socket-binding=http:write-attribute(name=port,value=8180)\n  deploy <archivo> [--name=] [--force] [--disabled]\n  undeploy <nombre> [--keep-content]\n  deployment-info             estado de los despliegues\n  module add --name=org.postgresql --resources=/ruta/driver.jar --dependencies=javax.api,javax.transaction.api\n  module remove --name=...\n  reload / shutdown [--restart=true]\n  batch / run-batch / discard-batch / list-batch\n  read-attribute <nombre>     atajo de :read-attribute\n  history / clear / version / quit');
          return 0;
        }
        case 'clear': case 'cls': c.out('\x1b[2J\x1b[H'); return 0;
        case 'history': this.history.forEach(h => c.println(h)); return 0;
        case 'echo': c.println(argStr); return 0;
        case 'pwd': c.println(this.pathStr()); return 0;
        case 'cd': case 'cn': {
          if (!this.need()) return 1;
          const target = args[0] || '/';
          try {
            let s = target, type = null;
            if (/\/?[\w.-]+=?$/.test(s) && !/=[^/]+$/.test(s)) { const mm = /^(.*?)\/?([\w.-]+)=?$/.exec(s); if (mm && !mm[2].includes('=') && !['..', '.'].includes(mm[2])) { type = mm[2]; s = mm[1] || (target.startsWith('/') ? '/' : ''); } }
            const base = this.cwdType && !target.startsWith('/') && /^[^=/]+$/.test(target) && !['..', '.'].includes(target) ? this.cwd.concat([[this.cwdType, target]]) : null;
            const addr = base || parseAddress(s || (target.startsWith('/') ? '/' : ''), this.cwdType && target === '..' ? this.cwd.concat([]) : this.cwd);
            if (this.cwdType && target === '..' && !base) { this.cwdType = null; return 0; }
            this.model().resolve(addr);
            this.cwd = addr; this.cwdType = base ? null : type;
          } catch (e) { c.err((e.dmr || e.message) + '\n'); return 1; }
          return 0;
        }
        case 'ls': {
          if (!this.need()) return 1;
          const model = this.model();
          const long = args.includes('-l');
          const p = args.filter(a => a !== '-l')[0];
          try {
            let addr = this.cwd, type = this.cwdType;
            if (p) { if (/^[\w.-]+$/.test(p) && !this.cwdType) { type = p; } else addr = parseAddress(p, this.cwd); }
            if (type) {
              const r = model.execute({ address: addr, operation: 'read-children-names', params: { 'child-type': type } });
              if (res(r)) printCols(c, r.result);
              return 0;
            }
            const r = model.execute({ address: addr, operation: 'read-resource', params: { 'include-runtime': true } });
            if (!res(r)) return 1;
            const types = model.execute({ address: addr, operation: 'read-children-types' }).result || [];
            if (long) {
              c.println('ATTRIBUTE                 VALUE                       TYPE');
              for (const [k, v] of Object.entries(r.result)) if (!types.includes(k)) c.println(U.pad(k, 25, true) + ' ' + U.pad(v === undefined ? 'undefined' : typeof v === 'object' ? JSON.stringify(v) : String(v), 27, true) + ' ' + (typeof v === 'number' ? 'INT' : typeof v === 'boolean' ? 'BOOLEAN' : Array.isArray(v) ? 'LIST' : 'STRING'));
              c.println('\nCHILD                MIN-OCCURS MAX-OCCURS\n' + types.map(t => U.pad(t, 20, true) + ' n/a        n/a').join('\n'));
              return 0;
            }
            const items = types.concat(Object.entries(r.result).filter(([k]) => !types.includes(k)).map(([k, v]) => k + '=' + (v === undefined ? 'undefined' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v)));
            printCols(c, items);
          } catch (e) { c.err((e.dmr || e.message) + '\n'); return 1; }
          return 0;
          function res(r) { if (r.outcome !== 'success') { c.err(r['failure-description'] + '\n'); return false; } return true; }
        }
        case 'read-attribute': {
          if (!this.need()) return 1;
          const r = this.model().execute({ address: this.cwd, operation: 'read-attribute', params: { name: args.filter(a => !a.startsWith('-'))[0] } });
          if (r.outcome !== 'success') { c.err(r['failure-description'] + '\n'); return 1; }
          c.println(r.result === undefined ? 'undefined' : typeof r.result === 'object' ? dmr(r.result) : String(r.result));
          return 0;
        }
        case 'reload': {
          if (!this.need()) return 1;
          if (this.embedded) { c.err('reload no aplica al servidor embebido\n'); return 1; }
          const r = this.model().execute({ address: [], operation: 'reload', params: {} });
          if (r.outcome !== 'success') { c.err(r['failure-description'] + '\n'); return 1; }
          await this.waitReload();
          return 0;
        }
        case 'shutdown': {
          if (!this.need()) return 1;
          const restart = /--restart(=true)?$/.test(argStr);
          const r = this.model().execute({ address: [], operation: 'shutdown', params: { restart } });
          if (r.outcome !== 'success') { c.err(r['failure-description'] + '\n'); return 1; }
          const srv = this.server;
          if (restart) srv.onRestart = () => this.vm.lab.startJBoss(this.vm, srv.home, srv.opts.rawArgs, srv.user, { env: {}, console: srv.console });
          await U.sleep(600);
          this.server = null;
          return 0;
        }
        case 'deploy': {
          if (!this.need()) return 1;
          const model = this.model();
          if (!args.filter(a => !a.startsWith('--')).length) {
            if (flag('name')) { const name = fval('name'); const r = model.execute({ address: [['deployment', name]], operation: 'deploy' }); if (r.outcome !== 'success') { c.err(r['failure-description'] + '\n'); return 1; } return 0; }
            for (const n of model.types().deployment.list()) c.println(n);
            return 0;
          }
          const file = c.resolve(args.filter(a => !a.startsWith('--'))[0].replace(/^"|"$/g, ''));
          if (!c.fs.exists(file)) { c.err('Path ' + file + ' doesn\'t exist.\n'); return 1; }
          if (this.batch) { this.batch.push(line); return 0; }
          try { model.deploy(file, { name: fval('name'), runtimeName: fval('runtime-name'), force: flag('force'), disabled: flag('disabled') }); }
          catch (e) {
            if (e.dmr && /WFLYCTL0212/.test(e.dmr)) c.err("'" + (fval('name') || P.basename(file)) + "' already exists in the deployment repository (use --force to replace the existing content in the repository).\n");
            else c.err('WFLYCTL0062: Composite operation failed and was rolled back. Steps that failed:' + '\n    Operation step-1 => ' + (e.dmr || e.message) + '\n');
            return 1;
          }
          return 0;
        }
        case 'undeploy': {
          if (!this.need()) return 1;
          const name = args.filter(a => !a.startsWith('--'))[0];
          const model = this.model();
          if (!name) { c.err('Required argument \'name\' is missing.\n'); return 1; }
          const d = model.types().deployment.node(name);
          if (!d) { c.err('Deployment \'' + name + '\' not found.\n'); return 1; }
          try { model.undeployManaged(d, flag('keep-content')); } catch (e) { c.err((e.dmr || e.message) + '\n'); return 1; }
          return 0;
        }
        case 'deployment-info': {
          if (!this.need()) return 1;
          const model = this.model();
          const rows = model.types().deployment.list().map(n => { const d = model.types().deployment.node(n); return [n, d.runtimeName || X.attr(d, 'runtime-name'), d.scanner ? 'false' : 'true', String(d.enabled !== false), d.status || 'STOPPED']; });
          const w = [Math.max(4, ...rows.map(r => r[0].length)) + 1, Math.max(12, ...rows.map(r => r[1].length)) + 1, 11, 8];
          c.println(U.pad('NAME', w[0], true) + ' ' + U.pad('RUNTIME-NAME', w[1], true) + ' ' + U.pad('PERSISTENT', w[2], true) + ' ' + U.pad('ENABLED', w[3], true) + ' STATUS');
          for (const r of rows) c.println(U.pad(r[0], w[0], true) + ' ' + U.pad(r[1], w[1], true) + ' ' + U.pad(r[2], w[2], true) + ' ' + U.pad(r[3], w[3], true) + ' ' + r[4]);
          return 0;
        }
        case 'module': {
          const sub = args[0];
          const name = fval('name');
          if (!name) { c.err('Required argument \'--name\' is missing.\n'); return 1; }
          const dir = this.home + '/modules/' + name.replace(/\./g, '/') + '/' + (fval('slot') || 'main');
          if (sub === 'add') {
            const resources = (fval('resources') || '').split(':').filter(Boolean);
            const deps = (fval('dependencies') || '').split(',').filter(Boolean);
            if (!resources.length && !flag('resource-delimiter')) { c.err('Required argument \'--resources\' or \'--absolute-resources\' is missing\n'); return 1; }
            if (c.fs.exists(dir)) { c.err('Module ' + name + ' already exists at ' + dir + '\n'); return 1; }
            try {
              for (const r of resources) if (!c.fs.exists(c.resolve(r))) { c.err('Failed to locate ' + r + '\n'); return 1; }
              c.fs.mkdir(dir, { parents: true, cred: c.cred });
              for (const r of resources) c.fs.copy(c.resolve(r), dir + '/' + P.basename(r), { cred: c.cred });
              c.fs.write(dir + '/module.xml', '<?xml version="1.0" ?>\n\n<module xmlns="urn:jboss:module:1.1" name="' + name + '">\n\n    <resources>\n' + resources.map(r => '        <resource-root path="' + P.basename(r) + '"/>\n').join('') + '    </resources>\n\n    <dependencies>\n' + deps.map(d => '        <module name="' + d.trim() + '"/>\n').join('') + '    </dependencies>\n</module>\n', { cred: c.cred });
            } catch (e) { c.err(e.message + '\n'); return 1; }
            return 0;
          }
          if (sub === 'remove') { if (!c.fs.exists(dir)) { c.err('Failed to locate module ' + name + ' at ' + dir + '\n'); return 1; } c.fs.rmrf(dir, c.cred); return 0; }
          c.err('Unknown module action: ' + sub + '\n'); return 1;
        }
        case 'embed-server': {
          if (this.connected && !this.embedded) { c.err('The embed-server command is not allowed while the CLI is connected.\n'); return 1; }
          const cfg = fval('server-config') || fval('c') || 'standalone.xml';
          const path = this.home + '/standalone/configuration/' + cfg;
          let doc;
          try { doc = X.parse(c.fs.read(path, c.cred)); } catch (e) { c.err('WFLYCTL0085: Failed to parse configuration ' + (e.line ? 'ParseError at [row,col]:[' + e.line + ',' + e.col + '] ' : '') + (e.java || e.message) + '\n'); return 1; }
          this.embedded = { doc, configPath: path, props: { 'jboss.home.dir': this.home }, dist: distOf(c, this.home) };
          this.cwd = [];
          return 0;
        }
        case 'stop-embedded-server': this.embedded = null; return 0;
        case 'batch': this.batch = []; return 0;
        case 'list-batch': (this.batch || []).forEach((b, i) => c.println('#' + (i + 1) + ' ' + b)); return 0;
        case 'discard-batch': this.batch = null; return 0;
        case 'run-batch': {
          const steps = this.batch || [];
          this.batch = null;
          if (!this.need()) return 1;
          const model = this.model();
          const xmlBackup = X.serialize(model.doc);
          for (const [i, s] of steps.entries()) {
            let r;
            try {
              if (s.startsWith('deploy ')) { const f = c.resolve(s.split(/\s+/)[1]); model.deploy(f, {}); r = { outcome: 'success' }; }
              else r = model.execute(parseOp(s, this.cwd));
            } catch (e) { r = { outcome: 'failed', 'failure-description': e.dmr || e.message }; }
            if (r.outcome !== 'success') {
              // rollback
              const fresh = X.parse(xmlBackup);
              model.doc.children = fresh.children; model.doc.children.forEach(ch => ch.parent = model.doc);
              model.persist();
              c.err('The batch failed with the following error (you are remaining in the batch editing mode to have an opportunity to correct the error): WFLYCTL0062: Composite operation failed and was rolled back. Steps that failed:\n    Operation step-' + (i + 1) + ' => ' + r['failure-description'] + '\n');
              this.batch = steps;
              return 1;
            }
          }
          c.println('The batch executed successfully');
          return 0;
        }
        case 'command-timeout': return 0;
        case 'data-source': c.err('Use la sintaxis de operaciones: /subsystem=datasources/data-source=NOMBRE:add(jndi-name=...,driver-name=...,connection-url=...)\n'); return 1;
        default: c.err("'" + cmd + "' is not a valid command or an operation request. Type 'help' for the list of supported commands.\n"); return 1;
      }
    }
    async waitReload() {
      const srv = this.server;
      for (let i = 0; i < 60; i++) { await U.sleep(200); if (srv.state === 'running' || srv.state === 'failed' || srv.state === 'stopped') break; }
    }
    complete(line) {
      // autocompletado básico de comandos, tipos hijos y operaciones
      const cmds = ['batch', 'cd', 'clear', 'connect', 'deploy', 'deployment-info', 'disconnect', 'echo', 'embed-server', 'help', 'history', 'list-batch', 'ls', 'module', 'pwd', 'quit', 'read-attribute', 'reload', 'run-batch', 'shutdown', 'stop-embedded-server', 'undeploy', 'version'];
      const m = /(\S*)$/.exec(line);
      const word = m[1];
      if (!this.connected || (!word.includes('/') && !word.includes(':') && !/^\s*(cd|ls)\s/.test(line))) return { word, cands: cmds.filter(x => x.startsWith(word)) };
      try {
        const model = this.model();
        const ci = word.lastIndexOf(':');
        if (ci >= 0 && !word.slice(ci).includes('(')) {
          const addr = parseAddress(word.slice(0, ci) || '.', this.cwd);
          const ops = model.execute({ address: addr, operation: 'read-operation-names' }).result || [];
          return { word, cands: ops.map(o => word.slice(0, ci + 1) + o).filter(x => x.startsWith(word)) };
        }
        const si = word.lastIndexOf('/');
        const prefix = word.slice(0, si + 1);
        const last = word.slice(si + 1);
        const addr = parseAddress(prefix.replace(/\/$/, '') || (word.startsWith('/') ? '/' : '.'), this.cwd);
        if (last.includes('=')) {
          const [t, n] = last.split('=');
          const names = model.execute({ address: addr, operation: 'read-children-names', params: { 'child-type': t } }).result || [];
          return { word, cands: names.filter(x => x.startsWith(n)).map(x => prefix + t + '=' + x) };
        }
        const types = model.execute({ address: addr, operation: 'read-children-types' }).result || [];
        return { word, cands: types.filter(x => x.startsWith(last)).map(x => prefix + x + '=') };
      } catch (e) { return { word, cands: [] }; }
    }
  }
  function printCols(c, items) {
    if (!items.length) return;
    const w = Math.max(...items.map(x => String(x).length)) + 3;
    const cols = Math.max(1, Math.floor((c.term ? c.term.cols : 100) / w));
    let line = '';
    items.forEach((x, i) => { line += U.pad(x, w, true); if ((i + 1) % cols === 0) { c.println(line.trimEnd()); line = ''; } });
    if (line) c.println(line.trimEnd());
  }

  S.cli = async (c) => {
    const s = new CliSession(c);
    let connect = false, commands = null, file = null;
    for (const a of c.args) {
      if (a === '-c' || a === '--connect') connect = true;
      else if (a.startsWith('--controller=')) s.controller = a.slice(13);
      else if (a.startsWith('--user=') || a.startsWith('-u=')) s.user = a.split('=')[1];
      else if (a.startsWith('--password=') || a.startsWith('-p=')) s.pass = a.slice(a.indexOf('=') + 1);
      else if (a.startsWith('--command=')) commands = [a.slice(10)];
      else if (a.startsWith('--commands=')) commands = a.slice(11).split(',');
      else if (a.startsWith('--file=')) file = a.slice(7);
      else if (a === '--help' || a === '-h') { c.println('Usage:\n\n  jboss-cli.sh/jboss-cli.bat [--help] [--version]\n                             [--controller=(controller_alias | [protocol://]host[:port])]\n                             [--connect] [--file=file_path]\n                             [--commands=command_or_operation1,command_or_operation2...]\n                             [--command=command_or_operation]\n                             [--user=username --password=password]'); return 0; }
      else if (a === '--version') { commands = ['version']; }
    }
    if (connect && !(await s.connect())) { if (commands || file || !c.stdinTTY || !c.term) return 1; }
    if (file) {
      let txt; try { txt = c.fs.read(c.resolve(file), c.cred); } catch (e) { return c.fail(file + ': ' + e.message); }
      commands = txt.split('\n');
    }
    if (!commands && !c.stdinTTY) commands = (await c.readAll()).split('\n');
    if (commands) {
      for (const cmd of commands) {
        try { const r = await s.exec(cmd); if (r) return 1; } catch (e) { if (e.cliExit) return 0; throw e; }
      }
      return 0;
    }
    if (!c.term) return c.fail('se requiere terminal');
    if (!connect) c.println('You are disconnected at the moment. Type \'connect\' to connect to the server or \'help\' for the list of supported commands.');
    const hist = [];
    while (true) {
      const line = await c.term.readLine({ prompt: s.prompt(), history: hist, complete: (l) => s.complete(l), cancelOnCtrlC: false });
      if (line === null) return 0;
      if (line.trim()) hist.push(line);
      try { await s.exec(line); } catch (e) { if (e.cliExit) return 0; c.err('Error: ' + (e.message || e) + '\n'); }
    }
  };
  L.jboss.CliSession = CliSession;
  L.jboss.parseOp = parseOp;
})(globalThis.JLab = globalThis.JLab || {});
