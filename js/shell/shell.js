/*
 * Intérprete de shell (bash simplificado) que ejecuta sobre una VM.
 *  - Expansión: ~, $VAR, ${VAR:-x}, ${#VAR}, ${VAR%pat}, $(cmd), $((expr)), globs
 *  - Tuberías concurrentes con streams, redirecciones, heredocs
 *  - Builtins: cd, export, alias, source, exit, history, jobs, read, ...
 *  - Resolución de comandos por $PATH y permisos de ejecución reales
 *  - Ctrl+C (SIGINT) aborta el trabajo en primer plano
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util;
  const { parse, Incomplete, SyntaxErr } = L.shparse;

  class Abort extends Error { constructor() { super('aborted'); this.aborted = true; } }
  class ExitSignal extends Error { constructor(code) { super('exit'); this.exitCode = code; } }
  class ReturnSignal extends Error { constructor(code) { super('return'); this.code = code; } }
  class LoopSignal extends Error { constructor(kind, n) { super(kind); this.kind = kind; this.n = n || 1; } }

  // ---------- Streams ----------
  class Pipe {
    constructor() { this.buf = []; this.closed = false; this.waiters = []; this.readerGone = false; }
    write(s) { if (this.closed || this.readerGone || !s) return; this.buf.push(String(s)); this._wake(); }
    close() { this.closed = true; this._wake(); }
    _wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
    async read() {
      while (!this.buf.length && !this.closed) await new Promise(r => this.waiters.push(r));
      if (this.buf.length) return this.buf.splice(0).join('');
      return null;
    }
    async readAll() { let s = ''; let c; while ((c = await this.read()) !== null) s += c; return s; }
  }
  class StringSource {
    constructor(s) { this.s = s; this.done = false; }
    async read() { if (this.done) return null; this.done = true; return this.s; }
    async readAll() { const s = this.done ? '' : this.s; this.done = true; return s; }
  }
  class NullSource { async read() { return null; } async readAll() { return ''; } }
  // Salida hacia la terminal (convierte \n -> \r\n)
  class TermSink {
    constructor(term) { this.term = term; this.isTTY = true; }
    write(s) { if (s) this.term.write(String(s).replace(/\r?\n/g, '\r\n')); }
    close() { }
  }
  class BufferSink { constructor() { this.data = ''; } write(s) { this.data += s; } close() { } }
  class NullSink { write() { } close() { } }
  // Redirección a archivo (escribe incrementalmente, respeta cuota y permisos)
  class FileSink {
    constructor(sh, path, append) {
      this.sh = sh; this.path = path; this.err = null;
      const fs = sh.vm.fs;
      const r = fs.tryLookup(path, { cred: sh.cred });
      if (r && r.node.dev === 'null') { this.devnull = true; return; }
      if (r && r.node.t === 'd') throw new L.FsError('EISDIR', path);
      if (!append || !r) fs.write(path, '', { cred: sh.cred, append: false });
      else if (!fs.can(r.node, sh.cred, 'w')) throw new L.FsError('EACCES', path);
    }
    write(s) {
      if (this.devnull || !s || this.err) return;
      try { this.sh.vm.fs.write(this.path, s, { cred: this.sh.cred, append: true }); }
      catch (e) { this.err = e; }
    }
    close() { }
  }

  function tildeHome(sh, user) {
    if (!user) return sh.env.HOME || sh.cred.home;
    const u = L.os.users.byName(sh.vm.fs, user);
    return u ? u.home : null;
  }

  // ---------- Aritmética $(( )) ----------
  function arith(expr, sh) {
    const toks = expr.match(/\d+|[A-Za-z_]\w*|\*\*|<=|>=|==|!=|&&|\|\||<<|>>|[-+*/%()<>!]/g) || [];
    let i = 0;
    const val = (name) => { const v = sh.getVar(name); return parseInt(v, 10) || 0; };
    const peek = () => toks[i], next = () => toks[i++];
    function primary() {
      const t = next();
      if (t === '(') { const v = or(); next(); return v; }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '!') return primary() ? 0 : 1;
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      if (/^[A-Za-z_]/.test(t || '')) return val(t);
      throw new Error('syntax error in expression (error token is "' + (t || '') + '")');
    }
    function pow() { let v = primary(); while (peek() === '**') { next(); v = Math.pow(v, primary()); } return v; }
    function mul() {
      let v = pow();
      while (['*', '/', '%'].includes(peek())) {
        const op = next(), r = pow();
        if ((op === '/' || op === '%') && r === 0) throw new Error('division by 0 (error token is "' + r + '")');
        v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : v % r;
      }
      return v;
    }
    function add() { let v = mul(); while (['+', '-'].includes(peek())) { const op = next(), r = mul(); v = op === '+' ? v + r : v - r; } return v; }
    function cmp() { let v = add(); while (['<', '>', '<=', '>=', '==', '!='].includes(peek())) { const op = next(), r = add(); v = { '<': v < r, '>': v > r, '<=': v <= r, '>=': v >= r, '==': v === r, '!=': v !== r }[op] ? 1 : 0; } return v; }
    function and() { let v = cmp(); while (peek() === '&&') { next(); const r = cmp(); v = v && r ? 1 : 0; } return v; }
    function or() { let v = and(); while (peek() === '||') { next(); const r = and(); v = v || r ? 1 : 0; } return v; }
    if (!toks.length) return 0;
    const v = or();
    if (i < toks.length) throw new Error('syntax error in expression (error token is "' + toks[i] + '")');
    return v;
  }

  function braceExpand(s) {
    const m = /^(.*?)\{([^{}]*)\}(.*)$/s.exec(s);
    if (!m) return [s];
    let items;
    const r = /^(-?\d+)\.\.(-?\d+)$/.exec(m[2]) || /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(m[2]);
    if (r) {
      const num = /\d/.test(r[1]);
      const a = num ? +r[1] : r[1].charCodeAt(0), b = num ? +r[2] : r[2].charCodeAt(0);
      items = [];
      for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? 1 : -1) { items.push(num ? String(x) : String.fromCharCode(x)); if (items.length > 10000) break; }
    } else if (m[2].includes(',')) items = m[2].split(',');
    else return [s];
    const out = [];
    for (const it of items) for (const rest of braceExpand(m[3])) out.push(...braceExpand(m[1] + it + rest));
    return out;
  }

  let shellSeq = 1;

  class Shell {
    constructor(vm, o) {
      o = o || {};
      this.vm = vm;
      this.id = shellSeq++;
      this.user = o.user || 'root';
      this.cred = L.os.users.cred(vm.fs, this.user) || Object.assign({}, L.fsutil.ROOT_CRED, { name: 'root', home: '/root' });
      this.term = o.term || null;
      this.tty = o.tty || 'pts/0';
      this.parent = o.parent || null;
      this.env = Object.assign({
        PATH: this.cred.uid === 0 ? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/root/bin' : '/home/' + this.user + '/.local/bin:/home/' + this.user + '/bin:/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin',
        HOME: this.cred.home, USER: this.user, LOGNAME: this.user, SHELL: '/bin/bash', HOSTNAME: vm.hostname,
        TERM: 'xterm-256color', LANG: 'en_US.UTF-8', HISTSIZE: '1000', PWD: o.cwd || this.cred.home
      }, o.env || {});
      this.vars = {};
      this.exported = new Set(Object.keys(this.env));
      this.cwd = o.cwd || this.cred.home || '/';
      if (!vm.fs.isDir(this.cwd)) this.cwd = '/';
      this.env.PWD = this.cwd;
      this.aliases = Object.assign({}, o.aliases || {});
      this.funcs = {};
      this.status = 0;
      this.positional = o.args || [];
      this.argv0 = o.argv0 || '-bash';
      this.history = [];
      this.jobs = [];
      this.jobSeq = 1;
      this.lastBg = 0;
      this.fg = null;          // {abort}
      this.login = !!o.login;
      this.noTty = !!o.noTty;
      this.sudoUntil = o.sudoUntil || 0;
      this.pid = vm.spawn({ user: this.user, cmd: '-bash', memMB: 4, tty: this.tty, ppid: o.ppid }).pid;
      this.env.$$ = String(this.pid);
    }

    // ---------- variables ----------
    getVar(name) {
      switch (name) {
        case '?': return String(this.status);
        case '$': return String(this.pid);
        case '#': return String(this.positional.length);
        case '0': return this.argv0;
        case '!': return String(this.lastBg || '');
        case '@': case '*': return this.positional.join(' ');
        case 'RANDOM': return String(Math.floor(Math.random() * 32768));
        case 'PWD': return this.cwd;
        case 'UID': return String(this.cred.uid);
        case 'EUID': return String(this.cred.uid);
        case 'SECONDS': return String(Math.floor((Date.now() - (this.startTime || Date.now())) / 1000));
      }
      if (/^\d+$/.test(name)) return this.positional[+name - 1] || '';
      if (this.vars[name] !== undefined) return this.vars[name];
      if (this.env[name] !== undefined) return this.env[name];
      return undefined;
    }
    setVar(name, value, exp) {
      if (name === 'PWD') this.cwd = value;
      if (this.exported.has(name) || exp) { this.env[name] = value; this.exported.add(name); delete this.vars[name]; }
      else this.vars[name] = value;
    }
    unsetVar(name) { delete this.vars[name]; delete this.env[name]; this.exported.delete(name); }
    exportedEnv() { const e = {}; for (const k of this.exported) if (this.env[k] !== undefined) e[k] = this.env[k]; return e; }

    resolve(p) { return P.resolve(this.cwd, p); }

    // ---------- expansión ----------
    async expandParam(part) {
      let v = part.v;
      if (!part.braced) return this.getVar(v);
      let m;
      if ((m = /^#([A-Za-z_]\w*|[0-9@*])$/.exec(v))) { const x = this.getVar(m[1]); return String(m[1] === '@' || m[1] === '*' ? this.positional.length : (x || '').length); }
      if ((m = /^([A-Za-z_]\w*|[0-9?@*#$!])(:?[-=+?])(.*)$/s.exec(v))) {
        const cur = this.getVar(m[1]);
        const empty = m[2][0] === ':' ? !cur : cur === undefined;
        const op = m[2].replace(':', '');
        const word = await this.expandString(m[3]);
        if (op === '-') return empty ? word : cur;
        if (op === '=') { if (empty) { this.setVar(m[1], word); return word; } return cur; }
        if (op === '+') return empty ? '' : word;
        if (op === '?') { if (empty) throw new Error(m[1] + ': ' + (word || 'parameter null or not set')); return cur; }
      }
      if ((m = /^([A-Za-z_]\w*|[0-9@*])(%%|%|##|#)(.*)$/s.exec(v))) {
        const cur = this.getVar(m[1]) || '';
        const pat = await this.expandString(m[3]);
        const re = U.globToRegex(pat).source.slice(1, -1).replace(/\[\^\/\]\*/g, '.*').replace(/\[\^\/\]/g, '.');
        if (m[2] === '%') { for (let i = cur.length; i >= 0; i--) if (new RegExp('^' + re + '$').test(cur.slice(i))) return cur.slice(0, i); return cur; }
        if (m[2] === '%%') { for (let i = 0; i <= cur.length; i++) if (new RegExp('^' + re + '$').test(cur.slice(i))) return cur.slice(0, i); return cur; }
        if (m[2] === '#') { for (let i = 0; i <= cur.length; i++) if (new RegExp('^' + re + '$').test(cur.slice(0, i))) return cur.slice(i); return cur; }
        if (m[2] === '##') { for (let i = cur.length; i >= 0; i--) if (new RegExp('^' + re + '$').test(cur.slice(0, i))) return cur.slice(i); return cur; }
      }
      if ((m = /^([A-Za-z_]\w*)(\/\/?)([^/]*)\/?(.*)$/s.exec(v))) {
        const cur = this.getVar(m[1]) || '';
        const pat = await this.expandString(m[3]), rep = await this.expandString(m[4]);
        if (!pat) return cur;
        return m[2] === '//' ? cur.split(pat).join(rep) : cur.replace(pat, rep);
      }
      if ((m = /^([A-Za-z_]\w*):(-?\d+)(?::(\d+))?$/.exec(v))) {
        const cur = this.getVar(m[1]) || '';
        let off = +m[2]; if (off < 0) off = Math.max(0, cur.length + off);
        return m[3] !== undefined ? cur.substr(off, +m[3]) : cur.substr(off);
      }
      if ((m = /^([A-Za-z_]\w*)(\^\^|,,)$/.exec(v))) { const cur = this.getVar(m[1]) || ''; return m[2] === '^^' ? cur.toUpperCase() : cur.toLowerCase(); }
      if (/^[A-Za-z_]\w*$|^[0-9?#$!@*]$/.test(v)) return this.getVar(v);
      throw new Error('${' + v + '}: bad substitution');
    }
    // Expande una cadena como si estuviera entre comillas dobles (para ${x:-...} y heredocs)
    async expandString(s) {
      if (!s.includes('$') && !s.includes('`')) return s;
      try {
        const toks = L.shparse.lex('"' + s.replace(/(["\\])/g, '\\$1').replace(/\\\\\$/g, '\\$') + '"');
        const w = toks[0];
        return (await this.expandWord(w, { noSplit: true, noGlob: true }))[0] || '';
      } catch (e) { return s; }
    }
    async heredocExpand(body) {
      // Expande $VAR, ${...}, $(...), `...` y \$ en el cuerpo de un heredoc
      let out = '', i = 0;
      while (i < body.length) {
        const c = body[i];
        if (c === '\\' && '$`\\'.includes(body[i + 1])) { out += body[i + 1]; i += 2; continue; }
        if (c === '$' || c === '`') {
          let end = i + 1;
          if (c === '`') end = body.indexOf('`', i + 1) + 1;
          else if (body[i + 1] === '(') { const j = L.shparse.matchParen(body, i + (body[i + 2] === '(' ? 3 : 2)); end = j < 0 ? body.length : (body[i + 2] === '(' ? j + 2 : j + 1); }
          else if (body[i + 1] === '{') end = body.indexOf('}', i) + 1;
          else { const m = /^\$([A-Za-z_]\w*|[0-9?#$!@*])/.exec(body.slice(i)); end = m ? i + m[0].length : i + 1; }
          if (end <= i) end = i + 1;
          const piece = body.slice(i, end);
          try {
            const toks = L.shparse.lex(piece);
            out += toks[0].t === 'word' ? (await this.expandWord(toks[0], { noSplit: true, noGlob: true })).join(' ') : piece;
          } catch (e) { out += piece; }
          i = end; continue;
        }
        out += c; i++;
      }
      return out;
    }
    // Devuelve la lista de campos resultantes de expandir una palabra
    async expandWord(word, o) {
      o = o || {};
      const parts = word.parts || word;
      // campos: array de arrays de segmentos {s, glob(bool: puede tener glob)}
      let fields = [[]];
      let hadQuoted = false;
      const cur = () => fields[fields.length - 1];
      for (let idx = 0; idx < parts.length; idx++) {
        const p = parts[idx];
        if (p.q) hadQuoted = true;
        if (p.k === 'lit') {
          let v = p.v;
          if (idx === 0 && p.q === 0 && v[0] === '~') {
            const m = /^~([A-Za-z_][\w-]*)?(?=\/|$)/.exec(v);
            if (m) { const h = tildeHome(this, m[1]); if (h) v = h + v.slice(m[0].length); }
          }
          cur().push({ s: v, glob: p.q === 0 });
          continue;
        }
        let val;
        if (p.k === 'var') {
          if ((p.v === '@' || p.v === '*') && !p.braced) {
            if (p.q === 2 && p.v === '@') {
              // "$@": un campo por argumento
              const args = this.positional;
              if (!args.length) { if (fields.length === 1 && !cur().length) fields = []; fields.push([]); continue; }
              args.forEach((a, k) => { if (k > 0) fields.push([]); cur().push({ s: a, glob: false }); });
              continue;
            }
          }
          val = await this.expandParam(p);
          if (val === undefined) val = '';
          if (o.nounset && val === undefined) throw new Error(p.v + ': unbound variable');
        } else if (p.k === 'cmd') {
          val = (await this.capture(p.v)).replace(/\n+$/, '');
        } else if (p.k === 'arith') {
          const inner = await this.expandString(p.v);
          val = String(arith(inner, this));
        }
        if (p.q || o.noSplit) { cur().push({ s: val, glob: false }); continue; }
        // división de campos (IFS por defecto)
        const pieces = val.split(/[ \t\n]+/);
        if (/^[ \t\n]/.test(val) && cur().length) fields.push([]);
        const clean = pieces.filter((x, k) => x !== '' || (k > 0 && k < pieces.length - 1));
        clean.forEach((x, k) => { if (k > 0) fields.push([]); if (x !== '') cur().push({ s: x, glob: true }); });
        if (/[ \t\n]$/.test(val) && clean.length) fields.push([]);
      }
      const out = [];
      for (const f of fields) {
        if (!f.length) { if (hadQuoted && fields.length === 1) out.push(''); continue; }
        const text = f.map(x => x.s).join('');
        if (!o.noGlob && f.some(x => x.glob && /[*?[]/.test(x.s))) {
          const pat = f.map(x => x.glob ? x.s : x.s.replace(/[*?[\]]/g, '\\$&')).join('');
          const matches = this.glob(pat);
          if (matches.length) { out.push(...matches); continue; }
        }
        out.push(text);
      }
      return out;
    }
    glob(pattern) {
      const abs = pattern.startsWith('/');
      const segs = pattern.split('/').filter((s, i) => s !== '' || i === 0);
      let bases = [abs ? '/' : ''];
      const fs = this.vm.fs;
      for (let i = abs ? 1 : 0; i < segs.length; i++) {
        const seg = segs[i];
        const isGlob = /(^|[^\\])[*?[]/.test(seg);
        const next = [];
        for (const b of bases) {
          const dir = b === '' ? this.cwd : this.resolve(b);
          if (!isGlob) {
            const lit = seg.replace(/\\(.)/g, '$1');
            const cand = b === '' ? lit : (b === '/' ? '/' + lit : b + '/' + lit);
            if (fs.tryLookup(this.resolve(cand), { cred: this.cred })) next.push(cand);
            continue;
          }
          let names;
          try { names = fs.readdir(dir, this.cred); } catch (e) { continue; }
          const re = U.globToRegex(seg.replace(/\\(.)/g, (m, c) => '[' + c + ']'));
          for (const nme of names) {
            if (nme.startsWith('.') && !seg.startsWith('.')) continue;
            if (re.test(nme)) next.push(b === '' ? nme : (b === '/' ? '/' + nme : b + '/' + nme));
          }
        }
        bases = next;
        if (!bases.length) return [];
      }
      return bases.sort();
    }
    async expandWords(words) {
      const out = [];
      for (const w of words) {
        const parts = w.parts || w;
        // expansión de llaves en palabras literales sin comillas: a{b,c}d  x{1..3}
        if (parts.length === 1 && parts[0].k === 'lit' && parts[0].q === 0 && /\{[^{}]*(,|\.\.)[^{}]*\}/.test(parts[0].v)) {
          for (const v of braceExpand(parts[0].v)) out.push(...await this.expandWord({ parts: [{ k: 'lit', v, q: 0 }] }));
          continue;
        }
        out.push(...await this.expandWord(w));
      }
      return out;
    }

    // ---------- ejecución ----------
    async capture(src) {
      const sub = this.subshell();
      const sink = new BufferSink();
      const io = { stdin: new NullSource(), stdout: sink, stderr: this.io ? this.io.stderr : new NullSink() };
      try { await sub.run(src, io); } catch (e) { if (!(e instanceof ExitSignal)) throw e; }
      this.status = sub.status;
      return sink.data;
    }
    subshell() {
      const s = Object.create(Shell.prototype);
      Object.assign(s, this);
      s.vars = Object.assign({}, this.vars);
      s.env = Object.assign({}, this.env);
      s.exported = new Set(this.exported);
      s.funcs = Object.assign({}, this.funcs);
      s.aliases = Object.assign({}, this.aliases);
      s.isSub = true;
      return s;
    }
    // Ejecuta código fuente completo con io dado
    async run(src, io) {
      let ast;
      try { ast = parse(this.expandAliases(src)); }
      catch (e) {
        const err = (io || this.io).stderr;
        if (e.incomplete) { err.write('-bash: syntax error: unexpected end of file\n'); this.status = 2; return 2; }
        err.write('-bash: ' + e.message + '\n'); this.status = 2; return 2;
      }
      return this.execNode(ast, io || this.io);
    }
    expandAliases(src) {
      if (!Object.keys(this.aliases).length) return src;
      // sustituye la primera palabra de cada comando simple por su alias (una vez)
      return src.split('\n').map(line => line.replace(/(^|[;&|]\s*|&&\s*|\|\|\s*)([A-Za-z0-9_.\-]+)(?=\s|$)/g, (m, pre, w) => {
        if (this.aliases[w] !== undefined && !this._inAlias) return pre + this.aliases[w];
        return m;
      })).join('\n');
    }
    checkAbort() { if (this.fg && this.fg.aborted) throw new Abort(); }

    async execNode(node, io) {
      this.checkAbort();
      switch (node.type) {
        case 'list': {
          let st = 0;
          for (const it of node.items) {
            if (it.bg) { this.startBg(it.node, io); st = 0; this.status = 0; continue; }
            st = await this.execNode(it.node, io);
            this.status = st;
          }
          return st;
        }
        case 'andor': {
          let st = await this.execNode(node.first, io);
          this.status = st;
          for (const r of node.rest) {
            if ((r.op === '&&' && st === 0) || (r.op === '||' && st !== 0)) { st = await this.execNode(r.node, io); this.status = st; }
          }
          return st;
        }
        case 'pipe': {
          const n = node.cmds.length;
          if (n === 1) { const st = await this.execNode(node.cmds[0], io); return node.neg ? (st ? 0 : 1) : st; }
          const pipes = [];
          for (let i = 0; i < n - 1; i++) pipes.push(new Pipe());
          const runs = node.cmds.map((c, i) => {
            const cio = { stdin: i === 0 ? io.stdin : pipes[i - 1], stdout: i === n - 1 ? io.stdout : pipes[i], stderr: io.stderr };
            const sub = i === n - 1 ? this : this.subshell();
            return sub.execNode(c, cio).catch(e => { if (e instanceof Abort) throw e; if (e instanceof ExitSignal) return e.exitCode; throw e; })
              .finally(() => { if (i < n - 1) pipes[i].close(); if (i > 0) pipes[i - 1].readerGone = true; });
          });
          const sts = await Promise.all(runs);
          const st = sts[n - 1];
          return node.neg ? (st ? 0 : 1) : st;
        }
        case 'simple': return this.execSimple(node, io);
        case 'group': {
          const rio = await this.applyRedirs(node.redirs, io);
          if (!rio) return 1;
          if (node.subshell) {
            const sub = this.subshell();
            try { return await sub.execNode(node.body, rio); } catch (e) { if (e instanceof ExitSignal) return e.exitCode; throw e; }
          }
          return this.execNode(node.body, rio);
        }
        case 'if': {
          const rio = await this.applyRedirs(node.redirs, io); if (!rio) return 1;
          for (const c of node.clauses) {
            const st = await this.execNode(c.cond, rio);
            if (st === 0) return this.execNode(c.body, rio);
          }
          if (node.else) return this.execNode(node.else, rio);
          return 0;
        }
        case 'for': {
          const rio = await this.applyRedirs(node.redirs, io); if (!rio) return 1;
          const items = node.items ? await this.expandWords(node.items) : this.positional.slice();
          let st = 0;
          for (const it of items) {
            this.checkAbort();
            this.setVar(node.var, it);
            try { st = await this.execNode(node.body, rio); }
            catch (e) {
              if (e instanceof LoopSignal) { if (e.n > 1) { e.n--; throw e; } if (e.kind === 'break') break; continue; }
              throw e;
            }
            await U.sleep(0);
          }
          return st;
        }
        case 'while': {
          const rio = await this.applyRedirs(node.redirs, io); if (!rio) return 1;
          let st = 0, guard = 0;
          while (true) {
            this.checkAbort();
            const c = await this.execNode(node.cond, rio);
            if (node.until ? c === 0 : c !== 0) break;
            try { st = await this.execNode(node.body, rio); }
            catch (e) {
              if (e instanceof LoopSignal) { if (e.n > 1) { e.n--; throw e; } if (e.kind === 'break') break; continue; }
              throw e;
            }
            if (++guard % 50 === 0) await U.sleep(1);
          }
          return st;
        }
        case 'case': {
          const rio = await this.applyRedirs(node.redirs, io); if (!rio) return 1;
          const w = (await this.expandWord(node.word, { noSplit: true, noGlob: true })).join(' ');
          for (const arm of node.arms) {
            for (const pw of arm.patterns) {
              const pat = (await this.expandWord(pw, { noSplit: true, noGlob: true })).join(' ');
              if (U.globToRegex(pat).test(w) || pat === w) return this.execNode(arm.body, rio);
            }
          }
          return 0;
        }
        case 'func': { this.funcs[node.name] = node.body; return 0; }
      }
      return 0;
    }

    startBg(node, io) {
      const job = { id: this.jobSeq++, cmd: this.lastCmdText || '', status: 'Running', fg: { aborted: false } };
      const sub = this.subshell();
      sub.fg = job.fg;
      const p = sub.execNode(node, Object.assign({}, io, { stdin: new NullSource() }))
        .catch(e => (e instanceof ExitSignal ? e.exitCode : e instanceof Abort ? 130 : 1))
        .then(code => { job.status = code === 0 ? 'Done' : 'Exit ' + code; job.done = true; job.code = code; });
      job.pid = sub._bgPid || (this.vm.nextPid);
      job.promise = p;
      this.jobs.push(job);
      this.lastBg = job.pid;
      io.stderr.write('[' + job.id + '] ' + job.pid + '\n');
    }
    reportJobs(out) {
      for (const j of this.jobs.filter(j => j.done && !j.reported)) {
        j.reported = true;
        out.write('[' + j.id + ']+  ' + U.pad(j.status, 22, true) + ' ' + j.cmd + '\n');
      }
      this.jobs = this.jobs.filter(j => !j.reported);
    }

    async applyRedirs(redirs, io) {
      if (!redirs || !redirs.length) return io;
      const nio = Object.assign({}, io);
      for (const r of redirs) {
        try {
          if (r.op === 'dup>') {
            if (r.to === '-') continue;
            if (r.fd === 2 && r.to === '1') nio.stderr = nio.stdout;
            else if (r.fd === 1 && r.to === '2') nio.stdout = nio.stderr;
            continue;
          }
          if (r.op === 'dup<') continue;
          if (r.op === '<<') {
            const body = r.quoted ? r.body : await this.heredocExpand(r.body || '');
            nio.stdin = new StringSource(body);
            continue;
          }
          const target = (await this.expandWord(r.word, { noGlob: false }));
          if (target.length !== 1) { io.stderr.write('-bash: ' + r.word.map(x => x.v).join('') + ': ambiguous redirect\n'); return null; }
          const path = this.resolve(target[0]);
          if (r.op === '<<<') { nio.stdin = new StringSource(target[0] + '\n'); continue; }
          if (r.op === '<') {
            const data = this.vm.fs.read(path, this.cred);
            nio.stdin = new StringSource(data);
            continue;
          }
          const append = r.op === '>>' || r.op === '&>>';
          const sink = new FileSink(this, path, append);
          if (r.op === '&>' || r.op === '&>>') { nio.stdout = sink; nio.stderr = sink; }
          else if (r.fd === 2) nio.stderr = sink;
          else nio.stdout = sink;
        } catch (e) {
          const name = r.word ? r.word.map(x => x.v).join('') : '';
          io.stderr.write('-bash: ' + name + ': ' + (e.message || e) + '\n');
          return null;
        }
      }
      return nio;
    }

    async execSimple(node, io) {
      // asignaciones
      const assigns = [];
      for (const a of node.assigns) {
        const v = (await this.expandWord(a.parts, { noSplit: true, noGlob: true })).join('');
        assigns.push([a.name, a.append ? (this.getVar(a.name) || '') + v : v]);
      }
      let argv;
      try { argv = await this.expandWords(node.words); }
      catch (e) { if (e instanceof Abort || e instanceof ExitSignal) throw e; io.stderr.write('-bash: ' + e.message + '\n'); return 1; }
      const rio = await this.applyRedirs(node.redirs, io);
      if (!rio) return 1;
      if (!argv.length) {
        for (const [k, v] of assigns) this.setVar(k, v);
        return 0;
      }
      const tmpEnv = {};
      for (const [k, v] of assigns) tmpEnv[k] = v;
      if (this.xtrace) rio.stderr.write('+ ' + argv.join(' ') + '\n');
      return this.execCommand(argv, rio, tmpEnv);
    }

    // Busca un ejecutable en $PATH
    whichAll(name) {
      const out = [];
      for (const d of (this.getVar('PATH') || '').split(':')) {
        if (!d) continue;
        const p = d.replace(/\/$/, '') + '/' + name;
        const r = this.vm.fs.tryLookup(p);
        if (r && r.node.t === 'f' && (r.node.m & 0o111) && !out.includes(p)) out.push(p);
      }
      return out;
    }
    which(name) {
      if (name.includes('/')) return this.vm.fs.tryLookup(this.resolve(name)) ? this.resolve(name) : null;
      for (const d of (this.getVar('PATH') || '').split(':')) {
        if (!d) continue;
        const p = d.replace(/\/$/, '') + '/' + name;
        const r = this.vm.fs.tryLookup(p);
        if (r && r.node.t === 'f' && (r.node.m & 0o111)) return p;
      }
      return null;
    }

    async execCommand(argv, io, tmpEnv) {
      const name = argv[0];
      tmpEnv = tmpEnv || {};
      if (this.funcs[name]) {
        const saved = this.positional, savedArgv0 = this.argv0;
        this.positional = argv.slice(1);
        try { return await this.execNode(this.funcs[name], io); }
        catch (e) { if (e instanceof ReturnSignal) return e.code; throw e; }
        finally { this.positional = saved; this.argv0 = savedArgv0; }
      }
      const bi = L.builtins[name];
      if (bi) {
        const saved = {};
        for (const [k, v] of Object.entries(tmpEnv)) { saved[k] = this.env[k]; this.env[k] = v; }
        try { return await this.callImpl(bi, name, argv, io); }
        finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete this.env[k]; else this.env[k] = saved[k]; } }
      }
      // ejecutable en disco
      const fs = this.vm.fs;
      let path;
      if (name.includes('/')) {
        path = this.resolve(name);
        const r = fs.tryLookup(path, { cred: this.cred });
        if (!r) { io.stderr.write('-bash: ' + name + ': No such file or directory\n'); return 127; }
        if (r.node.t === 'd') { io.stderr.write('-bash: ' + name + ': Is a directory\n'); return 126; }
        if (!fs.can(r.node, this.cred, 'x')) { io.stderr.write('-bash: ' + name + ': Permission denied\n'); return 126; }
      } else {
        path = this.which(name);
        if (path) {
          this.hashTable = this.hashTable || new Map();
          const h = this.hashTable.get(name);
          if (h && h.path === path) h.hits++; else this.hashTable.set(name, { path, hits: 1 });
        }
        if (!path) {
          io.stderr.write('-bash: ' + name + ': command not found\n');
          return 127;
        }
      }
      const node = fs.stat(path);
      if (!fs.can(node, this.cred, 'x')) { io.stderr.write('-bash: ' + path + ': Permission denied\n'); return 126; }
      const saved = {};
      for (const [k, v] of Object.entries(tmpEnv)) { saved[k] = this.env[k]; this.env[k] = v; this.exported.add(k); }
      try {
        if (node.bi) {
          const impl = L.cmds[node.bi] || L.builtins[node.bi];
          if (!impl) { io.stderr.write('-bash: ' + name + ': binario no implementado en el laboratorio\n'); return 126; }
          return await this.callImpl(impl, name, argv, io, path);
        }
        const data = node.d || '';
        const mark = /#JLAB-SCRIPT:([\w-]+)/.exec(data);
        if (mark && L.scripts[mark[1]]) return await this.callImpl(L.scripts[mark[1]], name, argv, io, path);
        if (node.bin) { io.stderr.write('-bash: ' + path + ': cannot execute binary file: Exec format error\n'); return 126; }
        return await this.runScript(path, argv.slice(1), io, name);
      } finally {
        for (const k of Object.keys(saved)) { if (saved[k] === undefined) { delete this.env[k]; this.exported.delete(k); } else this.env[k] = saved[k]; }
      }
    }

    async runScript(path, args, io, argv0) {
      const fs = this.vm.fs;
      let src;
      try { src = fs.read(path, this.cred); } catch (e) { io.stderr.write('/bin/bash: ' + path + ': ' + e.message + '\n'); return 126; }
      const mark = /#JLAB-SCRIPT:([\w-]+)/.exec(src);
      if (mark && L.scripts[mark[1]]) return this.callImpl(L.scripts[mark[1]], argv0 || path, [argv0 || path].concat(args), io, path);
      const sub = new Shell(this.vm, { user: this.user, env: this.exportedEnv(), cwd: this.cwd, args, argv0: argv0 || path, term: this.term, parent: this, noTty: this.noTty, ppid: this.pid });
      sub.xtrace = !!this._xtraceNext; this._xtraceNext = false;
      sub.cred = this.cred;
      sub.fg = this.fg;
      sub.io = io;
      try { return await sub.run(src.replace(/^#!.*\n/, ''), io); }
      catch (e) { if (e instanceof ExitSignal) return e.exitCode; throw e; }
      finally { this.vm.reap(sub.pid); }
    }
    async source(path, args, io) {
      const src = this.vm.fs.read(this.resolve(path), this.cred);
      const saved = this.positional;
      if (args && args.length) this.positional = args;
      try { return await this.run(src, io); }
      catch (e) { if (e instanceof ReturnSignal) return e.code; throw e; }
      finally { this.positional = saved; }
    }

    // Construye el contexto para un comando JS y lo ejecuta
    async callImpl(fn, name, argv, io, path) {
      const sh = this;
      const out = io.stdout, err = io.stderr;
      const ctx = {
        sh, vm: this.vm, fs: this.vm.fs, cred: this.cred, user: this.user, name, argv, args: argv.slice(1), path,
        env: this.env, io,
        get cwd() { return sh.cwd; },
        out: (s) => out.write(s), err: (s) => err.write(s),
        println: (s) => out.write((s === undefined ? '' : s) + '\n'),
        errln: (s) => err.write(s + '\n'),
        isTTY: !!out.isTTY, stdinTTY: !(io.stdin instanceof Pipe || io.stdin instanceof StringSource),
        term: this.term,
        resolve: (p) => sh.resolve(p),
        get aborted() { return !!(sh.fg && sh.fg.aborted); },
        sleep: (ms) => sh.sleep(ms),
        stdin: io.stdin,
        readAll: () => io.stdin ? io.stdin.readAll() : Promise.resolve(''),
        fail: (msg, code) => { err.write(name + ': ' + msg + '\n'); return code === undefined ? 1 : code; },
        fsErr: (p, e) => { err.write(name + ': ' + (p ? p + ': ' : '') + (e.message || e) + '\n'); return 1; },
        userName: (uid) => L.os.users.userName(sh.vm.fs, uid),
        groupName: (gid) => L.os.users.groupName(sh.vm.fs, gid)
      };
      // Lee entrada: archivos dados o stdin
      ctx.input = async (files) => {
        if (!files || !files.length || (files.length === 1 && files[0] === '-')) return { text: await ctx.readAll(), ok: true };
        let text = '', ok = true;
        for (const f of files) {
          if (f === '-') { text += await ctx.readAll(); continue; }
          try { text += sh.vm.fs.read(sh.resolve(f), sh.cred); }
          catch (e) { err.write(name + ': ' + f + ': ' + e.message + '\n'); ok = false; }
        }
        return { text, ok };
      };
      ctx.prompt = (q, hidden) => sh.promptLine(q, hidden);
      try {
        const r = await fn(ctx);
        return typeof r === 'number' ? r : 0;
      } catch (e) {
        if (e instanceof Abort || e instanceof ExitSignal || e instanceof ReturnSignal || e instanceof LoopSignal) throw e;
        if (e instanceof L.FsError) { err.write(name + ': ' + (e.path ? e.path + ': ' : '') + e.message + '\n'); return 1; }
        console.error(e);
        err.write(name + ': error interno: ' + (e.message || e) + '\n');
        return 1;
      }
    }
    sleep(ms) {
      return new Promise((res, rej) => {
        const fg = this.fg;
        if (fg && fg.aborted) return rej(new Abort());
        const t = setTimeout(() => { if (fg) fg.waiters = (fg.waiters || []).filter(w => w !== wk); res(); }, ms);
        const wk = () => { clearTimeout(t); rej(new Abort()); };
        if (fg) (fg.waiters = fg.waiters || []).push(wk);
      });
    }
    async promptLine(q, hidden) {
      if (!this.term || this.noTty) throw new Error('no hay terminal (tty) para leer la entrada');
      return this.term.readLine({ prompt: q, hidden, history: null });
    }

    // ---------- modo interactivo ----------
    ps1() {
      const host = this.vm.hostname.split('.')[0];
      const home = this.cred.home;
      let dir = this.cwd === home ? '~' : P.basename(this.cwd);
      if (this.cwd === '/') dir = '/';
      const ps = this.getVar('PS1');
      if (ps) return ps.replace(/\\u/g, this.user).replace(/\\h/g, host).replace(/\\H/g, this.vm.hostname).replace(/\\W/g, dir).replace(/\\w/g, this.cwd.startsWith(home) ? '~' + this.cwd.slice(home.length) : this.cwd).replace(/\\\$/g, this.cred.uid === 0 ? '#' : '$').replace(/\\\[|\\\]/g, '').replace(/\\e/g, '\x1b');
      return '[' + this.user + '@' + host + ' ' + dir + ']' + (this.cred.uid === 0 ? '# ' : '$ ');
    }
    loadHistory() {
      try { this.history = this.vm.fs.read(this.cred.home + '/.bash_history', this.cred).split('\n').filter(Boolean).slice(-1000); } catch (e) { this.history = []; }
    }
    saveHistoryLine(line) {
      try { this.vm.fs.write(this.cred.home + '/.bash_history', line + '\n', { cred: this.cred, append: true, mode: 0o600 }); } catch (e) { }
    }
    async runStartupFiles(io) {
      const files = this.login ? ['/etc/profile', this.cred.home + '/.bash_profile'] : ['/etc/bashrc', this.cred.home + '/.bashrc'];
      for (const f of files) {
        if (this.vm.fs.tryLookup(f, { cred: this.cred })) {
          try { await this.source(f, [], io); } catch (e) { if (e instanceof ExitSignal) throw e; }
        }
      }
    }
    // Bucle REPL. Devuelve el código de salida al terminar (exit / Ctrl+D)
    async interactive(term) {
      this.term = term;
      this.startTime = Date.now();
      const out = new TermSink(term);
      this.io = { stdin: new NullSource(), stdout: out, stderr: out };
      this.loadHistory();
      try { await this.runStartupFiles(this.io); } catch (e) { if (e instanceof ExitSignal) return e.exitCode; }
      let exitCode = 0;
      while (true) {
        if (this.vm.state !== 'running') return 0;
        this.reportJobs(out);
        let src = await term.readLine({ prompt: this.ps1(), history: this.history, complete: (line, pos) => this.complete(line, pos) });
        if (src === null) { term.write('logout\r\n'); break; }
        // continuación de líneas incompletas
        while (true) {
          try { parse(src); break; }
          catch (e) {
            if (!e.incomplete) break;
            const more = await term.readLine({ prompt: '> ', history: null });
            if (more === null) { src = ''; break; }
            src += '\n' + more;
          }
        }
        if (!src.trim()) continue;
        // expansión de historial !! y !n
        if (/(^|\s)!(!|\d+|-\d+)/.test(src)) {
          src = src.replace(/(^|\s)!(!|-?\d+)/g, (m, pre, k) => {
            let h;
            if (k === '!') h = this.history[this.history.length - 1];
            else if (+k < 0) h = this.history[this.history.length + (+k)];
            else h = this.history[+k - 1];
            return h !== undefined ? pre + h : m;
          });
          term.write(src + '\r\n');
        }
        if (!/^\s/.test(src)) { this.history.push(src); this.saveHistoryLine(src.replace(/\n/g, ' ')); }
        this.lastCmdText = src;
        this.fg = { aborted: false, waiters: [] };
        term.onInterrupt = () => { this.fg.aborted = true; (this.fg.waiters || []).forEach(w => w()); this.fg.waiters = []; };
        try {
          this.status = await this.run(src, this.io);
        } catch (e) {
          if (e instanceof ExitSignal) { exitCode = e.exitCode; this.fg = null; break; }
          if (e instanceof Abort) { this.status = 130; term.write('^C\r\n'); }
          else if (e instanceof ReturnSignal || e instanceof LoopSignal) { this.status = 1; }
          else { console.error(e); term.write('\x1b[31m-bash: error interno: ' + (e.message || e) + '\x1b[0m\r\n'); this.status = 1; }
        }
        term.onInterrupt = null;
        this.fg = null;
        term.resetMode && term.resetMode();
      }
      this.vm.reap(this.pid);
      return exitCode;
    }

    // ---------- autocompletado (Tab) ----------
    complete(line, pos) {
      const before = line.slice(0, pos);
      const m = /(\S*)$/.exec(before);
      const word = m[1];
      const isCmd = /^\s*\S*$/.test(before) || /(\||;|&&|\|\||sudo\s+)\s*\S*$/.test(before);
      let cands = [];
      if (isCmd && !word.includes('/')) {
        const set = new Set(Object.keys(L.builtins).concat(Object.keys(this.aliases), Object.keys(this.funcs)));
        for (const d of (this.getVar('PATH') || '').split(':')) { try { for (const f of this.vm.fs.readdir(d)) set.add(f); } catch (e) { } }
        cands = Array.from(set).filter(c => c.startsWith(word)).sort();
      } else {
        let w = word.replace(/^~(?=\/|$)/, this.cred.home);
        const slash = w.lastIndexOf('/');
        const dirPart = slash >= 0 ? w.slice(0, slash + 1) : '';
        const base = slash >= 0 ? w.slice(slash + 1) : w;
        const dir = this.resolve(dirPart || '.');
        try {
          for (const f of this.vm.fs.readdir(dir, this.cred)) {
            if (!f.startsWith(base) || (f.startsWith('.') && !base.startsWith('.'))) continue;
            const full = (dir === '/' ? '' : dir) + '/' + f;
            cands.push(word.slice(0, word.length - base.length) + f + (this.vm.fs.isDir(full) ? '/' : ''));
          }
        } catch (e) { }
        cands.sort();
      }
      return { word, cands };
    }
  }

  L.Shell = Shell;
  L.shio = { Pipe, StringSource, NullSource, TermSink, BufferSink, NullSink, FileSink };
  L.shsig = { Abort, ExitSignal, ReturnSignal, LoopSignal };
  L.arith = arith;
  L.cmds = L.cmds || {};
  L.builtins = L.builtins || {};
  L.scripts = L.scripts || {};
})(globalThis.JLab = globalThis.JLab || {});
