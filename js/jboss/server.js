/*
 * Runtime simulado de un servidor JBoss/WildFly en modo standalone.
 *  - Lee bin/standalone.conf (JAVA_OPTS, JBOSS_JAVA_SIZING, JAVA_HOME)
 *  - Valida Java instalado / versión mínima y memoria de la VM
 *  - Parsea standalone*.xml (errores con fila/columna como el real)
 *  - Abre puertos según socket-binding-group + port-offset + interfaces
 *  - Escribe standalone/log/server.log con mensajes WFLY* reales
 *  - Deployment scanner con marcadores .dodeploy/.deployed/.failed/...
 *  - Datasources, despliegues administrados (CLI) y peticiones HTTP
 */
(function (L) {
  'use strict';
  const P = L.path, X = L.xml, U = L.util;

  const LEVELS = { ALL: 0, TRACE: 1, DEBUG: 2, INFO: 3, WARN: 4, ERROR: 5, FATAL: 6, OFF: 7 };
  const COLORS = { ERROR: '\x1b[1;31m', WARN: '\x1b[1;33m', INFO: '', DEBUG: '\x1b[36m', FATAL: '\x1b[1;31m' };

  // ---------- lectura de standalone.conf (subconjunto de sh) ----------
  function evalConf(text, env) {
    const vars = Object.assign({}, env);
    const lines = text.split('\n');
    const expand = (s) => s.replace(/\$\{?(\w+)\}?/g, (m, k) => vars[k] !== undefined ? vars[k] : '');
    const stack = [];
    const active = () => stack.every(Boolean);
    for (let raw of lines) {
      const l = raw.trim();
      if (!l || l.startsWith('#')) continue;
      let m;
      if ((m = /^if \[ "x\$(\w+)" = "x" \]; then$/.exec(l))) { stack.push(!vars[m[1]]); continue; }
      if (/^if\b/.test(l)) { stack.push(true); continue; }
      if (l === 'else') { stack[stack.length - 1] = !stack[stack.length - 1]; continue; }
      if (l === 'fi') { stack.pop(); continue; }
      if (!active()) continue;
      if ((m = /^(?:export\s+)?(\w+)=(?:"([^"]*)"|'([^']*)'|(\S*))\s*$/.exec(l))) {
        vars[m[1]] = m[3] !== undefined ? m[3] : expand(m[2] !== undefined ? m[2] : m[4]);
      }
    }
    return vars;
  }

  function parseMem(v) {
    const m = /^(\d+)([kKmMgG]?)$/.exec(v || '');
    if (!m) return null;
    const n = +m[1];
    return m[2].toLowerCase() === 'g' ? n * 1024 : m[2].toLowerCase() === 'k' ? Math.ceil(n / 1024) : m[2] ? n : Math.ceil(n / 1048576);
  }

  function parseArgs(args) {
    const o = { config: 'standalone.xml', props: {}, errors: [] };
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      let m;
      if (a === '-c' || a === '--server-config') o.config = args[++i];
      else if ((m = /^--server-config=(.+)$/.exec(a))) o.config = m[1];
      else if (a === '-b') o.props['jboss.bind.address'] = args[++i];
      else if ((m = /^-b(?:=)?(.+)$/.exec(a)) && !a.startsWith('-bmanagement')) {
        const mm = /^-b([\w.]+)=(.+)$/.exec(a);
        if (mm && !/^\d/.test(mm[1])) o.props['jboss.bind.address.' + mm[1]] = mm[2];
        else o.props['jboss.bind.address'] = m[1].replace(/^=/, '');
      }
      else if (a === '-bmanagement') o.props['jboss.bind.address.management'] = args[++i];
      else if ((m = /^-bmanagement=(.+)$/.exec(a))) o.props['jboss.bind.address.management'] = m[1];
      else if ((m = /^-D([^=]+)(?:=(.*))?$/.exec(a))) o.props[m[1]] = m[2] !== undefined ? m[2] : 'true';
      else if (a === '-P' || a === '--properties') o.propFile = args[++i];
      else if (a === '--admin-only') o.adminOnly = true;
      else if (a === '--debug') { o.debug = true; if (/^\d+$/.test(args[i + 1] || '')) i++; }
      else if (a === '-h' || a === '--help') o.help = true;
      else if (a === '-v' || a === '-V' || a === '--version') o.version = true;
      else if ((m = /^--start-mode=(.+)$/.exec(a))) o.startMode = m[1];
      else o.errors.push(a);
    }
    return o;
  }

  let seq = 1;

  class JBossServer extends L.Emitter {
    constructor(vm, home, dist, opts) {
      super();
      this.id = 'srv' + (seq++);
      this.vm = vm; this.home = home; this.dist = dist;
      this.opts = opts;
      this.user = opts.user || 'root';
      this.cred = opts.cred;
      this.state = 'stopped';
      this.deployments = new Map();
      this.baseDir = opts.props['jboss.server.base.dir'] || home + '/standalone';
      this.configFile = opts.config;
      this.console = opts.console || null;   // fn(texto) para salida de consola
      this.startedAt = 0;
      this.pid = null;
      this.shPid = null;
      this.boundDs = new Map();
      this.reloadRequired = false;
      this.restartRequired = false;
      this.props = Object.assign({}, opts.props);
      this.doc = null;
    }
    get vfs() { return this.vm.fs; }
    get configDir() { return this.props['jboss.server.config.dir'] || this.baseDir + '/configuration'; }
    get logDir() { return this.props['jboss.server.log.dir'] || this.baseDir + '/log'; }
    get dataDir() { return this.props['jboss.server.data.dir'] || this.baseDir + '/data'; }
    get configPath() { return this.configFile.startsWith('/') ? this.configFile : this.configDir + '/' + this.configFile; }
    get nodeName() { return this.props['jboss.node.name'] || this.vm.hostname.split('.')[0]; }
    get serverName() { return this.props['jboss.server.name'] || this.nodeName; }

    // ---------- logging ----------
    rootLevel() {
      try {
        const lg = X.subsystem(this.doc, 'logging');
        const rl = X.kid(lg, 'root-logger');
        return (X.attr(X.kid(rl, 'level'), 'name') || 'INFO').toUpperCase();
      } catch (e) { return 'INFO'; }
    }
    categoryLevel(cat) {
      try {
        const lg = X.subsystem(this.doc, 'logging');
        let best = null;
        for (const l of X.kids(lg, 'logger')) {
          const c = X.attr(l, 'category');
          if (cat === c || cat.startsWith(c + '.')) if (!best || c.length > X.attr(best, 'category').length) best = l;
        }
        if (best) return (X.attr(X.kid(best, 'level'), 'name') || 'INFO').toUpperCase();
      } catch (e) { }
      return this.rootLevel();
    }
    log(level, category, thread, msg) {
      const eff = this.doc ? this.categoryLevel(category) : 'INFO';
      if (LEVELS[level] < LEVELS[eff]) return;
      const now = Date.now();
      const file = U.logTime(now) + ' ' + U.pad(level, 5, true) + ' [' + category + '] (' + thread + ') ' + msg + '\n';
      try {
        if (!this.vfs.exists(this.logDir)) this.vfs.mkdir(this.logDir, { parents: true, uid: this.cred.uid, gid: this.cred.gid });
        this.vfs.write(this.logDir + '/server.log', file, { append: true, uid: this.cred.uid, gid: this.cred.gid });
      } catch (e) {
        if (e.code === 'ENOSPC' && !this._nospc) { this._nospc = true; this.consoleOut('java.io.IOException: No space left on device\n'); }
      }
      const con = U.clock(now) + ',' + String(now % 1000).padStart(3, '0') + ' ' + (COLORS[level] || '') + U.pad(level, 5, true) + (COLORS[level] ? '\x1b[0m' : '') + ' [' + category + '] (' + thread + ') ' + msg + '\n';
      this.consoleOut(con);
      this.emit('log', { level, category, thread, msg, time: now });
    }
    consoleOut(s) { if (this.console) { try { this.console(s); } catch (e) { } } }

    // ---------- propiedades y expresiones ----------
    buildProps() {
      const p = {
        'jboss.home.dir': this.home, 'jboss.server.base.dir': this.baseDir,
        'jboss.server.config.dir': this.baseDir + '/configuration', 'jboss.server.log.dir': this.baseDir + '/log',
        'jboss.server.data.dir': this.baseDir + '/data', 'jboss.server.temp.dir': this.baseDir + '/tmp',
        'jboss.server.deploy.dir': this.baseDir + '/data/content', 'user.home': (this.cred.home || '/root'), 'user.name': this.user,
        'java.version': this.java ? this.java.full : '', 'jboss.qualified.host.name': this.vm.hostname
      };
      Object.assign(p, this.opts.props);
      // <system-properties> del XML
      if (this.doc) {
        const sp = X.kid(X.root(this.doc), 'system-properties');
        for (const prop of X.kids(sp, 'property')) if (p[X.attr(prop, 'name')] === undefined) p[X.attr(prop, 'name')] = X.expr(X.attr(prop, 'value'), p);
      }
      this.props = p;
      return p;
    }
    expr(v) { return X.expr(v, this.props); }

    // Dirección efectiva de una interfaz
    interfaceAddr(name) {
      const itf = X.kids(X.kid(X.root(this.doc), 'interfaces'), 'interface').find(i => X.attr(i, 'name') === name);
      if (!itf) return null;
      const ia = X.kid(itf, 'inet-address');
      if (ia) return this.expr(X.attr(ia, 'value'));
      if (X.kid(itf, 'any-address')) return '0.0.0.0';
      if (X.kid(itf, 'loopback')) return '127.0.0.1';
      return '127.0.0.1';
    }
    socketGroup() { return X.kid(X.root(this.doc), 'socket-binding-group'); }
    portOffset() { return parseInt(this.expr(X.attr(this.socketGroup(), 'port-offset') || '0'), 10) || 0; }
    // Puertos efectivos de todos los socket-binding
    bindings() {
      const g = this.socketGroup();
      const def = X.attr(g, 'default-interface') || 'public';
      const off = this.portOffset();
      const out = {};
      for (const sb of X.kids(g, 'socket-binding')) {
        const name = X.attr(sb, 'name');
        const fixed = X.attr(sb, 'fixed-port') === 'true';
        const port = parseInt(this.expr(X.attr(sb, 'port') || '0'), 10);
        const itf = X.attr(sb, 'interface') || def;
        out[name] = { name, port: fixed ? port : port + off, basePort: port, interface: itf, addr: this.interfaceAddr(itf) || '127.0.0.1' };
      }
      return out;
    }
    httpBinding() {
      const us = X.subsystem(this.doc, 'undertow');
      const srv = X.kid(us, 'server');
      const hl = X.kids(srv, 'http-listener')[0];
      return this.bindings()[hl ? X.attr(hl, 'socket-binding') : 'http'];
    }
    mgmtBinding() {
      const mi = X.kid(X.kid(X.root(this.doc), 'management'), 'management-interfaces');
      const hi = X.kid(mi, 'http-interface');
      const sb = X.kid(hi, 'socket-binding');
      return this.bindings()[sb ? X.attr(sb, 'http') : 'management-http'];
    }

    // ---------- configuración persistida ----------
    saveConfig() {
      if (!this.doc) return;
      const xml = X.serialize(this.doc);
      try {
        // historial como el real: standalone_xml_history/current
        const hist = this.configDir + '/standalone_xml_history';
        if (!this.vfs.exists(hist + '/current')) this.vfs.mkdir(hist + '/current', { parents: true, uid: this.cred.uid, gid: this.cred.gid });
        const n = (this._histN = (this._histN || 0) + 1);
        const name = P.basename(this.configPath).replace(/\.xml$/, '.v' + n + '.xml');
        this.vfs.write(hist + '/current/' + name, this.vfs.read(this.configPath), { uid: this.cred.uid, gid: this.cred.gid });
      } catch (e) { }
      this.vfs.write(this.configPath, xml, { cred: this.cred });
    }

    // ---------- arranque ----------
    async start(ctx) {
      const vm = this.vm, vfs = this.vfs;
      const out = (s) => this.consoleOut(s);
      this.state = 'starting';
      this.emit('state', this.state);
      // standalone.conf
      let confText = '';
      try { confText = vfs.read(this.home + '/bin/standalone.conf', this.cred); } catch (e) { }
      const env = Object.assign({}, ctx.env || {});
      const conf = evalConf(confText, env);
      const javaHome = conf.JAVA_HOME || env.JAVA_HOME;
      this.java = L.os.detectJava(vfs, javaHome);
      const javaOpts = (conf.JAVA_OPTS || '').trim();
      this.javaOpts = javaOpts;
      const xms = parseMem((/-Xms(\S+)/.exec(javaOpts) || [])[1]) || 64;
      const xmx = parseMem((/-Xmx(\S+)/.exec(javaOpts) || [])[1]) || Math.max(xms, 512);
      this.xms = xms; this.xmx = Math.max(xms, xmx);
      for (const m of javaOpts.matchAll(/-D([^=\s]+)(?:=(\S*))?/g)) if (this.opts.props[m[1]] === undefined) this.opts.props[m[1]] = m[2] || 'true';

      if (!ctx.reload) {
        const javaPath = this.java ? this.java.path : (javaHome ? javaHome + '/bin/java' : 'java');
        out('=========================================================================\n\n');
        out('  JBoss Bootstrap Environment\n\n');
        out('  JBOSS_HOME: ' + this.home + '\n\n');
        out('  JAVA: ' + (this.java ? this.java.path.replace(/\/usr\/bin\/java$/, 'java') : javaPath) + '\n\n');
        out('  JAVA_OPTS:  -server ' + javaOpts + '\n\n');
        out('=========================================================================\n\n');
        if (!this.java) {
          out(this.home + '/bin/standalone.sh: line 383: ' + (javaHome ? javaHome + '/bin/java: No such file or directory' : 'java: command not found') + '\n');
          return this._fail(127, 'Java no está instalado (sugerencia: dnf install java-17-openjdk)');
        }
        if (this.java.major < this.dist.javaMin) {
          const cf = (m) => (m === 8 ? 52 : m + 44) + '.0';
          out('Error: A JNI error has occurred, please check your installation and try again\n');
          out('Exception in thread "main" java.lang.UnsupportedClassVersionError: org/jboss/modules/Main has been compiled by a more recent version of the Java Runtime (class file version ' + cf(this.dist.javaMin) + '), this version of the Java Runtime only recognizes class file versions up to ' + cf(this.java.major) + '\n');
          return this._fail(1, 'Java ' + this.java.major + ' no soportado (mínimo ' + this.dist.javaMin + ')');
        }
        // memoria
        const avail = vm.memAvailableMB();
        if (xms + 90 > avail) {
          out('OpenJDK 64-Bit Server VM warning: INFO: os::commit_memory(0x00000000ae800000, ' + (xms * 1048576) + ', 0) failed; error=\'Not enough space\' (errno=12)\n');
          out('#\n# There is insufficient memory for the Java Runtime Environment to continue.\n# Native memory allocation (mmap) failed to map ' + (xms * 1048576) + ' bytes for committing reserved memory.\n# An error report file with more information is saved as:\n# ' + this.home + '/bin/hs_err_pid' + (vm.nextPid) + '.log\n');
          return this._fail(1, 'Memoria insuficiente: -Xms' + xms + 'm con ' + avail + ' MB libres');
        }
        // procesos
        const cmdline = 'java -D[Standalone] -server ' + javaOpts + ' --add-exports=java.base/sun.nio.ch=ALL-UNNAMED -Dorg.jboss.boot.log.file=' + this.baseDir + '/log/server.log -Dlogging.configuration=file:' + this.baseDir + '/configuration/logging.properties -jar ' + this.home + '/jboss-modules.jar -mp ' + this.home + '/modules org.jboss.as.standalone -Djboss.home.dir=' + this.home + ' -Djboss.server.base.dir=' + this.baseDir + ' ' + (this.opts.rawArgs || []).join(' ');
        const sh = vm.spawn({ user: this.user, cmd: '/bin/sh ' + this.home + '/bin/standalone.sh ' + (this.opts.rawArgs || []).join(' '), memMB: 2, ppid: ctx.ppid });
        this.shPid = sh.pid;
        const jp = vm.spawn({
          user: this.user, cmd: cmdline, memMB: Math.min(xms, 256) + 120, ppid: sh.pid, kind: 'java', server: this,
          onSignal: (sig) => this._signal(sig)
        });
        this.pid = jp.pid;
        this.startedAt = Date.now();
      }
      // parseo del XML
      const t0 = Date.now();
      this.doc = null;
      let xml;
      this.buildProps();
      try { xml = vfs.read(this.configPath, this.cred); } catch (e) {
        this.log('ERROR', 'org.jboss.as.server', 'Controller Boot Thread', 'WFLYSRV0055: Caught exception during boot: java.lang.IllegalStateException: WFLYCTL0214: Could not get main file: ' + this.configFile + '. Specified files must be relative to the configuration dir: ' + this.configDir);
        return this._abortBoot();
      }
      this.buildProps();
      const speed = Math.max(0.35, 2 / Math.max(1, vm.cpu));
      const pause = (ms) => this._pause(ms * speed);
      this.log('INFO', 'org.jboss.modules', 'main', 'JBoss Modules version 2.1.0.Final');
      await pause(250);
      if (this.state !== 'starting') return this.exitCode;
      this.log('INFO', 'org.jboss.msc', 'main', 'JBoss MSC version 1.4.13.Final');
      this.log('INFO', 'org.jboss.threads', 'main', 'JBoss Threads version 2.4.0.Final');
      this.log('INFO', 'org.jboss.as', 'MSC service thread 1-2', 'WFLYSRV0049: ' + this.dist.startLine + ' starting');
      try {
        this.doc = X.parse(xml);
        const root = X.root(this.doc);
        if (X.local(root.name) !== 'server') throw new X.XmlError("Unexpected element '" + root.name + "'", 1, 1);
      } catch (e) {
        this.log('ERROR', 'org.jboss.as.server', 'Controller Boot Thread', 'WFLYCTL0085: Failed to parse configuration: javax.xml.stream.XMLStreamException: ParseError at [row,col]:[' + (e.line || 1) + ',' + (e.col || 1) + ']\nMessage: ' + e.message);
        this.log('FATAL', 'org.jboss.as.server', 'Controller Boot Thread', 'WFLYSRV0056: Server boot has failed in an unrecoverable manner; exiting. See previous messages for details.');
        return this._abortBoot();
      }
      this.buildProps();
      await pause(300);
      if (this.state !== 'starting') return this.exitCode;
      this.log('INFO', 'org.jboss.as.server', 'Controller Boot Thread', 'WFLYSRV0039: Creating http management service using socket-binding (management-http)');
      this.log('INFO', 'org.xnio', 'MSC service thread 1-2', 'XNIO version 3.8.7.Final');
      this.log('INFO', 'org.jboss.as.naming', 'ServerService Thread Pool -- 43', 'WFLYNAM0001: Activating Naming Subsystem');
      this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-3', 'WFLYUT0003: Undertow 2.2.19.Final starting');
      this.log('INFO', 'org.jboss.as.connector', 'MSC service thread 1-1', 'WFLYJCA0009: Starting Jakarta Connectors Subsystem (WildFly/IronJacamar 1.5.3.Final)');
      this.drivers = this.loadDrivers();
      for (const d of this.drivers.values()) {
        if (d.ok) this.log('INFO', 'org.jboss.as.connector.subsystems.datasources', 'ServerService Thread Pool -- 38', 'WFLYJCA0005: Deploying non-JDBC-compliant driver class ' + d.className + ' (version 2.2)');
        else this.log('ERROR', 'org.jboss.as.controller.management-operation', 'ServerService Thread Pool -- 38', 'WFLYCTL0013: Operation ("add") failed - address: ([("subsystem" => "datasources"),("jdbc-driver" => "' + d.name + '")]) - failure description: "WFLYJCA0115: Module for driver [' + d.module + '] or one of it dependencies is missing: [' + d.module + ']"');
      }
      await pause(300);
      if (this.state !== 'starting') return this.exitCode;
      // puertos
      this.failedServices = 0;
      vm.unlistenPid(this.pid);
      const b = this.bindings();
      const openPort = (bind, what, svc) => {
        if (!bind) return false;
        const conflict = vm.listenConflict(bind.port, bind.addr);
        if (conflict) {
          this.failedServices++;
          this.log('ERROR', 'org.jboss.msc.service.fail', 'MSC service thread 1-4', 'MSC000001: Failed to start service ' + svc + ': org.jboss.msc.service.StartException in service ' + svc + ': Address already in use /' + (bind.addr === '0.0.0.0' ? '0.0.0.0' : bind.addr) + ':' + bind.port);
          return false;
        }
        vm.listen({ port: bind.port, addr: bind.addr, pid: this.pid, proc: 'java', server: this, kind: what });
        return true;
      };
      const hb = this.httpBinding();
      this.httpOk = openPort(hb, 'http', 'org.wildfly.undertow.listener.default');
      if (this.httpOk) this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-3', 'WFLYUT0006: Undertow HTTP listener default listening on ' + hb.addr + ':' + hb.port);
      if (b.https) {
        if (openPort(b.https, 'https', 'org.wildfly.undertow.listener.https'))
          this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-2', 'WFLYUT0006: Undertow HTTPS listener https listening on ' + b.https.addr + ':' + b.https.port);
      }
      if (b['txn-recovery-environment']) openPort(b['txn-recovery-environment'], 'txn', 'org.wildfly.transactions.recovery-environment');
      // datasources
      await pause(200);
      if (this.state !== 'starting') return this.exitCode;
      this.boundDs.clear();
      for (const ds of this.readDatasources()) this.bindDatasource(ds, 'ServerService Thread Pool -- 38');
      this.log('INFO', 'org.wildfly.extension.undertow', 'ServerService Thread Pool -- 80', 'WFLYUT0021: Registered web context: \'/\' for server \'default-server\'');
      // despliegues administrados (<deployments> del XML)
      await pause(250);
      if (this.state !== 'starting') return this.exitCode;
      this.deployments.clear();
      for (const d of X.kids(X.kid(X.root(this.doc), 'deployments'), 'deployment')) {
        const content = X.kid(d, 'content');
        const sha = content ? X.attr(content, 'sha1') : '';
        const file = this.contentPath(sha);
        this.deployments.set(X.attr(d, 'name'), { name: X.attr(d, 'name'), runtimeName: X.attr(d, 'runtime-name') || X.attr(d, 'name'), managed: true, sha, file, enabled: X.attr(d, 'enabled') !== 'false', status: 'STOPPED' });
      }
      for (const dep of this.deployments.values()) if (dep.enabled) this.deployNow(dep, 'MSC service thread 1-5', true);
      // deployment-scanner
      this.scannerTick(true);
      // management
      const mb = this.mgmtBinding();
      this.mgmtOk = openPort(mb, 'management', 'org.wildfly.management.http.extensible');
      await pause(300);
      if (this.state !== 'starting') return this.exitCode;
      this.log('INFO', 'org.jboss.as.server', 'ServerService Thread Pool -- 45', 'WFLYSRV0212: Resuming server');
      if (this.mgmtOk) {
        this.log('INFO', 'org.jboss.as', 'Controller Boot Thread', 'WFLYSRV0060: Http management interface listening on http://' + mb.addr + ':' + mb.port + '/management');
        this.log('INFO', 'org.jboss.as', 'Controller Boot Thread', 'WFLYSRV0051: Admin console listening on http://' + mb.addr + ':' + mb.port);
      } else {
        this.log('WARN', 'org.jboss.as', 'Controller Boot Thread', 'WFLYSRV0059: Http management interface is not enabled');
      }
      const ms = Date.now() - t0 + Math.round(2800 * speed);
      const total = 320 + this.deployments.size * 12 + this.boundDs.size * 6;
      const started = total - Math.floor(total * 0.42);
      const failedDeps = Array.from(this.deployments.values()).filter(d => d.status === 'FAILED').length;
      const errors = this.failedServices + failedDeps + Array.from(this.drivers.values()).filter(d => !d.ok).length;
      if (errors) {
        this.log('ERROR', 'org.jboss.as', 'Controller Boot Thread', 'WFLYSRV0026: ' + this.dist.startLine + ' started (with errors) in ' + ms + 'ms - Started ' + (started - errors) + ' of ' + total + ' services (' + errors + ' services failed or missing dependencies, ' + (total - started) + ' services are lazy, passive or on-demand)');
      } else {
        this.log('INFO', 'org.jboss.as', 'Controller Boot Thread', 'WFLYSRV0025: ' + this.dist.startLine + ' started in ' + ms + 'ms - Started ' + started + ' of ' + total + ' services (' + (total - started) + ' services are lazy, passive or on-demand)');
      }
      this.state = 'running';
      this.reloadRequired = false;
      this.emit('state', this.state);
      vm.proc(this.pid) && (vm.proc(this.pid).memMB = Math.min(this.xmx, xms + 60) + 160);
      this._scanTimer = setInterval(() => this.scannerTick(false), 5000);
      this._memTimer = setInterval(() => this.memTick(), 3000);
      return 0;
    }
    _pause(ms) {
      return new Promise(res => { this._pauseRes = res; this._pauseT = setTimeout(res, ms); });
    }
    _fail(code, reason) {
      this.state = 'failed'; this.failReason = reason; this.exitCode = code;
      this.emit('state', this.state);
      this.emit('exit', code);
      return code;
    }
    _abortBoot() {
      this._cleanup();
      this.log('INFO', 'org.jboss.as', 'MSC service thread 1-3', 'WFLYSRV0050: ' + this.dist.startLine + ' stopped in 12ms');
      return this._fail(1, 'Fallo de arranque (ver server.log)');
    }
    _cleanup() {
      clearInterval(this._scanTimer); clearInterval(this._memTimer);
      if (this._pauseT) { clearTimeout(this._pauseT); if (this._pauseRes) this._pauseRes(); }
      this.vm.unlistenPid(this.pid);
      if (this.pid) this.vm.reap(this.pid);
      if (this.shPid) this.vm.reap(this.shPid);
      this.boundDs.clear();
      for (const d of this.deployments.values()) if (d.status === 'OK') d.status = 'STOPPED';
    }

    // Señales al proceso java (kill, Ctrl+C del script en primer plano)
    _signal(sig) {
      if (this.state === 'stopped' || this.state === 'failed') return;
      if (sig === 9 || sig === 'KILL') {
        this._cleanup();
        this.state = 'stopped'; this.exitCode = 137;
        this.emit('state', this.state); this.emit('exit', 137);
        return;
      }
      this.stop();
    }
    async stop(restart) {
      if (this.state === 'stopped' || this.state === 'failed' || this.state === 'stopping') return;
      const wasBooting = this.state === 'starting';
      this.state = 'stopping';
      this.emit('state', this.state);
      if (wasBooting) { if (this._pauseT) { clearTimeout(this._pauseT); if (this._pauseRes) this._pauseRes(); } }
      this.log('INFO', 'org.jboss.as.server', 'Thread-1', 'WFLYSRV0272: Suspending server');
      this.log('INFO', 'org.jboss.as.ejb3', 'Thread-1', 'WFLYEJB0493: Jakarta Enterprise Beans subsystem suspension complete');
      this.log('INFO', 'org.jboss.as.server', 'Thread-1', 'WFLYSRV0220: Server shutdown has been requested via an OS signal');
      await U.sleep(300);
      for (const d of this.deployments.values()) {
        if (d.status === 'OK') {
          this.log('INFO', 'org.wildfly.extension.undertow', 'ServerService Thread Pool -- 12', 'WFLYUT0022: Unregistered web context: \'' + d.contextRoot + '\' from server \'default-server\'');
          this.log('INFO', 'org.jboss.as.server.deployment', 'MSC service thread 1-2', 'WFLYSRV0028: Stopped deployment ' + d.runtimeName + ' (runtime-name: ' + d.runtimeName + ') in 18ms');
        }
      }
      for (const ds of this.boundDs.values()) this.log('INFO', 'org.jboss.as.connector.subsystems.datasources', 'MSC service thread 1-6', 'WFLYJCA0010: Unbound data source [' + ds.jndi + ']');
      if (this.httpOk) { const hb = this.httpBinding(); this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-1', 'WFLYUT0019: Host default-host stopping'); this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-3', 'WFLYUT0008: Undertow HTTP listener default suspending'); this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-3', 'WFLYUT0007: Undertow HTTP listener default stopped, was bound to ' + hb.addr + ':' + hb.port); }
      this.log('INFO', 'org.wildfly.extension.undertow', 'MSC service thread 1-4', 'WFLYUT0004: Undertow 2.2.19.Final stopping');
      const ms = Date.now() % 90 + 20;
      this.log('INFO', 'org.jboss.as', 'MSC service thread 1-3', 'WFLYSRV0050: ' + this.dist.startLine + ' stopped in ' + ms + 'ms');
      this._cleanup();
      this.state = 'stopped'; this.exitCode = restart ? 10 : 130;
      this.emit('state', this.state);
      this.emit('exit', this.exitCode);
    }
    // :reload -> vuelve a leer el XML y reinicia servicios, mismo PID
    async reload() {
      if (this.state !== 'running') return false;
      this.state = 'reloading'; this.emit('state', this.state);
      this.log('INFO', 'org.jboss.as.server', 'Management Triggered Reload', 'WFLYSRV0272: Suspending server');
      this.vm.unlistenPid(this.pid);
      clearInterval(this._scanTimer); clearInterval(this._memTimer);
      for (const d of this.deployments.values()) if (d.status === 'OK') this.undeployNow(d, 'MSC service thread 1-4');
      this.log('INFO', 'org.jboss.as', 'MSC service thread 1-6', 'WFLYSRV0050: ' + this.dist.startLine + ' stopped in 41ms');
      this.state = 'starting';
      // Mismo PID: la JVM no se reinicia, solo se recarga el modelo
      const code = await this.start({ reload: true, env: {} });
      return code === 0;
    }

    // ---------- drivers y datasources ----------
    moduleExists(mod) {
      const rel = mod.replace(/\./g, '/') + '/main/module.xml';
      return this.vfs.exists(this.home + '/modules/system/layers/base/' + rel) || this.vfs.exists(this.home + '/modules/' + rel);
    }
    loadDrivers() {
      const map = new Map();
      const ds = X.subsystem(this.doc, 'datasources');
      for (const d of X.find(ds, 'driver', n => n.parent && X.local(n.parent.name) === 'drivers')) {
        const name = X.attr(d, 'name'), module = X.attr(d, 'module');
        const cls = X.text(X.kid(d, 'driver-class')) || (name === 'h2' ? 'org.h2.Driver' : name === 'postgresql' ? 'org.postgresql.Driver' : name === 'mysql' ? 'com.mysql.cj.jdbc.Driver' : 'java.sql.Driver');
        map.set(name, { name, module, className: cls, ok: this.moduleExists(module) });
      }
      return map;
    }
    readDatasources() {
      const ds = X.subsystem(this.doc, 'datasources');
      const list = [];
      for (const d of X.find(ds, 'datasource').concat(X.find(ds, 'xa-datasource'))) {
        const sec = X.kid(d, 'security');
        list.push({
          name: X.attr(d, 'pool-name'), jndi: X.attr(d, 'jndi-name'), enabled: X.attr(d, 'enabled') !== 'false',
          url: X.text(X.kid(d, 'connection-url')), driver: X.text(X.kid(d, 'driver')),
          user: sec ? (X.attr(sec, 'user-name') || X.text(X.kid(sec, 'user-name'))) : '', xa: X.local(d.name) === 'xa-datasource', node: d
        });
      }
      return list;
    }
    bindDatasource(ds, thread) {
      if (!ds.enabled) return false;
      const drv = this.drivers.get(ds.driver);
      if (!drv || !drv.ok) {
        this.log('ERROR', 'org.jboss.as.controller.management-operation', thread, 'WFLYCTL0013: Operation ("add") failed - address: ([("subsystem" => "datasources"),("data-source" => "' + ds.name + '")]) - failure description: {"WFLYCTL0412: Required services that are not installed:" => ["jboss.jdbc-driver.' + ds.driver + '"]}');
        this.failedServices = (this.failedServices || 0) + 1;
        return false;
      }
      this.boundDs.set(ds.jndi, ds);
      this.log('INFO', 'org.jboss.as.connector.subsystems.datasources', thread, 'WFLYJCA0001: Bound data source [' + ds.jndi + ']');
      return true;
    }

    // ---------- despliegues ----------
    contentPath(sha) { return this.dataDir + '/content/' + sha.slice(0, 2) + '/' + sha.slice(2) + '/content'; }
    // Analiza el contenido de un despliegue: {ok, contextRoot, files, error}
    analyze(name, data, exploded) {
      let entries;
      if (exploded) entries = exploded;
      else {
        const a = L.archive.decode(data);
        if (!a) return { ok: false, phase: 'STRUCTURE', error: 'WFLYSRV0160: Failed to mount deployment content\n    Caused by: java.util.zip.ZipException: zip END header not found' };
        entries = a.entries;
      }
      const get = (p) => { const e = entries.find(e => e.p === p); return e ? (e.d || '') : null; };
      const isWar = /\.war$/.test(name);
      let ctxRoot = '/' + name.replace(/\.(war|ear|jar)$/, '');
      if (/^ROOT\.war$/i.test(name)) ctxRoot = '/';
      const needs = [];
      if (isWar) {
        const web = get('WEB-INF/web.xml');
        if (web != null) {
          try {
            const d = X.parse(web);
            for (const rr of X.find(d, 'resource-ref')) { const l = X.text(X.kid(rr, 'lookup-name')); if (l) needs.push(l); }
          } catch (e) {
            return { ok: false, phase: 'PARSE', error: 'org.jboss.as.server.deployment.DeploymentUnitProcessingException: Failed to parse XML descriptor "/content/' + name + '/WEB-INF/web.xml" at [' + e.line + ',' + e.col + ']\n    Caused by: javax.xml.stream.XMLStreamException: ParseError at [row,col]:[' + e.line + ',' + e.col + ']\nMessage: ' + e.message };
          }
        }
        const jw = get('WEB-INF/jboss-web.xml');
        if (jw != null) {
          try { const d = X.parse(jw); const cr = X.find(d, 'context-root')[0]; if (cr) ctxRoot = '/' + X.text(cr).replace(/^\/+/, ''); }
          catch (e) { return { ok: false, phase: 'PARSE', error: 'Failed to parse XML descriptor "/content/' + name + '/WEB-INF/jboss-web.xml" at [' + e.line + ',' + e.col + ']' }; }
        }
      }
      return { ok: true, contextRoot: ctxRoot, entries, needs };
    }
    deployNow(dep, thread, boot) {
      let data = null, exploded = null;
      try {
        const st = this.vfs.lookup(dep.file).node;
        if (st.t === 'd') exploded = L.archive.collect(this.vfs, dep.file, ['.'], null);
        else data = this.vfs.read(dep.file);
      } catch (e) {
        dep.status = 'FAILED'; dep.error = 'Content not found'; return false;
      }
      this.log('INFO', 'org.jboss.as.server.deployment', thread, 'WFLYSRV0027: Starting deployment of "' + dep.runtimeName + '" (runtime-name: "' + dep.runtimeName + '")');
      const r = this.analyze(dep.runtimeName, data, exploded);
      if (!r.ok) {
        dep.status = 'FAILED';
        dep.error = 'WFLYSRV0153: Failed to process phase ' + r.phase + ' of deployment "' + dep.runtimeName + '"\n    Caused by: ' + r.error;
        this.log('ERROR', 'org.jboss.msc.service.fail', thread, 'MSC000001: Failed to start service jboss.deployment.unit."' + dep.runtimeName + '".' + r.phase + ': org.jboss.msc.service.StartException in service jboss.deployment.unit."' + dep.runtimeName + '".' + r.phase + ': ' + dep.error);
        return false;
      }
      const missing = r.needs.filter(j => !this.boundDs.has(j));
      if (missing.length) {
        dep.status = 'FAILED';
        dep.error = '{\n    "WFLYCTL0412: Required services that are not installed:" => [' + missing.map(j => '"jboss.naming.context.' + j.replace(/[:/]/g, '.').replace(/\.+/g, '.') + '"').join(', ') + '],\n    "WFLYCTL0180: Services with missing/unavailable dependencies" => ["jboss.deployment.unit.\\"' + dep.runtimeName + '\\".component... is missing [' + missing.join(', ') + ']"]\n}';
        this.log('ERROR', 'org.jboss.as.controller.management-operation', thread, 'WFLYCTL0013: Operation ("' + (boot ? 'deploy' : 'full-replace-deployment') + '") failed - address: ([("deployment" => "' + dep.runtimeName + '")]) - failure description: ' + dep.error);
        return false;
      }
      const clash = Array.from(this.deployments.values()).find(o => o !== dep && o.status === 'OK' && o.contextRoot === r.contextRoot);
      if (clash) {
        dep.status = 'FAILED';
        dep.error = 'java.lang.IllegalArgumentException: UT010053: Duplicate context root ' + r.contextRoot + ' (ya usado por ' + clash.runtimeName + ')';
        this.log('ERROR', 'org.jboss.msc.service.fail', thread, 'MSC000001: Failed to start service jboss.deployment.unit."' + dep.runtimeName + '".undertow-deployment: ' + dep.error);
        return false;
      }
      dep.status = 'OK'; dep.error = null; dep.contextRoot = r.contextRoot; dep.entries = r.entries; dep.deployedAt = Date.now();
      this.log('INFO', 'org.wildfly.extension.undertow', 'ServerService Thread Pool -- 81', 'WFLYUT0021: Registered web context: \'' + r.contextRoot + '\' for server \'default-server\'');
      if (!boot || dep.scanner) this.log('INFO', 'org.jboss.as.server', thread, 'WFLYSRV0010: Deployed "' + dep.runtimeName + '" (runtime-name : "' + dep.runtimeName + '")');
      return true;
    }
    undeployNow(dep, thread) {
      if (dep.status === 'OK') {
        this.log('INFO', 'org.wildfly.extension.undertow', 'ServerService Thread Pool -- 12', 'WFLYUT0022: Unregistered web context: \'' + dep.contextRoot + '\' from server \'default-server\'');
        this.log('INFO', 'org.jboss.as.server.deployment', 'MSC service thread 1-2', 'WFLYSRV0028: Stopped deployment ' + dep.runtimeName + ' (runtime-name: ' + dep.runtimeName + ') in 21ms');
      }
      dep.status = 'STOPPED';
      this.log('INFO', 'org.jboss.as.server', thread, 'WFLYSRV0009: Undeployed "' + dep.runtimeName + '" (runtime-name: "' + dep.runtimeName + '")');
    }
    scannerConfig() {
      const sc = X.subsystem(this.doc, 'deployment-scanner');
      const d = sc && X.kid(sc, 'deployment-scanner');
      if (!d) return null;
      const rel = X.attr(d, 'relative-to');
      let base = this.baseDir;
      if (rel && rel !== 'jboss.server.base.dir') base = this.props[rel] || base;
      const p = X.attr(d, 'path') || 'deployments';
      return {
        dir: p.startsWith('/') ? p : base + '/' + p,
        enabled: X.attr(d, 'scan-enabled') !== 'false',
        autoZipped: X.attr(d, 'auto-deploy-zipped') !== 'false',
        autoExploded: X.attr(d, 'auto-deploy-exploded') === 'true'
      };
    }
    // Revisión del directorio deployments (cada 5 s, como scan-interval=5000)
    scannerTick(boot) {
      if (!this.doc || (this.state !== 'running' && !boot)) return;
      const cfg = this.scannerConfig();
      if (!cfg || !cfg.enabled) return;
      const vfs = this.vfs;
      let names;
      try { names = vfs.readdir(cfg.dir); } catch (e) { return; }
      const thread = 'DeploymentScanner-threads - ' + (boot ? 1 : 2);
      const has = (n) => names.includes(n);
      const mark = (name, ext, content) => { try { vfs.write(cfg.dir + '/' + name + ext, content || name, { uid: this.cred.uid, gid: this.cred.gid }); } catch (e) { } };
      const unmark = (name, ext) => { try { if (vfs.exists(cfg.dir + '/' + name + ext)) vfs.unlink(cfg.dir + '/' + name + ext); } catch (e) { } };
      const content = names.filter(n => /\.(war|ear|jar|rar|sar)$/.test(n));
      for (const name of content) {
        const path = cfg.dir + '/' + name;
        const node = vfs.lstat(path);
        const isDir = node.t === 'd';
        if (has(name + '.skipdeploy')) continue;
        let dep = this.deployments.get(name);
        if (dep && dep.managed) continue;
        // .deployed eliminado por el usuario -> undeploy (y marcador .undeployed)
        if (dep && dep.scanner && dep.status === 'OK' && !has(name + '.deployed') && !has(name + '.dodeploy') && !has(name + '.isdeploying')) {
          this.undeployNow(dep, thread);
          this.deployments.delete(name);
          mark(name, '.undeployed');
          continue;
        }
        const want = has(name + '.dodeploy') || (!isDir && cfg.autoZipped && !has(name + '.deployed') && !has(name + '.failed') && !has(name + '.undeployed')) ||
          (isDir && cfg.autoExploded && !has(name + '.deployed') && !has(name + '.failed'));
        const updated = dep && dep.scanner && dep.status === 'OK' && !isDir && node.mt > (dep.deployedAt || 0) + 10;
        if (!want && !updated) {
          if (!dep && has(name + '.deployed') && boot) {
            // tras reinicio: redeploy de lo marcado como desplegado
            dep = { name, runtimeName: name, file: path, scanner: true, enabled: true, status: 'STOPPED' };
            this.deployments.set(name, dep);
            if (!this.deployNow(dep, thread, true)) { unmark(name, '.deployed'); mark(name, '.failed', dep.error); }
          }
          continue;
        }
        if (dep && dep.status === 'OK') this.undeployNow(dep, thread);
        unmark(name, '.dodeploy'); unmark(name, '.failed'); unmark(name, '.undeployed');
        dep = { name, runtimeName: name, file: path, scanner: true, enabled: true, status: 'STOPPED' };
        this.deployments.set(name, dep);
        mark(name, '.isdeploying');
        const ok = this.deployNow(dep, thread, false);
        unmark(name, '.isdeploying');
        if (ok) { unmark(name, '.failed'); mark(name, '.deployed'); }
        else { unmark(name, '.deployed'); mark(name, '.failed', dep.error + '\n'); }
      }
      // contenido eliminado del directorio
      for (const [name, dep] of Array.from(this.deployments.entries())) {
        if (!dep.scanner) continue;
        if (!has(name)) {
          if (dep.status === 'OK') this.undeployNow(dep, thread);
          this.deployments.delete(name);
          unmark(name, '.deployed'); unmark(name, '.failed');
        }
      }
    }
    memTick() {
      const p = this.vm.proc(this.pid);
      if (!p) return;
      const base = Math.min(this.xmx, this.xms + 40) + 150 + this.deployments.size * 12;
      p.memMB = Math.round(base + Math.random() * 30);
      p.cpu = Math.round(Math.random() * 3 * 10) / 10;
      this.heapUsed = Math.round(Math.min(this.xmx * 0.9, this.xms * 0.2 + 60 + this.deployments.size * 15 + Math.random() * 40));
    }

    // ---------- HTTP ----------
    handleHttp(req, kind) {
      if (kind === 'management') return this.handleMgmt(req);
      if (this.state !== 'running') return { status: 503, body: 'Service Unavailable' };
      const path = req.path.split('?')[0];
      let best = null;
      for (const d of this.deployments.values()) {
        if (d.status !== 'OK') continue;
        const cr = d.contextRoot;
        if (path === cr || path.startsWith(cr === '/' ? '/' : cr + '/')) if (!best || cr.length > best.contextRoot.length) best = d;
      }
      const type = (p) => /\.html?$/.test(p) ? 'text/html;charset=UTF-8' : /\.json$/.test(p) ? 'application/json' : /\.css$/.test(p) ? 'text/css' : /\.js$/.test(p) ? 'application/javascript' : 'text/plain';
      if (!best) {
        if (path === '/' || path === '/index.html') {
          try { return { status: 200, type: 'text/html', body: this.vfs.read(this.home + '/welcome-content/index.html') }; } catch (e) { }
        }
        return { status: 404, type: 'text/html', body: '<html><head><title>Error</title></head><body>Not Found</body></html>' };
      }
      let rel = path.slice(best.contextRoot === '/' ? 1 : best.contextRoot.length + 1);
      if (!rel && path !== best.contextRoot + '/' && best.contextRoot !== '/') {
        return { status: 302, headers: { Location: best.contextRoot + '/' }, body: '' };
      }
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      if (/^(WEB-INF|META-INF)\//i.test(rel)) return { status: 404, type: 'text/html', body: '<html><head><title>Error</title></head><body>Not Found</body></html>' };
      const e = best.entries.find(x => x.p === rel && x.t === 'f');
      if (!e) return { status: 404, type: 'text/html', body: '<html><head><title>Error</title></head><body>Not Found</body></html>' };
      return { status: 200, type: type(rel), body: e.d || '' };
    }
    mgmtUsers() {
      try {
        const txt = this.vfs.read(this.configDir + '/mgmt-users.properties');
        const out = {};
        for (const l of txt.split('\n')) { const m = /^([^#=\s][^=]*)=([0-9a-f]{32})\s*$/.exec(l.trim()); if (m) out[m[1]] = m[2]; }
        return out;
      } catch (e) { return {}; }
    }
    checkMgmtAuth(user, pass) {
      const users = this.mgmtUsers();
      return users[user] && users[user] === U.md5(user + ':ManagementRealm:' + pass);
    }
    handleMgmt(req) {
      if (this.state !== 'running' && this.state !== 'reloading') return { status: 503, body: 'Service Unavailable' };
      const path = req.path.split('?')[0];
      if (path === '/' || path === '/console' || path.startsWith('/console/')) {
        return { status: 200, type: 'text/html', body: '<!DOCTYPE html><html><head><title>' + this.dist.consoleName + '</title></head><body><p>HAL Management Console</p><p>(Use la aplicación "Consola JBoss" del escritorio)</p></body></html>' };
      }
      if (path.startsWith('/management')) {
        const auth = req.auth;
        if (!auth || !this.checkMgmtAuth(auth.user, auth.pass)) {
          return { status: 401, headers: { 'WWW-Authenticate': 'Digest realm="ManagementRealm"' }, type: 'text/html', body: '<html><head><title>Error</title></head><body>Unauthorized</body></html>' };
        }
        const model = new L.jboss.Model(this.vm, this.home, this);
        const r = model.execute({ address: [], operation: 'read-attribute', params: { name: 'server-state' } });
        return { status: 200, type: 'application/json', body: JSON.stringify({ outcome: 'success', result: r.result }) };
      }
      return { status: 404, body: 'Not Found' };
    }
  }

  L.jboss = L.jboss || {};
  Object.assign(L.jboss, { JBossServer, parseArgs, evalConf, parseMem, LEVELS });
})(globalThis.JLab = globalThis.JLab || {});
