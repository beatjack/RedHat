/*
 * Utilidades para comandos + builtins del shell (cd, export, alias, read...).
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util;
  const { ExitSignal, ReturnSignal, LoopSignal } = L.shsig;

  // getopt sencillo: spec = { flags: 'lahR', values: 'nC', long: { 'all': 'a', 'lines': 'n=' } }
  function getopt(args, spec) {
    const opts = {}, rest = [];
    const flags = spec.flags || '', values = spec.values || '', long = spec.long || {};
    let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (a === '--') { rest.push(...args.slice(i + 1)); break; }
      if (a.startsWith('--') && a.length > 2) {
        const [k, v] = a.slice(2).split(/=(.*)/s);
        const def = long[k];
        if (def === undefined) { opts._bad = a; continue; }
        const key = def.replace(/=$/, '');
        if (def.endsWith('=')) opts[key] = v !== undefined ? v : args[++i];
        else opts[key] = true;
        continue;
      }
      if (a.startsWith('-') && a.length > 1 && !(spec.numeric && /^-\d+$/.test(a))) {
        for (let j = 1; j < a.length; j++) {
          const c = a[j];
          if (values.includes(c)) { opts[c] = a.slice(j + 1) || args[++i]; break; }
          if (flags.includes(c)) { opts[c] = (opts[c] || 0) + 1; continue; }
          opts._bad = '-' + c;
        }
        continue;
      }
      if (spec.numeric && /^-\d+$/.test(a)) { opts.num = +a.slice(1); continue; }
      if (spec.stopAtFirst) { rest.push(...args.slice(i)); break; }
      rest.push(a);
    }
    return { opts, rest };
  }

  function lines(text) {
    if (!text) return [];
    const l = text.split('\n');
    if (l[l.length - 1] === '') l.pop();
    return l;
  }

  const B = L.builtins;

  B.cd = async (c) => {
    const sh = c.sh;
    let target = c.args.filter(a => a !== '-L' && a !== '-P')[0];
    if (target === undefined) target = sh.getVar('HOME');
    if (target === '-') { target = sh.getVar('OLDPWD') || sh.cwd; c.println(target); }
    const p = sh.resolve(target);
    try {
      const r = c.fs.lookup(p, { cred: c.cred });
      if (r.node.t !== 'd') return c.fail(target + ': Not a directory');
      if (!c.fs.can(r.node, c.cred, 'x')) return c.fail(target + ': Permission denied');
      sh.setVar('OLDPWD', sh.cwd, true);
      sh.cwd = P.normalize(p);
      sh.env.PWD = sh.cwd;
      return 0;
    } catch (e) { c.err('-bash: cd: ' + target + ': ' + e.message + '\n'); return 1; }
  };
  B.pwd = (c) => { c.println(c.sh.cwd); return 0; };
  B.echo = (c) => {
    let args = c.args, nl = true, esc = false;
    while (args.length && /^-[neE]+$/.test(args[0])) {
      if (args[0].includes('n')) nl = false;
      if (args[0].includes('e')) esc = true;
      if (args[0].includes('E')) esc = false;
      args = args.slice(1);
    }
    let s = args.join(' ');
    if (esc) s = unescapeC(s);
    c.out(s + (nl ? '\n' : ''));
    return 0;
  };
  function unescapeC(s) {
    return s.replace(/\\(0[0-7]{0,3}|x[0-9a-fA-F]{1,2}|[abefnrtv\\c'"])/g, (m, e) => {
      if (e[0] === '0' && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 8));
      if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
      return { a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', c: '', "'": "'", '"': '"', '0': '\0' }[e] || m;
    });
  }
  B.printf = (c) => {
    if (!c.args.length) return c.fail('usage: printf format [arguments]', 2);
    const fmt = unescapeC(c.args[0]);
    let args = c.args.slice(1);
    let out = '';
    do {
      let used = 0;
      out += fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifxXoc%b])/g, (m, fl, w, pr, t) => {
        if (t === '%') return '%';
        const a = args[used++]; const v = a === undefined ? '' : a;
        let s;
        switch (t) {
          case 'd': case 'i': s = String(parseInt(v, 10) || 0); break;
          case 'f': s = (parseFloat(v) || 0).toFixed(pr !== undefined ? +pr : 6); break;
          case 'x': s = (parseInt(v, 10) || 0).toString(16); break;
          case 'X': s = (parseInt(v, 10) || 0).toString(16).toUpperCase(); break;
          case 'o': s = (parseInt(v, 10) || 0).toString(8); break;
          case 'c': s = v[0] || ''; break;
          case 'b': s = unescapeC(v); break;
          default: s = pr !== undefined ? v.slice(0, +pr) : v;
        }
        if (w) s = fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') && t !== 's' ? '0' : ' ');
        return s;
      });
      args = args.slice(used || args.length);
      if (!used) break;
    } while (args.length);
    c.out(out);
    return 0;
  };
  B.export = (c) => {
    const sh = c.sh;
    const args = c.args.filter(a => a !== '-n' && a !== '-p');
    if (!args.length) {
      for (const k of Array.from(sh.exported).sort()) if (sh.env[k] !== undefined) c.println('declare -x ' + k + '="' + sh.env[k] + '"');
      return 0;
    }
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a);
      if (!m) { c.err('-bash: export: `' + a + "': not a valid identifier\n"); return 1; }
      const v = m[2] !== undefined ? m[2] : (sh.getVar(m[1]) || '');
      if (c.args.includes('-n')) { sh.exported.delete(m[1]); continue; }
      sh.setVar(m[1], v, true);
    }
    return 0;
  };
  B.unset = (c) => { for (const a of c.args.filter(a => !a.startsWith('-'))) { c.sh.unsetVar(a); delete c.sh.funcs[a]; } return 0; };
  B.set = (c) => {
    const sh = c.sh;
    if (!c.args.length) {
      const all = Object.assign({}, sh.env, sh.vars);
      for (const k of Object.keys(all).sort()) c.println(k + '=' + all[k]);
      return 0;
    }
    for (const a of c.args) {
      if (a === '-x') sh.xtrace = true; else if (a === '+x') sh.xtrace = false;
      else if (a === '-e' || a === '+e' || a === '-u' || a === '+u' || a === '-o' || a === 'pipefail') { }
      else if (a === '--') { sh.positional = c.args.slice(c.args.indexOf('--') + 1); break; }
    }
    return 0;
  };
  B.alias = (c) => {
    const sh = c.sh;
    if (!c.args.length || c.args[0] === '-p') { for (const k of Object.keys(sh.aliases).sort()) c.println("alias " + k + "='" + sh.aliases[k] + "'"); return 0; }
    let st = 0;
    for (const a of c.args) {
      const m = /^([^=]+)=(.*)$/s.exec(a);
      if (m) sh.aliases[m[1]] = m[2];
      else if (sh.aliases[a] !== undefined) c.println("alias " + a + "='" + sh.aliases[a] + "'");
      else { c.err('-bash: alias: ' + a + ': not found\n'); st = 1; }
    }
    return st;
  };
  B.unalias = (c) => { for (const a of c.args) { if (a === '-a') c.sh.aliases = {}; else delete c.sh.aliases[a]; } return 0; };
  B.source = async (c) => {
    if (!c.args.length) return c.fail('filename argument required', 2);
    try { return await c.sh.source(c.args[0], c.args.slice(1), c.io); }
    catch (e) { if (e instanceof L.FsError) { c.err('-bash: ' + c.args[0] + ': ' + e.message + '\n'); return 1; } throw e; }
  };
  B['.'] = B.source;
  B.exit = (c) => { throw new ExitSignal(c.args[0] !== undefined ? (parseInt(c.args[0], 10) & 255) : c.sh.status); };
  B.logout = B.exit;
  B.return = (c) => { throw new ReturnSignal(c.args[0] !== undefined ? +c.args[0] : c.sh.status); };
  B.break = (c) => { throw new LoopSignal('break', +(c.args[0] || 1)); };
  B.continue = (c) => { throw new LoopSignal('continue', +(c.args[0] || 1)); };
  B.shift = (c) => { c.sh.positional = c.sh.positional.slice(+(c.args[0] || 1)); return 0; };
  B.local = (c) => { for (const a of c.args) { const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (m) c.sh.setVar(m[1], m[2] || ''); } return 0; };
  B.declare = (c) => {
    const exp = c.args.includes('-x');
    const rest = c.args.filter(a => !a.startsWith('-'));
    if (!rest.length) return B.set(c);
    for (const a of rest) { const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a); if (m) c.sh.setVar(m[1], m[2] || '', exp); }
    return 0;
  };
  B.typeset = B.declare;
  B.readonly = B.declare;
  B.history = (c) => {
    const sh = c.sh;
    if (c.args[0] === '-c') { sh.history = []; try { c.fs.write(sh.cred.home + '/.bash_history', '', { cred: sh.cred }); } catch (e) { } return 0; }
    const n = c.args[0] ? +c.args[0] : sh.history.length;
    const start = Math.max(0, sh.history.length - n);
    sh.history.slice(start).forEach((h, i) => c.println(U.pad(start + i + 1, 5) + '  ' + h));
    return 0;
  };
  B.jobs = (c) => {
    for (const j of c.sh.jobs) c.println('[' + j.id + ']' + (j === c.sh.jobs[c.sh.jobs.length - 1] ? '+' : '-') + '  ' + (c.args.includes('-l') ? j.pid + ' ' : '') + U.pad(j.status, 22, true) + ' ' + j.cmd);
    return 0;
  };
  B.wait = async (c) => {
    const jobs = c.sh.jobs.filter(j => !j.done);
    for (const j of jobs) await Promise.race([j.promise, new Promise((_, rej) => { const fg = c.sh.fg; if (fg) (fg.waiters = fg.waiters || []).push(() => rej(new L.shsig.Abort())); })]);
    return 0;
  };
  B.fg = async (c) => {
    const j = c.sh.jobs.filter(j => !j.done).pop();
    if (!j) return c.fail('current: no such job');
    c.println(j.cmd);
    const fg = c.sh.fg;
    const onInt = () => { j.fg.aborted = true; (j.fg.waiters || []).forEach(w => w()); };
    if (fg) (fg.waiters = fg.waiters || []).push(onInt);
    await j.promise;
    j.reported = true;
    c.sh.jobs = c.sh.jobs.filter(x => x !== j);
    return j.code || 0;
  };
  B.bg = (c) => { const j = c.sh.jobs.filter(j => !j.done).pop(); if (!j) return c.fail('current: no such job'); c.println('[' + j.id + ']+ ' + j.cmd + ' &'); return 0; };
  B.disown = (c) => { c.sh.jobs = c.sh.jobs.filter(j => j.done); return 0; };
  B.read = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rs', values: 'pt' });
    let line;
    if (c.stdinTTY && c.term) {
      if (opts.p) c.out(opts.p);
      line = await c.term.readLine({ prompt: '', hidden: !!opts.s });
      if (line === null) return 1;
    } else {
      // lee una línea del stdin (se guarda el resto para siguientes read)
      const src = c.stdin;
      if (!src._lines) {
        const all = await src.readAll();
        src._lines = all.split('\n');
        if (src._lines[src._lines.length - 1] === '') src._lines.pop();
      }
      if (!src._lines.length) return 1;
      line = src._lines.shift();
      // conserva el stream para la siguiente lectura
      src.readAll = async () => '';
    }
    if (!opts.r) line = line.replace(/\\(.)/g, '$1');
    const names = rest.length ? rest : ['REPLY'];
    const fields = line.trim().split(/\s+/);
    names.forEach((n, i) => c.sh.setVar(n, i === names.length - 1 ? fields.slice(i).join(' ') : (fields[i] || '')));
    return 0;
  };
  B.type = (c) => {
    let st = 0;
    const all = c.args.includes('-a'), onlyPath = c.args.includes('-p') || c.args.includes('-P'), kind = c.args.includes('-t');
    for (const a of c.args.filter(x => !x.startsWith('-'))) {
      const found = [];
      if (!onlyPath) {
        if (c.sh.aliases[a] !== undefined) found.push(['alias', a + " is aliased to `" + c.sh.aliases[a] + "'"]);
        if (L.shparse.RESERVED.has(a)) found.push(['keyword', a + ' is a shell keyword']);
        if (c.sh.funcs[a]) found.push(['function', a + ' is a function']);
        if (B[a]) found.push(['builtin', a + ' is a shell builtin']);
      }
      const h = c.sh.hashTable && c.sh.hashTable.get(a);
      if (h && !all && !found.length) found.push(['file', a + ' is hashed (' + h.path + ')']);
      for (const p of c.sh.whichAll(a)) found.push(['file', onlyPath ? p : a + ' is ' + p]);
      if (!found.length) { if (!kind && !onlyPath) c.err('-bash: type: ' + a + ': not found\n'); st = 1; continue; }
      for (const [k, line] of (all ? found : found.slice(0, 1))) c.println(kind ? k : line);
    }
    return st;
  };
  B.hash = (c) => {
    const sh = c.sh;
    sh.hashTable = sh.hashTable || new Map();
    if (c.args[0] === '-r') { sh.hashTable.clear(); return 0; }
    if (c.args[0] === '-d') { for (const n of c.args.slice(1)) sh.hashTable.delete(n); return 0; }
    const names = c.args.filter(a => !a.startsWith('-'));
    if (names.length) {
      let st = 0;
      for (const n of names) { const p = sh.whichAll(n)[0]; if (!p) { c.err('-bash: hash: ' + n + ': not found\n'); st = 1; continue; } sh.hashTable.set(n, { path: p, hits: 0 }); }
      return st;
    }
    if (!sh.hashTable.size) { c.println('hash: hash table empty'); return 0; }
    c.println('hits\tcommand');
    for (const [, v] of sh.hashTable) c.println(U.pad(v.hits, 4) + '\t' + v.path);
    return 0;
  };
  // time: mide un comando (real / user / sys en la salida de error)
  B.time = async (c) => {
    const t0 = Date.now();
    let st = 0;
    if (c.args.length) st = await c.sh.execCommand(c.args, c.io);
    const real = (Date.now() - t0) / 1000;
    const f = (s) => Math.floor(s / 60) + 'm' + (s % 60).toFixed(3) + 's';
    const user = real * (0.02 + Math.random() * 0.05), sys = real * (0.01 + Math.random() * 0.03);
    c.err('\nreal\t' + f(real) + '\nuser\t' + f(Math.min(real, user + 0.001)) + '\nsys\t' + f(Math.min(real, sys + 0.001)) + '\n');
    return st;
  };
  // pila de directorios
  const tildify = (sh, p) => p === sh.cred.home ? '~' : p.startsWith(sh.cred.home + '/') ? '~' + p.slice(sh.cred.home.length) : p;
  const showDirs = (c) => c.println([c.sh.cwd].concat(c.sh.dirStack || []).map(p => tildify(c.sh, p)).join(' '));
  B.dirs = (c) => {
    const sh = c.sh; sh.dirStack = sh.dirStack || [];
    if (c.args.includes('-c')) { sh.dirStack = []; return 0; }
    const list = [sh.cwd].concat(sh.dirStack);
    if (c.args.includes('-v')) { list.forEach((p, i) => c.println(U.pad(i, 2) + '  ' + (c.args.includes('-l') ? p : tildify(sh, p)))); return 0; }
    if (c.args.includes('-p')) { list.forEach(p => c.println(c.args.includes('-l') ? p : tildify(sh, p))); return 0; }
    c.println(list.map(p => c.args.includes('-l') ? p : tildify(sh, p)).join(' '));
    return 0;
  };
  B.pushd = async (c) => {
    const sh = c.sh; sh.dirStack = sh.dirStack || [];
    const arg = c.args.filter(a => a !== '-n')[0];
    if (!arg) {
      if (!sh.dirStack.length) { c.err('-bash: pushd: no other directory\n'); return 1; }
      const top = sh.dirStack.shift(), here = sh.cwd;
      const r = await B.cd(Object.assign({}, c, { args: [top] }));
      if (r) { sh.dirStack.unshift(top); return r; }
      sh.dirStack.unshift(here); showDirs(c); return 0;
    }
    if (/^\+\d+$/.test(arg)) {
      const list = [sh.cwd].concat(sh.dirStack), n = +arg.slice(1);
      if (n >= list.length) { c.err('-bash: pushd: ' + arg + ': directory stack index out of range\n'); return 1; }
      const rot = list.slice(n).concat(list.slice(0, n));
      const r = await B.cd(Object.assign({}, c, { args: [rot[0]] })); if (r) return r;
      sh.dirStack = rot.slice(1); showDirs(c); return 0;
    }
    const here = sh.cwd;
    const r = await B.cd(Object.assign({}, c, { args: [arg] }));
    if (r) return r;
    sh.dirStack.unshift(here);
    showDirs(c);
    return 0;
  };
  B.popd = async (c) => {
    const sh = c.sh; sh.dirStack = sh.dirStack || [];
    if (!sh.dirStack.length) { c.err('-bash: popd: directory stack empty\n'); return 1; }
    const arg = c.args[0];
    if (arg && /^\+\d+$/.test(arg)) { const n = +arg.slice(1); if (n === 0) { const t = sh.dirStack.shift(); await B.cd(Object.assign({}, c, { args: [t] })); } else sh.dirStack.splice(n - 1, 1); showDirs(c); return 0; }
    const top = sh.dirStack.shift();
    const r = await B.cd(Object.assign({}, c, { args: [top] }));
    if (r) { sh.dirStack.unshift(top); return r; }
    showDirs(c);
    return 0;
  };
  B.command = async (c) => {
    if (c.args[0] === '-v') { const a = c.args[1]; if (B[a]) { c.println(a); return 0; } const p = c.sh.which(a); if (p) { c.println(p); return 0; } return 1; }
    return c.sh.execCommand(c.args, c.io);
  };
  B.builtin = (c) => c.sh.execCommand(c.args, c.io);
  B.eval = (c) => c.sh.run(c.args.join(' '), c.io);
  B.exec = async (c) => { if (!c.args.length) return 0; const st = await c.sh.execCommand(c.args, c.io); throw new ExitSignal(st); };
  B.true = () => 0;
  B.false = () => 1;
  B[':'] = () => 0;
  B.let = (c) => {
    let v = 0;
    for (const a of c.args) {
      const m = /^([A-Za-z_]\w*)\s*(\+\+|--|[-+*/%]?=)\s*(.*)$/.exec(a);
      if (m) {
        const cur = parseInt(c.sh.getVar(m[1]), 10) || 0;
        if (m[2] === '++') v = cur + 1; else if (m[2] === '--') v = cur - 1;
        else { const r = L.arith(m[3], c.sh); v = m[2] === '=' ? r : m[2] === '+=' ? cur + r : m[2] === '-=' ? cur - r : m[2] === '*=' ? cur * r : m[2] === '/=' ? Math.trunc(cur / r) : cur % r; }
        c.sh.setVar(m[1], String(v));
      } else v = L.arith(a, c.sh);
    }
    return v ? 0 : 1;
  };
  B.umask = (c) => { if (!c.args.length) c.println('0022'); return 0; };
  B.clear = (c) => { c.out('\x1b[2J\x1b[3J\x1b[H'); return 0; };
  B.reset = B.clear;
  B.times = (c) => { c.println('0m0.012s 0m0.004s\n0m0.230s 0m0.051s'); return 0; };
  B.getopts = () => 1;
  B.trap = () => 0;
  B.ulimit = (c) => {
    if (c.args.includes('-n')) c.println('1024');
    else if (c.args.includes('-a')) c.println('core file size          (blocks, -c) 0\nopen files                      (-n) 1024\nmax user processes              (-u) 7823\nstack size              (kbytes, -s) 8192');
    else c.println('unlimited');
    return 0;
  };

  // test / [ / [[
  function testExpr(c, a) {
    const fs = c.fs;
    const st = (p) => c.fs.tryLookup(c.resolve(p), { cred: c.cred });
    const lst = (p) => c.fs.tryLookup(c.resolve(p), { cred: c.cred, follow: false });
    const unary = {
      '-e': p => !!st(p), '-f': p => { const r = st(p); return !!r && r.node.t === 'f'; }, '-d': p => { const r = st(p); return !!r && r.node.t === 'd'; },
      '-L': p => { const r = lst(p); return !!r && r.node.t === 'l'; }, '-h': p => { const r = lst(p); return !!r && r.node.t === 'l'; },
      '-r': p => { const r = st(p); return !!r && fs.can(r.node, c.cred, 'r'); }, '-w': p => { const r = st(p); return !!r && fs.can(r.node, c.cred, 'w'); },
      '-x': p => { const r = st(p); return !!r && (r.node.t === 'd' ? fs.can(r.node, c.cred, 'x') : fs.can(r.node, c.cred, 'x')); },
      '-s': p => { const r = st(p); return !!r && fs.nodeSize(r.node) > 0 && r.node.t === 'f'; },
      '-z': s => s.length === 0, '-n': s => s.length > 0
    };
    function evalOr(i) { let [v, j] = evalAnd(i); while (a[j] === '-o' || a[j] === '||') { const [v2, k] = evalAnd(j + 1); v = v || v2; j = k; } return [v, j]; }
    function evalAnd(i) { let [v, j] = evalNot(i); while (a[j] === '-a' || a[j] === '&&') { const [v2, k] = evalNot(j + 1); v = v && v2; j = k; } return [v, j]; }
    function evalNot(i) { if (a[i] === '!') { const [v, j] = evalNot(i + 1); return [!v, j]; } return prim(i); }
    function prim(i) {
      if (a[i] === '(') { const [v, j] = evalOr(i + 1); return [v, j + 1]; }
      if (unary[a[i]] && i + 1 < a.length && !isBin(a[i + 1])) return [unary[a[i]](a[i + 1]), i + 2];
      if (isBin(a[i + 1])) {
        const l = a[i], op = a[i + 1], r = a[i + 2] === undefined ? '' : a[i + 2];
        let v;
        switch (op) {
          case '=': case '==': v = c.name === '[[' ? L.util.globToRegex(r).test(l) || l === r : l === r; break;
          case '!=': v = c.name === '[[' ? !(L.util.globToRegex(r).test(l) || l === r) : l !== r; break;
          case '=~': v = new RegExp(r).test(l); break;
          case '-eq': v = +l === +r; break; case '-ne': v = +l !== +r; break;
          case '-lt': v = +l < +r; break; case '-le': v = +l <= +r; break;
          case '-gt': v = +l > +r; break; case '-ge': v = +l >= +r; break;
          case '<': v = l < r; break; case '>': v = l > r; break;
          case '-nt': { const x = st(l), y = st(r); v = !!x && (!y || x.node.mt > y.node.mt); break; }
          case '-ot': { const x = st(l), y = st(r); v = !!y && (!x || x.node.mt < y.node.mt); break; }
        }
        if ((op.startsWith('-') && ['-eq', '-ne', '-lt', '-le', '-gt', '-ge'].includes(op)) && (!/^-?\d+$/.test(l) || !/^-?\d+$/.test(r))) throw new Error((/^-?\d+$/.test(l) ? r : l) + ': integer expression expected');
        return [v, i + 3];
      }
      return [a[i] !== undefined && a[i] !== '', i + 1];
    }
    function isBin(x) { return ['=', '==', '!=', '=~', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '<', '>', '-nt', '-ot'].includes(x); }
    if (!a.length) return false;
    return evalOr(0)[0];
  }
  B.test = (c) => { try { return testExpr(c, c.args) ? 0 : 1; } catch (e) { c.err('-bash: test: ' + e.message + '\n'); return 2; } };
  B['['] = (c) => {
    if (c.args[c.args.length - 1] !== ']') { c.err("-bash: [: missing `]'\n"); return 2; }
    try { return testExpr(c, c.args.slice(0, -1)) ? 0 : 1; } catch (e) { c.err('-bash: [: ' + e.message + '\n'); return 2; }
  };
  B['[['] = (c) => {
    if (c.args[c.args.length - 1] !== ']]') { c.err("-bash: syntax error: missing `]]'\n"); return 2; }
    try { return testExpr(c, c.args.slice(0, -1)) ? 0 : 1; } catch (e) { c.err('-bash: [[: ' + e.message + '\n'); return 2; }
  };
  B.help = (c) => L.cmds.__help(c);

  L.cmdutil = { getopt, lines, unescapeC, testExpr };
})(globalThis.JLab = globalThis.JLab || {});
