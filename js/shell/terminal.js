/*
 * Terminal: envoltorio sobre xterm.js (o un backend de pruebas) que ofrece
 *  - write(texto)
 *  - readLine({prompt, history, complete, hidden}) con edición tipo readline
 *  - raw(handler) para programas a pantalla completa (vi, nano, top, less)
 *  - onInterrupt (Ctrl+C mientras corre un comando)
 */
(function (L) {
  'use strict';

  class Terminal {
    constructor(backend) {
      this.backend = backend;           // {write(s), cols, rows, onData(cb)}
      this.reader = null;               // readLine activo
      this.rawHandler = null;
      this.onInterrupt = null;
      this.typeahead = [];
      backend.onData((d) => this.feed(d));
    }
    get cols() { return this.backend.cols || 80; }
    get rows() { return this.backend.rows || 24; }
    write(s) { this.backend.write(s); }
    resetMode() { this.rawHandler = null; }
    // Corta la sesión (VM apagada): cancela lecturas y comandos en curso
    hangup() {
      this.rawHandler = null;
      if (this.reader && this.reader.cancel) this.reader.cancel();
      if (this.onInterrupt) this.onInterrupt();
    }

    feed(d) {
      if (this.rawHandler) { this.rawHandler(d); return; }
      if (this.reader) { this.reader.input(d); return; }
      // comando en ejecución: Ctrl+C interrumpe, lo demás queda en buffer (type-ahead)
      for (const ch of d) {
        if (ch === '\x03') { if (this.onInterrupt) this.onInterrupt(); this.typeahead = []; }
        else if (ch === '\x1c') { if (this.onInterrupt) this.onInterrupt(); }
        else this.typeahead.push(ch);
      }
    }
    // Modo raw: el handler recibe cada tecla. Devuelve función para salir.
    raw(handler) {
      this.rawHandler = handler;
      return () => { if (this.rawHandler === handler) this.rawHandler = null; };
    }

    readLine(o) {
      o = o || {};
      return new Promise((resolve) => {
        const prompt = o.prompt || '';
        const hist = o.history || [];
        let buf = '', pos = 0, hi = hist.length, saved = '';
        let lastTab = 0;
        const W = (s) => this.write(s);
        const visLen = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').length;
        const redraw = () => {
          if (o.hidden) return;
          // reescribe la línea completa (maneja líneas largas de forma simple)
          const total = visLen(prompt) + buf.length;
          const cols = this.cols;
          const rowsUp = this._rowsDrawn || 0;
          let s = '';
          if (rowsUp > 0) s += '\x1b[' + rowsUp + 'A';
          s += '\r\x1b[J' + prompt + buf;
          const endRow = Math.floor(total / cols);
          const curAbs = visLen(prompt) + pos;
          const curRow = Math.floor(curAbs / cols), curCol = curAbs % cols;
          if (total > 0 && total % cols === 0) s += '\r\n';
          const endRowFix = total > 0 && total % cols === 0 ? endRow : endRow;
          if (endRowFix - curRow > 0) s += '\x1b[' + (endRowFix - curRow) + 'A';
          s += '\r' + (curCol ? '\x1b[' + curCol + 'C' : '');
          this._rowsDrawn = curRow;
          W(s);
        };
        this._rowsDrawn = 0;
        W(prompt);
        const finish = (val) => {
          this.reader = null;
          if (!o.hidden) { pos = buf.length; redraw(); }
          const total = visLen(prompt) + buf.length;
          if (o.hidden || !(total > 0 && total % this.cols === 0)) W('\r\n');
          this._rowsDrawn = 0;
          resolve(val);
        };
        const insert = (s) => { buf = buf.slice(0, pos) + s + buf.slice(pos); pos += s.length; redraw(); };
        const reader = {
          input: (d) => {
            let i = 0;
            while (i < d.length) {
              const c = d[i];
              // secuencias de escape
              if (c === '\x1b') {
                const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z]|[bf])/.exec(d.slice(i));
                const seq = m ? m[0] : c;
                i += seq.length;
                switch (seq) {
                  case '\x1b[A': case '\x1bOA':
                    if (!hist.length || hi === 0) break;
                    if (hi === hist.length) saved = buf;
                    hi--; buf = hist[hi]; pos = buf.length; redraw(); break;
                  case '\x1b[B': case '\x1bOB':
                    if (hi >= hist.length) break;
                    hi++; buf = hi === hist.length ? saved : hist[hi]; pos = buf.length; redraw(); break;
                  case '\x1b[C': case '\x1bOC': if (pos < buf.length) { pos++; redraw(); } break;
                  case '\x1b[D': case '\x1bOD': if (pos > 0) { pos--; redraw(); } break;
                  case '\x1b[H': case '\x1bOH': case '\x1b[1~': pos = 0; redraw(); break;
                  case '\x1b[F': case '\x1bOF': case '\x1b[4~': pos = buf.length; redraw(); break;
                  case '\x1b[3~': if (pos < buf.length) { buf = buf.slice(0, pos) + buf.slice(pos + 1); redraw(); } break;
                  case '\x1bb': case '\x1b[1;5D': { let p = pos; while (p > 0 && buf[p - 1] === ' ') p--; while (p > 0 && buf[p - 1] !== ' ') p--; pos = p; redraw(); break; }
                  case '\x1bf': case '\x1b[1;5C': { let p = pos; while (p < buf.length && buf[p] === ' ') p++; while (p < buf.length && buf[p] !== ' ') p++; pos = p; redraw(); break; }
                }
                continue;
              }
              i++;
              switch (c) {
                case '\r': case '\n': finish(buf); return;
                case '\x7f': case '\b':
                  if (pos > 0) { buf = buf.slice(0, pos - 1) + buf.slice(pos); pos--; redraw(); }
                  break;
                case '\x03': // Ctrl+C
                  if (!o.hidden) { pos = buf.length; redraw(); }
                  W('^C\r\n'); this._rowsDrawn = 0; buf = ''; pos = 0;
                  if (o.cancelOnCtrlC) { this.reader = null; resolve(null); return; }
                  W(prompt); break;
                case '\x04': // Ctrl+D
                  if (!buf.length) { this.reader = null; W('\r\n'); resolve(null); return; }
                  if (pos < buf.length) { buf = buf.slice(0, pos) + buf.slice(pos + 1); redraw(); }
                  break;
                case '\x01': pos = 0; redraw(); break;                     // Ctrl+A
                case '\x05': pos = buf.length; redraw(); break;            // Ctrl+E
                case '\x02': if (pos > 0) { pos--; redraw(); } break;      // Ctrl+B
                case '\x06': if (pos < buf.length) { pos++; redraw(); } break; // Ctrl+F
                case '\x15': buf = buf.slice(pos); pos = 0; redraw(); break; // Ctrl+U
                case '\x0b': buf = buf.slice(0, pos); redraw(); break;       // Ctrl+K
                case '\x17': { let p = pos; while (p > 0 && buf[p - 1] === ' ') p--; while (p > 0 && buf[p - 1] !== ' ') p--; buf = buf.slice(0, p) + buf.slice(pos); pos = p; redraw(); break; } // Ctrl+W
                case '\x0c': W('\x1b[2J\x1b[H'); this._rowsDrawn = 0; W(prompt); redraw(); break; // Ctrl+L
                case '\t': {
                  if (!o.complete || o.hidden) break;
                  const r = o.complete(buf, pos);
                  if (!r || !r.cands.length) { W('\x07'); break; }
                  if (r.cands.length === 1) {
                    const c1 = r.cands[0];
                    const add = c1.slice(r.word.length) + (c1.endsWith('/') ? '' : ' ');
                    insert(add);
                    break;
                  }
                  // prefijo común
                  let pre = r.cands[0];
                  for (const x of r.cands) while (!x.startsWith(pre)) pre = pre.slice(0, -1);
                  if (pre.length > r.word.length) { insert(pre.slice(r.word.length)); break; }
                  const now = Date.now();
                  if (now - lastTab < 800) {
                    const names = r.cands.map(x => x.replace(/\/$/, '').split('/').pop() + (x.endsWith('/') ? '/' : ''));
                    const w = Math.max(...names.map(n => n.length)) + 2;
                    const per = Math.max(1, Math.floor(this.cols / w));
                    let s = '\r\n';
                    names.forEach((n, k) => { s += n.padEnd(w); if ((k + 1) % per === 0) s += '\r\n'; });
                    if (names.length % per) s += '\r\n';
                    W(s); this._rowsDrawn = 0; W(prompt + buf);
                    const back = buf.length - pos; if (back) W('\x1b[' + back + 'D');
                  } else W('\x07');
                  lastTab = now;
                  break;
                }
                default:
                  if (c >= ' ' || c === ' ') {
                    // agrupa texto pegado
                    let j = i;
                    while (j < d.length && d[j] >= ' ' && d[j] !== '\x7f') j++;
                    const chunk = c + d.slice(i, j);
                    i = j;
                    if (o.hidden) { buf += chunk; pos = buf.length; }
                    else insert(chunk);
                  }
              }
            }
          }
        };
        reader.cancel = () => { if (this.reader === reader) this.reader = null; this._rowsDrawn = 0; resolve(null); };
        this.reader = reader;
        // teclas escritas mientras corría el comando anterior
        if (this.typeahead.length) { const t = this.typeahead.join(''); this.typeahead = []; reader.input(t); }
      });
    }
  }

  L.Terminal = Terminal;
})(globalThis.JLab = globalThis.JLab || {});
