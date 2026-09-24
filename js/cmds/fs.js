/*
 * Comandos de sistema de archivos: ls, mkdir, rm, cp, mv, touch, cat, head,
 * tail (-f), ln, stat, file, du, df, tree, chmod, chown, chgrp, find, ...
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds;
  const { getopt, lines } = L.cmdutil;
  const { modeString, applySymbolicMode } = L.fsutil;

  // Colores estilo ls --color
  function colorName(n, name, fs, path) {
    if (n.t === 'd') return (n.m & 0o1002) === 0o1002 ? '\x1b[30;42m' + name + '\x1b[0m' : '\x1b[1;34m' + name + '\x1b[0m';
    if (n.t === 'l') return '\x1b[1;36m' + name + '\x1b[0m';
    if (n.m & 0o4000) return '\x1b[37;41m' + name + '\x1b[0m';
    if (n.m & 0o111) return '\x1b[1;32m' + name + '\x1b[0m';
    if (/\.(zip|tar|gz|tgz|war|ear|jar|rpm)$/.test(name)) return '\x1b[1;31m' + name + '\x1b[0m';
    return name;
  }

  C.ls = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'lahRtr1dFiSAn', long: { all: 'a', 'human-readable': 'h', color: 'color', 'color=auto': 'color', 'almost-all': 'A', recursive: 'R', directory: 'd' } });
    if (opts._bad && !/^--color/.test(opts._bad)) return c.fail("invalid option -- '" + opts._bad.replace(/^-+/, '') + "'\nTry 'ls --help' for more information.", 2);
    const fs = c.fs;
    const color = c.isTTY;
    const targets = rest.length ? rest : ['.'];
    let st = 0;
    const files = [], dirs = [];
    for (const t of targets) {
      const p = c.resolve(t);
      const r = fs.tryLookup(p, { cred: c.cred, follow: !(opts.l || opts.d) || true });
      const lr = fs.tryLookup(p, { cred: c.cred, follow: false });
      if (!r && !lr) {
        let msg = 'No such file or directory';
        try { fs.lookup(p, { cred: c.cred }); } catch (e) { msg = e.message; }
        c.err("ls: cannot access '" + t + "': " + msg + '\n'); st = 2; continue;
      }
      const node = (opts.l && lr && lr.node.t === 'l') ? lr.node : (r || lr).node;
      if (node.t === 'd' && !opts.d) dirs.push([t, p]); else files.push([t, p, node]);
    }
    const fmtEntries = (entries, dirPath) => {
      // entries: [name, node, fullpath]
      const sortKey = opts.t ? (a, b) => b[1].mt - a[1].mt : opts.S ? (a, b) => fs.nodeSize(b[1]) - fs.nodeSize(a[1]) : (a, b) => a[0].replace(/^\./, '').localeCompare(b[0].replace(/^\./, ''));
      entries.sort(sortKey);
      if (opts.r) entries.reverse();
      if (opts.l || opts.n) {
        let total = 0;
        const rows = entries.map(([name, n, full]) => {
          const size = fs.nodeSize(n);
          total += Math.ceil(size / 4096) * 4;
          const us = opts.n ? String(n.u) : c.userName(n.u), gs = opts.n ? String(n.g) : c.groupName(n.g);
          let disp = color ? colorName(n, name, fs, full) : name;
          if (n.t === 'l') disp += ' -> ' + n.tg;
          return [modeString(n) + '.', n.t === 'd' ? String(2 + Object.values(n.c).filter(x => x.t === 'd').length) : '1', us, gs, opts.h ? U.human(size) : String(size), U.lsDate(n.mt), disp];
        });
        const w = [0, 1, 2, 3, 4].map(i => Math.max(0, ...rows.map(r => r[i].length)));
        if (dirPath !== null) c.println('total ' + (opts.h ? U.human(total * 1024) : total));
        for (const r of rows) c.println(r[0] + ' ' + U.pad(r[1], w[1]) + ' ' + U.pad(r[2], w[2], true) + ' ' + U.pad(r[3], w[3], true) + ' ' + U.pad(r[4], w[4]) + ' ' + r[5] + ' ' + r[6]);
        return;
      }
      const names = entries.map(([name, n, full]) => (opts.F ? name + (n.t === 'd' ? '/' : n.t === 'l' ? '@' : (n.m & 0o111) ? '*' : '') : name));
      if (opts['1'] || !c.isTTY) { entries.forEach(([name, n], i) => c.println(color ? colorName(n, names[i], fs) : names[i])); return; }
      if (!names.length) return;
      const cols = c.term ? c.term.cols : 80;
      const wmax = Math.max(...names.map(n => n.length)) + 2;
      const per = Math.max(1, Math.floor(cols / wmax));
      const rowsN = Math.ceil(names.length / per);
      for (let r = 0; r < rowsN; r++) {
        let line = '';
        for (let k = 0; k < per; k++) {
          const idx = k * rowsN + r;
          if (idx >= names.length) continue;
          const nm = names[idx];
          const shown = color ? colorName(entries[idx][1], nm, fs) : nm;
          line += shown + (k < per - 1 && (k + 1) * rowsN + r < names.length ? ' '.repeat(wmax - nm.length) : '');
        }
        c.println(line);
      }
    };
    if (files.length) fmtEntries(files.map(([t, p, n]) => [t, n, p]), null);
    const listDir = (t, p, first) => {
      let names;
      try { names = fs.readdir(p, c.cred); } catch (e) { c.err("ls: cannot open directory '" + t + "': " + e.message + '\n'); st = 2; return; }
      if (!opts.a && !opts.A) names = names.filter(n => !n.startsWith('.'));
      const entries = names.map(n => [n, fs.lstat(p === '/' ? '/' + n : p + '/' + n), (p === '/' ? '' : p) + '/' + n]);
      if (opts.a) { entries.unshift(['..', fs.stat(P.dirname(p)), P.dirname(p)]); entries.unshift(['.', fs.stat(p), p]); }
      if (dirs.length + files.length > 1 || opts.R) { if (!first || files.length) c.println(''); c.println(t + ':'); }
      fmtEntries(entries, p);
      if (opts.R) for (const [n, node, full] of entries) if (node.t === 'd' && n !== '.' && n !== '..') listDir((t === '.' ? '.' : t.replace(/\/$/, '')) + '/' + n, full, false);
    };
    dirs.forEach(([t, p], i) => listDir(t, p, i === 0));
    return st;
  };
  C.dir = C.ls;

  C.mkdir = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'pv', values: 'm', long: { parents: 'p', verbose: 'v', mode: 'm=' } });
    if (!rest.length) return c.fail('missing operand\nTry \'mkdir --help\' for more information.');
    let st = 0;
    const mode = opts.m ? parseInt(opts.m, 8) : undefined;
    for (const d of rest) {
      try {
        const p = c.resolve(d);
        if (opts.p && c.fs.isDir(p)) continue;
        c.fs.mkdir(p, { parents: !!opts.p, cred: c.cred, mode: mode != null ? mode : 0o755 });
        if (opts.v) c.println("mkdir: created directory '" + d + "'");
      } catch (e) { c.err("mkdir: cannot create directory '" + d + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.rmdir = (c) => {
    let st = 0;
    for (const d of c.args.filter(a => !a.startsWith('-'))) {
      try { c.fs.rmdir(c.resolve(d), c.cred); } catch (e) { c.err("rmdir: failed to remove '" + d + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.rm = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rRfivd', long: { recursive: 'r', force: 'f', interactive: 'i', verbose: 'v', 'no-preserve-root': 'nopreserve' } });
    const rec = opts.r || opts.R;
    if (!rest.length) { if (opts.f) return 0; return c.fail('missing operand\nTry \'rm --help\' for more information.'); }
    let st = 0;
    for (const t of rest) {
      const p = c.resolve(t);
      if (p === '/' && !opts.nopreserve) { c.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); st = 1; continue; }
      const r = c.fs.tryLookup(p, { cred: c.cred, follow: false });
      if (!r) { if (!opts.f) { c.err("rm: cannot remove '" + t + "': No such file or directory\n"); st = 1; } continue; }
      if (opts.i && !opts.f && c.term) {
        const ans = await c.prompt("rm: remove " + (r.node.t === 'd' ? 'directory' : 'regular file') + " '" + t + "'? ");
        if (!/^y/i.test(ans || '')) continue;
      }
      try {
        if (r.node.t === 'd') {
          if (!rec) { c.err("rm: cannot remove '" + t + "': Is a directory\n"); st = 1; continue; }
          const errs = c.fs.rmrf(p, c.cred);
          for (const e of errs) { c.err("rm: cannot remove '" + (e.path || t) + "': " + e.message + '\n'); st = 1; }
        } else c.fs.unlink(p, c.cred);
        if (opts.v) c.println("removed '" + t + "'");
      } catch (e) { c.err("rm: cannot remove '" + t + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.cp = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rRapvfiun', long: { recursive: 'r', archive: 'a', verbose: 'v', force: 'f', preserve: 'p' } });
    if (rest.length < 2) return c.fail(rest.length ? "missing destination file operand after '" + rest[0] + "'" : 'missing file operand');
    const dst = c.resolve(rest[rest.length - 1]);
    const srcs = rest.slice(0, -1);
    if (srcs.length > 1 && !c.fs.isDir(dst)) return c.fail("target '" + rest[rest.length - 1] + "' is not a directory");
    let st = 0;
    for (const s of srcs) {
      try {
        const sp = c.resolve(s);
        const sn = c.fs.stat(sp, { cred: c.cred });
        if (sn.t === 'd' && !(opts.r || opts.R || opts.a)) { c.err("cp: -r not specified; omitting directory '" + s + "'\n"); st = 1; continue; }
        const target = c.fs.isDir(dst) ? P.join(dst, P.basename(sp)) : dst;
        if (opts.i && c.fs.exists(target) && c.term) { const a = await c.prompt("cp: overwrite '" + target + "'? "); if (!/^y/i.test(a || '')) continue; }
        if (opts.n && c.fs.exists(target)) continue;
        c.fs.copy(sp, dst, { recursive: true, cred: c.cred, preserve: !!(opts.a || opts.p) && c.cred.uid === 0 });
        if (opts.v) c.println("'" + s + "' -> '" + target + "'");
      } catch (e) { c.err("cp: cannot copy '" + s + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.mv = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'fivn', long: { force: 'f', verbose: 'v' } });
    if (rest.length < 2) return c.fail(rest.length ? "missing destination file operand after '" + rest[0] + "'" : 'missing file operand');
    const dst = c.resolve(rest[rest.length - 1]);
    const srcs = rest.slice(0, -1);
    if (srcs.length > 1 && !c.fs.isDir(dst)) return c.fail("target '" + rest[rest.length - 1] + "' is not a directory");
    let st = 0;
    for (const s of srcs) {
      try {
        const target = c.fs.isDir(dst) ? P.join(dst, P.basename(s)) : dst;
        if (opts.i && c.fs.exists(target) && c.term) { const a = await c.prompt("mv: overwrite '" + target + "'? "); if (!/^y/i.test(a || '')) continue; }
        if (opts.n && c.fs.exists(target)) continue;
        c.fs.rename(c.resolve(s), dst, c.cred);
        if (opts.v) c.println("renamed '" + s + "' -> '" + target + "'");
      } catch (e) { c.err("mv: cannot move '" + s + "' to '" + rest[rest.length - 1] + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.touch = (c) => {
    const rest = c.args.filter(a => !a.startsWith('-'));
    if (!rest.length) return c.fail('missing file operand');
    let st = 0;
    for (const f of rest) {
      try { c.fs.touch(c.resolve(f), c.cred); } catch (e) { c.err("touch: cannot touch '" + f + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.cat = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'nAbsEvT', long: { number: 'n' } });
    let st = 0;
    const files = rest.length ? rest : ['-'];
    let n = 1;
    for (const f of files) {
      let text;
      if (f === '-') text = await c.readAll();
      else {
        try {
          const p = c.resolve(f);
          const r = c.fs.lookup(p, { cred: c.cred });
          if (r.node.t === 'd') { c.err('cat: ' + f + ': Is a directory\n'); st = 1; continue; }
          text = c.fs.read(p, c.cred);
          if (r.node.bin && c.isTTY && !L.archive.isArchive(text)) text = text.replace(/[^\n\t -~]/g, '�');
        } catch (e) { c.err('cat: ' + f + ': ' + e.message + '\n'); st = 1; continue; }
      }
      if (opts.n || opts.b) text = lines(text).map(l => (opts.b && !l ? '' : U.pad(n++, 6) + '\t') + l).join('\n') + (text ? '\n' : '');
      if (opts.A || opts.E) text = text.replace(/\n/g, '$\n');
      c.out(text);
    }
    return st;
  };
  C.tac = async (c) => { const { text, ok } = await c.input(c.args); c.out(lines(text).reverse().map(l => l + '\n').join('')); return ok ? 0 : 1; };

  C.head = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'qv', values: 'nc', numeric: true, long: { lines: 'n=', bytes: 'c=' } });
    let n = opts.num != null ? opts.num : opts.n != null ? parseInt(opts.n, 10) : 10;
    let st = 0;
    const files = rest.length ? rest : ['-'];
    for (const [i, f] of files.entries()) {
      let text;
      if (f === '-') text = await c.readAll();
      else { try { text = c.fs.read(c.resolve(f), c.cred); } catch (e) { c.err("head: cannot open '" + f + "' for reading: " + e.message + '\n'); st = 1; continue; } }
      if (files.length > 1) c.println((i ? '\n' : '') + '==> ' + f + ' <==');
      if (opts.c) { c.out(text.slice(0, +opts.c)); continue; }
      const ls = lines(text);
      const sel = n < 0 ? ls.slice(0, n) : ls.slice(0, n);
      c.out(sel.map(l => l + '\n').join(''));
    }
    return st;
  };
  C.tail = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'fFqv', values: 'nc', numeric: true, long: { lines: 'n=', follow: 'f' } });
    let nArg = opts.num != null ? String(opts.num) : opts.n != null ? String(opts.n) : '10';
    const fromStart = nArg.startsWith('+');
    const n = parseInt(nArg.replace('+', ''), 10);
    const follow = opts.f || opts.F;
    let st = 0;
    const files = rest.length ? rest : ['-'];
    const sizes = {};
    for (const [i, f] of files.entries()) {
      let text;
      if (f === '-') text = await c.readAll();
      else { try { text = c.fs.read(c.resolve(f), c.cred); } catch (e) { c.err("tail: cannot open '" + f + "' for reading: " + e.message + '\n'); st = 1; if (!opts.F) continue; text = ''; } }
      sizes[f] = text.length;
      if (files.length > 1) c.println((i ? '\n' : '') + '==> ' + f + ' <==');
      if (opts.c) { c.out(text.slice(-(+opts.c))); continue; }
      const ls = lines(text);
      const sel = fromStart ? ls.slice(n - 1) : (n === 0 ? [] : ls.slice(-n));
      c.out(sel.map(l => l + '\n').join(''));
    }
    if (!follow || (files.length === 1 && files[0] === '-')) return st;
    // tail -f: sigue el archivo hasta Ctrl+C
    let lastFile = files[files.length - 1];
    while (true) {
      await c.sleep(400);
      if (c.io.stdout.readerGone) return 0;
      for (const f of files) {
        if (f === '-') continue;
        let text;
        try { text = c.fs.read(c.resolve(f), c.cred); } catch (e) { continue; }
        if (text.length < sizes[f]) { c.err('tail: ' + f + ': file truncated\n'); sizes[f] = 0; }
        if (text.length > sizes[f]) {
          if (files.length > 1 && lastFile !== f) { c.println('\n==> ' + f + ' <=='); lastFile = f; }
          c.out(text.slice(sizes[f]));
          sizes[f] = text.length;
        }
      }
    }
  };

  C.ln = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'sfvnT', long: { symbolic: 's', force: 'f' } });
    if (rest.length < 1) return c.fail('missing file operand');
    const target = rest[0];
    let link = rest[1] || P.basename(target);
    let lp = c.resolve(link);
    if (c.fs.isDir(lp) && !opts.n) lp = P.join(lp, P.basename(target));
    try {
      if (opts.f && c.fs.tryLookup(lp, { follow: false })) c.fs.unlink(lp, c.cred);
      if (opts.s) c.fs.symlink(target, lp, c.cred);
      else {
        // enlace duro: copia (el VFS no comparte inodos)
        c.fs.copy(c.resolve(target), lp, { cred: c.cred });
      }
      if (opts.v) c.println("'" + link + "' -> '" + target + "'");
    } catch (e) { return c.fail("failed to create " + (opts.s ? 'symbolic ' : 'hard ') + "link '" + link + "': " + e.message); }
    return 0;
  };
  C.stat = (c) => {
    let st = 0;
    for (const f of c.args.filter(a => !a.startsWith('-'))) {
      try {
        const r = c.fs.lookup(c.resolve(f), { cred: c.cred, follow: c.args.includes('-L') });
        const n = r.node;
        const size = c.fs.nodeSize(n);
        const d = new Date(n.mt);
        const ts = d.getFullYear() + '-' + U.two(d.getMonth() + 1) + '-' + U.two(d.getDate()) + ' ' + U.clock(n.mt) + '.000000000 +0000';
        c.println('  File: ' + f + (n.t === 'l' ? ' -> ' + n.tg : ''));
        c.println('  Size: ' + U.pad(size, 10, true) + '\tBlocks: ' + U.pad(Math.ceil(size / 512), 10, true) + ' IO Block: 4096   ' + (n.t === 'd' ? 'directory' : n.t === 'l' ? 'symbolic link' : size ? 'regular file' : 'regular empty file'));
        c.println('Device: fd00h/64768d\tInode: ' + (Math.abs(hashCode(r.path)) % 90000000 + 100000) + '    Links: 1');
        c.println('Access: (' + (n.m & 0o7777).toString(8).padStart(4, '0') + '/' + modeString(n) + ')  Uid: (' + U.pad(n.u, 5) + '/' + U.pad(c.userName(n.u), 8, true) + ')   Gid: (' + U.pad(n.g, 5) + '/' + U.pad(c.groupName(n.g), 8, true) + ')');
        c.println('Context: unconfined_u:object_r:usr_t:s0');
        c.println('Access: ' + ts); c.println('Modify: ' + ts); c.println('Change: ' + ts); c.println(' Birth: -');
      } catch (e) { c.err("stat: cannot statx '" + f + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  function hashCode(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  C.file = (c) => {
    let st = 0;
    for (const f of c.args.filter(a => !a.startsWith('-'))) {
      try {
        const r = c.fs.lookup(c.resolve(f), { cred: c.cred, follow: false });
        const n = r.node;
        let t;
        if (n.t === 'd') t = 'directory';
        else if (n.t === 'l') t = "symbolic link to " + n.tg;
        else if (n.bi || (n.d || '').startsWith('\x7fELF')) t = 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, stripped';
        else {
          const d = n.d || '';
          const a = L.archive.decode(d);
          if (a) t = a.format === 'war' || a.format === 'jar' || a.format === 'ear' || a.format === 'zip' ? (/\.(war|jar|ear)$/.test(f) ? 'Java archive data (JAR)' : 'Zip archive data, at least v2.0 to extract') : a.format === 'tar.gz' ? 'gzip compressed data, from Unix' : 'POSIX tar archive (GNU)';
          else if (/\.jar$/.test(f) || d.startsWith('PK')) t = 'Java archive data (JAR)';
          else if (!n.d && n.vs == null) t = 'empty';
          else if (/^#!\s*\/bin\/(ba)?sh/.test(d)) t = 'Bourne-Again shell script, ASCII text executable';
          else if (/^\s*<\?xml/.test(d)) t = 'XML 1.0 document, ASCII text';
          else if (n.bin) t = 'data';
          else t = /[^\x00-\x7f]/.test(d) ? 'Unicode text, UTF-8 text' : 'ASCII text';
        }
        c.println(f + ': ' + t);
      } catch (e) { c.println(f + ": cannot open `" + f + "' (" + e.message + ')'); st = 1; }
    }
    return st;
  };
  C.du = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'shcab', values: 'd', long: { 'max-depth': 'd=', summarize: 's', 'human-readable': 'h' } });
    const targets = rest.length ? rest : ['.'];
    const fmt = (b) => opts.h ? U.human(b) : String(Math.ceil(b / 1024));
    let total = 0, st = 0;
    const maxD = opts.s ? 0 : opts.d != null ? +opts.d : Infinity;
    for (const t of targets) {
      const p = c.resolve(t);
      try {
        const rec = (path, node, depth, label) => {
          let s = c.fs.nodeSize(node);
          if (node.t === 'd') {
            if (!c.fs.can(node, c.cred, 'r')) { c.err("du: cannot read directory '" + label + "': Permission denied\n"); st = 1; return s; }
            for (const k of Object.keys(node.c).sort()) s += rec(path + '/' + k, node.c[k], depth + 1, label.replace(/\/$/, '') + '/' + k);
            if (depth <= maxD) c.println(fmt(s) + '\t' + label);
          } else if (opts.a && depth <= maxD) c.println(fmt(s) + '\t' + label);
          return s;
        };
        const r = c.fs.lookup(p, { cred: c.cred });
        const s = rec(r.path, r.node, 0, t);
        if (r.node.t !== 'd') c.println(fmt(s) + '\t' + t);
        total += s;
      } catch (e) { c.err("du: cannot access '" + t + "': " + e.message + '\n'); st = 1; }
    }
    if (opts.c) c.println(fmt(total) + '\ttotal');
    return st;
  };
  C.df = (c) => {
    const { opts } = getopt(c.args, { flags: 'hTiP', long: { 'human-readable': 'h' } });
    const d = c.vm.diskStats();
    const f = (b) => opts.h ? U.human(b) : String(Math.round(b / 1024));
    const ram = c.vm.ramMB * 1048576;
    const rows = [
      ['Filesystem', opts.T ? 'Type' : null, opts.h ? 'Size' : '1K-blocks', 'Used', 'Avail', 'Use%', 'Mounted on'],
      ['devtmpfs', opts.T ? 'devtmpfs' : null, f(4194304), '0', f(4194304), '0%', '/dev'],
      ['tmpfs', opts.T ? 'tmpfs' : null, f(ram / 2), '0', f(ram / 2), '0%', '/dev/shm'],
      ['/dev/mapper/rhel-root', opts.T ? 'xfs' : null, f(d.total - 1073741824), f(d.used - 300 * 1048576), f(d.avail), d.pct + '%', '/'],
      ['/dev/sda1', opts.T ? 'xfs' : null, f(1014 * 1048576), f(300 * 1048576), f(714 * 1048576), '30%', '/boot'],
      ['tmpfs', opts.T ? 'tmpfs' : null, f(ram / 5), '0', f(ram / 5), '0%', '/run/user/1000']
    ].map(r => r.filter(x => x !== null));
    const w = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
    for (const r of rows) c.println(r.map((x, i) => i === 0 || i === r.length - 1 ? U.pad(x, w[i], true) : U.pad(x, w[i])).join(' ').trimEnd());
    return 0;
  };
  C.tree = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'adfp', values: 'L' });
    const root = rest[0] || '.';
    let nd = 0, nf = 0;
    const max = opts.L ? +opts.L : Infinity;
    const rec = (path, prefix, depth) => {
      if (depth >= max) return;
      let names;
      try { names = c.fs.readdir(path, c.cred); } catch (e) { c.println(prefix + '[error opening dir]'); return; }
      if (!opts.a) names = names.filter(n => !n.startsWith('.'));
      if (opts.d) names = names.filter(n => c.fs.isDir(path + '/' + n));
      names.forEach((n, i) => {
        const last = i === names.length - 1;
        const full = (path === '/' ? '' : path) + '/' + n;
        const node = c.fs.lstat(full);
        const disp = c.isTTY ? colorName(node, n) : n;
        c.println(prefix + (last ? '└── ' : '├── ') + (opts.p ? '[' + modeString(node) + ']  ' : '') + disp + (node.t === 'l' ? ' -> ' + node.tg : ''));
        if (node.t === 'd') { nd++; rec(full, prefix + (last ? '    ' : '│   '), depth + 1); } else nf++;
      });
    };
    const p = c.resolve(root);
    if (!c.fs.isDir(p)) return c.fail(root + ' [error opening dir]');
    c.println(c.isTTY ? '\x1b[1;34m' + root + '\x1b[0m' : root);
    rec(p, '', 0);
    c.println('\n' + nd + ' director' + (nd === 1 ? 'y' : 'ies') + (opts.d ? '' : ', ' + nf + ' file' + (nf === 1 ? '' : 's')));
    return 0;
  };
  C.chmod = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'Rvfc', long: { recursive: 'R' } });
    if (rest.length < 2) return c.fail("missing operand after '" + (rest[0] || '') + "'");
    const spec = rest[0];
    let st = 0;
    for (const f of rest.slice(1)) {
      const apply = (p) => {
        const n = c.fs.stat(p, { cred: c.cred });
        let m;
        if (/^[0-7]{1,4}$/.test(spec)) m = parseInt(spec, 8);
        else { m = applySymbolicMode(n.m & 0o7777, spec, n.t === 'd'); if (m === null) throw new Error("invalid mode: '" + spec + "'"); }
        c.fs.chmod(p, m, c.cred);
        if (opts.v) c.println("mode of '" + p + "' changed to " + m.toString(8).padStart(4, '0'));
      };
      try {
        const p = c.resolve(f);
        if (opts.R) c.fs.walk(p, (path) => apply(path), c.cred); else apply(p);
      } catch (e) {
        if (/invalid mode/.test(e.message)) return c.fail(e.message);
        c.err("chmod: changing permissions of '" + f + "': " + e.message + '\n'); st = 1;
      }
    }
    return st;
  };
  function parseOwner(c, spec) {
    const [u, g] = spec.split(/[:.]/);
    let uid = null, gid = null;
    if (u) { const x = /^\d+$/.test(u) ? { uid: +u } : L.os.users.byName(c.fs, u); if (!x) throw new Error("invalid user: '" + spec + "'"); uid = x.uid; if (spec.includes(':') && !g) gid = x.gid; }
    if (g) { const x = /^\d+$/.test(g) ? { gid: +g } : L.os.users.groups(c.fs).find(gr => gr.name === g); if (!x) throw new Error("invalid group: '" + spec + "'"); gid = x.gid; }
    return { uid, gid };
  }
  C.chown = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'Rvfh', long: { recursive: 'R' } });
    if (rest.length < 2) return c.fail("missing operand after '" + (rest[0] || '') + "'");
    let o;
    try { o = parseOwner(c, rest[0]); } catch (e) { return c.fail(e.message); }
    let st = 0;
    for (const f of rest.slice(1)) {
      try {
        const p = c.resolve(f);
        if (opts.R) c.fs.walk(p, (path) => c.fs.chown(path, o.uid, o.gid, c.cred), c.cred);
        else c.fs.chown(p, o.uid, o.gid, c.cred);
      } catch (e) { c.err("chown: changing ownership of '" + f + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.chgrp = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'Rv' });
    if (rest.length < 2) return c.fail('missing operand');
    let o;
    try { o = parseOwner(c, ':' + rest[0]); } catch (e) { return c.fail(e.message); }
    let st = 0;
    for (const f of rest.slice(1)) {
      try {
        const p = c.resolve(f);
        if (opts.R) c.fs.walk(p, (path) => c.fs.chown(path, null, o.gid, c.cred), c.cred);
        else c.fs.chown(p, null, o.gid, c.cred);
      } catch (e) { c.err("chgrp: changing group of '" + f + "': " + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C.basename = (c) => { if (!c.args.length) return c.fail('missing operand'); c.println(P.basename(c.args[0], c.args[1])); return 0; };
  C.dirname = (c) => { if (!c.args.length) return c.fail('missing operand'); c.println(P.dirname(c.args[0])); return 0; };
  C.realpath = (c) => { let st = 0; for (const f of c.args.filter(a => !a.startsWith('-'))) { try { c.println(c.fs.realpath(c.resolve(f))); } catch (e) { c.err('realpath: ' + f + ': ' + e.message + '\n'); st = 1; } } return st; };
  C.readlink = (c) => {
    const f = c.args.filter(a => !a.startsWith('-'))[0];
    if (!f) return c.fail('missing operand');
    try {
      if (c.args.includes('-f') || c.args.includes('-e')) { c.println(c.fs.realpath(c.resolve(f))); return 0; }
      const n = c.fs.lstat(c.resolve(f));
      if (n.t !== 'l') return 1;
      c.println(n.tg); return 0;
    } catch (e) { return 1; }
  };
  C.mktemp = (c) => {
    const dir = c.args.includes('-d');
    const tpl = c.args.filter(a => !a.startsWith('-'))[0] || 'tmp.XXXXXXXXXX';
    const name = tpl.replace(/X+$/, (m) => Math.random().toString(36).slice(2, 2 + m.length).padEnd(m.length, 'a'));
    const p = name.includes('/') ? c.resolve(name) : '/tmp/' + name;
    if (dir) c.fs.mkdir(p, { cred: c.cred, mode: 0o700 }); else c.fs.write(p, '', { cred: c.cred, mode: 0o600 });
    c.println(p);
    return 0;
  };
  C.install = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'dDv', values: 'mog' });
    if (opts.d) { for (const d of rest) c.fs.mkdir(c.resolve(d), { parents: true, cred: c.cred, mode: opts.m ? parseInt(opts.m, 8) : 0o755 }); return 0; }
    if (rest.length < 2) return c.fail('missing destination file operand');
    c.fs.copy(c.resolve(rest[0]), c.resolve(rest[1]), { cred: c.cred });
    const tgt = c.fs.isDir(c.resolve(rest[1])) ? P.join(c.resolve(rest[1]), P.basename(rest[0])) : c.resolve(rest[1]);
    c.fs.chmod(tgt, opts.m ? parseInt(opts.m, 8) : 0o755, c.cred);
    return 0;
  };

  // find: -name -iname -type -maxdepth -mindepth -size -user -perm -mtime -newer -exec -delete -print
  C.find = async (c) => {
    const args = c.args.slice();
    const paths = [];
    while (args.length && !args[0].startsWith('-') && args[0] !== '(' && args[0] !== '!') paths.push(args.shift());
    if (!paths.length) paths.push('.');
    let maxdepth = Infinity, mindepth = 0;
    const tests = [];
    let action = null, execCmd = null;
    let negate = false;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const add = (fn) => { const neg = negate; tests.push(neg ? (...x) => !fn(...x) : fn); negate = false; };
      switch (a) {
        case '!': case '-not': negate = true; break;
        case '-name': { const re = U.globToRegex(args[++i]); add((p) => re.test(P.basename(p))); break; }
        case '-iname': { const re = U.globToRegex(args[++i].toLowerCase()); add((p) => re.test(P.basename(p).toLowerCase())); break; }
        case '-path': case '-wholename': { const re = new RegExp('^' + U.globToRegex(args[++i]).source.slice(1, -1).replace(/\[\^\/\]\*/g, '.*') + '$'); add((p) => re.test(p)); break; }
        case '-type': { const t = args[++i]; add((p, n) => (t === 'f' && n.t === 'f') || (t === 'd' && n.t === 'd') || (t === 'l' && n.t === 'l')); break; }
        case '-maxdepth': maxdepth = +args[++i]; break;
        case '-mindepth': mindepth = +args[++i]; break;
        case '-empty': add((p, n) => n.t === 'd' ? !Object.keys(n.c).length : c.fs.nodeSize(n) === 0); break;
        case '-user': { const u = args[++i]; const uu = L.os.users.byName(c.fs, u); add((p, n) => uu ? n.u === uu.uid : false); break; }
        case '-group': { const g = args[++i]; const gg = L.os.users.groups(c.fs).find(x => x.name === g); add((p, n) => gg ? n.g === gg.gid : false); break; }
        case '-perm': { const m = args[++i]; const any = m.startsWith('/'), all = m.startsWith('-'); const v = parseInt(m.replace(/^[-/]/, ''), 8); add((p, n) => { const x = n.m & 0o7777; return any ? (x & v) !== 0 : all ? (x & v) === v : x === v; }); break; }
        case '-size': {
          const s = args[++i]; const mm = /^([+-]?)(\d+)([ckMG]?)$/.exec(s);
          const unit = { c: 1, k: 1024, M: 1048576, G: 1073741824, '': 512 }[mm ? mm[3] : ''];
          const val = mm ? +mm[2] * unit : 0;
          add((p, n) => { if (n.t !== 'f') return false; const z = c.fs.nodeSize(n); return mm[1] === '+' ? z > val : mm[1] === '-' ? z < val : Math.ceil(z / unit) === +mm[2]; });
          break;
        }
        case '-mtime': case '-mmin': {
          const s = args[++i]; const unit = a === '-mtime' ? 86400e3 : 60e3;
          const v = parseInt(s, 10);
          add((p, n) => { const age = (Date.now() - n.mt) / unit; return s.startsWith('+') ? age > Math.abs(v) : s.startsWith('-') ? age < Math.abs(v) : Math.floor(age) === v; });
          break;
        }
        case '-newer': { const ref = c.fs.stat(c.resolve(args[++i])); add((p, n) => n.mt > ref.mt); break; }
        case '-print': action = action || 'print'; break;
        case '-ls': action = 'ls'; break;
        case '-delete': action = 'delete'; break;
        case '-exec': case '-ok': {
          const cmd = [];
          i++;
          while (i < args.length && args[i] !== ';' && args[i] !== '+') cmd.push(args[i++]);
          execCmd = { cmd, plus: args[i] === '+' };
          action = 'exec';
          break;
        }
        case '-o': case '-or': case '-a': case '-and': break;
        default: return c.fail("unknown predicate `" + a + "'");
      }
    }
    let st = 0;
    const found = [];
    for (const start of paths) {
      const sp = c.resolve(start);
      const rec = (full, disp, node, depth) => {
        if (depth >= mindepth && tests.every(t => t(disp, node))) found.push([disp, full, node]);
        if (node.t !== 'd' || depth >= maxdepth) return;
        if (!c.fs.can(node, c.cred, 'r') || !c.fs.can(node, c.cred, 'x')) { c.err("find: '" + disp + "': Permission denied\n"); st = 1; return; }
        for (const k of Object.keys(node.c).sort()) rec(full === '/' ? '/' + k : full + '/' + k, disp === '/' ? '/' + k : disp.replace(/\/$/, '') + '/' + k, node.c[k], depth + 1);
      };
      try { const r = c.fs.lookup(sp, { cred: c.cred }); rec(r.path, start, r.node, 0); }
      catch (e) { c.err("find: '" + start + "': " + e.message + '\n'); st = 1; }
    }
    if (action === 'delete') { for (const [d, full] of found.reverse()) { try { const n = c.fs.lstat(full); if (n.t === 'd') c.fs.rmdir(full, c.cred); else c.fs.unlink(full, c.cred); } catch (e) { c.err('find: cannot delete ' + d + ': ' + e.message + '\n'); st = 1; } } return st; }
    if (action === 'exec') {
      if (execCmd.plus) { const argv = []; for (const x of execCmd.cmd) { if (x === '{}') argv.push(...found.map(f => f[0])); else argv.push(x); } if (found.length) await c.sh.execCommand(argv, c.io); return st; }
      for (const [d] of found) { await c.sh.execCommand(execCmd.cmd.map(x => x.replace(/\{\}/g, d)), c.io); }
      return st;
    }
    for (const [d, full, n] of found) {
      if (action === 'ls') c.println(U.pad(Math.ceil(c.fs.nodeSize(n) / 1024), 8) + ' ' + modeString(n) + '   1 ' + U.pad(c.userName(n.u), 8, true) + ' ' + U.pad(c.groupName(n.g), 8, true) + ' ' + U.pad(c.fs.nodeSize(n), 8) + ' ' + U.lsDate(n.mt) + ' ' + d);
      else c.println(d);
    }
    return st;
  };

  C.dd = (c) => {
    const o = {};
    for (const a of c.args) { const [k, v] = a.split('='); o[k] = v; }
    if (!o.of) return c.fail('se requiere of=ARCHIVO (simulado)');
    const bs = L.jboss.parseMem((o.bs || '512').toLowerCase().replace(/b$/, '')) || 1;
    const count = +(o.count || 1);
    const bytes = Math.round(bs * count * 1048576 / (/[mgk]/i.test(o.bs || '') ? 1 : 1048576));
    try {
      const p = c.resolve(o.of);
      if (c.fs.exists(p)) c.fs.unlink(p, c.cred);
      c.fs.write(p, '', { cred: c.cred, vsize: bytes, bin: true });
    } catch (e) { return c.fail(o.of + ': ' + e.message); }
    c.err(count + '+0 records in\n' + count + '+0 records out\n' + bytes + ' bytes (' + U.human(bytes) + ') copied, 0.52 s, ' + U.human(bytes * 2) + '/s\n');
    return 0;
  };
})(globalThis.JLab = globalThis.JLab || {});
