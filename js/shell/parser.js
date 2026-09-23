/*
 * Lexer y parser de un subconjunto amplio de bash:
 *   tuberías |, listas ; & && ||, redirecciones > >> < 2> 2>&1 &> <<EOF <<<,
 *   comillas '...' "..." \, variables $VAR ${VAR:-def} ${#VAR} ${VAR%.*},
 *   $(cmd) `cmd` $((expr)), if/elif/else/fi, for/while/until, case/esac,
 *   funciones f() { ... }, grupos { ...; } y subshells ( ... ).
 * Si la entrada está incompleta lanza Incomplete (el shell muestra PS2 "> ").
 */
(function (L) {
  'use strict';

  class Incomplete extends Error { constructor(m) { super(m || 'incomplete'); this.incomplete = true; } }
  class SyntaxErr extends Error { constructor(m) { super(m); this.syntax = true; } }

  const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', '{', '}', '!', '[[', ']]']);

  // ---------- Lexer ----------
  function lex(src) {
    const toks = [];
    let i = 0;
    const heredocs = [];    // pendientes de leer tras el siguiente salto de línea
    const n = src.length;

    function readDollar(q) {
      // src[i] === '$'
      const c = src[i + 1];
      if (c === '(' && src[i + 2] === '(') {
        // $(( ... ))
        let depth = 0, j = i + 3;
        for (; j < n; j++) {
          if (src[j] === '(') depth++;
          else if (src[j] === ')') { if (depth === 0 && src[j + 1] === ')') break; depth--; }
        }
        if (j >= n) throw new Incomplete();
        const part = { k: 'arith', v: src.slice(i + 3, j), q };
        i = j + 2; return part;
      }
      if (c === '(') {
        const j = matchParen(src, i + 2);
        if (j < 0) throw new Incomplete();
        const part = { k: 'cmd', v: src.slice(i + 2, j), q };
        i = j + 1; return part;
      }
      if (c === '{') {
        const j = src.indexOf('}', i + 2);
        if (j < 0) throw new Incomplete();
        const inner = src.slice(i + 2, j);
        i = j + 1;
        return { k: 'var', v: inner, braced: true, q };
      }
      const m = /^([A-Za-z_]\w*|[0-9]|[?#$!@*\-])/.exec(src.slice(i + 1));
      if (m) { i += 1 + m[0].length; return { k: 'var', v: m[0], q }; }
      i++;
      return { k: 'lit', v: '$', q };
    }

    function readWord() {
      const parts = [];
      let lit = '', litQ = 0;
      const flush = () => { if (lit) { parts.push({ k: 'lit', v: lit, q: litQ }); lit = ''; } };
      const addLit = (s, q) => { if (q !== litQ) flush(); litQ = q; lit += s; };
      while (i < n) {
        const c = src[i];
        if (/[\s|&;<>()]/.test(c)) {
          // (  dentro de palabra solo si es parte de glob extendido: no soportado
          break;
        }
        if (c === '\\') {
          if (i + 1 >= n) throw new Incomplete();
          if (src[i + 1] === '\n') { i += 2; continue; }
          addLit(src[i + 1], 1); i += 2; continue;
        }
        if (c === "'") {
          const j = src.indexOf("'", i + 1);
          if (j < 0) throw new Incomplete();
          addLit(src.slice(i + 1, j), 1);
          if (j === i + 1) { flush(); parts.push({ k: 'lit', v: '', q: 1 }); }
          i = j + 1; continue;
        }
        if (c === '"') {
          i++;
          let empty = true;
          while (true) {
            if (i >= n) throw new Incomplete();
            const d = src[i];
            if (d === '"') { i++; break; }
            empty = false;
            if (d === '\\' && i + 1 < n && '$`"\\\n'.includes(src[i + 1])) {
              if (src[i + 1] !== '\n') addLit(src[i + 1], 2);
              i += 2; continue;
            }
            if (d === '$') { flush(); parts.push(readDollar(2)); continue; }
            if (d === '`') {
              const j = src.indexOf('`', i + 1);
              if (j < 0) throw new Incomplete();
              flush(); parts.push({ k: 'cmd', v: src.slice(i + 1, j), q: 2 }); i = j + 1; continue;
            }
            addLit(d, 2); i++;
          }
          if (empty) { flush(); parts.push({ k: 'lit', v: '', q: 2 }); }
          continue;
        }
        if (c === '$') { flush(); parts.push(readDollar(0)); continue; }
        if (c === '`') {
          const j = src.indexOf('`', i + 1);
          if (j < 0) throw new Incomplete();
          flush(); parts.push({ k: 'cmd', v: src.slice(i + 1, j), q: 0 }); i = j + 1; continue;
        }
        addLit(c, 0); i++;
      }
      flush();
      return parts;
    }

    while (i < n) {
      const c = src[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
      if (c === '#' ) {
        // comentario solo al inicio de palabra
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '\n') {
        toks.push({ t: 'op', v: '\n' });
        i++;
        // leer heredocs pendientes
        while (heredocs.length) {
          const h = heredocs.shift();
          const lines = [];
          let found = false;
          while (i < n) {
            let e = src.indexOf('\n', i);
            if (e < 0) e = n;
            let line = src.slice(i, e);
            i = e + 1;
            const cmp = h.strip ? line.replace(/^\t+/, '') : line;
            if (cmp === h.delim) { found = true; break; }
            lines.push(h.strip ? line.replace(/^\t+/, '') : line);
          }
          if (!found) throw new Incomplete('heredoc');
          h.tok.body = lines.join('\n') + (lines.length ? '\n' : '');
        }
        continue;
      }
      // operadores
      const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
      let m;
      if ((m = /^(\d?)(<<<|<<-|<<|>>|>&|<&|&>>|&>|>\||[<>])/.exec(src.slice(i)))) {
        const fd = m[1] !== '' ? +m[1] : null;
        let op = m[2];
        i += m[0].length;
        if ((op === '>&' || op === '<&') && /^\s*(\d|-)/.test(src.slice(i))) {
          const mm = /^\s*(\d|-)/.exec(src.slice(i));
          i += mm[0].length;
          toks.push({ t: 'redir', op: op === '>&' ? 'dup>' : 'dup<', fd: fd != null ? fd : (op === '>&' ? 1 : 0), to: mm[1] });
          continue;
        }
        if (op === '>&') op = '&>';
        while (src[i] === ' ' || src[i] === '\t') i++;
        if (op === '<<' || op === '<<-') {
          const w = readWord();
          const quoted = w.some(p => p.q);
          const delim = w.map(p => p.v).join('');
          if (!delim) throw new SyntaxErr("syntax error near unexpected token `newline'");
          const tok = { t: 'redir', op: '<<', fd: fd != null ? fd : 0, quoted, body: null };
          heredocs.push({ delim, strip: op === '<<-', tok });
          toks.push(tok);
          continue;
        }
        const w = readWord();
        if (!w.length) throw new SyntaxErr("syntax error near unexpected token `" + (src[i] || 'newline') + "'");
        toks.push({ t: 'redir', op, fd, word: w });
        continue;
      }
      if (two === '&&' || two === '||' || two === ';;') { toks.push({ t: 'op', v: two }); i += 2; continue; }
      if ('|&;()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
      const w = readWord();
      toks.push({ t: 'word', parts: w });
    }
    if (heredocs.length) throw new Incomplete('heredoc');
    toks.push({ t: 'eof' });
    return toks;
  }

  function matchParen(src, start) {
    let depth = 0, q = null;
    for (let j = start; j < src.length; j++) {
      const c = src[j];
      if (q) { if (c === q) q = null; else if (c === '\\' && q === '"') j++; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      if (c === '\\') { j++; continue; }
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) return j; depth--; }
    }
    return -1;
  }

  // Texto literal de una palabra (sin expansiones), o null si tiene expansiones
  function wordLiteral(w) {
    if (!w) return null;
    let s = '';
    for (const p of w.parts || w) { if (p.k !== 'lit') return null; s += p.v; }
    return s;
  }
  function isUnquotedLit(w, val) {
    const parts = w.parts;
    return parts.length === 1 && parts[0].k === 'lit' && parts[0].q === 0 && (val === undefined || parts[0].v === val);
  }

  // ---------- Parser ----------
  function parse(src) {
    const toks = lex(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => peek().t === 'op' && peek().v === v;
    const isWord = (v) => peek().t === 'word' && isUnquotedLit(peek(), v);
    const skipNl = () => { while (isOp('\n')) p++; };
    const expectWord = (v) => {
      skipNl();
      if (peek().t === 'eof') throw new Incomplete();
      if (!isWord(v)) throw new SyntaxErr("syntax error near unexpected token `" + tokText(peek()) + "'");
      p++;
    };
    const tokText = (t) => t.t === 'eof' ? 'newline' : t.t === 'op' ? (t.v === '\n' ? 'newline' : t.v) : t.t === 'word' ? t.parts.map(x => x.v).join('') : t.op;

    function list(terms) {
      const items = [];
      skipNl();
      while (true) {
        const t = peek();
        if (t.t === 'eof') break;
        if (t.t === 'word' && terms && terms.some(x => isUnquotedLit(t, x))) break;
        if (t.t === 'op' && (t.v === ')' || t.v === ';;')) break;
        const node = andOr();
        let bg = false;
        if (isOp('&')) { p++; bg = true; }
        else if (isOp(';') || isOp('\n')) p++;
        else if (peek().t !== 'eof' && !(peek().t === 'op' && (peek().v === ')' || peek().v === ';;')) && !(peek().t === 'word' && terms && terms.some(x => isUnquotedLit(peek(), x)))) {
          throw new SyntaxErr("syntax error near unexpected token `" + tokText(peek()) + "'");
        }
        items.push({ node, bg });
        skipNl();
      }
      return { type: 'list', items };
    }
    function andOr() {
      const first = pipeline();
      const rest = [];
      while (isOp('&&') || isOp('||')) {
        const op = next().v;
        skipNl();
        if (peek().t === 'eof') throw new Incomplete();
        rest.push({ op, node: pipeline() });
      }
      return rest.length ? { type: 'andor', first, rest } : first;
    }
    function pipeline() {
      let neg = false;
      if (isWord('!')) { p++; neg = true; }
      const cmds = [command()];
      while (isOp('|')) {
        p++; skipNl();
        if (peek().t === 'eof') throw new Incomplete();
        cmds.push(command());
      }
      return cmds.length > 1 || neg ? { type: 'pipe', neg, cmds } : cmds[0];
    }
    function redirs(node) {
      node.redirs = node.redirs || [];
      while (peek().t === 'redir') node.redirs.push(next());
      return node;
    }
    function command() {
      const t = peek();
      if (t.t === 'eof') throw new Incomplete();
      if (t.t === 'op' && t.v === '(') {
        p++;
        const body = list([]);
        if (peek().t === 'eof') throw new Incomplete();
        if (!isOp(')')) throw new SyntaxErr("syntax error near unexpected token `" + tokText(peek()) + "'");
        p++;
        return redirs({ type: 'group', subshell: true, body });
      }
      if (t.t === 'op') throw new SyntaxErr("syntax error near unexpected token `" + tokText(t) + "'");
      if (t.t === 'word' && t.parts.length === 1 && t.parts[0].q === 0 && t.parts[0].k === 'lit') {
        const w = t.parts[0].v;
        if (w === 'if') return redirs(ifCmd());
        if (w === 'for') return redirs(forCmd());
        if (w === 'while' || w === 'until') return redirs(whileCmd(w === 'until'));
        if (w === 'case') return redirs(caseCmd());
        if (w === '{') { p++; const body = list(['}']); expectWord('}'); return redirs({ type: 'group', body }); }
        if (w === 'function') {
          p++;
          const name = wordLiteral(next().parts);
          if (isOp('(')) { p++; if (!isOp(')')) throw new SyntaxErr('syntax error'); p++; }
          skipNl();
          return { type: 'func', name, body: command() };
        }
        if (['then', 'elif', 'else', 'fi', 'do', 'done', 'esac', '}'].includes(w)) throw new SyntaxErr("syntax error near unexpected token `" + w + "'");
        // f() { ... }
        if (toks[p + 1] && toks[p + 1].t === 'op' && toks[p + 1].v === '(' && toks[p + 2] && toks[p + 2].t === 'op' && toks[p + 2].v === ')') {
          p += 3; skipNl();
          if (peek().t === 'eof') throw new Incomplete();
          return { type: 'func', name: w, body: command() };
        }
      }
      return simple();
    }
    function simple() {
      const node = { type: 'simple', assigns: [], words: [], redirs: [] };
      while (true) {
        const t = peek();
        if (t.t === 'redir') { node.redirs.push(next()); continue; }
        if (t.t !== 'word') break;
        if (!node.words.length && t.parts[0] && t.parts[0].k === 'lit' && t.parts[0].q === 0 && /^[A-Za-z_]\w*(\[\w*\])?\+?=/.test(t.parts[0].v)) {
          const m = /^([A-Za-z_]\w*)(?:\[\w*\])?(\+?)=/.exec(t.parts[0].v);
          const rest = [{ k: 'lit', v: t.parts[0].v.slice(m[0].length), q: 0 }].concat(t.parts.slice(1)).filter(x => !(x.k === 'lit' && x.v === '' && x.q === 0));
          node.assigns.push({ name: m[1], append: m[2] === '+', parts: rest });
          p++; continue;
        }
        node.words.push(next());
      }
      if (!node.words.length && !node.assigns.length && !node.redirs.length) throw new SyntaxErr("syntax error near unexpected token `" + tokText(peek()) + "'");
      return node;
    }
    function ifCmd() {
      p++; // if
      const clauses = [];
      const cond = list(['then']); expectWord('then');
      const body = list(['elif', 'else', 'fi']);
      clauses.push({ cond, body });
      let elseBody = null;
      while (true) {
        skipNl();
        if (peek().t === 'eof') throw new Incomplete();
        if (isWord('elif')) { p++; const c = list(['then']); expectWord('then'); const b = list(['elif', 'else', 'fi']); clauses.push({ cond: c, body: b }); continue; }
        if (isWord('else')) { p++; elseBody = list(['fi']); }
        expectWord('fi');
        break;
      }
      return { type: 'if', clauses, else: elseBody };
    }
    function forCmd() {
      p++;
      if (peek().t === 'eof') throw new Incomplete();
      if (isOp('(')) throw new SyntaxErr('for ((...)) no soportado; use: for i in $(seq 1 10)');
      const v = wordLiteral(next().parts);
      let items = null;
      skipNl();
      if (isWord('in')) {
        p++; items = [];
        while (peek().t === 'word') items.push(next());
      }
      if (isOp(';')) p++;
      expectWord('do');
      const body = list(['done']);
      expectWord('done');
      return { type: 'for', var: v, items, body };
    }
    function whileCmd(until) {
      p++;
      const cond = list(['do']); expectWord('do');
      const body = list(['done']); expectWord('done');
      return { type: 'while', until, cond, body };
    }
    function caseCmd() {
      p++;
      if (peek().t === 'eof') throw new Incomplete();
      const word = next();
      skipNl();
      expectWord('in');
      const arms = [];
      while (true) {
        skipNl();
        if (peek().t === 'eof') throw new Incomplete();
        if (isWord('esac')) { p++; break; }
        if (isOp('(')) p++;
        const pats = [next()];
        while (isOp('|')) { p++; pats.push(next()); }
        if (!isOp(')')) throw new SyntaxErr('syntax error in case pattern');
        p++;
        const body = list(['esac']);
        arms.push({ patterns: pats, body });
        if (isOp(';;')) p++;
      }
      return { type: 'case', word, arms };
    }
    const ast = list([]);
    if (peek().t !== 'eof') throw new SyntaxErr("syntax error near unexpected token `" + tokText(peek()) + "'");
    return ast;
  }

  L.shparse = { lex, parse, Incomplete, SyntaxErr, wordLiteral, matchParen, RESERVED };
})(globalThis.JLab = globalThis.JLab || {});
