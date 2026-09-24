/*
 * Sistema y seguridad RHEL: SELinux (getenforce, setenforce, sestatus,
 * chcon, restorecon, ausearch, contextos en ls -Z / stat %C), sysctl,
 * getent, nice/renice, logrotate, locate/updatedb, whereis, truncate,
 * nmcli, traceroute.
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, OS = L.os;
  const { getopt, lines } = L.cmdutil;

  // ================= SELinux =================
  // Etiqueta por defecto según la ruta (subconjunto de la política targeted)
  const RULES = [
    [/^\/home\/[^/]+$/, 'unconfined_u', 'user_home_dir_t'], [/^\/home\//, 'unconfined_u', 'user_home_t'],
    [/^\/root(\/|$)/, 'unconfined_u', 'admin_home_t'], [/^\/(var\/)?tmp(\/|$)/, 'unconfined_u', 'tmp_t'],
    [/^\/etc\/shadow$/, 'system_u', 'shadow_t'], [/^\/etc\/(passwd|group)$/, 'system_u', 'passwd_file_t'],
    [/^\/etc\/selinux(\/|$)/, 'system_u', 'selinux_config_t'], [/^\/etc\/systemd\/system(\/|$)/, 'system_u', 'systemd_unit_file_t'],
    [/^\/usr\/lib\/systemd\/system(\/|$)/, 'system_u', 'systemd_unit_file_t'], [/^\/etc(\/|$)/, 'system_u', 'etc_t'],
    [/^\/var\/log\/audit(\/|$)/, 'system_u', 'auditd_log_t'], [/^\/var\/log(\/|$)/, 'system_u', 'var_log_t'],
    [/^\/usr\/(local\/)?s?bin(\/|$)/, 'system_u', 'bin_t'], [/^\/usr\/lib\/jvm(\/|$)/, 'system_u', 'lib_t'],
    [/^\/usr(\/|$)/, 'system_u', 'usr_t'], [/^\/opt(\/|$)/, 'system_u', 'usr_t'], [/^\/srv(\/|$)/, 'system_u', 'var_t'],
    [/^\/var\/www(\/|$)/, 'system_u', 'httpd_sys_content_t'], [/^\/var(\/|$)/, 'system_u', 'var_t'],
    [/^\/boot(\/|$)/, 'system_u', 'boot_t'], [/^\/proc(\/|$)/, 'system_u', 'proc_t'], [/^\/dev(\/|$)/, 'system_u', 'device_t'],
    [/^\/$/, 'system_u', 'root_t']
  ];
  function defaultContext(path) {
    for (const [re, user, type] of RULES) if (re.test(path)) return user + ':object_r:' + type + ':s0';
    return 'system_u:object_r:default_t:s0';
  }
  // Contexto efectivo: etiqueta explícita del nodo, heredada de un árbol
  // movido con mv (conserva la etiqueta de origen), o la de la ruta.
  function contextOf(fs, path) {
    const parts = P.split(path);
    let node = fs.root, inherited = null;
    for (const part of parts) {
      if (!node || node.t !== 'd') break;
      node = node.c[part];
      if (node && node.ctxTree) inherited = node.ctx;
    }
    if (node && node.ctx) return node.ctx;
    return inherited || defaultContext(P.normalize(path));
  }
  const ctxType = (ctx) => (ctx.split(':')[2] || '');
  function selinuxMode(vm) {
    if (vm.selinux) return vm.selinux;
    let mode = 'enforcing';
    try { const m = /^\s*SELINUX=(\w+)/m.exec(vm.fs.read('/etc/selinux/config')); if (m) mode = m[1]; } catch (e) { }
    vm.selinux = mode;
    return mode;
  }
  function audit(vm, perm, comm, path, tctx, tclass) {
    const t = Date.now();
    const permissive = selinuxMode(vm) !== 'enforcing' ? 1 : 0;
    const line = 'type=AVC msg=audit(' + (t / 1000).toFixed(3) + ':' + (100 + Math.floor(Math.random() * 900)) + '): avc:  denied  { ' + perm + ' } for  pid=' + vm.nextPid + ' comm="' + comm + '" name="' + P.basename(path) + '" dev="dm-0" ino=' + (Math.abs(U.md5(path).slice(0, 6).split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7)) % 900000 + 10000) + ' scontext=system_u:system_r:init_t:s0 tcontext=' + tctx + ' tclass=' + (tclass || 'file') + ' permissive=' + permissive + '\n';
    try {
      if (!vm.fs.exists('/var/log/audit')) vm.fs.mkdir('/var/log/audit', { parents: true, mode: 0o700 });
      vm.fs.write('/var/log/audit/audit.log', line, { append: true, mode: 0o600 });
    } catch (e) { }
    vm.logSys('setroubleshoot', 'SELinux is preventing ' + comm + ' from ' + perm + ' access on the file ' + P.basename(path) + '. For complete SELinux messages run: sealert -l ' + U.md5(line).slice(0, 8));
  }
  // ¿Puede systemd (init_t) ejecutar este archivo? Devuelve true si SELinux lo bloquea.
  function blocksServiceExec(vm, path) {
    const mode = selinuxMode(vm);
    if (mode === 'disabled') return false;
    const ctx = contextOf(vm.fs, path);
    const bad = ['user_home_t', 'user_home_dir_t', 'admin_home_t', 'tmp_t', 'default_t'].includes(ctxType(ctx));
    if (!bad) return false;
    audit(vm, 'execute', '(' + P.basename(path).slice(0, 13) + ')', path, ctx, 'file');
    return mode === 'enforcing';
  }
  // mv conserva la etiqueta del origen (cp crea una nueva según el destino)
  const origRename = L.VFS.prototype.rename;
  L.VFS.prototype.rename = function (src, dst, cred) {
    let label = null, isDir = false;
    try { const r = this.lookup(src, { cred, follow: false }); label = r.node.ctx || contextOf(this, r.path); isDir = r.node.t === 'd'; } catch (e) { }
    origRename.call(this, src, dst, cred);
    if (!label) return;
    try {
      let d = this.lookup(dst, { follow: false });
      if (d.node.t === 'd' && P.basename(src) !== P.basename(dst) && this.tryLookup(P.join(d.path, P.basename(src)), { follow: false })) d = this.lookup(P.join(d.path, P.basename(src)), { follow: false });
      d.node.ctx = label;
      if (isDir) d.node.ctxTree = true;
    } catch (e) { }
  };
  L.selinux = { defaultContext, contextOf, selinuxMode, blocksServiceExec, audit };

  C.getenforce = (c) => { const m = selinuxMode(c.vm); c.println(m[0].toUpperCase() + m.slice(1)); return 0; };
  C.setenforce = (c) => {
    const v = c.args[0];
    if (!['0', '1', 'Permissive', 'Enforcing', 'permissive', 'enforcing'].includes(v || '')) return c.fail('usage:  setenforce [ Enforcing | Permissive | 1 | 0 ]');
    if (selinuxMode(c.vm) === 'disabled') return c.fail('SELinux is disabled');
    if (c.cred.uid !== 0) return c.fail('setenforce() failed');
    c.vm.selinux = (v === '1' || /^enforcing$/i.test(v)) ? 'enforcing' : 'permissive';
    c.vm.logSys('kernel', 'SELinux:  ' + (c.vm.selinux === 'enforcing' ? 'Enforcing' : 'Permissive') + ' mode');
    return 0;
  };
  C.sestatus = (c) => {
    const mode = selinuxMode(c.vm);
    let cfg = 'enforcing';
    try { const m = /^\s*SELINUX=(\w+)/m.exec(c.fs.read('/etc/selinux/config')); if (m) cfg = m[1]; } catch (e) { }
    if (mode === 'disabled') { c.println('SELinux status:                 disabled'); return 0; }
    c.println('SELinux status:                 enabled\nSELinuxfs mount:                /sys/fs/selinux\nSELinux root directory:         /etc/selinux\nLoaded policy name:             targeted\nCurrent mode:                   ' + mode + '\nMode from config file:          ' + cfg + '\nPolicy MLS status:              enabled\nPolicy deny_unknown status:     allowed\nMemory protection checking:     actual (secure)\nMax kernel policy version:      33');
    return 0;
  };
  C.chcon = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'Rvh', values: 'tur', long: { type: 't=', reference: 'ref=' } });
    let files = rest, full = null;
    if (!opts.t && !opts.u && !opts.r && !opts.ref) { full = files.shift(); if (!full || full.split(':').length < 3) return c.fail('invalid context: ' + (full || '')); }
    if (opts.ref) full = contextOf(c.fs, c.resolve(opts.ref));
    if (!files.length) return c.fail('missing operand');
    let st = 0;
    const apply = (p) => {
      const n = c.fs.lstat(p);
      if (c.cred.uid !== 0 && n.u !== c.cred.uid) throw new L.FsError('EPERM', p);
      const cur = contextOf(c.fs, p).split(':');
      let nc = full ? full.split(':') : cur.slice();
      if (opts.u) nc[0] = opts.u;
      if (opts.r) nc[1] = opts.r;
      if (opts.t) nc[2] = opts.t;
      n.ctx = nc.join(':');
      delete n.ctxTree;
      c.fs._changed(p);
      if (opts.v) c.println("changing security context of '" + p + "'");
    };
    for (const f of files) {
      try {
        const p = c.resolve(f);
        if (opts.R) c.fs.walk(p, (path) => apply(path), c.cred); else apply(p);
      } catch (e) { c.err("chcon: failed to change context of '" + f + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.restorecon = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'RrvnF' });
    if (c.cred.uid !== 0) { c.err('restorecon: Could not set context: Permission denied\n'); return 255; }
    if (!rest.length) return c.fail('usage:  restorecon [-iIDFmnprRv0x] [-e excludedir] pathname...', 1);
    for (const f of rest) {
      const p = c.resolve(f);
      if (!c.fs.tryLookup(p, { follow: false })) { c.err("restorecon: lstat(" + f + ") failed: No such file or directory\n"); continue; }
      const fix = (path) => {
        const n = c.fs.lstat(path);
        const before = contextOf(c.fs, path);
        const after = defaultContext(path);
        if (!opts.n) { delete n.ctx; delete n.ctxTree; }
        if (opts.v && ctxType(before) !== ctxType(after)) c.println('Relabeled ' + path + ' from ' + before + ' to ' + after);
      };
      if (opts.R || opts.r) {
        // primero recolecta (el contexto heredado depende de los ancestros)
        const all = [];
        c.fs.walk(p, (path) => { all.push(path); });
        const labels = all.map(x => [x, contextOf(c.fs, x)]);
        for (const [x, before] of labels) {
          const n = c.fs.lstat(x);
          const after = defaultContext(x);
          if (!opts.n) { delete n.ctx; delete n.ctxTree; }
          if (opts.v && ctxType(before) !== ctxType(after)) c.println('Relabeled ' + x + ' from ' + before + ' to ' + after);
        }
      } else fix(p);
      c.fs._changed(p);
    }
    return 0;
  };
  C.ausearch = (c) => {
    if (c.cred.uid !== 0) { c.err('Error opening /var/log/audit/audit.log (Permission denied)\n'); return 1; }
    const { opts } = getopt(c.args, { flags: 'i', values: 'mcp', long: { message: 'm=', 'start': 'ts=', 'ts': 'ts=' } });
    let txt = '';
    try { txt = c.fs.read('/var/log/audit/audit.log'); } catch (e) { }
    let recs = lines(txt);
    if (opts.m) { const types = opts.m.toUpperCase().split(','); recs = recs.filter(l => types.some(t => l.startsWith('type=' + t + ' '))); }
    if (opts.c) recs = recs.filter(l => l.includes('comm="' + opts.c));
    if (!recs.length) { c.err('<no matches>\n'); return 1; }
    for (const r of recs) {
      const m = /audit\((\d+)\.\d+:/.exec(r);
      c.println('----\ntime->' + U.dateStr(m ? +m[1] * 1000 : Date.now()) + '\n' + r);
    }
    return 0;
  };

  // ================= sysctl =================
  const SYSCTL_DEFAULTS = {
    'fs.file-max': '9223372036854775807', 'kernel.hostname': null, 'kernel.osrelease': null, 'kernel.pid_max': '4194304',
    'kernel.panic': '0', 'kernel.threads-max': '63245', 'net.core.somaxconn': '4096', 'net.core.rmem_max': '212992',
    'net.core.wmem_max': '212992', 'net.ipv4.ip_forward': '0', 'net.ipv4.ip_local_port_range': '32768\t60999',
    'net.ipv4.tcp_fin_timeout': '60', 'net.ipv4.tcp_keepalive_time': '7200', 'net.ipv4.tcp_max_syn_backlog': '1024',
    'net.ipv4.tcp_tw_reuse': '2', 'net.ipv6.conf.all.disable_ipv6': '0', 'vm.dirty_ratio': '30', 'vm.max_map_count': '65530',
    'vm.overcommit_memory': '0', 'vm.swappiness': '30'
  };
  function sysctlTable(vm) {
    if (!vm.sysctl || vm.sysctlBoot !== vm.bootTime) {
      vm.sysctl = Object.assign({}, SYSCTL_DEFAULTS);
      vm.sysctlBoot = vm.bootTime;
      for (const f of sysctlFiles(vm)) applySysctlFile(vm, f, null);
    }
    vm.sysctl['kernel.hostname'] = vm.hostname.split('.')[0];
    vm.sysctl['kernel.osrelease'] = vm.osInfo.kernel;
    return vm.sysctl;
  }
  function sysctlFiles(vm) {
    const out = [];
    for (const d of ['/usr/lib/sysctl.d', '/etc/sysctl.d']) { try { for (const f of vm.fs.readdir(d).filter(x => x.endsWith('.conf')).sort()) out.push(d + '/' + f); } catch (e) { } }
    if (vm.fs.isFile('/etc/sysctl.conf')) out.push('/etc/sysctl.conf');
    return out;
  }
  function applySysctlFile(vm, file, out) {
    let txt;
    try { txt = vm.fs.read(file); } catch (e) { if (out) out.err('sysctl: cannot open "' + file + '": No such file or directory\n'); return false; }
    for (const raw of txt.split('\n')) {
      const l = raw.trim();
      if (!l || l.startsWith('#') || l.startsWith(';')) continue;
      const m = /^([\w.\-/]+)\s*=\s*(.*)$/.exec(l);
      if (!m) continue;
      const key = m[1].replace(/\//g, '.');
      if (!(key in SYSCTL_DEFAULTS)) { if (out) out.err('sysctl: cannot stat /proc/sys/' + key.replace(/\./g, '/') + ': No such file or directory\n'); continue; }
      vm.sysctl[key] = m[2].trim();
      if (out) out.println(key + ' = ' + m[2].trim());
    }
    return true;
  }
  C.sysctl = (c) => {
    const t = sysctlTable(c.vm);
    const { opts, rest } = getopt(c.args, { flags: 'anqwpNe', long: { all: 'a', system: 'system', write: 'w' } });
    const show = (k) => c.println(opts.n ? t[k] : opts.N ? k : k + ' = ' + t[k]);
    if (opts.a) { for (const k of Object.keys(t).sort()) show(k); return 0; }
    if (opts.system) { if (c.cred.uid !== 0) return c.fail('permission denied on key "vm.swappiness"', 255); for (const f of sysctlFiles(c.vm)) { c.println('* Applying ' + f + ' ...'); applySysctlFile(c.vm, f, c); } return 0; }
    if (opts.p) {
      if (c.cred.uid !== 0) return c.fail('permission denied on key', 255);
      const files = rest.length ? rest.map(f => c.resolve(f)) : ['/etc/sysctl.conf'];
      let st = 0; for (const f of files) if (!applySysctlFile(c.vm, f, c)) st = 1; return st;
    }
    if (!rest.length) return c.fail('no variables specified\nTry `sysctl --help\' for more information.', 255);
    let st = 0;
    for (const arg of rest) {
      const m = /^([\w.\-/]+)(?:=(.*))?$/.exec(arg);
      const key = m ? m[1].replace(/\//g, '.') : arg;
      if (!(key in t)) { c.err('sysctl: cannot stat /proc/sys/' + key.replace(/\./g, '/') + ': No such file or directory\n'); st = 255; continue; }
      if (m[2] !== undefined) {
        if (c.cred.uid !== 0) { c.err('sysctl: permission denied on key "' + key + '"\n'); st = 255; continue; }
        if (['kernel.osrelease'].includes(key)) { c.err('sysctl: setting key "' + key + '": Operation not permitted\n'); st = 255; continue; }
        t[key] = m[2];
        if (key === 'kernel.hostname') { c.vm.hostname = m[2]; }
        if (!opts.q) show(key);
      } else show(key);
    }
    return st;
  };

  // ================= getent =================
  const SERVICES = { ssh: '22/tcp', http: '80/tcp', https: '443/tcp', 'http-alt': '8080/tcp', postgresql: '5432/tcp', mysql: '3306/tcp', ntp: '123/udp', smtp: '25/tcp', ldap: '389/tcp', ldaps: '636/tcp' };
  C.getent = (c) => {
    const [db, ...keys] = c.args;
    if (!db) return c.fail('Usage: getent [OPTION...] database [key ...]', 1);
    let rows = [];
    if (db === 'passwd' || db === 'group' || db === 'shadow') {
      if (db === 'shadow' && c.cred.uid !== 0) return 2;
      let txt; try { txt = c.fs.read('/etc/' + db); } catch (e) { return 2; }
      rows = lines(txt).filter(l => l && !l.startsWith('#'));
      if (keys.length) rows = rows.filter(l => { const f = l.split(':'); return keys.includes(f[0]) || (db !== 'shadow' && keys.includes(f[2])); });
    } else if (db === 'hosts' || db === 'ahosts') {
      const names = keys.length ? keys : null;
      if (!names) { rows = lines(c.fs.read('/etc/hosts')).filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().replace(/\s+/g, '       ')); }
      else for (const k of names) {
        const r = c.vm.lab.resolve(c.vm, k);
        if (!r) continue;
        const ip = r.local ? (k === c.vm.ip ? c.vm.ip : (k === 'localhost' ? '127.0.0.1' : c.vm.ip)) : r.ip;
        const vmh = r.local ? c.vm.hostname : (r.vm ? r.vm.hostname : k);
        rows.push(db === 'ahosts' ? ip + '       STREAM ' + k + '\n' + ip + '       DGRAM  \n' + ip + '       RAW    ' : U.pad(ip, 15, true) + ' ' + (k === 'localhost' ? 'localhost localhost.localdomain' : vmh + ' ' + vmh.split('.')[0]));
      }
    } else if (db === 'services') {
      rows = Object.entries(SERVICES).filter(([n, p]) => !keys.length || keys.includes(n) || keys.includes(p.split('/')[0]) || keys.includes(p)).map(([n, p]) => U.pad(n, 21, true) + ' ' + p);
    } else return c.fail('Unknown database: ' + db, 1);
    if (!rows.length) return 2;
    for (const r of rows) c.println(r);
    return 0;
  };

  // ================= nice / renice =================
  C.nice = async (c) => {
    let n = 10, i = 0;
    const a = c.args;
    if (a[0] === '-n') { n = parseInt(a[1], 10); i = 2; }
    else if (/^-n-?\d+$/.test(a[0] || '')) { n = parseInt(a[0].slice(2), 10); i = 1; }
    else if (/^-\d+$/.test(a[0] || '') || /^--\d+$/.test(a[0] || '')) { n = -parseInt(a[0].replace(/^-/, ''), 10) * -1; n = parseInt(a[0].slice(1), 10); i = 1; }
    if (i >= a.length) { c.println(String(c.sh.niceness || 0)); return 0; }
    if (isNaN(n)) return c.fail("invalid adjustment '" + a[1] + "'", 125);
    let level = Math.max(-20, Math.min(19, (c.sh.niceness || 0) + n));
    if (level < (c.sh.niceness || 0) && c.cred.uid !== 0) { c.err('nice: cannot set niceness: Permission denied\n'); level = c.sh.niceness || 0; }
    const prev = c.vm.defaultNice;
    c.vm.defaultNice = level;
    try { return await c.sh.execCommand(a.slice(i), c.io); }
    finally { c.vm.defaultNice = prev; }
  };
  C.renice = (c) => {
    const a = c.args.slice();
    let n = null, mode = 'p';
    const targets = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '-n') n = parseInt(a[++i], 10);
      else if (a[i] === '-p') mode = 'p';
      else if (a[i] === '-u') mode = 'u';
      else if (a[i] === '-g') mode = 'g';
      else if (n === null && /^-?\d+$/.test(a[i])) n = parseInt(a[i], 10);
      else targets.push([mode, a[i]]);
    }
    if (n === null || !targets.length) return c.fail(' renice [-n] <priority> [-p|--pid] <pid>...\n renice [-n] <priority>  -g|--pgrp <pgid>...\n renice [-n] <priority>  -u|--user <user>...', 1);
    let st = 0;
    for (const [m, t] of targets) {
      const procs = m === 'u' ? Array.from(c.vm.procs.values()).filter(p => p.user === t) : [c.vm.proc(+t)].filter(Boolean);
      if (!procs.length) { c.err('renice: failed to get priority for ' + t + ' (process ID): No such process\n'); st = 1; continue; }
      for (const p of procs) {
        const old = p.ni || 0;
        const val = Math.max(-20, Math.min(19, n));
        if (c.cred.uid !== 0 && (p.user !== c.user || val < old)) { c.err('renice: failed to set priority for ' + p.pid + ' (process ID): Permission denied\n'); st = 1; continue; }
        p.ni = val;
        c.println(p.pid + ' (process ID) old priority ' + old + ', new priority ' + val);
      }
    }
    return st;
  };

  // ================= logrotate =================
  function parseSize(s) { const m = /^(\d+)([kKmMgG]?)$/.exec(s || ''); if (!m) return null; return +m[1] * ({ '': 1, k: 1024, K: 1024, m: 1048576, M: 1048576, g: 1073741824, G: 1073741824 }[m[2]]); }
  function parseLogrotate(c, file, global, blocks, seen) {
    seen = seen || new Set();
    if (seen.has(file)) return;
    seen.add(file);
    let txt;
    try { txt = c.fs.read(file, c.cred); } catch (e) { throw new Error('error: cannot stat ' + file + ': ' + e.message); }
    const ls = txt.split('\n');
    let cur = null, script = null;
    for (let i = 0; i < ls.length; i++) {
      const l = ls[i].trim();
      if (script) { if (l === 'endscript') { cur[script.kind] = script.lines.join('\n'); script = null; } else script.lines.push(ls[i]); continue; }
      if (!l || l.startsWith('#')) continue;
      if (l === '}') { blocks.push(cur); cur = null; continue; }
      if (!cur && l.endsWith('{')) { cur = Object.assign({}, global, { patterns: l.slice(0, -1).trim().split(/\s+/).filter(Boolean), file }); continue; }
      const [k, ...v] = l.split(/\s+/);
      const target = cur || global;
      if (k === 'include' && !cur) {
        const p = v[0];
        try {
          if (c.fs.isDir(p)) { for (const f of c.fs.readdir(p, c.cred).sort()) parseLogrotate(c, p + '/' + f, Object.assign({}, global), blocks, seen); }
          else parseLogrotate(c, p, global, blocks, seen);
        } catch (e) { }
        continue;
      }
      if (k === 'postrotate' || k === 'prerotate') { script = { kind: k, lines: [] }; continue; }
      if (['daily', 'weekly', 'monthly', 'yearly', 'hourly'].includes(k)) target.freq = k;
      else if (k === 'rotate') target.rotate = parseInt(v[0], 10);
      else if (k === 'size' || k === 'maxsize' || k === 'minsize') target[k] = parseSize(v[0]);
      else if (k === 'create') target.create = v.length ? v : true;
      else if (k === 'nocreate') target.create = false;
      else if (['compress', 'delaycompress', 'missingok', 'notifempty', 'copytruncate', 'dateext', 'sharedscripts'].includes(k)) target[k] = true;
      else if (k === 'nocompress') target.compress = false;
      else if (k === 'ifempty') target.notifempty = false;
      else if (k === 'nomissingok') target.missingok = false;
      else if (k === 'nodateext') target.dateext = false;
      else if (k === 'nocopytruncate') target.copytruncate = false;
      else if (k === 'dateformat') target.dateformat = v.join(' ');
      else if (k === 'su') target.su = v;
      else if (k === 'olddir') target.olddir = v[0];
    }
  }
  function gzipData(name, data) { return L.archive.encode('gz', [{ p: name, t: 'f', m: 0o644, d: data }]); }
  C.logrotate = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'dfv', values: 's', long: { debug: 'd', force: 'f', verbose: 'v', state: 's=' } });
    if (!rest.length) { c.println('logrotate 3.18.0 - Copyright (C) 1995-2001 Red Hat, Inc.\nThis may be freely redistributed under the terms of the GNU General Public License\n\nUsage: logrotate [-dfv?] [-d|--debug] [-f|--force] [-s|--state=statefile] [-v|--verbose] <configfile>'); return 1; }
    const debug = !!opts.d, verbose = !!(opts.v || opts.d);
    const say = (s) => { if (verbose) c.err(s + '\n'); };
    if (debug) say('WARNING: logrotate in debug mode does nothing except printing debug messages!  Consider using verbose mode (-v) instead if this is not what you want.\n');
    const stateFile = opts.s ? c.resolve(opts.s) : '/var/lib/logrotate/logrotate.status';
    const state = {};
    try { for (const l of lines(c.fs.read(stateFile, c.cred)).slice(1)) { const m = /^"(.*)" (\S+)$/.exec(l); if (m) state[m[1]] = m[2]; } } catch (e) { }
    const blocks = [];
    for (const f of rest) {
      say('reading config file ' + f);
      try { parseLogrotate(c, c.resolve(f), { rotate: 0, freq: 'weekly' }, blocks); }
      catch (e) { c.err(e.message + '\n'); return 1; }
    }
    say('\nHandling ' + blocks.length + ' logs');
    const today = new Date(); const ymd = today.getFullYear() + U.two(today.getMonth() + 1) + U.two(today.getDate());
    const stamp = today.getFullYear() + '-' + (today.getMonth() + 1) + '-' + today.getDate() + '-' + today.getHours() + ':0';
    let st = 0;
    for (const b of blocks) {
      say('\nrotating pattern: ' + b.patterns.join(' ') + ' ' + (opts.f ? ' forced from command line ' : (b.size ? b.size + ' bytes ' : b.freq + ' ')) + '(' + b.rotate + ' rotations)');
      say('empty log files are ' + (b.notifempty ? 'not ' : '') + 'rotated, old logs are removed');
      const files = [];
      for (const pat of b.patterns) {
        const m = c.sh.glob(pat);
        if (m.length) files.push(...m); else if (c.fs.exists(pat)) files.push(pat);
        else if (!b.missingok) { c.err('error: stat of ' + pat + ' failed: No such file or directory\n'); st = 1; }
      }
      const rotated = [];
      for (const f of files) {
        say('considering log ' + f);
        let node;
        try { node = c.fs.stat(f, { cred: c.cred }); } catch (e) { c.err('error: stat of ' + f + ' failed: ' + e.message + '\n'); st = 1; continue; }
        if (node.t !== 'f') continue;
        const size = c.fs.nodeSize(node);
        // El archivo de estado guarda Y-M-D-H:M; en pantalla se muestra YYYY-MM-DD HH:MM
        const show = (t) => { const m = /^(\d+)-(\d+)-(\d+)-(\d+):(\d+)$/.exec(t); const z = (n) => String(n).padStart(2, '0'); return m ? m[1] + '-' + z(m[2]) + '-' + z(m[3]) + ' ' + z(m[4]) + ':' + z(m[5]) : t; };
        say('  Now: ' + show(stamp) + '\n  Last rotated at ' + (state[f] ? show(state[f]) : 'never'));
        let need = false;
        if (opts.f) need = true;
        else if (b.size != null) need = size >= b.size;
        else if (!state[f]) { need = false; state[f] = stamp; node._lrFirst = true; }
        else {
          const [y, mo, d] = state[f].split('-').map(Number);
          const last = new Date(y, mo - 1, d);
          const days = (today - last) / 864e5;
          need = { hourly: days >= 1 / 24, daily: days >= 1, weekly: days >= 7, monthly: days >= 30, yearly: days >= 365 }[b.freq];
        }
        if (need && b.notifempty && size === 0) { say('  log does not need rotating (log is empty)'); continue; }
        if (!need) {
          const unit = { hourly: 'an hour', daily: 'a day', weekly: 'a week', monthly: 'a month', yearly: 'a year' }[b.freq] || 'a week';
          say(b.size != null ? '  log does not need rotating (\'size\' ' + b.size + ' bytes not reached)' : '  log does not need rotating (log has been rotated at ' + state[f] + ', which is less than ' + unit + ' ago)');
          delete node._lrFirst;
          continue;
        }
        say('  log needs rotating');
        rotated.push(f);
        if (debug) continue;
        try {
          if (b.prerotate && !b.sharedscripts) await c.sh.run(b.prerotate, c.io);
          const ext = b.compress ? '.gz' : '';
          const dir = b.olddir ? P.resolve(P.dirname(f), b.olddir) : P.dirname(f);
          const base = dir + '/' + P.basename(f);
          const data = c.fs.read(f, c.cred);
          let firstName;
          if (b.dateext) {
            firstName = base + '-' + ymd;
            if (c.fs.exists(firstName) || c.fs.exists(firstName + '.gz')) { c.err('error: destination ' + firstName + ext + ' already exists, skipping rotation\n'); st = 1; continue; }
            const olds = c.fs.readdir(dir, c.cred).filter(n => new RegExp('^' + P.basename(f).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d{8}(\\.gz)?$').test(n)).sort();
            while (b.rotate > 0 && olds.length >= b.rotate) { const o = olds.shift(); say('removing old log ' + dir + '/' + o); c.fs.unlink(dir + '/' + o, c.cred); }
          } else {
            const nm = (k, gz) => base + '.' + k + (gz ? '.gz' : '');
            for (const gz of [true, false]) if (b.rotate > 0 && c.fs.exists(nm(b.rotate, gz))) { say('removing old log ' + nm(b.rotate, gz)); c.fs.unlink(nm(b.rotate, gz), c.cred); }
            for (let k = b.rotate - 1; k >= 1; k--) {
              for (const gz of [true, false]) {
                if (!c.fs.exists(nm(k, gz))) continue;
                say('renaming ' + nm(k, gz) + ' to ' + nm(k + 1, gz));
                c.fs.rename(nm(k, gz), nm(k + 1, gz), c.cred);
                if (!gz && k === 1 && b.compress && b.delaycompress) {
                  c.fs.write(nm(2, true), gzipData(P.basename(nm(2, false)), c.fs.read(nm(2, false), c.cred)), { cred: c.cred, bin: true });
                  c.fs.unlink(nm(2, false), c.cred);
                  say('compressing log with: /bin/gzip');
                }
              }
            }
            firstName = nm(1, false);
          }
          if (b.rotate === 0) { if (b.copytruncate) c.fs.write(f, '', { cred: c.cred }); else c.fs.unlink(f, c.cred); say('log ' + f + ' removed (rotate count is 0)'); }
          else if (b.copytruncate) { say('copying ' + f + ' to ' + firstName + '\ntruncating ' + f); c.fs.write(firstName, data, { cred: c.cred, mode: node.m }); c.fs.write(f, '', { cred: c.cred }); }
          else {
            say('renaming ' + f + ' to ' + firstName);
            c.fs.rename(f, firstName, c.cred);
            if (b.create) {
              const [mode, owner, group] = Array.isArray(b.create) ? b.create : [];
              const u = owner ? OS.users.byName(c.fs, owner) : null, g = group ? OS.users.groups(c.fs).find(x => x.name === group) : null;
              c.fs.write(f, '', { cred: c.cred, mode: mode ? parseInt(mode, 8) : node.m, uid: u ? u.uid : node.u, gid: g ? g.gid : node.g });
              say('creating new ' + f + ' mode = 0' + (mode || (node.m & 0o777).toString(8)) + ' uid = ' + (u ? u.uid : node.u) + ' gid = ' + (g ? g.gid : node.g));
            }
          }
          if (b.rotate > 0 && b.compress && !b.delaycompress) {
            c.fs.write(firstName + '.gz', gzipData(P.basename(firstName), c.fs.read(firstName, c.cred)), { cred: c.cred, bin: true });
            c.fs.unlink(firstName, c.cred);
            say('compressing log with: /bin/gzip');
          }
          state[f] = stamp;
          if (b.postrotate && !b.sharedscripts) { say('running postrotate script'); await c.sh.run(b.postrotate, c.io); }
        } catch (e) { c.err('error: error rotating ' + f + ': ' + e.message + '\n'); st = 1; }
      }
      if (!debug && rotated.length && b.sharedscripts && b.postrotate) { say('running postrotate script'); await c.sh.run(b.postrotate, c.io); }
    }
    if (!debug) {
      try {
        c.fs.mkdir(P.dirname(stateFile), { parents: true, cred: c.cred });
        c.fs.write(stateFile, 'logrotate state -- version 2\n' + Object.entries(state).map(([k, v]) => '"' + k + '" ' + v).join('\n') + '\n', { cred: c.cred, mode: 0o644 });
      } catch (e) { c.err('error: error creating state file ' + stateFile + ': ' + e.message + '\n'); return 1; }
    }
    return st;
  };

  // ================= locate / updatedb / whereis =================
  const LOCATE_DB = '/var/lib/plocate/plocate.db';
  C.updatedb = (c) => {
    if (c.cred.uid !== 0) { c.err('updatedb: can not open a temporary file for `' + LOCATE_DB + "'\n"); return 1; }
    const paths = [];
    c.fs.walk('/', (p, n) => {
      if (/^\/(proc|sys|dev|tmp|var\/tmp|run)(\/|$)/.test(p) && p !== '/') return false;
      paths.push(p);
    });
    c.fs.mkdir(P.dirname(LOCATE_DB), { parents: true });
    c.fs.write(LOCATE_DB, JSON.stringify(paths), { mode: 0o640, bin: true });
    return 0;
  };
  C.locate = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'icbAe', values: 'ln', long: { 'ignore-case': 'i', count: 'c', basename: 'b', limit: 'l=', existing: 'e' } });
    if (!rest.length) return c.fail('no pattern to search for specified');
    let db;
    try { db = JSON.parse(c.fs.read(LOCATE_DB)); } catch (e) { c.err('/usr/bin/locate: can not stat () `' + LOCATE_DB + "': No such file or directory\n"); return 1; }
    const tests = rest.map(pat => {
      const hay = (p) => opts.b ? P.basename(p) : p;
      if (/[*?[]/.test(pat)) { const re = L.util.globToRegex(opts.i ? pat.toLowerCase() : pat); return (p) => re.test(opts.i ? hay(p).toLowerCase() : hay(p)) || re.test(opts.i ? P.basename(p).toLowerCase() : P.basename(p)); }
      return (p) => opts.i ? hay(p).toLowerCase().includes(pat.toLowerCase()) : hay(p).includes(pat);
    });
    let hits = db.filter(p => (opts.A ? tests.every(t => t(p)) : tests.some(t => t(p))) && c.fs.tryLookup(p, { cred: c.cred, follow: false }));
    const lim = opts.l || opts.n;
    if (lim) hits = hits.slice(0, +lim);
    if (opts.c) { c.println(String(hits.length)); return hits.length ? 0 : 1; }
    for (const h of hits) c.println(h);
    return hits.length ? 0 : 1;
  };
  C.whereis = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'bms' });
    for (const name of rest) {
      const found = [];
      if (!opts.m) {
        const dirs = ['/usr/bin', '/usr/sbin', '/usr/local/bin', '/usr/local/sbin', '/usr/lib/jvm'];
        for (const d of dirs) {
          if (d === '/usr/lib/jvm') { try { for (const j of c.fs.readdir(d)) if (c.fs.exists(d + '/' + j + '/bin/' + name)) found.push(d + '/' + j + '/bin/' + name); } catch (e) { } continue; }
          if (c.fs.tryLookup(d + '/' + name, { follow: false })) found.push(d + '/' + name);
        }
        if (c.fs.isDir('/etc/' + name)) found.push('/etc/' + name);
      }
      if (!opts.b && L.manual && L.manual[name]) found.push('/usr/share/man/man1/' + name + '.1.gz');
      c.println(name + ':' + found.map(x => ' ' + x).join(''));
    }
    return 0;
  };

  // ================= truncate =================
  C.truncate = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'co', values: 'sr', long: { size: 's=', 'no-create': 'c', reference: 'r=' } });
    if (opts.s === undefined && !opts.r) return c.fail("you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information.");
    if (!rest.length) return c.fail('missing file operand');
    let st = 0;
    for (const f of rest) {
      const p = c.resolve(f);
      try {
        let r = c.fs.tryLookup(p, { cred: c.cred });
        if (!r) { if (opts.c) continue; c.fs.write(p, '', { cred: c.cred }); r = c.fs.lookup(p, { cred: c.cred }); }
        const n = r.node;
        if (n.t === 'd') throw new L.FsError('EISDIR', f);
        if (!c.fs.can(n, c.cred, 'w')) throw new L.FsError('EACCES', f);
        const cur = c.fs.nodeSize(n);
        let target;
        if (opts.r) target = c.fs.nodeSize(c.fs.stat(c.resolve(opts.r)));
        else {
          const m = /^([+\-<>/%]?)(\d+)([KMGT]?)(B?)$/i.exec(opts.s);
          if (!m) return c.fail("Invalid number: '" + opts.s + "'");
          const mult = m[3] ? Math.pow(m[4] ? 1000 : 1024, 'KMGT'.indexOf(m[3].toUpperCase()) + 1) : 1;
          const v = +m[2] * mult;
          target = { '': v, '+': cur + v, '-': Math.max(0, cur - v), '<': Math.min(cur, v), '>': Math.max(cur, v), '/': Math.floor(cur / v) * v, '%': Math.ceil(cur / v) * v }[m[1]];
        }
        const data = n.d || '';
        if (n.vs != null || target > data.length) {
          if (target > cur) c.fs._charge(target - cur, p); else c.fs.used -= cur - target;
          n.d = data.slice(0, Math.min(data.length, target)); n.vs = target;
          if (target === n.d.length) delete n.vs;
        } else { c.fs.used -= cur - target; n.d = data.slice(0, target); delete n.vs; }
        n.mt = Date.now();
        c.fs._changed(p);
      } catch (e) { c.err("truncate: cannot open '" + f + "' for writing: " + e.message + '\n'); st = 1; }
    }
    return st;
  };

  // ================= nmcli =================
  function mac(vm) { const h = U.md5(vm.id); return '52:54:00:' + h.slice(0, 2) + ':' + h.slice(2, 4) + ':' + h.slice(4, 6); }
  const uuid = (vm, k) => { const h = U.md5(vm.id + k); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20, 32); };
  C.nmcli = (c) => {
    const vm = c.vm;
    const a = c.args.filter(x => !/^-(t|p|f|c|terse|pretty|colors)$/.test(x));
    const obj = (a[0] || '').toLowerCase(), sub = (a[1] || '').toLowerCase();
    const dns = '10.0.0.1';
    if (!obj) {
      c.println('enp1s0: connected to enp1s0\n        "Red Hat Virtio"\n        ethernet (virtio_net), ' + mac(vm).toUpperCase() + ', hw, mtu 1500\n        ip4 default\n        inet4 ' + vm.ip + '/24\n        route4 10.0.0.0/24 metric 100\n        route4 default via 10.0.0.1 metric 100\n\nlo: connected (externally) to lo\n        "lo"\n        loopback (unknown), 00:00:00:00:00:00, sw, mtu 65536\n        inet4 127.0.0.1/8\n\nDNS configuration:\n        servers: ' + dns + '\n        domains: lab.local\n        interface: enp1s0\n\nUse "nmcli device show" to get complete information about known devices and\n"nmcli connection show" to get an overview on active connection profiles.');
      return 0;
    }
    if ('general'.startsWith(obj)) {
      if (sub === 'hostname') {
        if (!a[2]) { c.println(vm.hostname); return 0; }
        if (c.cred.uid !== 0) return c.fail('Error: Could not set hostname: Insufficient privileges.');
        vm.hostname = a[2]; c.fs.write('/etc/hostname', a[2] + '\n'); c.sh.env.HOSTNAME = a[2]; vm.lab.scheduleSave(vm); vm.lab.emit('change');
        return 0;
      }
      c.println('STATE      CONNECTIVITY  WIFI-HW  WIFI     WWAN-HW  WWAN    \nconnected  limited       missing  enabled  missing  enabled ');
      return 0;
    }
    if ('device'.startsWith(obj)) {
      if (!sub || 'status'.startsWith(sub)) { c.println('DEVICE  TYPE      STATE                   CONNECTION \nenp1s0  ethernet  connected               enp1s0     \nlo      loopback  connected (externally)  lo         '); return 0; }
      if ('show'.startsWith(sub)) {
        c.println('GENERAL.DEVICE:                         enp1s0\nGENERAL.TYPE:                           ethernet\nGENERAL.HWADDR:                         ' + mac(vm).toUpperCase() + '\nGENERAL.MTU:                            1500\nGENERAL.STATE:                          100 (connected)\nGENERAL.CONNECTION:                     enp1s0\nWIRED-PROPERTIES.CARRIER:               on\nIP4.ADDRESS[1]:                         ' + vm.ip + '/24\nIP4.GATEWAY:                            10.0.0.1\nIP4.ROUTE[1]:                           dst = 10.0.0.0/24, nh = 0.0.0.0, mt = 100\nIP4.ROUTE[2]:                           dst = 0.0.0.0/0, nh = 10.0.0.1, mt = 100\nIP4.DNS[1]:                             ' + dns);
        return 0;
      }
    }
    if ('connection'.startsWith(obj)) {
      if (!sub || 'show'.startsWith(sub)) {
        if (a[2]) {
          if (a[2] !== 'enp1s0') { c.err('Error: ' + a[2] + ' - no such connection profile.\n'); return 10; }
          c.println('connection.id:                          enp1s0\nconnection.uuid:                        ' + uuid(vm, 'enp1s0') + '\nconnection.type:                        802-3-ethernet\nconnection.interface-name:              enp1s0\nconnection.autoconnect:                 yes\nipv4.method:                            manual\nipv4.dns:                               ' + dns + '\nipv4.dns-search:                        lab.local\nipv4.addresses:                         ' + vm.ip + '/24\nipv4.gateway:                           10.0.0.1\nipv4.never-default:                     no\nipv6.method:                            disabled\nGENERAL.NAME:                           enp1s0\nGENERAL.DEVICES:                        enp1s0\nGENERAL.STATE:                          activated\nIP4.ADDRESS[1]:                         ' + vm.ip + '/24\nIP4.GATEWAY:                            10.0.0.1\nIP4.DNS[1]:                             ' + dns);
          return 0;
        }
        c.println('NAME    UUID                                  TYPE      DEVICE \nenp1s0  ' + uuid(vm, 'enp1s0') + '  ethernet  enp1s0 \nlo      ' + uuid(vm, 'lo') + '  loopback  lo     ');
        return 0;
      }
      if (['modify', 'mod', 'up', 'down', 'add', 'delete', 'reload'].includes(sub)) {
        if (c.cred.uid !== 0) return c.fail('Error: Failed to ' + sub + ': Insufficient privileges.');
        c.err('Error: la red del laboratorio es estática (10.0.0.0/24): los cambios de conexión no están simulados.\n');
        return 1;
      }
    }
    c.err('Error: argument \'' + (a[0] || '') + '\' not understood. Try passing --help instead.\n');
    return 2;
  };

  // ================= traceroute =================
  C.traceroute = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'nI', values: 'mwq' });
    const host = rest[0];
    if (!host) { c.err('Usage:\n  traceroute [ -46dFITnreAUDV ] [ -f first_ttl ] [ -m max_ttl ] host [ packetlen ]\n'); return 2; }
    const r = c.vm.lab.resolve(c.vm, host);
    if (!r) { c.err(host + ': Name or service not known\nCannot handle "host" cmdline arg `' + host + "' on position 1 (argc 1)\n"); return 2; }
    const ip = r.local ? '127.0.0.1' : r.ip;
    const name = r.local ? 'localhost' : (r.vm ? r.vm.hostname : host);
    const max = +(opts.m || 30);
    c.println('traceroute to ' + host + ' (' + ip + '), ' + max + ' hops max, 60 byte packets');
    const up = r.local || (r.vm && r.vm.state === 'running');
    if (up) {
      const t = () => (r.local ? 0.02 + Math.random() * 0.03 : 0.3 + Math.random() * 0.4).toFixed(3) + ' ms';
      c.println(' 1  ' + (opts.n ? ip : name + ' (' + ip + ')') + '  ' + t() + '  ' + t() + '  ' + t());
      return 0;
    }
    for (let k = 1; k <= Math.min(max, 5); k++) { await c.sleep(300); c.println(U.pad(k, 2) + '  * * *'); }
    c.println(' 6  ' + c.vm.ip + ' (' + c.vm.ip + ')  3006.451 ms !H  3006.402 ms !H  3006.389 ms !H');
    return 0;
  };
})(globalThis.JLab = globalThis.JLab || {});
