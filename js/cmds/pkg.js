/*
 * Paquetes (dnf/yum/rpm/alternatives), compresión (tar, zip, unzip, gzip,
 * jar) y herramientas Java (java, jps, jstack, jcmd, jmap, keytool).
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, OS = L.os;
  const { getopt } = L.cmdutil;

  // ---------------- dnf / yum ----------------
  C.dnf = async (c) => {
    const args = c.args.filter(a => !['-y', '--assumeyes', '-q', '--quiet', '--nogpgcheck'].includes(a));
    const yes = c.args.includes('-y') || c.args.includes('--assumeyes');
    const quiet = c.args.includes('-q');
    const sub = args[0];
    const names = args.slice(1);
    const os = c.vm.osInfo;
    const installed = OS.installedList(c.fs);
    const repoName = (n) => OS.PACKAGES[n].base ? 'baseos' : 'appstream';
    const resolveName = (n) => {
      if (OS.PACKAGES[n]) return n;
      const alias = { java: 'java-17-openjdk', 'java-17': 'java-17-openjdk', 'java-11': 'java-11-openjdk', 'java-1.8.0': 'java-1.8.0-openjdk', 'java-21': 'java-21-openjdk', vim: 'vim-enhanced', 'java-17-openjdk-devel': 'java-17-openjdk', 'java-11-openjdk-devel': 'java-11-openjdk', 'java-1.8.0-openjdk-devel': 'java-1.8.0-openjdk', 'java-21-openjdk-devel': 'java-21-openjdk', 'java-17-openjdk-headless': 'java-17-openjdk', 'java-11-openjdk-headless': 'java-11-openjdk', nc: 'nmap-ncat', ifconfig: 'net-tools', netstat: 'net-tools' };
      if (alias[n]) return alias[n];
      // búsqueda por comando provisto (dnf provides)
      const byCmd = Object.entries(OS.PACKAGES).find(([k, p]) => (p.cmds || []).includes(n));
      return byCmd ? null : null;
    };
    const needRoot = () => { if (c.cred.uid !== 0) { c.println('Error: This command has to be run with superuser privileges (under the root user on most systems).'); return true; } return false; };
    const meta = () => { if (!quiet) c.println('Updating Subscription Management repositories.\nLast metadata expiration check: 0:' + U.two(new Date().getMinutes()) + ':12 ago on ' + U.dateStr(Date.now() - 3600e3) + '.'); };
    const table = (title, list) => {
      c.println('================================================================================\n Package                     Arch      Version                   Repository  Size\n================================================================================\n' + title + ':');
      let total = 0;
      for (const n of list) { const p = OS.PACKAGES[n]; total += p.size; c.println(' ' + U.pad(n, 27, true) + ' x86_64    ' + U.pad(p.v + '.' + os.el, 25, true) + ' ' + U.pad('lab-' + repoName(n), 11, true) + ' ' + U.pad(p.size.toFixed(1) + ' M', 5)); }
      c.println('\nTransaction Summary\n================================================================================\n' + (title === 'Installing' ? 'Install' : 'Remove') + '  ' + list.length + ' Package' + (list.length > 1 ? 's' : '') + '\n');
      return total;
    };
    const confirm = async () => {
      if (yes) { c.println('Is this ok [y/N]: y'); return true; }
      if (!c.term) { c.println('Operation aborted.'); return false; }
      const a = await c.prompt('Is this ok [y/N]: ');
      if (!/^y/i.test(a || '')) { c.println('Operation aborted.'); return false; }
      return true;
    };
    switch (sub) {
      case 'install': case 'reinstall': {
        if (needRoot()) return 1;
        if (!names.length) { c.println('Error: Need to pass a list of pkgs to install'); return 1; }
        meta();
        const todo = [];
        for (const raw of names) {
          const n = resolveName(raw);
          if (!n) { c.println('No match for argument: ' + raw); c.println('Error: Unable to find a match: ' + raw); return 1; }
          if (installed[n] && sub === 'install') { c.println('Package ' + n + '-' + OS.PACKAGES[n].v + '.' + os.el + '.x86_64 is already installed.'); continue; }
          if (!todo.includes(n)) todo.push(n);
        }
        if (!todo.length) { c.println('Dependencies resolved.\nNothing to do.\nComplete!'); return 0; }
        c.println('Dependencies resolved.');
        const total = table('Installing', todo);
        const need = Math.round(total * 1024 * 1024 * 2.2);
        c.println('Total download size: ' + total.toFixed(0) + ' M\nInstalled size: ' + (total * 2.2).toFixed(0) + ' M');
        if (c.fs.free() < need) { c.println('Error: Transaction test error:\n  installing package ' + todo[0] + ' needs ' + Math.round(need / 1048576) + 'MB more space on the / filesystem\n\nError Summary\n-------------\nDisk Requirements:\n   At least ' + Math.round(need / 1048576) + 'MB more space needed on the / filesystem.'); return 1; }
        if (!await confirm()) return 1;
        c.println('Downloading Packages:');
        for (const n of todo) {
          const p = OS.PACKAGES[n];
          await c.sleep(150 + p.size * 8);
          c.println('(' + (todo.indexOf(n) + 1) + '/' + todo.length + '): ' + U.pad(n + '-' + p.v + '.' + os.el + '.x86_64.rpm', 50, true) + ' ' + U.pad((p.size * 3.1).toFixed(1) + ' MB/s', 12) + ' | ' + U.pad(p.size.toFixed(1) + ' MB', 7) + '     00:0' + Math.ceil(p.size / 20));
        }
        c.println('--------------------------------------------------------------------------------\nTotal                                            25 MB/s | ' + total.toFixed(0) + ' MB     00:02\nRunning transaction check\nTransaction check succeeded.\nRunning transaction test\nTransaction test succeeded.\nRunning transaction');
        for (const [i, n] of todo.entries()) {
          await c.sleep(200);
          c.println('  Installing       : ' + U.pad(n + '-' + OS.PACKAGES[n].v + '.' + os.el + '.x86_64', 55, true) + ' ' + (i + 1) + '/' + todo.length);
          OS.installPackageFiles(c.fs, n, os);
          installed[n] = OS.PACKAGES[n].v + '.' + os.el;
        }
        for (const [i, n] of todo.entries()) c.println('  Verifying        : ' + U.pad(n + '-' + OS.PACKAGES[n].v + '.' + os.el + '.x86_64', 55, true) + ' ' + (i + 1) + '/' + todo.length);
        OS.setInstalled(c.fs, installed);
        c.fs.write('/var/log/dnf.log', U.logTime() + ' INFO Installed: ' + todo.join(', ') + '\n', { append: true });
        c.println('Installed products updated.\n\nInstalled:\n  ' + todo.map(n => n + '-' + OS.PACKAGES[n].v + '.' + os.el + '.x86_64').join('\n  ') + '\n\nComplete!');
        return 0;
      }
      case 'remove': case 'erase': {
        if (needRoot()) return 1;
        meta();
        const todo = [];
        for (const raw of names) { const n = resolveName(raw); if (!n || !installed[n]) { c.println('No match for argument: ' + raw); continue; } if (OS.PACKAGES[n].base && ['bash', 'systemd', 'coreutils', 'dnf', 'rpm', 'sudo'].includes(n)) { c.println('Error: \n Problem: The operation would result in removing the following protected packages: ' + n); return 1; } todo.push(n); }
        if (!todo.length) { c.println('No packages marked for removal.\nDependencies resolved.\nNothing to do.\nComplete!'); return 0; }
        c.println('Dependencies resolved.');
        table('Removing', todo);
        if (!await confirm()) return 1;
        for (const n of todo) { OS.removePackageFiles(c.fs, n); delete installed[n]; c.println('  Erasing          : ' + n + '-' + OS.PACKAGES[n].v + '.' + os.el + '.x86_64'); await c.sleep(120); }
        OS.setInstalled(c.fs, installed);
        c.println('\nRemoved:\n  ' + todo.join('\n  ') + '\n\nComplete!');
        return 0;
      }
      case 'list': {
        meta();
        const which = names[0];
        if (which === 'installed' || !which || which === '--installed') {
          c.println('Installed Packages');
          for (const n of Object.keys(installed).sort()) c.println(U.pad(n + '.x86_64', 40, true) + ' ' + U.pad(installed[n], 28, true) + ' @lab-' + repoName(n));
        }
        if (which === 'available' || !which) {
          c.println('Available Packages');
          for (const n of Object.keys(OS.PACKAGES).filter(n => !installed[n]).sort()) c.println(U.pad(n + '.x86_64', 40, true) + ' ' + U.pad(OS.PACKAGES[n].v + '.' + os.el, 28, true) + ' lab-' + repoName(n));
        }
        if (which && !['installed', 'available', '--installed'].includes(which)) {
          const re = U.globToRegex(which);
          for (const n of Object.keys(OS.PACKAGES).filter(n => re.test(n))) c.println(U.pad(n + '.x86_64', 40, true) + ' ' + U.pad(OS.PACKAGES[n].v + '.' + os.el, 28, true) + ' ' + (installed[n] ? '@' : '') + 'lab-' + repoName(n));
        }
        return 0;
      }
      case 'search': {
        meta();
        const q = (names[0] || '').toLowerCase();
        const hits = Object.entries(OS.PACKAGES).filter(([n, p]) => n.includes(q) || p.desc.toLowerCase().includes(q));
        if (!hits.length) { c.println('No matches found.'); return 1; }
        c.println('======================== Name & Summary Matched: ' + q + ' ========================');
        for (const [n, p] of hits) c.println(n + '.x86_64 : ' + p.desc);
        return 0;
      }
      case 'info': {
        for (const raw of names) {
          const n = resolveName(raw); if (!n) { c.println('Error: No matching Packages to list'); return 1; }
          const p = OS.PACKAGES[n];
          c.println((installed[n] ? 'Installed Packages' : 'Available Packages') + '\nName         : ' + n + '\nVersion      : ' + p.v.split('-')[0] + '\nRelease      : ' + p.v.split('-')[1] + '.' + os.el + '\nArchitecture : x86_64\nSize         : ' + p.size.toFixed(1) + ' M\nRepository   : ' + (installed[n] ? '@System' : 'lab-' + repoName(n)) + '\nSummary      : ' + p.desc + '\nLicense      : (ver paquete original)\n');
        }
        return 0;
      }
      case 'provides': case 'whatprovides': {
        meta();
        const q = P.basename(names[0] || '');
        const hits = Object.entries(OS.PACKAGES).filter(([n, p]) => (p.cmds || []).includes(q) || (p.jvm && ['java', 'keytool', 'jar'].includes(q)));
        if (!hits.length) { c.println('Error: No matches found. If searching for a file, try specifying the full path or using a wildcard prefix ("*/") at the beginning.'); return 1; }
        for (const [n, p] of hits) c.println(n + '-' + p.v + '.' + os.el + '.x86_64 : ' + p.desc + '\nRepo        : lab-' + repoName(n) + '\nMatched from:\nFilename    : /usr/bin/' + q + '\n');
        return 0;
      }
      case 'update': case 'upgrade': case 'check-update': {
        if (sub !== 'check-update' && needRoot()) return 1;
        meta(); c.println('Dependencies resolved.\nNothing to do.\nComplete!'); return 0;
      }
      case 'repolist': c.println('repo id                            repo name\nlab-appstream                      Lab AppStream (repositorio local simulado)\nlab-baseos                         Lab BaseOS (repositorio local simulado)'); return 0;
      case 'clean': c.println('0 files removed'); return 0;
      case 'makecache': meta(); c.println('Metadata cache created.'); return 0;
      case 'history': c.out(c.fs.read('/var/log/dnf.log') || 'No transactions\n'); return 0;
      default: c.println('usage: dnf [options] COMMAND\n\nList of Main Commands:\n\ninstall     install a package or packages on your system\nremove      remove a package or packages from your system\nlist        list a package or groups of packages\nsearch      search package details for the given string\ninfo        display details about a package or group of packages\nprovides    find what package provides the given value\nupdate      upgrade a package or packages on your system\nrepolist    display the configured software repositories'); return sub ? 1 : 0;
    }
  };
  C.yum = C.dnf;
  C.rpm = (c) => {
    const installed = OS.installedList(c.fs);
    const a = c.args;
    if (a[0] === '-qa' || (a.includes('-q') && a.includes('-a'))) { for (const n of Object.keys(installed).sort()) c.println(n + '-' + installed[n] + '.x86_64'); return 0; }
    if (a[0] === '-q' || a[0] === '-qi') {
      let st = 0;
      for (const n of a.slice(1)) { if (installed[n]) c.println(n + '-' + installed[n] + '.x86_64'); else { c.println('package ' + n + ' is not installed'); st = 1; } }
      return st;
    }
    if (a[0] === '-qf') { const f = a[1]; const b = P.basename(c.fs.tryLookup(c.resolve(f)) ? c.fs.realpath(c.resolve(f)) : f); const hit = Object.entries(OS.PACKAGES).find(([n, p]) => installed[n] && ((p.cmds || []).includes(b) || (p.jvm && f.includes(p.jvm.dir)))); if (!hit) { c.println('file ' + f + ' is not owned by any package'); return 1; } c.println(hit[0] + '-' + installed[hit[0]] + '.x86_64'); return 0; }
    if (a[0] === '-ql') { const p = OS.PACKAGES[a[1]]; if (!p || !installed[a[1]]) { c.println('package ' + a[1] + ' is not installed'); return 1; } for (const x of p.cmds || []) c.println('/usr/bin/' + x); if (p.jvm) c.println('/usr/lib/jvm/' + p.jvm.dir + '/bin/java'); return 0; }
    if (/^-(i|U|e)/.test(a[0] || '')) return c.fail('use dnf para instalar/eliminar paquetes en el laboratorio');
    return c.fail('usage: rpm -qa | -q PAQUETE | -qf ARCHIVO | -ql PAQUETE');
  };
  C.alternatives = async (c) => {
    const javas = Object.values(OS.PACKAGES).filter(p => p.jvm && c.fs.exists('/usr/lib/jvm/' + p.jvm.dir + '/bin/java'));
    const cur = c.fs.tryLookup('/etc/alternatives/java', { follow: false });
    const curT = cur ? cur.node.tg : '';
    if (c.args[0] === '--display' || c.args[0] === '--list') {
      if (c.args[0] === '--list') { c.println('java\tmanual\t' + curT); return 0; }
      c.println('java - status is manual.\n link currently points to ' + curT);
      for (const p of javas) c.println('/usr/lib/jvm/' + p.jvm.dir + '/bin/java - family ' + p.jvm.dir + ' priority ' + p.jvm.major * 10000);
      return 0;
    }
    if (c.args[0] === '--config' && c.args[1] === 'java') {
      if (c.cred.uid !== 0) return c.fail('alternatives: cannot access /var/lib/alternatives/java.new: Permission denied', 2);
      if (!javas.length) { c.println('There is 0 program that provides \'java\'.'); return 2; }
      c.println('\nThere ' + (javas.length === 1 ? 'is 1 program' : 'are ' + javas.length + ' programs') + ' which provide \'java\'.\n\n  Selection    Command\n-----------------------------------------------');
      javas.forEach((p, i) => { const t = '/usr/lib/jvm/' + p.jvm.dir + '/bin/java'; c.println((t === curT ? '*+' : '  ') + ' ' + (i + 1) + '           ' + p.jvm.dir + '.x86_64 (' + t + ')'); });
      const ans = c.term ? await c.prompt('\nEnter to keep the current selection[+], or type selection number: ') : '';
      const k = parseInt(ans, 10);
      if (k >= 1 && k <= javas.length) { c.fs.unlink('/etc/alternatives/java'); c.fs.symlink('/usr/lib/jvm/' + javas[k - 1].jvm.dir + '/bin/java', '/etc/alternatives/java'); }
      return 0;
    }
    if (c.args[0] === '--set' && c.args[1] === 'java' && c.args[2]) {
      if (c.cred.uid !== 0) return c.fail('Permission denied', 2);
      if (!c.fs.exists(c.args[2])) return c.fail(c.args[2] + ' has not been configured as an alternative for java', 2);
      c.fs.unlink('/etc/alternatives/java'); c.fs.symlink(c.args[2], '/etc/alternatives/java');
      return 0;
    }
    return c.fail('usage: alternatives --config java | --display java | --set java RUTA', 2);
  };
  C['update-alternatives'] = C.alternatives;

  // ---------------- tar / zip / unzip / gzip / jar ----------------
  C.tar = (c) => {
    let args = c.args.slice();
    if (args[0] && !args[0].startsWith('-') && /^[cxtvzfjpC]+$/.test(args[0])) args[0] = '-' + args[0];
    const { opts, rest } = getopt(args, { flags: 'cxtvzjpJ', values: 'fC', long: { create: 'c', extract: 'x', list: 't', verbose: 'v', gzip: 'z', file: 'f=', directory: 'C=' } });
    if (!opts.f) return c.fail('Refusing to read archive contents from terminal (missing -f option?)', 2);
    const file = c.resolve(opts.f);
    const baseDir = opts.C ? c.resolve(opts.C) : c.sh.cwd;
    if (opts.c) {
      if (!rest.length) return c.fail('Cowardly refusing to create an empty archive', 2);
      try {
        const entries = L.archive.create(c.fs, file, opts.z ? 'tar.gz' : 'tar', baseDir, rest, c.cred);
        if (opts.v) for (const e of entries) c.println(e.p + (e.t === 'd' ? '/' : ''));
      } catch (e) { return c.fail(e.message, 2); }
      return 0;
    }
    let data;
    try { data = c.fs.read(file, c.cred); } catch (e) { return c.fail(opts.f + ': Cannot open: ' + e.message + '\ntar: Error is not recoverable: exiting now', 2); }
    const a = L.archive.decode(data);
    if (!a || !/tar/.test(a.format)) { c.err((opts.z ? '\ngzip: stdin: not in gzip format\n' : '') + 'tar: This does not look like a tar archive\ntar: Exiting with failure status due to previous errors\n'); return 2; }
    if (opts.t) { for (const e of a.entries) c.println(opts.v ? L.fsutil.modeString({ t: e.t, m: e.m }) + ' root/root ' + U.pad(e.vs || (e.d || '').length, 9) + ' ' + U.lsDate(e.mt || Date.now()) + ' ' + e.p : e.p + (e.t === 'd' ? '/' : '')); return 0; }
    if (opts.x) {
      const filter = rest.length ? (p) => rest.some(r => p === r || p.startsWith(r.replace(/\/$/, '') + '/')) : null;
      try {
        const done = L.archive.extract(c.fs, baseDir, a, c.cred, { filter, owner: c.cred });
        if (opts.v) for (const e of done) c.println(e.p + (e.t === 'd' ? '/' : ''));
      } catch (e) { return c.fail((e.path || '') + ': ' + e.message, 2); }
      return 0;
    }
    return c.fail('You must specify one of the \'-Acdtrux\', \'--delete\' or \'--test-label\' options', 2);
  };
  C.zip = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rqv9' });
    if (rest.length < 2) return c.fail('zip error: Nothing to do!', 12);
    const file = c.resolve(/\.\w+$/.test(rest[0]) ? rest[0] : rest[0] + '.zip');
    try {
      const entries = L.archive.create(c.fs, file, 'zip', c.sh.cwd, opts.r ? rest.slice(1) : rest.slice(1).filter(f => !c.fs.isDir(c.resolve(f))), c.cred);
      if (!opts.q) for (const e of entries) c.println('  adding: ' + e.p + (e.t === 'd' ? '/' : '') + ' (' + (e.t === 'd' ? 'stored 0%' : 'deflated ' + (40 + e.p.length % 50) + '%') + ')');
    } catch (e) { return c.fail(e.message, 15); }
    return 0;
  };
  C.unzip = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'lqoonvt', values: 'd' });
    const f = rest[0];
    if (!f) { c.println('UnZip 6.00 of 20 April 2009, by Info-ZIP.\n\nUsage: unzip [-Z] [-opts[modifiers]] file[.zip] [list] [-x xlist] [-d exdir]'); return 0; }
    let data, path = c.resolve(f);
    if (!c.fs.exists(path) && c.fs.exists(path + '.zip')) path += '.zip';
    try { data = c.fs.read(path, c.cred); } catch (e) { c.println('unzip:  cannot find or open ' + f + ', ' + f + '.zip or ' + f + '.ZIP.'); return 9; }
    const a = L.archive.decode(data);
    if (!a || /tar/.test(a.format)) { c.println('Archive:  ' + f + '\n  End-of-central-directory signature not found.  Either this file is not\n  a zipfile, or it constitutes one disk of a multi-part archive.'); return 9; }
    if (opts.l || opts.v) {
      c.println('Archive:  ' + f + '\n  Length      Date    Time    Name\n---------  ---------- -----   ----');
      let tot = 0;
      for (const e of a.entries) { const s = e.t === 'f' ? (e.vs || (e.d || '').length) : 0; tot += s; c.println(U.pad(s, 9) + '  ' + new Date(e.mt || Date.now()).toISOString().slice(0, 10) + ' ' + U.clock(e.mt || Date.now()).slice(0, 5) + '   ' + e.p + (e.t === 'd' ? '/' : '')); }
      c.println('---------                     -------\n' + U.pad(tot, 9) + '                     ' + a.entries.length + ' files');
      return 0;
    }
    if (opts.t) { c.println('No errors detected in compressed data of ' + f + '.'); return 0; }
    const dest = opts.d ? c.resolve(opts.d) : c.sh.cwd;
    if (!opts.q) c.println('Archive:  ' + f);
    try {
      if (!c.fs.exists(dest)) c.fs.mkdir(dest, { parents: true, cred: c.cred });
      const need = a.entries.reduce((x, e) => x + (e.vs || (e.d || '').length), 0);
      if (need > c.fs.free()) { c.println('error:  cannot create ' + a.entries[0].p + '\n        No space left on device'); return 50; }
      let n = 0;
      for (const e of a.entries) {
        const abs = P.resolve(dest, e.p);
        if (e.t === 'f' && c.fs.exists(abs) && !opts.o && !opts.n && c.term) {
          const ans = await c.prompt('replace ' + P.join(opts.d || '.', e.p).replace(/^\.\//, '') + '? [y]es, [n]o, [A]ll, [N]one, [r]ename: ');
          if (ans === 'A') opts.o = 1; else if (ans === 'N') { opts.n = 1; continue; } else if (!/^y/.test(ans || '')) continue;
        }
        if (e.t === 'f' && opts.n && c.fs.exists(abs)) continue;
        L.archive.extract(c.fs, dest, { entries: [e] }, c.cred, { owner: c.cred });
        if (!opts.q) c.println((e.t === 'd' ? '   creating: ' : '  inflating: ') + P.join(opts.d || '', e.p).replace(/^\.?\//, opts.d && opts.d.startsWith('/') ? '/' : '') + (e.t === 'd' ? '/' : ''));
        if (++n % 25 === 0) await c.sleep(1);
      }
    } catch (e) { c.println('checkdir error:  cannot create ' + (e.path || dest) + '\n                 ' + e.message); return 50; }
    return 0;
  };
  C.gzip = (c) => {
    const d = c.args.includes('-d') || c.name === 'gunzip';
    let st = 0;
    for (const f of c.args.filter(a => !a.startsWith('-'))) {
      const p = c.resolve(f);
      try {
        if (d) {
          const data = c.fs.read(p, c.cred);
          const a = L.archive.decode(data);
          if (!a || a.format !== 'gz') { c.err('gzip: ' + f + ': not in gzip format\n'); st = 1; continue; }
          c.fs.write(p.replace(/\.gz$/, ''), a.entries[0].d || '', { cred: c.cred });
          c.fs.unlink(p, c.cred);
        } else {
          const data = c.fs.read(p, c.cred);
          c.fs.write(p + '.gz', L.archive.encode('gz', [{ p: P.basename(p), t: 'f', m: 0o644, d: data }]), { cred: c.cred, bin: true });
          c.fs.unlink(p, c.cred);
        }
      } catch (e) { c.err('gzip: ' + f + ': ' + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.gunzip = C.gzip;
  C.zcat = (c) => { for (const f of c.args) { const a = L.archive.decode(c.fs.read(c.resolve(f), c.cred)); if (a && a.format === 'gz') c.out(a.entries[0].d || ''); else return c.fail(f + ': not in gzip format'); } return 0; };
  C.jar = (c) => {
    let args = c.args.slice();
    if (args[0] && !args[0].startsWith('-')) args[0] = '-' + args[0];
    const mode = args[0] || '';
    const verbose = mode.includes('v');
    const fIdx = mode.includes('f') ? 1 : -1;
    const file = fIdx > 0 ? args[1] : null;
    let rest = args.slice(fIdx > 0 ? 2 : 1);
    if (!file) return c.fail('Usage: jar {ctxu}[vfm0Me] [jar-file] [manifest-file] [entry-point] [-C dir] files ...', 1);
    const p = c.resolve(file);
    if (mode.includes('c')) {
      let base = c.sh.cwd; const items = [];
      for (let i = 0; i < rest.length; i++) { if (rest[i] === '-C') { base = c.resolve(rest[++i]); items.push(...(rest[++i] === '.' ? c.fs.readdir(base, c.cred) : [rest[i]])); } else items.push(rest[i]); }
      try {
        const entries = L.archive.create(c.fs, p, /\.war$/.test(file) ? 'war' : /\.ear$/.test(file) ? 'ear' : 'jar', base, items, c.cred);
        if (verbose) { c.println('added manifest'); for (const e of entries) c.println('adding: ' + e.p + (e.t === 'd' ? '/' : '') + '(in = ' + (e.d || '').length + ') (out= ' + Math.round((e.d || '').length * 0.5) + ')(deflated 50%)'); }
      } catch (e) { return c.fail(e.message); }
      return 0;
    }
    let data;
    try { data = c.fs.read(p, c.cred); } catch (e) { return c.fail(file + ' (' + e.message + ')'); }
    const a = L.archive.decode(data);
    if (!a) return c.fail('java.util.zip.ZipException: zip END header not found');
    if (mode.includes('t')) { for (const e of a.entries) c.println(e.p + (e.t === 'd' ? '/' : '')); return 0; }
    if (mode.includes('x')) { L.archive.extract(c.fs, c.sh.cwd, a, c.cred, { owner: c.cred }); if (verbose) for (const e of a.entries) c.println((e.t === 'd' ? '  created: ' : ' inflated: ') + e.p); return 0; }
    return c.fail('opción no soportada');
  };

  // ---------------- Java ----------------
  function javaFor(c) {
    const node = c.path ? c.fs.stat(c.path) : null;
    const major = node && node.jvm;
    return Object.values(OS.PACKAGES).find(p => p.jvm && p.jvm.major === major) || null;
  }
  C.java = (c) => {
    const pkg = javaFor(c);
    if (!pkg) return c.fail('java: JDK no encontrado');
    const j = pkg.jvm;
    if (c.args.includes('-version') || c.args.includes('--version')) {
      const text = j.major === 8
        ? 'openjdk version "' + j.full + '"\nOpenJDK Runtime Environment (build ' + j.build + ')\nOpenJDK 64-Bit Server VM (build 25.412-b08, mixed mode)\n'
        : 'openjdk version "' + j.full + '" 2024-04-16 LTS\nOpenJDK Runtime Environment (Red_Hat-' + j.full + '.0.9-1) (build ' + j.build + ')\nOpenJDK 64-Bit Server VM (Red_Hat-' + j.full + '.0.9-1) (build ' + j.build + ', mixed mode, sharing)\n';
      if (c.args.includes('--version')) c.out(text); else c.err(text);
      return 0;
    }
    if (c.args.includes('-XshowSettings:properties')) { c.err('Property settings:\n    java.home = /usr/lib/jvm/' + j.dir + '\n    java.version = ' + j.full + '\n    java.vendor = Red Hat, Inc.\n'); return 0; }
    const jarIdx = c.args.indexOf('-jar');
    if (jarIdx >= 0) {
      const f = c.args[jarIdx + 1];
      if (!f) return c.fail('Error: -jar requires jar file specification', 1);
      if (!c.fs.exists(c.resolve(f))) { c.err('Error: Unable to access jarfile ' + f + '\n'); return 1; }
      if (/jboss-modules\.jar$/.test(f)) { c.err('Use bin/standalone.sh para iniciar JBoss en el laboratorio.\n'); return 1; }
      c.err('no main manifest attribute, in ' + f + '\n');
      return 1;
    }
    c.err('Usage: java [options] <mainclass> [args...]\n           (to execute a class)\n   or  java [options] -jar <jarfile> [args...]\n           (to execute a jar file)\n');
    return c.args.length ? 1 : 1;
  };
  C.javac = (c) => { const pkg = javaFor(c); c.println('javac ' + (pkg ? pkg.jvm.full : '')); return 0; };
  const javaProcs = (c) => Array.from(c.vm.procs.values()).filter(p => p.kind === 'java' && (c.cred.uid === 0 || p.user === c.user));
  C.jps = (c) => {
    for (const p of javaProcs(c)) c.println(p.pid + (c.args.includes('-l') ? ' ' + p.server.home + '/jboss-modules.jar' : ' jboss-modules.jar') + (c.args.includes('-v') ? ' -D[Standalone] ' + p.server.javaOpts : ''));
    c.println((c.vm.nextPid + 1) + ' Jps');
    return 0;
  };
  function findJava(c, pid) {
    const p = c.vm.proc(+pid);
    if (!p || p.kind !== 'java') { c.err(pid + ': Unable to open socket file /proc/' + pid + '/root/tmp/.java_pid' + pid + ': target process ' + pid + ' doesn\'t respond within 10500ms or HotSpot VM not loaded\n'); return null; }
    if (c.cred.uid !== 0 && p.user !== c.user) { c.err(pid + ': well-known file /tmp/.java_pid' + pid + ' is not secure: file should be owned by the current user (which is ' + c.cred.uid + ') but is owned by ' + OS.users.byName(c.fs, p.user).uid + '\n'); return null; }
    return p;
  }
  C.jstack = (c) => {
    const pid = c.args.filter(a => !a.startsWith('-'))[0];
    const p = findJava(c, pid); if (!p) return 1;
    const srv = p.server;
    c.println(new Date().toISOString().replace('T', ' ').slice(0, 19) + '\nFull thread dump OpenJDK 64-Bit Server VM (' + (srv.java ? srv.java.build : '') + ' mixed mode, sharing):\n');
    const thr = (name, state, frames, daemon) => { c.println('"' + name + '" #' + Math.floor(Math.random() * 300) + (daemon ? ' daemon' : '') + ' prio=5 os_prio=0 cpu=' + (Math.random() * 200).toFixed(2) + 'ms elapsed=' + ((Date.now() - p.start) / 1000).toFixed(2) + 's tid=0x00007f' + U.md5(name).slice(0, 10) + ' nid=0x' + (p.pid + name.length).toString(16) + ' ' + (state === 'RUNNABLE' ? 'runnable' : 'waiting on condition') + '  [0x00007f' + U.md5(name).slice(10, 20) + ']\n   java.lang.Thread.State: ' + state + '\n' + frames.map(f => '\tat ' + f).join('\n') + '\n'); };
    thr('main', 'WAITING (parking)', ['jdk.internal.misc.Unsafe.park(java.base@' + (srv.java ? srv.java.full : '') + '/Native Method)', 'org.jboss.as.server.Main.main(Main.java:134)', 'org.jboss.modules.Main.main(Main.java:604)']);
    thr('Reference Handler', 'RUNNABLE', ['java.lang.ref.Reference.waitForReferencePendingList(java.base/Native Method)'], true);
    thr('default I/O-1', 'RUNNABLE', ['sun.nio.ch.EPoll.wait(java.base/Native Method)', 'org.xnio.nio.WorkerThread.run(WorkerThread.java:552)'], false);
    thr('DeploymentScanner-threads - 1', 'TIMED_WAITING (parking)', ['java.util.concurrent.ScheduledThreadPoolExecutor$DelayedWorkQueue.take(java.base/ScheduledThreadPoolExecutor.java:1182)'], false);
    thr('MSC service thread 1-1', 'WAITING (parking)', ['org.jboss.msc.service.ServiceContainerImpl$ServiceThread.run(ServiceContainerImpl.java:1348)'], false);
    for (const d of srv.deployments.values()) if (d.status === 'OK') thr('default task-' + (1 + d.name.length), 'WAITING (parking)', ['org.jboss.threads.EnhancedQueueExecutor$ThreadBody.run(EnhancedQueueExecutor.java:1545)', 'io.undertow.server.HttpServerExchange$ReadDispatchChannel (' + d.contextRoot + ')'], false);
    c.println('JNI global refs: 42, weak refs: 0\n');
    return 0;
  };
  C.jcmd = (c) => {
    const [pid, cmd] = c.args;
    if (!pid) { return C.jps(c); }
    const p = findJava(c, pid); if (!p) return 1;
    const srv = p.server;
    c.println(pid + ':');
    if (cmd === 'GC.heap_info') { c.println(' garbage-first heap   total ' + srv.xms * 1024 + 'K, used ' + (srv.heapUsed || 90) * 1024 + 'K\n  region size 1024K, ' + Math.round((srv.heapUsed || 90) / 2) + ' young (' + Math.round((srv.heapUsed || 90) / 2) * 1024 + 'K), 4 survivors (4096K)\n Metaspace       used 98765K, committed 99840K, reserved 1138688K'); return 0; }
    if (cmd === 'VM.flags') { c.println(srv.javaOpts.split(/\s+/).filter(x => /^-X/.test(x)).join(' ') + ' -XX:+UseG1GC'); return 0; }
    if (cmd === 'VM.version') { c.println('OpenJDK 64-Bit Server VM version ' + (srv.java ? srv.java.build : '') + '\nJDK ' + (srv.java ? srv.java.full : '')); return 0; }
    if (cmd === 'Thread.print') return C.jstack(Object.assign({}, c, { args: [pid] }));
    if (cmd === 'GC.run') { srv.heapUsed = Math.round((srv.heapUsed || 90) * 0.6); c.println('Command executed successfully'); return 0; }
    c.println('The following commands are available:\nGC.heap_info\nGC.run\nThread.print\nVM.flags\nVM.version\nhelp');
    return 0;
  };
  C.jmap = (c) => {
    const pid = c.args.filter(a => !a.startsWith('-'))[0];
    const p = findJava(c, pid); if (!p) return 1;
    const dump = c.args.find(a => a.startsWith('-dump:'));
    if (dump) { const f = /file=([^,\s]+)/.exec(dump); if (f) { c.fs.write(c.resolve(f[1]), '', { cred: c.cred, vsize: (p.server.heapUsed || 90) * 1048576, bin: true }); c.println('Dumping heap to ' + c.resolve(f[1]) + ' ...\nHeap dump file created [' + (p.server.heapUsed || 90) * 1048576 + ' bytes in 0.412 secs]'); } return 0; }
    c.println(' num     #instances         #bytes  class name (module)\n-------------------------------------------------------\n   1:        312045       29154872  [B (java.base)\n   2:        290001        6960024  java.lang.String (java.base)\n   3:         61234        5388592  java.lang.Class (java.base)\n   4:         98812        3162000  java.util.HashMap$Node (java.base)\nTotal       1204520      64982341');
    return 0;
  };
  // keytool: ver js/cmds/certs.js
})(globalThis.JLab = globalThis.JLab || {});
