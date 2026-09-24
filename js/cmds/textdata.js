/*
 * Texto y datos: jq, xmllint, column, comm, fold, shuf, strings, xxd, od,
 * hexdump, envsubst, zgrep, zless.
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, X = L.xml;
  const { getopt, lines } = L.cmdutil;

  // Lee un archivo; si es .gz del laboratorio devuelve su contenido descomprimido
  function readMaybeGz(c, f) {
    const data = c.fs.read(c.resolve(f), c.cred);
    const a = L.archive.decode(data);
    if (a && a.format === 'gz') return a.entries[0] ? (a.entries[0].d || '') : '';
    return data;
  }
  const utf8 = (s) => { const out = []; for (const b of unescape(encodeURIComponent(s))) out.push(b.charCodeAt(0)); return out; };

  // ================= column / comm / fold / shuf =================
  C.column = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'tx', values: 'sco', long: { table: 't', separator: 's=' } });
    const { text, ok } = await c.input(rest);
    const ls = lines(text).filter(l => l.trim() !== '');
    if (!opts.t) {
      const w = Math.max(1, ...ls.map(l => l.length)) + 2;
      const per = Math.max(1, Math.floor((+opts.c || (c.term ? c.term.cols : 80)) / w));
      for (let i = 0; i < ls.length; i += per) c.println(ls.slice(i, i + per).map(x => x.padEnd(w)).join('').trimEnd());
      return ok ? 0 : 1;
    }
    const sep = opts.s !== undefined ? new RegExp('[' + opts.s.replace(/[\]\\^-]/g, '\\$&') + ']') : /\s+/;
    const rows = ls.map(l => (opts.s !== undefined ? l : l.trim()).split(sep));
    const w = [];
    for (const r of rows) r.forEach((x, i) => { w[i] = Math.max(w[i] || 0, x.length); });
    const osep = opts.o !== undefined ? opts.o : '  ';
    for (const r of rows) c.println(r.map((x, i) => i === r.length - 1 ? x : x.padEnd(w[i])).join(osep));
    return ok ? 0 : 1;
  };
  C.comm = (c) => {
    const { opts, rest } = getopt(c.args, { flags: '123' });
    if (rest.length < 2) return c.fail('missing operand');
    let a, b;
    try { a = lines(c.fs.read(c.resolve(rest[0]), c.cred)); b = lines(c.fs.read(c.resolve(rest[1]), c.cred)); } catch (e) { return c.fail(e.message); }
    let i = 0, j = 0;
    const col = (n, s) => { if (opts[n]) return; const ind = ['1', '2'].filter(k => k < n && !opts[k]).length; c.println('\t'.repeat(ind) + s); };
    while (i < a.length || j < b.length) {
      if (j >= b.length || (i < a.length && a[i] < b[j])) col('1', a[i++]);
      else if (i >= a.length || b[j] < a[i]) col('2', b[j++]);
      else { col('3', a[i]); i++; j++; }
    }
    return 0;
  };
  C.fold = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'sb', values: 'w', numeric: true });
    const w = +(opts.w || opts.num || 80);
    const { text, ok } = await c.input(rest);
    for (const l of lines(text)) {
      if (!l.length) { c.println(''); continue; }
      let s = l;
      while (s.length > w) {
        let cut = w;
        if (opts.s) { const sp = s.lastIndexOf(' ', w - 1); if (sp > 0) cut = sp + 1; }
        c.println(s.slice(0, cut)); s = s.slice(cut);
      }
      c.println(s);
    }
    return ok ? 0 : 1;
  };
  C.shuf = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'er', values: 'ni', long: { 'head-count': 'n=', 'input-range': 'i=' } });
    let items;
    if (opts.i) { const [a, b] = opts.i.split('-').map(Number); items = []; for (let x = a; x <= b; x++) items.push(String(x)); }
    else if (opts.e) items = rest.slice();
    else items = lines((await c.input(rest)).text);
    for (let k = items.length - 1; k > 0; k--) { const r = Math.floor(Math.random() * (k + 1)); [items[k], items[r]] = [items[r], items[k]]; }
    if (opts.n !== undefined) items = items.slice(0, +opts.n);
    c.out(items.map(x => x + '\n').join(''));
    return 0;
  };

  // ================= strings / xxd / od / hexdump =================
  C.strings = async (c) => {
    const { opts, rest } = getopt(c.args, { values: 'n', numeric: true });
    const min = +(opts.n || opts.num || 4);
    let st = 0;
    for (const f of rest.length ? rest : ['-']) {
      let data;
      try { data = f === '-' ? await c.readAll() : c.fs.read(c.resolve(f), c.cred); } catch (e) { c.err('strings: ' + f + ': ' + e.message + '\n'); st = 1; continue; }
      const node = f === '-' ? null : c.fs.stat(c.resolve(f));
      if (node && node.bi) data += '\n/lib64/ld-linux-x86-64.so.2\nlibc.so.6\nGLIBC_2.34\n__libc_start_main\n' + node.bi + '\n--help\n--version\nUsage: %s [OPTION]...\n';
      for (const m of data.match(new RegExp('[\\x20-\\x7e\\t]{' + min + ',}', 'g')) || []) c.println(m);
    }
    return st;
  };
  function hexRows(bytes, per) { const out = []; for (let i = 0; i < bytes.length; i += per) out.push([i, bytes.slice(i, i + per)]); return out; }
  const hx = (n, w) => n.toString(16).padStart(w, '0');
  const pr = (b) => b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  async function bytesOf(c, rest) {
    if (!rest.length || rest[0] === '-') return utf8(await c.readAll());
    return utf8(c.fs.read(c.resolve(rest[0]), c.cred));
  }
  C.xxd = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'pu', values: 'lsc' });
    let b;
    try { b = await bytesOf(c, rest); } catch (e) { return c.fail(rest[0] + ': ' + e.message, 2); }
    if (opts.s) b = b.slice(+opts.s);
    if (opts.l) b = b.slice(0, +opts.l);
    if (opts.p) { c.println((b.map(x => hx(x, 2)).join('').match(/.{1,60}/g) || []).join('\n')); return 0; }
    const per = +(opts.c || 16);
    for (const [off, row] of hexRows(b, per)) {
      let hex = '';
      for (let i = 0; i < per; i += 2) hex += (row[i] !== undefined ? hx(row[i], 2) : '  ') + (row[i + 1] !== undefined ? hx(row[i + 1], 2) : '  ') + ' ';
      c.println(hx(off + (+opts.s || 0), 8) + ': ' + (opts.u ? hex.toUpperCase() : hex) + ' ' + row.map(pr).join(''));
    }
    return 0;
  };
  C.hexdump = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'Cvbcx', values: 'ns' });
    let b;
    try { b = await bytesOf(c, rest); } catch (e) { return c.fail(rest[0] + ': ' + e.message); }
    if (opts.s) b = b.slice(+opts.s);
    if (opts.n) b = b.slice(0, +opts.n);
    if (opts.C) {
      for (const [off, row] of hexRows(b, 16)) {
        const h = row.map(x => hx(x, 2));
        c.println(hx(off, 8) + '  ' + (h.slice(0, 8).join(' ')).padEnd(23) + '  ' + (h.slice(8).join(' ')).padEnd(23) + '  |' + row.map(pr).join('') + '|');
      }
      c.println(hx(b.length, 8));
      return 0;
    }
    for (const [off, row] of hexRows(b, 16)) {
      const words = [];
      for (let i = 0; i < row.length; i += 2) words.push(hx((row[i + 1] || 0) * 256 + row[i], 4));
      c.println(hx(off, 7) + ' ' + words.join(' '));
    }
    c.println(hx(b.length, 7));
    return 0;
  };
  C.od = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'cbxdv', values: 'At', long: { format: 't=' } });
    let b;
    try { b = await bytesOf(c, rest); } catch (e) { return c.fail(rest[0] + ': ' + e.message); }
    const radix = opts.A === 'x' ? 16 : opts.A === 'd' ? 10 : opts.A === 'n' ? 0 : 8;
    const addr = (n) => radix ? n.toString(radix).padStart(7, '0') : '';
    const fmt = opts.c ? 'c' : opts.x ? 'x2' : opts.b ? 'o1' : opts.t || 'o2';
    for (const [off, row] of hexRows(b, 16)) {
      let cells;
      if (fmt === 'c') cells = row.map(x => ({ 10: '\\n', 9: '\\t', 13: '\\r', 0: '\\0' }[x] || pr(x)).padStart(4));
      else if (fmt === 'x1') cells = row.map(x => ' ' + hx(x, 2));
      else if (fmt === 'o1') cells = row.map(x => ' ' + x.toString(8).padStart(3, '0'));
      else if (fmt === 'd1' || fmt === 'u1') cells = row.map(x => String(x).padStart(4));
      else {
        cells = [];
        for (let i = 0; i < row.length; i += 2) { const v = (row[i + 1] || 0) * 256 + row[i]; cells.push(' ' + (fmt === 'x2' ? hx(v, 4) : v.toString(8).padStart(6, '0'))); }
      }
      c.println(addr(off) + cells.join(''));
    }
    if (radix) c.println(addr(b.length));
    return 0;
  };

  // ================= envsubst / zgrep / zless =================
  C.envsubst = async (c) => {
    const shellFormat = c.args.find(a => !a.startsWith('-'));
    const allowed = shellFormat ? new Set((shellFormat.match(/\$\{?(\w+)\}?/g) || []).map(x => x.replace(/[${}]/g, ''))) : null;
    if (c.args.includes('-v') || c.args.includes('--variables')) { for (const v of allowed || []) c.println(v); return 0; }
    const env = c.sh.exportedEnv();
    const text = await c.readAll();
    c.out(text.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => { const k = a || b; if (allowed && !allowed.has(k)) return m; return env[k] !== undefined ? env[k] : ''; }));
    return 0;
  };
  C.zgrep = async (c) => {
    const opts = [], files = [];
    let pattern = null;
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === '-e') { opts.push(a, c.args[++i]); pattern = pattern || ''; continue; }
      if (a.startsWith('-')) { opts.push(a); if (/^-[ABCm]$/.test(a)) opts.push(c.args[++i]); continue; }
      if (pattern === null) { pattern = a; opts.push(a); continue; }
      files.push(a);
    }
    if (!files.length) return C.grep(c);
    let found = false, st = 0;
    for (const f of files) {
      let text;
      try { text = readMaybeGz(c, f); } catch (e) { c.err('gzip: ' + f + ': ' + e.message + '\n'); st = 2; continue; }
      const buf = new L.shio.BufferSink();
      const r = await c.sh.execCommand(['grep'].concat(opts), { stdin: new L.shio.StringSource(text), stdout: buf, stderr: c.io.stderr });
      if (r === 0) found = true;
      c.out(files.length > 1 ? buf.data.replace(/^(?=.)/gm, f + ':') : buf.data);
    }
    return st || (found ? 0 : 1);
  };
  C.zless = async (c) => {
    const f = c.args.filter(a => !a.startsWith('-'))[0];
    if (!f) return c.fail('Missing filename');
    let text;
    try { text = readMaybeGz(c, f); } catch (e) { return c.fail(f + ': ' + e.message); }
    return L.pager(c, text, f);
  };

  // ================= jq (subconjunto del lenguaje) =================
  function jqCompile(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      let m;
      if (ch === '"') {
        let s = ''; i++;
        while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { const n = src[++i]; s += { n: '\n', t: '\t', '"': '"', '\\': '\\' }[n] || n; i++; continue; } s += src[i++]; }
        i++; toks.push({ t: 'str', v: s }); continue;
      }
      if ((m = /^\d+(\.\d+)?/.exec(src.slice(i)))) { toks.push({ t: 'num', v: +m[0] }); i += m[0].length; continue; }
      if ((m = /^\$[A-Za-z_]\w*/.exec(src.slice(i)))) { toks.push({ t: 'var', v: m[0].slice(1) }); i += m[0].length; continue; }
      if ((m = /^\.[A-Za-z_][\w-]*/.exec(src.slice(i)))) { toks.push({ t: 'field', v: m[0].slice(1) }); i += m[0].length; continue; }
      if ((m = /^[A-Za-z_]\w*/.exec(src.slice(i)))) { toks.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(==|!=|<=|>=|\/\/|\.\.|[.|,()[\]{}:<>+\-*/?])/.exec(src.slice(i)))) { toks.push({ t: 'op', v: m[0] }); i += m[0].length; continue; }
      throw new Error('syntax error, unexpected ' + JSON.stringify(ch));
    }
    toks.push({ t: 'eof' });
    let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const isId = (v) => peek().t === 'id' && peek().v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error('syntax error, expected ' + v); p++; };
    function pipe() { let l = comma(); while (isOp('|')) { p++; const r = comma(); const a = l; l = { t: 'pipe', l: a, r }; } return l; }
    function comma() { let l = alt(); while (isOp(',')) { p++; l = { t: 'comma', l, r: alt() }; } return l; }
    function alt() { let l = or(); while (isOp('//')) { p++; l = { t: 'alt', l, r: or() }; } return l; }
    function or() { let l = and(); while (isId('or')) { p++; l = { t: 'bin', op: 'or', l, r: and() }; } return l; }
    function and() { let l = cmp(); while (isId('and')) { p++; l = { t: 'bin', op: 'and', l, r: cmp() }; } return l; }
    function cmp() { let l = add(); while (peek().t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) { const op = next().v; l = { t: 'bin', op, l, r: add() }; } return l; }
    function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = next().v; l = { t: 'bin', op, l, r: mul() }; } return l; }
    function mul() { let l = postfix(); while (isOp('*') || isOp('/')) { const op = next().v; l = { t: 'bin', op, l, r: postfix() }; } return l; }
    function postfix() {
      let e = primary();
      for (;;) {
        if (peek().t === 'field') { e = { t: 'pipe', l: e, r: { t: 'field', v: next().v } }; continue; }
        if (isOp('.') && toks[p + 1] && toks[p + 1].t === 'str') { p++; e = { t: 'pipe', l: e, r: { t: 'field', v: next().v } }; continue; }
        if (isOp('[')) { e = { t: 'pipe', l: e, r: index() }; continue; }
        if (isOp('?')) { p++; e = { t: 'try', e }; continue; }
        break;
      }
      return e;
    }
    function index() {
      expect('[');
      if (isOp(']')) { p++; return { t: 'iter' }; }
      const e = pipe();
      if (isOp(':')) { p++; const e2 = isOp(']') ? null : pipe(); expect(']'); return { t: 'slice', a: e, b: e2 }; }
      expect(']');
      return { t: 'index', e };
    }
    function primary() {
      const t = peek();
      if (t.t === 'field') { p++; return { t: 'field', v: t.v }; }
      if (isOp('..')) { p++; return { t: 'recurse' }; }
      if (isOp('.')) {
        p++;
        if (peek().t === 'str') return { t: 'field', v: next().v };
        if (isOp('[')) return index();
        return { t: 'id' };
      }
      if (t.t === 'num') { p++; return { t: 'lit', v: t.v }; }
      if (t.t === 'str') { p++; return { t: 'lit', v: t.v }; }
      if (t.t === 'var') { p++; return { t: 'var', v: t.v }; }
      if (isOp('(')) { p++; const e = pipe(); expect(')'); return e; }
      if (isOp('-')) { p++; return { t: 'bin', op: '-', l: { t: 'lit', v: 0 }, r: postfix() }; }
      if (isOp('[')) { p++; if (isOp(']')) { p++; return { t: 'arr', e: null }; } const e = pipe(); expect(']'); return { t: 'arr', e }; }
      if (isOp('{')) {
        p++; const fields = [];
        while (!isOp('}')) {
          let key, val;
          if (peek().t === 'id' || peek().t === 'str') { key = { t: 'lit', v: next().v }; }
          else if (peek().t === 'var') { const v = next().v; key = { t: 'lit', v }; val = { t: 'var', v }; }
          else if (isOp('(')) { p++; key = pipe(); expect(')'); }
          else throw new Error('syntax error in object construction');
          if (isOp(':')) { p++; val = alt(); }
          else if (!val) val = { t: 'field', v: key.v };
          fields.push([key, val]);
          if (isOp(',')) p++;
        }
        p++;
        return { t: 'obj', fields };
      }
      if (t.t === 'id') {
        p++;
        if (t.v === 'true' || t.v === 'false') return { t: 'lit', v: t.v === 'true' };
        if (t.v === 'null') return { t: 'lit', v: null };
        if (t.v === 'not') return { t: 'call', name: 'not', args: [] };
        if (t.v === 'if') {
          const c1 = pipe(); if (!isId('then')) throw new Error('expected then'); p++;
          const a = pipe(); let b = { t: 'id' };
          if (isId('elif')) throw new Error('elif no soportado; use if/else anidados');
          if (isId('else')) { p++; b = pipe(); }
          if (!isId('end')) throw new Error('expected end'); p++;
          return { t: 'if', c: c1, a, b };
        }
        const args = [];
        if (isOp('(')) { p++; while (!isOp(')')) { args.push(pipe()); if (isOp(';')) p++; } p++; }
        return { t: 'call', name: t.v, args };
      }
      throw new Error('syntax error, unexpected ' + (t.v || t.t));
    }
    const ast = pipe();
    if (peek().t !== 'eof') throw new Error('syntax error, unexpected ' + JSON.stringify(peek().v));
    return ast;
  }
  const jqType = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v;
  const jqCmp = (a, b) => {
    const order = ['null', 'boolean', 'number', 'string', 'array', 'object'];
    const ta = order.indexOf(jqType(a)), tb = order.indexOf(jqType(b));
    if (ta !== tb) return ta - tb;
    if (typeof a === 'number' || typeof a === 'string' || typeof a === 'boolean') return a < b ? -1 : a > b ? 1 : 0;
    return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
  };
  const truthy = (v) => v !== false && v !== null;
  function jqEval(n, input, env) {
    const one = (e, x) => { const r = jqEval(e, x, env); return r; };
    switch (n.t) {
      case 'id': return [input];
      case 'lit': return [n.v];
      case 'var': if (!(n.v in env)) throw new Error('$' + n.v + ' is not defined'); return [env[n.v]];
      case 'field':
        if (input === null) return [null];
        if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Cannot index ' + jqType(input) + ' with "' + n.v + '"');
        return [input[n.v] === undefined ? null : input[n.v]];
      case 'iter':
        if (Array.isArray(input)) return input.slice();
        if (input && typeof input === 'object') return Object.values(input);
        throw new Error('Cannot iterate over ' + jqType(input) + (input === null ? '' : ' (' + JSON.stringify(input) + ')'));
      case 'index': return one(n.e, input).map(k => {
        if (input === null) return null;
        if (typeof k === 'number') { if (!Array.isArray(input)) throw new Error('Cannot index ' + jqType(input) + ' with number'); const v = input[k < 0 ? input.length + k : k]; return v === undefined ? null : v; }
        if (Array.isArray(input)) throw new Error('Cannot index array with string "' + k + '"');
        return input[k] === undefined ? null : input[k];
      });
      case 'slice': { const a = n.a ? one(n.a, input)[0] : 0, b = n.b ? one(n.b, input)[0] : undefined; return [input === null ? null : input.slice(a, b)]; }
      case 'recurse': { const out = []; const walk = (v) => { out.push(v); if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x); }; walk(input); return out; }
      case 'pipe': { const out = []; for (const x of one(n.l, input)) out.push(...one(n.r, x)); return out; }
      case 'comma': return one(n.l, input).concat(one(n.r, input));
      case 'alt': { const l = (() => { try { return one(n.l, input).filter(truthy); } catch (e) { return []; } })(); return l.length ? l : one(n.r, input); }
      case 'try': try { return one(n.e, input); } catch (e) { return []; }
      case 'arr': return [n.e ? one(n.e, input) : []];
      case 'obj': {
        let objs = [{}];
        for (const [k, v] of n.fields) {
          const keys = one(k, input), vals = one(v, input), next = [];
          for (const o of objs) for (const kk of keys) for (const vv of vals) next.push(Object.assign({}, o, { [kk]: vv }));
          objs = next;
        }
        return objs;
      }
      case 'if': return one(n.c, input).flatMap(cv => truthy(cv) ? one(n.a, input) : one(n.b, input));
      case 'bin': {
        const out = [];
        for (const r of one(n.r, input)) for (const l of one(n.l, input)) {
          switch (n.op) {
            case 'and': out.push(truthy(l) && truthy(r)); break;
            case 'or': out.push(truthy(l) || truthy(r)); break;
            case '==': out.push(jqCmp(l, r) === 0); break;
            case '!=': out.push(jqCmp(l, r) !== 0); break;
            case '<': out.push(jqCmp(l, r) < 0); break;
            case '>': out.push(jqCmp(l, r) > 0); break;
            case '<=': out.push(jqCmp(l, r) <= 0); break;
            case '>=': out.push(jqCmp(l, r) >= 0); break;
            case '+':
              if (l === null) out.push(r); else if (r === null) out.push(l);
              else if (Array.isArray(l)) out.push(l.concat(r));
              else if (typeof l === 'object') out.push(Object.assign({}, l, r));
              else if (typeof l !== typeof r) throw new Error(jqType(l) + ' (' + JSON.stringify(l) + ') and ' + jqType(r) + ' (' + JSON.stringify(r) + ') cannot be added');
              else out.push(l + r);
              break;
            case '-': out.push(Array.isArray(l) ? l.filter(x => !r.some(y => jqCmp(x, y) === 0)) : l - r); break;
            case '*': out.push(l * r); break;
            case '/': out.push(typeof l === 'string' ? l.split(r) : l / r); break;
          }
        }
        return out;
      }
      case 'call': {
        const a = n.args;
        const arg = (i, x) => one(a[i], x === undefined ? input : x);
        switch (n.name) {
          case 'empty': return [];
          case 'not': return [!truthy(input)];
          case 'length': return [input === null ? 0 : typeof input === 'number' ? Math.abs(input) : typeof input === 'object' && !Array.isArray(input) ? Object.keys(input).length : input.length];
          case 'keys': case 'keys_unsorted': return [Array.isArray(input) ? input.map((_, i) => i) : (n.name === 'keys' ? Object.keys(input).sort() : Object.keys(input))];
          case 'values': return truthy(input) ? [input] : [];
          case 'has': return [Array.isArray(input) ? arg(0)[0] < input.length : Object.prototype.hasOwnProperty.call(input, arg(0)[0])];
          case 'select': return arg(0).some(truthy) ? [input] : [];
          case 'map': if (!Array.isArray(input) && (typeof input !== 'object' || input === null)) throw new Error('Cannot iterate over ' + jqType(input)); return [(Array.isArray(input) ? input : Object.values(input)).flatMap(x => arg(0, x))];
          case 'map_values': { const o = Array.isArray(input) ? [] : {}; for (const [k, v] of Object.entries(input)) { const r = arg(0, v); if (r.length) o[k] = r[0]; } return [o]; }
          case 'to_entries': return [Object.entries(input).map(([key, value]) => ({ key, value }))];
          case 'from_entries': return [Object.fromEntries(input.map(e => [e.key !== undefined ? e.key : e.name, e.value]))];
          case 'with_entries': return [Object.fromEntries(Object.entries(input).map(([key, value]) => arg(0, { key, value })[0]).filter(Boolean).map(e => [e.key, e.value]))];
          case 'add': return [input.reduce((acc, x) => acc === null ? x : (Array.isArray(acc) ? acc.concat(x) : typeof acc === 'object' ? Object.assign({}, acc, x) : acc + x), null)];
          case 'sort': return [input.slice().sort(jqCmp)];
          case 'sort_by': return [input.slice().sort((x, y) => jqCmp(arg(0, x)[0], arg(0, y)[0]))];
          case 'group_by': { const g = {}; for (const x of input) { const k = JSON.stringify(arg(0, x)[0]); (g[k] = g[k] || []).push(x); } return [Object.keys(g).sort().map(k => g[k])]; }
          case 'unique': return [Array.from(new Map(input.map(x => [JSON.stringify(x), x])).values()).sort(jqCmp)];
          case 'min': return [input.length ? input.slice().sort(jqCmp)[0] : null];
          case 'max': return [input.length ? input.slice().sort(jqCmp)[input.length - 1] : null];
          case 'reverse': return [Array.isArray(input) ? input.slice().reverse() : String(input).split('').reverse().join('')];
          case 'first': return a.length ? arg(0).slice(0, 1) : [input[0] === undefined ? null : input[0]];
          case 'last': return a.length ? arg(0).slice(-1) : [input[input.length - 1] === undefined ? null : input[input.length - 1]];
          case 'type': return [jqType(input)];
          case 'tostring': return [typeof input === 'string' ? input : JSON.stringify(input)];
          case 'tonumber': { const v = Number(input); if (isNaN(v)) throw new Error('Cannot parse ' + JSON.stringify(input) + ' as JSON'); return [v]; }
          case 'ascii_downcase': return [String(input).toLowerCase()];
          case 'ascii_upcase': return [String(input).toUpperCase()];
          case 'test': return [new RegExp(arg(0)[0], a[1] ? arg(1)[0] : '').test(input)];
          case 'startswith': return [String(input).startsWith(arg(0)[0])];
          case 'endswith': return [String(input).endsWith(arg(0)[0])];
          case 'contains': { const needle = arg(0)[0]; return [typeof input === 'string' ? input.includes(needle) : JSON.stringify(input).includes(JSON.stringify(needle).slice(1, -1))]; }
          case 'split': return [String(input).split(arg(0)[0])];
          case 'join': return [input.map(x => x === null ? '' : String(x)).join(arg(0)[0])];
          case 'ltrimstr': { const s = arg(0)[0]; return [typeof input === 'string' && input.startsWith(s) ? input.slice(s.length) : input]; }
          case 'rtrimstr': { const s = arg(0)[0]; return [typeof input === 'string' && input.endsWith(s) ? input.slice(0, -s.length) : input]; }
          case 'sub': case 'gsub': { const re = new RegExp(arg(0)[0], n.name === 'gsub' ? 'g' : ''); return [String(input).replace(re, arg(1)[0])]; }
          case 'paths': { const out = []; const walk = (v, pth) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { const kk = Array.isArray(v) ? +k : k; out.push(pth.concat([kk])); walk(x, pth.concat([kk])); } }; walk(input, []); return out; }
          case 'env': return [env.$ENV || {}];
          case 'tojson': return [JSON.stringify(input)];
          case 'fromjson': return [JSON.parse(input)];
          case 'range': { const x = arg(0)[0], y = a[1] ? arg(1)[0] : null; const out = []; for (let k = y === null ? 0 : x; k < (y === null ? x : y); k++) out.push(k); return out; }
          case 'floor': return [Math.floor(input)];
          case 'sqrt': return [Math.sqrt(input)];
          case 'any': return [(a.length ? input.map(x => arg(0, x)[0]) : input).some(truthy)];
          case 'all': return [(a.length ? input.map(x => arg(0, x)[0]) : input).every(truthy)];
          case 'error': throw new Error(a.length ? arg(0)[0] : JSON.stringify(input));
        }
        throw new Error(n.name + '/' + a.length + ' is not defined');
      }
    }
    throw new Error('expresión no soportada');
  }
  function jqFormat(v, compact, raw, indent) {
    if (raw && typeof v === 'string') return v;
    if (compact) return JSON.stringify(v);
    return JSON.stringify(v, null, indent);
  }
  function colorJson(s) {
    return s.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g, (m, str, colon, bool) => {
      if (str) return colon ? '\x1b[34;1m' + str + '\x1b[0m' + colon : '\x1b[0;32m' + str + '\x1b[0m';
      if (bool) return '\x1b[0;39m' + m + '\x1b[0m';
      if (m === 'null') return '\x1b[1;30m' + m + '\x1b[0m';
      return '\x1b[0;39m' + m + '\x1b[0m';
    });
  }
  C.jq = async (c) => {
    const args = c.args.slice();
    const env = { $ENV: c.sh.exportedEnv() };
    let raw = false, compact = false, nullIn = false, slurp = false, exitStatus = false, tab = false, color = null, filter = null;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--arg') { env[args[i + 1]] = args[i + 2]; i += 2; continue; }
      if (a === '--argjson') { try { env[args[i + 1]] = JSON.parse(args[i + 2]); } catch (e) { return c.fail('Invalid JSON text passed to --argjson', 2); } i += 2; continue; }
      if (/^-[a-zA-Z]+$/.test(a) || a.startsWith('--')) {
        if (a === '--raw-output' || (a.startsWith('-') && !a.startsWith('--') && a.includes('r'))) raw = true;
        if (a === '--compact-output' || (a.startsWith('-') && !a.startsWith('--') && a.includes('c'))) compact = true;
        if (a === '--null-input' || (a.startsWith('-') && !a.startsWith('--') && a.includes('n'))) nullIn = true;
        if (a === '--slurp' || (a.startsWith('-') && !a.startsWith('--') && a.includes('s'))) slurp = true;
        if (a === '--exit-status' || (a.startsWith('-') && !a.startsWith('--') && a.includes('e'))) exitStatus = true;
        if (a === '--tab') tab = true;
        if (a === '--monochrome-output' || (!a.startsWith('--') && a.includes('M'))) color = false;
        if (a === '--color-output' || (!a.startsWith('--') && a.includes('C'))) color = true;
        continue;
      }
      if (filter === null) filter = a; else files.push(a);
    }
    if (filter === null) { c.err('Usage:\tjq [OPTIONS] FILTER [FILES...]\n\tjq [OPTIONS] --args FILTER [ARGS...]\n\nExample:\n\t$ echo \'{"foo": 0}\' | jq .\n\t{\n\t  "foo": 0\n\t}\n'); return 2; }
    let ast;
    try { ast = jqCompile(filter); } catch (e) { c.err('jq: error: ' + e.message + ' (Unix shell quoting issues?) at <top-level>, line 1:\n' + filter + '\njq: 1 compile error\n'); return 3; }
    let text = '';
    if (!nullIn) {
      if (files.length) { for (const f of files) { try { text += c.fs.read(c.resolve(f), c.cred) + '\n'; } catch (e) { c.err('jq: error: Could not open ' + f + ': ' + e.message + '\n'); return 2; } } }
      else text = await c.readAll();
    }
    // varios documentos JSON concatenados
    const inputs = [];
    if (nullIn) inputs.push(null);
    else {
      let rest = text.trim();
      while (rest) {
        let parsed = null, used = 0;
        for (let k = rest.length; k > 0; k--) {
          if (k < rest.length && !/[\]}"\d\se]/.test(rest[k - 1])) continue;
          try { parsed = JSON.parse(rest.slice(0, k)); used = k; break; } catch (e) { }
          if (rest.length - k > 2e5) break;
        }
        if (!used) { c.err('jq: error (at <stdin>:' + (text.split('\n').length) + '): Cannot parse input: Invalid numeric literal at line 1, column ' + Math.min(rest.length, 10) + '\n'); return 2; }
        inputs.push(parsed);
        rest = rest.slice(used).trim();
      }
    }
    const docs = slurp ? [inputs] : inputs;
    const useColor = color !== null ? color : c.isTTY;
    let last = null;
    for (const d of docs) {
      let outs;
      try { outs = jqEval(ast, d, env); }
      catch (e) { c.err('jq: error (at <stdin>:0): ' + e.message + '\n'); return 5; }
      for (const o of outs) {
        last = o;
        const s = jqFormat(o, compact, raw, tab ? '\t' : 2);
        c.println(useColor && !(raw && typeof o === 'string') ? colorJson(s) : s);
      }
    }
    return exitStatus ? (last === null || last === false ? 1 : 0) : 0;
  };

  // ================= xmllint (XPath 1.0 subconjunto) =================
  // Un elemento tiene espacio de nombres si él o un ancestro declara xmlns="...":
  // igual que en libxml2, //socket-binding NO encuentra nada en standalone.xml.
  function nsOf(n) { for (let e = n; e && e.type === 'element'; e = e.parent) { const d = X.attr(e, 'xmlns'); if (d !== undefined) return d; } return ''; }
  function xpathEval(doc, expr) {
    expr = expr.trim();
    let m;
    if ((m = /^count\((.*)\)$/s.exec(expr))) return { type: 'number', value: xpathEval(doc, m[1]).nodes.length };
    if ((m = /^string\((.*)\)$/s.exec(expr))) { const r = xpathEval(doc, m[1]); const n = r.nodes[0]; return { type: 'string', value: n ? nodeString(n) : '' }; }
    if ((m = /^normalize-space\((.*)\)$/s.exec(expr))) { const r = xpathEval(doc, m[1]); const n = r.nodes[0]; return { type: 'string', value: n ? nodeString(n).replace(/\s+/g, ' ').trim() : '' }; }
    // tokeniza en pasos respetando corchetes y comillas
    const steps = [];
    let i = 0, cur = '', depth = 0, q = null, axisDesc = false;
    if (!expr.startsWith('/')) expr = '/' + expr;
    const flush = () => { if (cur) { steps.push({ desc: axisDesc, test: cur }); cur = ''; axisDesc = false; } };
    while (i < expr.length) {
      const ch = expr[i];
      if (q) { cur += ch; if (ch === q) q = null; i++; continue; }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; i++; continue; }
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === '/' && depth === 0) { flush(); if (expr[i + 1] === '/') { axisDesc = true; i += 2; } else i++; continue; }
      cur += ch; i++;
    }
    flush();
    let ctx = [doc];
    for (const st of steps) {
      const sm = /^([^[]+)((?:\[.*?\])*)$/s.exec(st.test);
      if (!sm) throw new Error('Invalid expression');
      const test = sm[1].trim();
      const preds = (sm[2].match(/\[((?:[^\]"']|"[^"]*"|'[^']*')*)\]/g) || []).map(x => x.slice(1, -1));
      let out = [];
      for (const node of ctx) {
        let cands = [];
        const kids = (n) => (n.children || []).filter(k => k.type === 'element');
        const descendants = (n) => { const r = []; (function w(x) { for (const k of kids(x)) { r.push(k); w(k); } })(n); return r; };
        if (test.startsWith('@')) {
          const an = test.slice(1);
          const owners = st.desc ? [node].concat(descendants(node)) : [node];
          for (const o of owners) for (const a of o.attrs || []) if (an === '*' || a[0] === an) cands.push({ type: 'attr', name: a[0], value: a[1], owner: o });
        } else if (test === 'text()') {
          const owners = st.desc ? [node].concat(descendants(node)) : [node];
          for (const o of owners) for (const k of o.children || []) if (k.type === 'text' && k.value.trim()) cands.push(k);
        } else if (test === '.') cands = [node];
        else if (test === '..') cands = node.parent ? [node.parent] : [];
        else {
          const pool = st.desc ? descendants(node) : kids(node);
          cands = pool.filter(e => test === '*' || (e.name === test && !nsOf(e)) || (test.includes(':') && X.local(e.name) === X.local(test)));
        }
        for (const pr of preds) {
          let pm;
          if (/^\d+$/.test(pr.trim())) { const k = +pr - 1; cands = cands[k] ? [cands[k]] : []; continue; }
          if (pr.trim() === 'last()') { cands = cands.slice(-1); continue; }
          cands = cands.filter(e => {
            return pr.split(/\s+and\s+/).every(term => {
              term = term.trim();
              if ((pm = /^local-name\(\)\s*=\s*['"](.*)['"]$/.exec(term))) return e.type === 'element' && X.local(e.name) === pm[1];
              if ((pm = /^@([\w.:-]+)\s*=\s*['"](.*)['"]$/.exec(term))) return X.attr(e, pm[1]) === pm[2];
              if ((pm = /^@([\w.:-]+)\s*!=\s*['"](.*)['"]$/.exec(term))) return X.attr(e, pm[1]) !== undefined && X.attr(e, pm[1]) !== pm[2];
              if ((pm = /^@([\w.:-]+)$/.exec(term))) return X.attr(e, pm[1]) !== undefined;
              if ((pm = /^contains\(@([\w.:-]+),\s*['"](.*)['"]\)$/.exec(term))) return (X.attr(e, pm[1]) || '').includes(pm[2]);
              if ((pm = /^text\(\)\s*=\s*['"](.*)['"]$/.exec(term))) return X.text(e) === pm[1];
              throw new Error('Invalid predicate');
            });
          });
        }
        out = out.concat(cands);
      }
      ctx = Array.from(new Set(out));
    }
    return { type: 'nodes', nodes: ctx };
  }
  function nodeString(n) {
    if (n.type === 'attr') return n.value;
    if (n.type === 'text') return n.value;
    let s = '';
    (function w(x) { for (const k of x.children || []) { if (k.type === 'text' || k.type === 'cdata') s += k.value; else if (k.type === 'element') w(k); } })(n);
    return s;
  }
  function prettyXml(node, ind) {
    ind = ind || '';
    if (node.type === 'document') return node.children.map(k => k.type === 'text' ? '' : prettyXml(k, '')).filter(Boolean).join('\n') + '\n';
    if (node.type === 'comment') return ind + '<!--' + node.value + '-->';
    if (node.type === 'pi') return ind + '<?' + node.value + '?>';
    if (node.type !== 'element') return '';
    const head = ind + '<' + node.name + node.attrs.map(a => ' ' + a[0] + '="' + a[1].replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') + '"').join('');
    const kids = (node.children || []).filter(k => !(k.type === 'text' && !k.value.trim()));
    if (!kids.length) return head + '/>';
    if (kids.length === 1 && kids[0].type === 'text') return head + '>' + kids[0].value.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</' + node.name + '>';
    return head + '>\n' + kids.map(k => k.type === 'text' ? ind + '  ' + k.value.trim() : prettyXml(k, ind + '  ')).join('\n') + '\n' + ind + '</' + node.name + '>';
  }
  C.xmllint = async (c) => {
    const args = c.args.slice();
    let xpath = null, noout = false, format = false;
    const files = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '--xpath') xpath = args[++i];
      else if (a === '--noout') noout = true;
      else if (a === '--format') format = true;
      else if (a.startsWith('--')) continue;
      else files.push(a);
    }
    if (!files.length) { c.println('Usage : xmllint [options] XMLfiles ...\n\t--noout : don\'t output the result tree\n\t--format : reformat/reindent the output\n\t--xpath expr: evaluate the XPath expression, imply --noout'); return 1; }
    let st = 0;
    for (const f of files) {
      let src;
      try { src = f === '-' ? await c.readAll() : c.fs.read(c.resolve(f), c.cred); }
      catch (e) { c.err('warning: failed to load external entity "' + f + '"\n'); st = 1; continue; }
      let doc;
      try { doc = X.parse(src); }
      catch (e) {
        const line = src.split('\n')[e.line - 1] || '';
        c.err(f + ':' + e.line + ': parser error : ' + (e.libxml || e.message) + '\n' + line + '\n' + ' '.repeat(Math.max(0, e.col - 1)) + '^\n');
        st = 1; continue;
      }
      if (xpath !== null) {
        let r;
        try { r = xpathEval(doc, xpath); } catch (e) { c.err('XPath error : ' + e.message + '\n' + xpath + '\n'); return 10; }
        if (r.type === 'number') { c.println(String(r.value)); continue; }
        if (r.type === 'string') { c.println(r.value); continue; }
        if (!r.nodes.length) { c.err('XPath set is empty\n'); st = 10; continue; }
        for (const n of r.nodes) {
          if (n.type === 'attr') c.println(' ' + n.name + '="' + n.value + '"');
          else if (n.type === 'text') c.println(n.value);
          else c.println(X.serialize(n));
        }
        continue;
      }
      if (noout) continue;
      c.out(format ? '<?xml version="1.0" encoding="UTF-8"?>\n' + prettyXml(doc) : src);
    }
    return st;
  };

  L.jq = { compile: jqCompile, eval: jqEval };
  L.xpath = xpathEval;
})(globalThis.JLab = globalThis.JLab || {});
