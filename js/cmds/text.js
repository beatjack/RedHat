/*
 * Procesamiento de texto: grep, sed, awk, sort, uniq, cut, tr, wc, tee,
 * xargs, diff, nl, seq, rev, paste, base64, md5sum, sha256sum, expr, bc...
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds;
  const { getopt, lines } = L.cmdutil;

  // Convierte expresión regular básica (BRE) a JS
  function bre2js(re, extended) {
    if (extended) return re.replace(/\[\[:(\w+):\]\]/g, (m, k) => cls(k, true)).replace(/\[:(\w+):\]/g, (m, k) => cls(k, false));
    let out = '';
    for (let i = 0; i < re.length; i++) {
      const c = re[i];
      if (c === '\\' && i + 1 < re.length) {
        const n = re[++i];
        if ('(){}|+?'.includes(n)) out += n;
        else if (n === '<' || n === '>') out += '\\b';
        else out += '\\' + n;
      } else if ('(){}|+?'.includes(c)) out += '\\' + c;
      else if (c === '[') {
        const j = re.indexOf(']', i + (re[i + 1] === ']' ? 2 : 1) + (re[i + 1] === '^' ? 1 : 0));
        if (j < 0) { out += '\\['; continue; }
        out += re.slice(i, j + 1).replace(/\[:(\w+):\]/g, (m, k) => cls(k, false));
        i = j;
      } else out += c;
    }
    return out;
  }
  function cls(k, wrap) {
    const m = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f' }[k] || k;
    return wrap ? '[' + m + ']' : m;
  }

  // ---------------- grep ----------------
  async function grepImpl(c, forceE, forceF) {
    const { opts, rest } = getopt(c.args, {
      flags: 'ivnclLrREFwxohHqsVz', values: 'eABCm',
      long: { 'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', recursive: 'r', 'extended-regexp': 'E', 'fixed-strings': 'F', 'word-regexp': 'w', 'only-matching': 'o', quiet: 'q', color: 'color', colour: 'color', include: 'include=', exclude: 'exclude=', 'files-with-matches': 'l', 'max-count': 'm=' }
    });
    if (opts._bad && !/^--colou?r/.test(opts._bad)) return c.fail("invalid option -- '" + opts._bad.replace(/^-+/, '') + "'\nUsage: grep [OPTION]... PATTERNS [FILE]...", 2);
    let pats = [];
    if (opts.e) pats.push(opts.e);
    let files = rest.slice();
    if (!pats.length) { if (!files.length) return c.fail('Usage: grep [OPTION]... PATTERNS [FILE]...', 2); pats.push(files.shift()); }
    const E = opts.E || forceE, F = opts.F || forceF;
    let src = pats.map(p => F ? p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : bre2js(p, E)).join('|');
    if (opts.w) src = '\\b(?:' + src + ')\\b';
    if (opts.x) src = '^(?:' + src + ')$';
    let re;
    try { re = new RegExp(src, opts.i ? 'i' : ''); } catch (e) { return c.fail('Invalid regular expression', 2); }
    const reG = new RegExp(src, opts.i ? 'gi' : 'g');
    const color = c.isTTY;
    const recursive = opts.r || opts.R;
    if (recursive && !files.length) files = ['.'];
    // expande directorios en modo recursivo
    const list = [];
    for (const f of files) {
      const p = c.resolve(f);
      if (recursive && c.fs.isDir(p)) {
        c.fs.walk(p, (full, n) => { if (n.t === 'f') { const rel = f.replace(/\/$/, '') + full.slice(p.length); if (!opts.include || U.globToRegex(opts.include).test(P.basename(full))) list.push([rel, full]); } }, c.cred);
      } else list.push([f, p]);
    }
    const multi = (list.length > 1 || recursive) && !opts.h || opts.H;
    let matchedAny = false, st = 0;
    const max = opts.m ? +opts.m : Infinity;
    const A = +(opts.A || opts.C || 0), B = +(opts.B || opts.C || 0);
    const hl = (l) => color ? l.replace(reG, m => '\x1b[01;31m' + m + '\x1b[0m') : l;
    const pre = (name, n, sep) => (multi ? (color ? '\x1b[35m' + name + '\x1b[36m' + sep + '\x1b[0m' : name + sep) : '') + (opts.n ? (color ? '\x1b[32m' + n + '\x1b[36m' + sep + '\x1b[0m' : n + sep) : '');
    const processText = (name, text) => {
      const ls = lines(text);
      let count = 0, lastPrinted = -1, after = 0;
      for (let i = 0; i < ls.length; i++) {
        const m = re.test(ls[i]) !== !!opts.v;
        if (m && count < max) {
          count++; matchedAny = true;
          if (opts.q || opts.l || opts.L || opts.c) continue;
          if (B) for (let k = Math.max(lastPrinted + 1, i - B); k < i; k++) c.println(pre(name, k + 1, '-') + ls[k]);
          if ((A || B) && lastPrinted >= 0 && i - lastPrinted > 1 + B) c.println(color ? '\x1b[36m--\x1b[0m' : '--');
          if (opts.o && !opts.v) { for (const mm of ls[i].match(reG) || []) c.println(pre(name, i + 1, ':') + (color ? '\x1b[01;31m' + mm + '\x1b[0m' : mm)); }
          else c.println(pre(name, i + 1, ':') + (opts.v ? ls[i] : hl(ls[i])));
          lastPrinted = i; after = A;
        } else if (after > 0 && !opts.q && !opts.c && !opts.l) { c.println(pre(name, i + 1, '-') + ls[i]); lastPrinted = i; after--; }
      }
      if (opts.c) c.println((multi ? name + ':' : '') + count);
      if (opts.l && count) c.println(name);
      if (opts.L && !count) c.println(name);
      return count;
    };
    if (!list.length) {
      // stdin en streaming (permite tail -f | grep)
      let buf = '', n = 0, count = 0;
      while (true) {
        const chunk = await c.stdin.read();
        if (chunk === null) break;
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const l of parts) {
          n++;
          if (re.test(l) !== !!opts.v && count < max) {
            count++; matchedAny = true;
            if (opts.q) return 0;
            if (!opts.c && !opts.l) { if (opts.o && !opts.v) { for (const mm of l.match(reG) || []) c.println((opts.n ? n + ':' : '') + mm); } else c.println((opts.n ? (color ? '\x1b[32m' + n + '\x1b[36m:\x1b[0m' : n + ':') : '') + (opts.v ? l : hl(l))); }
          }
        }
      }
      if (buf && re.test(buf) !== !!opts.v) { count++; matchedAny = true; if (!opts.c && !opts.q) c.println((opts.n ? (n + 1) + ':' : '') + hl(buf)); }
      if (opts.c) c.println(count);
      if (opts.l && count) c.println('(standard input)');
      return matchedAny ? 0 : 1;
    }
    for (const [name, p] of list) {
      let text;
      try {
        const r = c.fs.lookup(p, { cred: c.cred });
        if (r.node.t === 'd') { if (!opts.s) c.err('grep: ' + name + ': Is a directory\n'); continue; }
        text = c.fs.read(p, c.cred);
        if (r.node.bin && !L.archive.isArchive(text)) { if (re.test(text)) { if (!opts.q) c.println('grep: ' + name + ': binary file matches'); matchedAny = true; } continue; }
      } catch (e) { if (!opts.s) c.err('grep: ' + name + ': ' + e.message + '\n'); st = 2; continue; }
      processText(name, text);
      if (opts.q && matchedAny) return 0;
    }
    return st === 2 && !matchedAny ? 2 : (matchedAny ? 0 : 1);
  }
  C.grep = (c) => grepImpl(c);
  C.egrep = (c) => grepImpl(c, true);
  C.fgrep = (c) => grepImpl(c, false, true);

  C.wc = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'lwcmL', long: { lines: 'l', words: 'w', bytes: 'c', chars: 'm' } });
    const all = !opts.l && !opts.w && !opts.c && !opts.m;
    const files = rest.length ? rest : [null];
    let tot = [0, 0, 0], st = 0;
    const rows = [];
    for (const f of files) {
      let text;
      if (f === null) text = await c.readAll();
      else { try { text = c.fs.read(c.resolve(f), c.cred); } catch (e) { c.err('wc: ' + f + ': ' + e.message + '\n'); st = 1; continue; } }
      const l = (text.match(/\n/g) || []).length, w = (text.match(/\S+/g) || []).length, b = unescape(encodeURIComponent(text)).length;
      tot = [tot[0] + l, tot[1] + w, tot[2] + b];
      rows.push([l, w, b, f]);
    }
    if (files.length > 1) rows.push([tot[0], tot[1], tot[2], 'total']);
    const width = files.length > 1 || all ? Math.max(1, ...rows.map(r => String(Math.max(r[0], r[1], r[2])).length)) : 0;
    for (const [l, w, b, f] of rows) {
      const parts = [];
      if (all || opts.l) parts.push(U.pad(l, width));
      if (all || opts.w) parts.push(U.pad(w, width));
      if (all || opts.c || opts.m) parts.push(U.pad(b, width));
      c.println(parts.join(' ') + (f ? ' ' + f : ''));
    }
    return st;
  };
  C.sort = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'nrufhbVcM', values: 'ktoT', long: { numeric: 'n', reverse: 'r', unique: 'u', 'ignore-case': 'f', 'human-numeric-sort': 'h', key: 'k=', 'field-separator': 't=', output: 'o=' } });
    const { text, ok } = await c.input(rest);
    let ls = lines(text);
    const key = (l) => {
      if (!opts.k) return l;
      const [a, b] = opts.k.split(',');
      const s = parseInt(a, 10) - 1, e = b ? parseInt(b, 10) - 1 : null;
      const f = opts.t ? l.split(opts.t) : l.trim().split(/\s+/);
      return (e === null ? f.slice(s) : f.slice(s, e + 1)).join(opts.t || ' ');
    };
    const hn = (s) => { const m = /^([\d.]+)([KMGT]?)/i.exec(s.trim()); if (!m) return 0; return parseFloat(m[1]) * ({ '': 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }[m[2].toUpperCase()]); };
    const num = opts.n || (opts.k && /n/.test(opts.k));
    ls.sort((x, y) => {
      let a = key(x), b = key(y);
      if (opts.f) { a = a.toLowerCase(); b = b.toLowerCase(); }
      let r;
      if (opts.h) r = hn(a) - hn(b);
      else if (num) r = (parseFloat(a) || 0) - (parseFloat(b) || 0);
      else r = a < b ? -1 : a > b ? 1 : 0;
      return r;
    });
    if (opts.r) ls.reverse();
    if (opts.u) ls = ls.filter((l, i) => i === 0 || key(l) !== key(ls[i - 1]));
    const out = ls.map(l => l + '\n').join('');
    if (opts.o) c.fs.write(c.resolve(opts.o), out, { cred: c.cred }); else c.out(out);
    return ok ? 0 : 2;
  };
  C.uniq = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'cdui', values: 'f' });
    const { text, ok } = await c.input(rest.slice(0, 1));
    const ls = lines(text);
    const groups = [];
    for (const l of ls) {
      const k = opts.i ? l.toLowerCase() : l;
      if (groups.length && groups[groups.length - 1].k === k) groups[groups.length - 1].n++;
      else groups.push({ k, l, n: 1 });
    }
    for (const g of groups) {
      if (opts.d && g.n < 2) continue;
      if (opts.u && g.n > 1) continue;
      c.println(opts.c ? U.pad(g.n, 7) + ' ' + g.l : g.l);
    }
    return ok ? 0 : 1;
  };
  C.cut = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 's', values: 'dfcb', long: { delimiter: 'd=', fields: 'f=', characters: 'c=' } });
    if (!opts.f && !opts.c && !opts.b) return c.fail('you must specify a list of bytes, characters, or fields');
    const ranges = (spec) => spec.split(',').map(r => { const m = /^(\d*)-?(\d*)$/.exec(r); const dash = r.includes('-'); const a = m[1] ? +m[1] : 1; const b = m[2] ? +m[2] : (dash ? Infinity : a); return [a, b]; });
    const inR = (i, rs) => rs.some(([a, b]) => i >= a && i <= b);
    const { text, ok } = await c.input(rest);
    const d = opts.d !== undefined ? opts.d : '\t';
    for (const l of lines(text)) {
      if (opts.f) {
        if (!l.includes(d)) { if (!opts.s) c.println(l); continue; }
        const rs = ranges(opts.f);
        c.println(l.split(d).filter((_, i) => inR(i + 1, rs)).join(d));
      } else {
        const rs = ranges(opts.c || opts.b);
        c.println(l.split('').filter((_, i) => inR(i + 1, rs)).join(''));
      }
    }
    return ok ? 0 : 1;
  };
  C.tr = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'dscC' });
    const expand = (s) => {
      s = L.cmdutil.unescapeC(s).replace(/\[:(\w+):\]/g, (m, k) => ({ lower: 'a-z', upper: 'A-Z', digit: '0-9', alpha: 'a-zA-Z', alnum: 'a-zA-Z0-9', space: ' \t\n\r\v\f', blank: ' \t', punct: '!-/:-@[-`{-~' }[k] || ''));
      let out = '';
      for (let i = 0; i < s.length; i++) {
        if (s[i + 1] === '-' && i + 2 < s.length) { for (let x = s.charCodeAt(i); x <= s.charCodeAt(i + 2); x++) out += String.fromCharCode(x); i += 2; }
        else out += s[i];
      }
      return out;
    };
    const text = await c.readAll();
    const a = expand(rest[0] || ''), b = expand(rest[1] || '');
    let out;
    if (opts.d) out = text.split('').filter(ch => opts.c ? a.includes(ch) : !a.includes(ch)).join('');
    else if (b) out = text.split('').map(ch => { const i = a.indexOf(ch); return i < 0 ? ch : b[Math.min(i, b.length - 1)]; }).join('');
    else out = text;
    if (opts.s) { const set = b || a; out = out.replace(/(.)\1+/g, (m, ch) => set.includes(ch) ? ch : m); }
    c.out(out);
    return 0;
  };
  C.tee = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'ai' });
    const paths = rest.map(f => c.resolve(f));
    let st = 0;
    for (const p of paths) { try { if (!opts.a || !c.fs.exists(p)) c.fs.write(p, '', { cred: c.cred }); } catch (e) { c.err('tee: ' + p + ': ' + e.message + '\n'); st = 1; } }
    while (true) {
      const chunk = await c.stdin.read();
      if (chunk === null) break;
      c.out(chunk);
      for (const p of paths) { try { c.fs.write(p, chunk, { cred: c.cred, append: true }); } catch (e) { } }
    }
    return st;
  };
  C.xargs = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rt0', values: 'nIL', stopAtFirst: true });
    const text = await c.readAll();
    const items = opts['0'] ? text.split('\0').filter(Boolean) : (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^["']|["']$/g, ''));
    const cmd = rest.length ? rest : ['echo'];
    if (!items.length && opts.r) return 0;
    let st = 0;
    if (opts.I) {
      for (const it of lines(text)) { const argv = cmd.map(a => a.split(opts.I).join(it)); if (opts.t) c.err(argv.join(' ') + '\n'); st = await c.sh.execCommand(argv, c.io) || st; }
      return st;
    }
    const n = opts.n ? +opts.n : items.length || 1;
    for (let i = 0; i < Math.max(items.length, 1); i += n) {
      const argv = cmd.concat(items.slice(i, i + n));
      if (opts.t) c.err(argv.join(' ') + '\n');
      const r = await c.sh.execCommand(argv, c.io);
      if (r) st = 123;
    }
    return st;
  };
  C.rev = async (c) => { const { text } = await c.input(c.args); c.out(lines(text).map(l => l.split('').reverse().join('') + '\n').join('')); return 0; };
  C.nl = async (c) => { const { text } = await c.input(c.args.filter(a => !a.startsWith('-'))); let n = 1; c.out(lines(text).map(l => l.trim() ? U.pad(n++, 6) + '\t' + l + '\n' : '       \n').join('')); return 0; };
  C.seq = (c) => {
    const { opts, rest } = getopt(c.args.map(a => /^-\d/.test(a) ? '\u0000' + a : a), { values: 's', flags: 'w' });
    const nums = rest.map(a => parseFloat(a.replace('\u0000', '')));
    let [a, s, b] = nums.length === 1 ? [1, 1, nums[0]] : nums.length === 2 ? [nums[0], 1, nums[1]] : nums;
    if ([a, s, b].some(isNaN)) return c.fail('invalid floating point argument');
    const out = [];
    const w = String(b).length;
    for (let x = a; s > 0 ? x <= b : x >= b; x += s) { out.push(opts.w ? String(x).padStart(w, '0') : String(x)); if (out.length > 100000) break; }
    c.out(out.join(opts.s !== undefined ? L.cmdutil.unescapeC(opts.s) : '\n') + '\n');
    return 0;
  };
  C.yes = async (c) => {
    const s = (c.args.join(' ') || 'y') + '\n';
    for (let i = 0; i < 100000; i++) {
      if (c.io.stdout.readerGone || c.aborted) return 0;
      c.out(s.repeat(50));
      await c.sleep(5);
    }
    return 0;
  };
  C.paste = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 's', values: 'd' });
    const d = opts.d || '\t';
    const cols = [];
    for (const f of rest.length ? rest : ['-']) cols.push(lines(f === '-' ? await c.readAll() : c.fs.read(c.resolve(f), c.cred)));
    if (opts.s) { for (const col of cols) c.println(col.join(d)); return 0; }
    const n = Math.max(0, ...cols.map(x => x.length));
    for (let i = 0; i < n; i++) c.println(cols.map(x => x[i] || '').join(d));
    return 0;
  };
  C.split = (c) => c.fail('no disponible en el laboratorio');
  C.base64 = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'dw', long: { decode: 'd' } });
    const { text } = await c.input(rest);
    try { c.out(opts.d ? U.b64decode(text) : (U.b64encode(text).match(/.{1,76}/g) || ['']).join('\n') + '\n'); } catch (e) { return c.fail('invalid input'); }
    return 0;
  };
  function hashCmd(fn, name) {
    return async (c) => {
      const { opts, rest } = getopt(c.args, { flags: 'cb' });
      if (opts.c) {
        const { text } = await c.input(rest);
        let st = 0;
        for (const l of lines(text)) {
          const m = /^([0-9a-f]+)\s+\*?(.+)$/.exec(l);
          if (!m) continue;
          let ok = false;
          try { ok = fn(c.fs.read(c.resolve(m[2]), c.cred)) === m[1]; } catch (e) { }
          c.println(m[2] + ': ' + (ok ? 'OK' : 'FAILED'));
          if (!ok) st = 1;
        }
        return st;
      }
      if (!rest.length) { c.println(fn(await c.readAll()) + '  -'); return 0; }
      let st = 0;
      for (const f of rest) { try { c.println(fn(c.fs.read(c.resolve(f), c.cred)) + '  ' + f); } catch (e) { c.err(name + ': ' + f + ': ' + e.message + '\n'); st = 1; } }
      return st;
    };
  }
  C.md5sum = hashCmd(U.md5, 'md5sum');
  C.sha256sum = hashCmd(U.sha256, 'sha256sum');
  C.cmp = (c) => {
    const [a, b] = c.args.filter(x => !x.startsWith('-'));
    try {
      const x = c.fs.read(c.resolve(a), c.cred), y = c.fs.read(c.resolve(b), c.cred);
      if (x === y) return 0;
      let i = 0; while (x[i] === y[i]) i++;
      c.println(a + ' ' + b + ' differ: byte ' + (i + 1) + ', line ' + (x.slice(0, i).split('\n').length));
      return 1;
    } catch (e) { return c.fail(e.message, 2); }
  };

  // diff (algoritmo LCS, formato normal y unificado)
  C.diff = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'uqrNiwB', values: 'U' });
    if (rest.length < 2) return c.fail('missing operand', 2);
    let a, b;
    try { a = lines(c.fs.read(c.resolve(rest[0]), c.cred)); b = lines(c.fs.read(c.resolve(rest[1]), c.cred)); }
    catch (e) { return c.fail(e.message, 2); }
    const norm = (s) => opts.w ? s.replace(/\s+/g, '') : opts.i ? s.toLowerCase() : s;
    if (a.length * b.length > 4e6) return c.fail('archivos demasiado grandes para diff en el laboratorio', 2);
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && norm(a[i]) === norm(b[j])) { ops.push(['=', i, j]); i++; j++; }
      else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(['+', i, j]); j++; }
      else { ops.push(['-', i, j]); i++; }
    }
    if (!ops.some(o => o[0] !== '=')) return 0;
    if (opts.q) { c.println('Files ' + rest[0] + ' and ' + rest[1] + ' differ'); return 1; }
    const color = c.isTTY;
    if (opts.u || opts.U) {
      const ctx = opts.U ? +opts.U : 3;
      c.println((color ? '\x1b[1m' : '') + '--- ' + rest[0] + '\n+++ ' + rest[1] + (color ? '\x1b[0m' : ''));
      let k = 0;
      while (k < ops.length) {
        while (k < ops.length && ops[k][0] === '=') k++;
        if (k >= ops.length) break;
        let s = Math.max(0, k - ctx), e = k;
        while (e < ops.length) {
          if (ops[e][0] !== '=') { e++; continue; }
          let run = 0; while (e + run < ops.length && ops[e + run][0] === '=') run++;
          if (run > ctx * 2 || e + run >= ops.length) { e = Math.min(ops.length, e + ctx); break; }
          e += run;
        }
        const hunk = ops.slice(s, e);
        const aStart = hunk[0][1] + 1, bStart = hunk[0][2] + 1;
        const aLen = hunk.filter(o => o[0] !== '+').length, bLen = hunk.filter(o => o[0] !== '-').length;
        c.println((color ? '\x1b[36m' : '') + '@@ -' + aStart + ',' + aLen + ' +' + bStart + ',' + bLen + ' @@' + (color ? '\x1b[0m' : ''));
        for (const o of hunk) {
          if (o[0] === '=') c.println(' ' + a[o[1]]);
          else if (o[0] === '-') c.println((color ? '\x1b[31m' : '') + '-' + a[o[1]] + (color ? '\x1b[0m' : ''));
          else c.println((color ? '\x1b[32m' : '') + '+' + b[o[2]] + (color ? '\x1b[0m' : ''));
        }
        k = e;
      }
      return 1;
    }
    // formato normal
    let k = 0;
    while (k < ops.length) {
      if (ops[k][0] === '=') { k++; continue; }
      let e = k; while (e < ops.length && ops[e][0] !== '=') e++;
      const del = ops.slice(k, e).filter(o => o[0] === '-'), add = ops.slice(k, e).filter(o => o[0] === '+');
      const ar = del.length ? (del.length > 1 ? (del[0][1] + 1) + ',' + (del[del.length - 1][1] + 1) : String(del[0][1] + 1)) : String(ops[k][1]);
      const br = add.length ? (add.length > 1 ? (add[0][2] + 1) + ',' + (add[add.length - 1][2] + 1) : String(add[0][2] + 1)) : String(ops[k][2]);
      c.println(ar + (del.length && add.length ? 'c' : del.length ? 'd' : 'a') + br);
      for (const o of del) c.println('< ' + a[o[1]]);
      if (del.length && add.length) c.println('---');
      for (const o of add) c.println('> ' + b[o[2]]);
      k = e;
    }
    return 1;
  };

  C.expr = (c) => {
    const a = c.args;
    try {
      let v;
      if (a[1] === ':' ) { const m = new RegExp('^' + bre2js(a[2])).exec(a[0]); v = m ? (m[1] !== undefined ? m[1] : m[0].length) : 0; }
      else if (a[0] === 'length') v = (a[1] || '').length;
      else if (a[0] === 'substr') v = (a[1] || '').substr(+a[2] - 1, +a[3]);
      else v = L.arith(a.join(' ').replace(/\\\*/g, '*'), c.sh);
      c.println(String(v));
      return v === 0 || v === '' ? 1 : 0;
    } catch (e) { return c.fail('syntax error', 2); }
  };
  C.bc = async (c) => {
    const text = await c.readAll();
    for (const l of lines(text)) {
      if (!l.trim() || /^scale/.test(l)) continue;
      if (!/^[\d\s+\-*/%().^]+$/.test(l)) { c.errln('(standard_in) 1: syntax error'); continue; }
      try { c.println(String(Function('"use strict";return (' + l.replace(/\^/g, '**') + ')')())); } catch (e) { c.errln('(standard_in) 1: syntax error'); }
    }
    return 0;
  };

  // ---------------- sed ----------------
  function parseSed(script, E) {
    const cmds = [];
    let i = 0;
    const s = script;
    const skipWs = () => { while (i < s.length && /[ \t\n;]/.test(s[i])) i++; };
    const readAddr = () => {
      if (s[i] === '$') { i++; return { t: 'last' }; }
      if (/\d/.test(s[i])) { let n = ''; while (/\d/.test(s[i])) n += s[i++]; return { t: 'line', n: +n }; }
      if (s[i] === '/' || s[i] === '\\') {
        const d = s[i] === '\\' ? s[++i] : '/'; i++;
        let re = ''; while (i < s.length && s[i] !== d) { if (s[i] === '\\' && s[i + 1] === d) { re += d; i += 2; continue; } re += s[i++]; } i++;
        let flags = ''; if (s[i] === 'I') { flags = 'i'; i++; }
        return { t: 're', re: new RegExp(bre2js(re, E), flags) };
      }
      return null;
    };
    const readDelim = (d) => { let out = ''; while (i < s.length && s[i] !== d) { if (s[i] === '\\' && s[i + 1] === d) { out += d; i += 2; continue; } if (s[i] === '\\' && s[i + 1] === 'n') { out += '\\n'; i += 2; continue; } out += s[i++]; } i++; return out; };
    while (true) {
      skipWs();
      if (i >= s.length) break;
      const cmd = { a1: readAddr(), a2: null, neg: false };
      if (cmd.a1 && s[i] === ',') { i++; cmd.a2 = readAddr(); }
      while (s[i] === ' ') i++;
      if (s[i] === '!') { cmd.neg = true; i++; }
      while (s[i] === ' ') i++;
      const op = s[i++];
      cmd.op = op;
      if (op === 's') {
        const d = s[i++];
        const re = readDelim(d), rep = readDelim(d);
        let flags = '';
        while (i < s.length && /[gpiI0-9w]/.test(s[i])) flags += s[i++];
        cmd.global = flags.includes('g'); cmd.print = flags.includes('p');
        const nth = /\d+/.exec(flags); cmd.nth = nth ? +nth[0] : 0;
        cmd.re = new RegExp(bre2js(re, E), (flags.includes('i') || flags.includes('I') ? 'i' : '') + 'g');
        cmd.rep = rep.replace(/\$/g, '$$$$').replace(/\\(\d)/g, '$$$1').replace(/(^|[^\\])&/g, '$1$$&').replace(/\\&/g, '&').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      } else if (op === 'y') {
        const d = s[i++]; cmd.from = readDelim(d); cmd.to = readDelim(d);
      } else if (op === 'a' || op === 'i' || op === 'c') {
        if (s[i] === '\\') i++;
        if (s[i] === '\n') i++;
        while (s[i] === ' ') i++;
        let t = ''; while (i < s.length && s[i] !== '\n' && s[i] !== ';') t += s[i++];
        cmd.text = t.replace(/\\n/g, '\n');
      } else if (op === 'q' || op === 'Q') {
        let n = ''; while (/\d/.test(s[i] || '')) n += s[i++]; cmd.code = +(n || 0);
      } else if (op === '{' || op === '}') {
        // bloques simples no soportados salvo agrupación trivial
      } else if (!'dpnNP=hHgGxl'.includes(op)) {
        throw new Error('-e expression #1, char ' + i + ": unknown command: `" + op + "'");
      }
      cmds.push(cmd);
    }
    return cmds;
  }
  function runSed(cmds, text, quiet) {
    const ls = lines(text);
    const out = [];
    const ranges = new Map();
    let hold = '';
    const matchA = (a, n, l, last) => a.t === 'last' ? last : a.t === 'line' ? n === a.n : a.re.test(l);
    for (let idx = 0; idx < ls.length; idx++) {
      let line = ls[idx];
      const n = idx + 1, last = idx === ls.length - 1;
      let deleted = false, quit = null;
      const appends = [];
      for (let k = 0; k < cmds.length; k++) {
        const cm = cmds[k];
        let sel = true;
        if (cm.a1) {
          if (!cm.a2) sel = matchA(cm.a1, n, line, last);
          else {
            const active = ranges.get(k);
            if (active) { sel = true; if (cm.a2.t === 'line' ? n >= cm.a2.n : matchA(cm.a2, n, line, last)) ranges.delete(k); }
            else if (matchA(cm.a1, n, line, last)) { sel = true; if (!(cm.a2.t === 'line' && cm.a2.n <= n)) ranges.set(k, true); }
            else sel = false;
          }
        }
        if (cm.neg) sel = !sel;
        if (!sel) continue;
        switch (cm.op) {
          case 's': {
            let count = 0, did = false;
            line = line.replace(cm.re, (...m) => {
              count++;
              if ((cm.nth && count !== cm.nth) || (!cm.global && !cm.nth && count > 1)) return m[0];
              did = true;
              const groups = m.slice(1, -2);
              return cm.rep.replace(/\$(\d|&)/g, (x, g) => g === '&' ? m[0] : (groups[+g - 1] || '')).replace(/\$\$/g, '$');
            });
            if (did && cm.print) out.push(line);
            break;
          }
          case 'y': line = line.split('').map(ch => { const p = cm.from.indexOf(ch); return p < 0 ? ch : cm.to[p]; }).join(''); break;
          case 'd': deleted = true; break;
          case 'p': out.push(line); break;
          case '=': out.push(String(n)); break;
          case 'a': appends.push(cm.text); break;
          case 'i': out.push(cm.text); break;
          case 'c': if (!cm.a2 || !ranges.get(k)) out.push(cm.text); deleted = true; break;
          case 'q': quit = 'q'; break;
          case 'Q': quit = 'Q'; break;
          case 'h': hold = line; break;
          case 'H': hold += '\n' + line; break;
          case 'g': line = hold; break;
          case 'G': line += '\n' + hold; break;
          case 'x': { const t = hold; hold = line; line = t; break; }
          case 'n': if (!quiet) out.push(line); if (idx + 1 < ls.length) line = ls[++idx]; break;
          case 'N': if (idx + 1 < ls.length) line += '\n' + ls[++idx]; break;
        }
        if (deleted || quit) break;
      }
      if (quit === 'Q') break;
      if (!deleted && !quiet) out.push(line);
      out.push(...appends);
      if (quit) break;
    }
    return out.map(l => l + '\n').join('');
  }
  C.sed = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'nErs', values: 'ef', long: { quiet: 'n', 'in-place': 'i', expression: 'e=', 'regexp-extended': 'E' } });
    let inplace = false, suffix = '';
    const args = rest.filter(a => { if (/^-i/.test(a)) { inplace = true; suffix = a.slice(2); return false; } return true; });
    if (c.args.some(a => /^-i/.test(a) || a === '--in-place')) inplace = true;
    const scripts = [];
    // -e puede repetirse
    for (let k = 0; k < c.args.length; k++) if (c.args[k] === '-e') scripts.push(c.args[k + 1]);
    let files = args.filter(a => !scripts.includes(a) || false);
    if (!scripts.length) { if (!files.length) return c.fail('no script specified', 1); scripts.push(files.shift()); }
    else files = files.filter(f => !scripts.includes(f));
    let cmds;
    try { cmds = parseSed(scripts.join('\n'), opts.E || opts.r); } catch (e) { return c.fail(e.message); }
    if (inplace) {
      let st = 0;
      for (const f of files) {
        try {
          const p = c.resolve(f);
          const txt = c.fs.read(p, c.cred);
          if (suffix) c.fs.write(p + suffix, txt, { cred: c.cred });
          c.fs.write(p, runSed(cmds, txt, !!opts.n), { cred: c.cred });
        } catch (e) { c.err("sed: can't read " + f + ': ' + e.message + '\n'); st = 2; }
      }
      return st;
    }
    const { text, ok } = await c.input(files);
    c.out(runSed(cmds, text, !!opts.n));
    return ok ? 0 : 2;
  };

  // ---------------- awk (subconjunto) ----------------
  function awkCompile(src) {
    // Tokenizer
    const toks = [];
    let i = 0;
    const kw = new Set(['BEGIN', 'END', 'if', 'else', 'while', 'for', 'in', 'print', 'printf', 'next', 'exit', 'return', 'function', 'delete', 'getline', 'do', 'break', 'continue']);
    let lastSig = null;
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || (ch === '\\' && src[i + 1] === '\n')) { i += ch === '\\' ? 2 : 1; continue; }
      if (ch === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (ch === '\n' || ch === ';') { toks.push({ t: 'nl' }); i++; lastSig = null; continue; }
      if (ch === '"') {
        let s = ''; i++;
        while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { const n = src[++i]; s += { n: '\n', t: '\t', '\\': '\\', '"': '"', '/': '/' }[n] || '\\' + n; i++; continue; } s += src[i++]; }
        i++; toks.push(lastSig = { t: 'str', v: s }); continue;
      }
      if (ch === '/' && (!lastSig || ['op', 'nl', '(', ',', '{', '!', '~'].includes(lastSig.t) || (lastSig.t === 'op' && lastSig.v !== ')'))) {
        let s = ''; i++;
        while (i < src.length && src[i] !== '/') { if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; continue; } s += src[i++]; }
        i++; toks.push(lastSig = { t: 're', v: s }); continue;
      }
      let m;
      if ((m = /^\d+(\.\d+)?/.exec(src.slice(i)))) { toks.push(lastSig = { t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_]\w*/.exec(src.slice(i)))) { toks.push(lastSig = kw.has(m[0]) ? { t: 'kw', v: m[0] } : { t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(\+\+|--|\+=|-=|\*=|\/=|%=|\^=|==|!=|<=|>=|&&|\|\||!~|>>|[-+*/%^<>=!~?:(){}\[\],$|])/.exec(src.slice(i)))) {
        const v = m[0];
        const t = ['(', ')', '{', '}', '[', ']', ','].includes(v) ? v : 'op';
        toks.push(lastSig = { t, v }); i += v.length; continue;
      }
      throw new Error('syntax error at source line 1: ' + src.slice(i, i + 10));
    }
    toks.push({ t: 'eof' });
    let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const is = (t, v) => peek().t === t && (v === undefined || peek().v === v);
    const isOp = (v) => (peek().t === 'op' || peek().t === v) && peek().v === v;
    const expect = (t, v) => { if (!(peek().t === t && (v === undefined || peek().v === v)) && !(t === 'op' && isOp(v))) throw new Error('syntax error near ' + JSON.stringify(peek().v || peek().t)); return next(); };
    const skipNl = () => { while (is('nl')) p++; };

    function program() {
      const rules = [], funcs = {};
      skipNl();
      while (!is('eof')) {
        if (is('kw', 'function')) {
          next(); const name = next().v; expect('('); const params = [];
          while (!is(')')) { params.push(next().v); if (is(',')) next(); }
          next(); skipNl(); funcs[name] = { params, body: block() }; skipNl(); continue;
        }
        let pattern = null, kind = 'main';
        if (is('kw', 'BEGIN')) { next(); kind = 'begin'; }
        else if (is('kw', 'END')) { next(); kind = 'end'; }
        else if (!is('{')) { pattern = expr(); if (is(',')) { next(); pattern = { range: [pattern, expr()] }; } }
        let body = null;
        if (is('{')) body = block();
        rules.push({ kind, pattern, body });
        skipNl();
      }
      return { rules, funcs };
    }
    function block() { expect('{'); const st = []; skipNl(); while (!is('}')) { st.push(stmt()); skipNl(); } next(); return { t: 'block', st }; }
    function simpleOrBlock() { skipNl(); return is('{') ? block() : stmt(); }
    function stmt() {
      if (is('{')) return block();
      if (is('kw', 'if')) {
        next(); expect('('); const c = expr(); expect(')'); const th = simpleOrBlock();
        let save = p; skipNl(); if (is('nl')) next();
        let el = null; if (is('kw', 'else')) { next(); el = simpleOrBlock(); } else p = save;
        return { t: 'if', c, th, el };
      }
      if (is('kw', 'while')) { next(); expect('('); const c = expr(); expect(')'); return { t: 'while', c, body: simpleOrBlock() }; }
      if (is('kw', 'for')) {
        next(); expect('(');
        if (peek().t === 'id' && toks[p + 1].t === 'kw' && toks[p + 1].v === 'in') { const v = next().v; next(); const arr = next().v; expect(')'); return { t: 'forin', v, arr, body: simpleOrBlock() }; }
        const init = is(';') || is('nl') ? null : simple(); expect('nl');
        const cond = is('nl') ? null : expr(); expect('nl');
        const inc = is(')') ? null : simple(); expect(')');
        return { t: 'for', init, cond, inc, body: simpleOrBlock() };
      }
      if (is('kw', 'next')) { next(); return { t: 'next' }; }
      if (is('kw', 'exit')) { next(); return { t: 'exit', e: is('nl') || is('}') || is('eof') ? null : expr() }; }
      if (is('kw', 'break')) { next(); return { t: 'break' }; }
      if (is('kw', 'continue')) { next(); return { t: 'continue' }; }
      if (is('kw', 'return')) { next(); return { t: 'return', e: is('nl') || is('}') ? null : expr() }; }
      if (is('kw', 'delete')) { next(); const name = next().v; let idx = null; if (is('[')) { next(); idx = expr(); expect(']'); } return { t: 'delete', name, idx }; }
      return simple();
    }
    function simple() {
      if (is('kw', 'print') || is('kw', 'printf')) {
        const kind = next().v;
        const args = [];
        const paren = is('(') && (() => { let d = 0, k = p; for (; k < toks.length; k++) { if (toks[k].t === '(') d++; else if (toks[k].t === ')') { d--; if (!d) break; } } const after = toks[k + 1]; return !after || after.t === 'nl' || after.t === '}' || (after.t === 'op' && (after.v === '>' || after.v === '>>' || after.v === '|')) || after.t === 'eof'; })();
        if (paren) { next(); while (!is(')')) { args.push(expr(true)); if (is(',')) next(); } next(); }
        else while (!is('nl') && !is('}') && !is('eof') && !(is('op') && (peek().v === '>' || peek().v === '>>' || peek().v === '|'))) { args.push(expr(true)); if (is(',')) next(); else break; }
        let redir = null;
        if (is('op') && (peek().v === '>' || peek().v === '>>')) { const op = next().v; redir = { op, target: primary() }; }
        return { t: kind, args, redir };
      }
      return { t: 'expr', e: expr() };
    }
    // Expresiones (precedencia simplificada)
    function expr(noGt) { return ternary(noGt); }
    function ternary(noGt) { const c = orE(noGt); if (isOp('?')) { next(); const a = ternary(noGt); expect('op', ':'); const b = ternary(noGt); return { t: 'tern', c, a, b }; } return assign(c, noGt); }
    function assign(left, noGt) {
      if (is('op') && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(peek().v) && (left.t === 'var' || left.t === 'idx' || left.t === 'field')) {
        const op = next().v; const r = ternary(noGt); return { t: 'assign', op, l: left, r };
      }
      return left;
    }
    function orE(noGt) { let l = andE(noGt); while (isOp('||')) { next(); skipNl(); l = { t: 'bin', op: '||', l, r: andE(noGt) }; } return l; }
    function andE(noGt) { let l = inE(noGt); while (isOp('&&')) { next(); skipNl(); l = { t: 'bin', op: '&&', l, r: inE(noGt) }; } return l; }
    function inE(noGt) { let l = matchE(noGt); if (is('kw', 'in')) { next(); return { t: 'in', key: l, arr: next().v }; } return l; }
    function matchE(noGt) { let l = cmpE(noGt); while (isOp('~') || isOp('!~')) { const op = next().v; l = { t: 'match', neg: op === '!~', l, r: cmpE(noGt) }; } return l; }
    function cmpE(noGt) { let l = concat(noGt); while (is('op') && ['<', '<=', '==', '!=', '>=', ...(noGt ? [] : ['>'])].includes(peek().v)) { const op = next().v; l = { t: 'bin', op, l, r: concat(noGt) }; } return l; }
    function startsPrimary() {
      const t = peek();
      if (['num', 'str', 'id', '(', 're'].includes(t.t)) return true;
      return t.t === 'op' && (t.v === '$' || t.v === '++' || t.v === '--' || t.v === '!');
    }
    function concat(noGt) {
      let l = addE();
      while (startsPrimary()) l = { t: 'cat', l, r: addE() };
      return l;
    }
    function addE() { let l = mulE(); while (isOp('+') || isOp('-')) { const op = next().v; l = { t: 'bin', op, l, r: mulE() }; } return l; }
    function mulE() { let l = unary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = next().v; l = { t: 'bin', op, l, r: unary() }; } return l; }
    function unary() {
      if (isOp('!')) { next(); return { t: 'not', e: unary() }; }
      if (isOp('-')) { next(); return { t: 'neg', e: unary() }; }
      if (isOp('+')) { next(); return { t: 'num', e: unary(), plus: true }; }
      return pow();
    }
    function pow() { let l = postfix(); if (isOp('^')) { next(); return { t: 'bin', op: '^', l, r: unary() }; } return l; }
    function postfix() {
      if (isOp('++') || isOp('--')) { const op = next().v; const e = postfix(); return { t: 'preinc', op, e }; }
      const e = primary();
      if (isOp('++') || isOp('--')) { const op = next().v; return { t: 'postinc', op, e }; }
      return e;
    }
    function primary() {
      const t = next();
      if (t.t === 'num') return { t: 'lit', v: t.v };
      if (t.t === 'str') return { t: 'lit', v: t.v };
      if (t.t === 're') return { t: 're', v: t.v };
      if (t.t === '(') { const e = expr(); expect(')'); return e; }
      if (t.t === 'op' && t.v === '$') return { t: 'field', e: postfixNoInc() };
      if (t.t === 'id') {
        if (is('(')) { next(); const args = []; while (!is(')')) { args.push(expr()); if (is(',')) next(); } next(); return { t: 'call', name: t.v, args }; }
        if (is('[')) { next(); const k = [expr()]; while (is(',')) { next(); k.push(expr()); } expect(']'); return { t: 'idx', name: t.v, k }; }
        return { t: 'var', name: t.v };
      }
      if (t.t === 'kw' && t.v === 'getline') return { t: 'lit', v: 0 };
      throw new Error('syntax error near ' + JSON.stringify(t.v || t.t));
    }
    function postfixNoInc() { if (is('(')) { next(); const e = expr(); expect(')'); return e; } const t = next(); if (t.t === 'num') return { t: 'lit', v: t.v }; if (t.t === 'id') return { t: 'var', name: t.v }; if (t.t === 'op' && t.v === '$') return { t: 'field', e: postfixNoInc() }; throw new Error('syntax error'); }
    return program();
  }
  class AwkNext { }
  class AwkExit { constructor(c) { this.code = c; } }
  class AwkBreak { } class AwkCont { } class AwkRet { constructor(v) { this.v = v; } }
  function awkRun(prog, inputs, vars, out, c) {
    const V = Object.assign({ FS: ' ', OFS: ' ', ORS: '\n', NR: 0, NF: 0, FNR: 0, FILENAME: '', RS: '\n', SUBSEP: '\x1c' }, vars);
    const A = {};
    let fields = [''];
    const num = (x) => { if (typeof x === 'number') return x; const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(String(x)); return m ? parseFloat(m[0]) : 0; };
    const str = (x) => typeof x === 'number' ? (Number.isInteger(x) ? String(x) : String(+x.toPrecision(6))) : (x === undefined ? '' : String(x));
    const split = (line, fs) => {
      if (fs === ' ') return line.trim() ? line.trim().split(/[ \t]+/) : [];
      if (fs.length === 1 && fs !== ' ') return line.split(fs);
      return line.split(new RegExp(fs));
    };
    const setRecord = (line) => { fields = [line].concat(split(line, V.FS)); V.NF = fields.length - 1; };
    const rebuild = () => { fields[0] = fields.slice(1).join(V.OFS); };
    const locals = [];
    const getVar = (name) => { for (let k = locals.length - 1; k >= 0; k--) if (name in locals[k]) return locals[k][name]; if (name === 'NF') return V.NF; return V[name]; };
    const setVar = (name, v) => { for (let k = locals.length - 1; k >= 0; k--) if (name in locals[k]) { locals[k][name] = v; return; } if (name === 'NF') { V.NF = num(v); fields.length = V.NF + 1; rebuild(); return; } V[name] = v; };
    const arr = (name) => { for (let k = locals.length - 1; k >= 0; k--) if (name in locals[k] && typeof locals[k][name] === 'object') return locals[k][name]; return A[name] = A[name] || {}; };
    const truth = (v) => typeof v === 'number' ? v !== 0 : v !== '' && v !== undefined;
    const toRe = (e) => e.t === 're' ? new RegExp(bre2js(e.v, true)) : new RegExp(str(ev(e)));
    const fmt = (f, args) => {
      let k = 0;
      return f.replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\d+))?([sdifxXoceEgG%])/g, (m, fl, w, pr, t) => {
        if (t === '%') return '%';
        let v = args[k++];
        if (w === '*') { w = num(v); v = args[k++]; }
        let s;
        switch (t) {
          case 'd': case 'i': s = String(Math.trunc(num(v))); break;
          case 'f': s = num(v).toFixed(pr !== undefined ? +pr : 6); break;
          case 'e': case 'E': s = num(v).toExponential(pr !== undefined ? +pr : 6); break;
          case 'g': case 'G': s = String(+num(v).toPrecision(pr !== undefined ? +pr || 1 : 6)); break;
          case 'x': s = Math.trunc(num(v)).toString(16); break; case 'X': s = Math.trunc(num(v)).toString(16).toUpperCase(); break;
          case 'o': s = Math.trunc(num(v)).toString(8); break;
          case 'c': s = typeof v === 'number' ? String.fromCharCode(v) : str(v)[0] || ''; break;
          default: s = str(v); if (pr !== undefined) s = s.slice(0, +pr);
        }
        if (w) s = fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') && t !== 's' ? '0' : ' ');
        return s;
      });
    };
    const lval = (e) => {
      if (e.t === 'var') return [() => getVar(e.name), (v) => setVar(e.name, v)];
      if (e.t === 'field') { const i = Math.trunc(num(ev(e.e))); return [() => fields[i] === undefined ? '' : fields[i], (v) => { if (i === 0) setRecord(str(v)); else { fields[i] = str(v); while (fields.length <= i) fields.push(''); V.NF = Math.max(V.NF, i); rebuild(); } }]; }
      if (e.t === 'idx') { const k = e.k.map(x => str(ev(x))).join(V.SUBSEP); const a = arr(e.name); return [() => a[k] === undefined ? '' : a[k], (v) => { a[k] = v; }]; }
      throw new Error('invalid assignment');
    };
    const builtins = {
      length: (a) => a.length ? (a[0].t === 'var' && A[a[0].name] ? Object.keys(A[a[0].name]).length : str(ev(a[0])).length) : fields[0].length,
      substr: (a) => { const s = str(ev(a[0])); const st = Math.round(num(ev(a[1]))); const n = a[2] ? Math.round(num(ev(a[2]))) : Infinity; const b = Math.max(1, st); const e = Math.min(s.length + 1, st + n); return e > b ? s.slice(b - 1, e - 1) : ''; },
      index: (a) => str(ev(a[0])).indexOf(str(ev(a[1]))) + 1,
      split: (a) => { const s = str(ev(a[0])); const name = a[1].name; const parts = a[2] ? (a[2].t === 're' ? s.split(toRe(a[2])) : split(s, str(ev(a[2])))) : split(s, V.FS); A[name] = {}; parts.forEach((x, i) => A[name][i + 1] = x); return parts.length; },
      tolower: (a) => str(ev(a[0])).toLowerCase(), toupper: (a) => str(ev(a[0])).toUpperCase(),
      int: (a) => Math.trunc(num(ev(a[0]))), sqrt: (a) => Math.sqrt(num(ev(a[0]))), rand: () => Math.random(), srand: () => 0,
      sprintf: (a) => fmt(str(ev(a[0])), a.slice(1).map(ev)),
      sub: (a) => subImpl(a, false), gsub: (a) => subImpl(a, true),
      match: (a) => { const m = toRe(a[1]).exec(str(ev(a[0]))); V.RSTART = m ? m.index + 1 : 0; V.RLENGTH = m ? m[0].length : -1; return V.RSTART; },
      system: () => 0, strftime: () => new Date().toString(), systime: () => Math.floor(Date.now() / 1000)
    };
    function subImpl(a, g) {
      const re = new RegExp(toRe(a[0]).source, g ? 'g' : '');
      const rep = str(ev(a[1]));
      const target = a[2] || { t: 'field', e: { t: 'lit', v: 0 } };
      const [get, set] = lval(target);
      let n = 0;
      const res = str(get()).replace(re, (m) => { n++; return rep.replace(/\\&/g, '\u0001').replace(/&/g, m).replace(/\u0001/g, '&'); });
      if (n) set(res);
      return n;
    }
    function ev(e) {
      switch (e.t) {
        case 'lit': return e.v;
        case 're': return re2match(e);
        case 'var': { const v = getVar(e.name); return v === undefined ? '' : v; }
        case 'field': { const i = Math.trunc(num(ev(e.e))); return fields[i] === undefined ? '' : fields[i]; }
        case 'idx': { const k = e.k.map(x => str(ev(x))).join(V.SUBSEP); const a = arr(e.name); return a[k] === undefined ? '' : a[k]; }
        case 'in': return str(ev(e.key)) in arr(e.arr) ? 1 : 0;
        case 'cat': return str(ev(e.l)) + str(ev(e.r));
        case 'not': return truth(ev(e.e)) ? 0 : 1;
        case 'neg': return -num(ev(e.e));
        case 'num': return num(ev(e.e));
        case 'tern': return truth(ev(e.c)) ? ev(e.a) : ev(e.b);
        case 'match': { const r = toRe(e.r).test(str(ev(e.l))); return (e.neg ? !r : r) ? 1 : 0; }
        case 'assign': {
          const [get, set] = lval(e.l);
          let v = ev(e.r);
          if (e.op !== '=') { const a = num(get()), b = num(v); v = { '+=': a + b, '-=': a - b, '*=': a * b, '/=': a / b, '%=': a % b, '^=': Math.pow(a, b) }[e.op]; }
          set(v); return v;
        }
        case 'preinc': { const [get, set] = lval(e.e); const v = num(get()) + (e.op === '++' ? 1 : -1); set(v); return v; }
        case 'postinc': { const [get, set] = lval(e.e); const v = num(get()); set(v + (e.op === '++' ? 1 : -1)); return v; }
        case 'bin': {
          if (e.op === '&&') return truth(ev(e.l)) && truth(ev(e.r)) ? 1 : 0;
          if (e.op === '||') return truth(ev(e.l)) || truth(ev(e.r)) ? 1 : 0;
          const l = ev(e.l), r = ev(e.r);
          const isNum = (x, node) => typeof x === 'number' || (node.t !== 'lit' && /^\s*[-+]?(\d+\.?\d*|\.\d+)\s*$/.test(String(x)));
          switch (e.op) {
            case '+': return num(l) + num(r); case '-': return num(l) - num(r); case '*': return num(l) * num(r);
            case '/': return num(l) / num(r); case '%': return num(l) % num(r); case '^': return Math.pow(num(l), num(r));
          }
          const both = isNum(l, e.l) && isNum(r, e.r);
          const a = both ? num(l) : str(l), b = both ? num(r) : str(r);
          return ({ '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b, '==': a === b, '!=': a !== b }[e.op]) ? 1 : 0;
        }
        case 'call': {
          if (builtins[e.name]) return builtins[e.name](e.args);
          const f = prog.funcs[e.name];
          if (!f) throw new Error('calling undefined function ' + e.name);
          const frame = {};
          f.params.forEach((pn, k) => { frame[pn] = e.args[k] ? (e.args[k].t === 'var' && A[e.args[k].name] ? A[e.args[k].name] : ev(e.args[k])) : ''; });
          locals.push(frame);
          try { exec(f.body); } catch (x) { if (x instanceof AwkRet) return x.v; throw x; } finally { locals.pop(); }
          return '';
        }
      }
      return '';
    }
    function re2match(e) { return toRe(e).test(fields[0]) ? 1 : 0; }
    function exec(s) {
      switch (s.t) {
        case 'block': for (const x of s.st) exec(x); return;
        case 'expr': ev(s.e); return;
        case 'print': case 'printf': {
          let text;
          if (s.t === 'print') text = (s.args.length ? s.args.map(a => { const v = ev(a); return typeof v === 'number' ? str(v) : v; }).join(V.OFS) : fields[0]) + V.ORS;
          else text = fmt(str(ev(s.args[0])), s.args.slice(1).map(ev));
          if (s.redir) {
            const f = c.resolve(str(ev(s.redir.target)));
            awkRun.files = awkRun.files || {};
            if (s.redir.op === '>' && !awkRun.files[f]) { c.fs.write(f, '', { cred: c.cred }); awkRun.files[f] = true; }
            c.fs.write(f, text, { cred: c.cred, append: true });
          } else out(text);
          return;
        }
        case 'if': if (truth(ev(s.c))) exec(s.th); else if (s.el) exec(s.el); return;
        case 'while': { let g = 0; while (truth(ev(s.c))) { if (++g > 1e6) throw new Error('bucle infinito'); try { exec(s.body); } catch (x) { if (x instanceof AwkBreak) break; if (x instanceof AwkCont) continue; throw x; } } return; }
        case 'for': { let g = 0; if (s.init) exec(s.init); while (!s.cond || truth(ev(s.cond))) { if (++g > 1e6) throw new Error('bucle infinito'); try { exec(s.body); } catch (x) { if (x instanceof AwkBreak) break; if (!(x instanceof AwkCont)) throw x; } if (s.inc) exec(s.inc); } return; }
        case 'forin': { for (const k of Object.keys(arr(s.arr))) { setVar(s.v, k); try { exec(s.body); } catch (x) { if (x instanceof AwkBreak) break; if (!(x instanceof AwkCont)) throw x; } } return; }
        case 'next': throw new AwkNext();
        case 'exit': throw new AwkExit(s.e ? num(ev(s.e)) : 0);
        case 'break': throw new AwkBreak();
        case 'continue': throw new AwkCont();
        case 'return': throw new AwkRet(s.e ? ev(s.e) : '');
        case 'delete': { if (s.idx) delete arr(s.name)[str(ev(s.idx))]; else A[s.name] = {}; return; }
      }
    }
    const rangeOn = new Map();
    let code = 0;
    const doRules = (kind) => { for (const r of prog.rules.filter(r => r.kind === kind)) exec(r.body || { t: 'print', args: [] }); };
    try {
      awkRun.files = {};
      doRules('begin');
      const mains = prog.rules.filter(r => r.kind === 'main');
      if (mains.length || prog.rules.some(r => r.kind === 'end')) {
        for (const inp of inputs) {
          V.FILENAME = inp.name; V.FNR = 0;
          for (const line of lines(inp.text)) {
            V.NR++; V.FNR++;
            setRecord(line);
            try {
              for (const [ri, r] of mains.entries()) {
                let ok = true;
                if (r.pattern && r.pattern.range) {
                  if (rangeOn.get(ri)) { ok = true; if (truth(ev(r.pattern.range[1]))) rangeOn.delete(ri); }
                  else if (truth(ev(r.pattern.range[0]))) { ok = true; if (!truth(ev(r.pattern.range[1]))) rangeOn.set(ri, true); }
                  else ok = false;
                } else if (r.pattern) ok = truth(ev(r.pattern));
                if (ok) exec(r.body || { t: 'print', args: [] });
              }
            } catch (x) { if (!(x instanceof AwkNext)) throw x; }
          }
        }
      }
      doRules('end');
    } catch (x) {
      if (x instanceof AwkExit) { code = x.code; try { doRules('end'); } catch (y) { } }
      else throw x;
    }
    return code;
  }
  C.awk = async (c) => {
    const args = c.args.slice();
    const vars = {};
    let prog = null;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-F') vars.FS = L.cmdutil.unescapeC(args[++i]);
      else if (a.startsWith('-F')) vars.FS = L.cmdutil.unescapeC(a.slice(2));
      else if (a === '-v') { const [k, ...v] = args[++i].split('='); vars[k] = v.join('='); }
      else if (a === '-f') prog = c.fs.read(c.resolve(args[++i]), c.cred);
      else if (prog === null) prog = a;
      else if (/^[A-Za-z_]\w*=/.test(a)) { const [k, ...v] = a.split('='); vars[k] = v.join('='); }
      else files.push(a);
    }
    if (prog === null) return c.fail('usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]', 2);
    if (vars.FS === 't') vars.FS = '\t';
    let compiled;
    try { compiled = awkCompile(prog); } catch (e) { c.err('awk: ' + e.message + '\n awk: ' + prog + '\n'); return 2; }
    const inputs = [];
    if (!files.length) inputs.push({ name: '', text: await c.readAll() });
    for (const f of files) { try { inputs.push({ name: f, text: c.fs.read(c.resolve(f), c.cred) }); } catch (e) { c.err("awk: cannot open \"" + f + "\" (" + e.message + ")\n"); return 2; } }
    try { return awkRun(compiled, inputs, vars, (s) => c.out(s), c); }
    catch (e) { c.err('awk: ' + e.message + '\n'); return 2; }
  };
  C.gawk = C.awk;

  L.textutil = { bre2js, parseSed, runSed };
})(globalThis.JLab = globalThis.JLab || {});
