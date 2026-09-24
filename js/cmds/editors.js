/*
 * Programas a pantalla completa sobre la terminal:
 *   vi / vim  (normal, inserción, línea de comandos, búsqueda)
 *   nano      (atajos ^O ^X ^K ^U ^W)
 *   less/more (paginador)
 *   top/htop  (monitor de procesos)
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds;

  const ALT_ON = '\x1b[?1049h\x1b[H', ALT_OFF = '\x1b[?1049l';
  const esc = (s) => s;

  // Lee teclas en modo raw hasta que el programa termine
  function rawSession(c, onKey, render) {
    return new Promise((resolve) => {
      const term = c.term;
      term.write(ALT_ON);
      let finished = false;
      const done = (v) => { if (finished) return; finished = true; release(); term.write(ALT_OFF); resolve(v); };
      const release = term.raw((data) => {
        // separa secuencias
        let i = 0;
        while (i < data.length && !finished) {
          let k = data[i];
          if (k === '\x1b') {
            const m = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(data.slice(i));
            if (m) k = m[0];
          }
          i += k.length;
          try { onKey(k, done); } catch (e) { console.error(e); }
        }
        if (!finished) render();
      });
      render();
    });
  }
  function readFileFor(c, path) {
    const r = c.fs.tryLookup(path, { cred: c.cred });
    if (!r) return { text: '', isNew: true };
    if (r.node.t === 'd') return { error: '"' + path + '" is a directory' };
    if (!c.fs.can(r.node, c.cred, 'r')) return { error: '"' + path + '" [Permission Denied]' };
    const text = c.fs.read(path, c.cred);
    return { text, isNew: false, ro: !c.fs.can(r.node, c.cred, 'w') };
  }

  // ================= vi =================
  C.vi = async (c) => {
    if (!c.term || !c.isTTY) return c.fail('Vim: Warning: Output is not to a terminal');
    const fileArg = c.args.filter(a => !a.startsWith('-') && !a.startsWith('+'))[0];
    let path = fileArg ? c.resolve(fileArg) : null;
    let st = path ? readFileFor(c, path) : { text: '', isNew: true };
    if (st.error) { st = { text: '', isNew: false, ro: true }; }
    let lines = st.text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const lineArg = c.args.find(a => /^\+\d*$/.test(a));
    let cx = 0, cy = lineArg ? (lineArg === '+' ? lines.length - 1 : Math.min(lines.length - 1, +lineArg.slice(1) - 1)) : 0, top = 0, left = 0;
    let mode = 'normal', cmd = '', msg = '', dirty = false, pending = '', count = '';
    let yank = null, yankLines = true, lastSearch = '', showNu = false, lastEdit = null;
    const undo = [];
    const snapshot = () => { undo.push({ lines: lines.slice(), cx, cy }); if (undo.length > 200) undo.shift(); };
    const name = fileArg || '[No Name]';
    if (path) msg = st.isNew ? '"' + fileArg + '" [New]' : st.ro ? '"' + fileArg + '" [readonly] ' + lines.length + 'L, ' + st.text.length + 'B' : '"' + fileArg + '" ' + lines.length + 'L, ' + st.text.length + 'B';
    if (st.error) msg = st.error;
    const rows = () => c.term.rows - 1, cols = () => c.term.cols;
    const gutter = () => showNu ? String(lines.length).length + 2 : 0;
    const clampX = (ins) => { const max = Math.max(0, lines[cy].length - (ins ? 0 : 1)); if (cx > max) cx = max; if (cx < 0) cx = 0; };
    const render = () => {
      const R = rows(), W = cols() - gutter();
      if (cy < top) top = cy;
      if (cy >= top + R) top = cy - R + 1;
      if (cx < left) left = cx;
      if (cx >= left + W) left = cx - W + 1;
      let out = '\x1b[?25l\x1b[H';
      for (let r = 0; r < R; r++) {
        const i = top + r;
        out += '\x1b[2K';
        if (i < lines.length) {
          if (showNu) out += '\x1b[33m' + U.pad(i + 1, gutter() - 1) + ' \x1b[0m';
          out += lines[i].slice(left, left + W).replace(/\t/g, ' ');
        } else out += '\x1b[1;34m~\x1b[0m';
        out += '\r\n';
      }
      out += '\x1b[2K';
      if (mode === 'cmd') out += ':' + cmd;
      else if (mode === 'search') out += '/' + cmd;
      else {
        const left2 = mode === 'insert' ? '\x1b[1m-- INSERT --\x1b[0m' : msg;
        const pos = (cy + 1) + ',' + (cx + 1);
        out += left2 + ' '.repeat(Math.max(1, cols() - 18 - left2.replace(/\x1b\[[0-9;]*m/g, '').length)) + U.pad(pos, 14, true) + (lines.length <= R ? 'All' : top === 0 ? 'Top' : top + R >= lines.length ? 'Bot' : Math.round(top / (lines.length - R) * 100) + '%');
      }
      if (mode === 'cmd' || mode === 'search') out += '\x1b[' + (R + 1) + ';' + (cmd.length + 2) + 'H';
      else out += '\x1b[' + (cy - top + 1) + ';' + (cx - left + 1 + gutter()) + 'H';
      out += '\x1b[?25h';
      c.term.write(out);
    };
    const save = (target, force) => {
      const p = target ? c.resolve(target) : path;
      if (!p) { msg = 'E32: No file name'; return false; }
      const text = lines.join('\n') + '\n';
      try {
        const existed = c.fs.exists(p);
        c.fs.write(p, text, { cred: c.cred });
        if (!path) path = p;
        msg = '"' + (target || fileArg) + '" ' + (existed ? '' : '[New] ') + lines.length + 'L, ' + text.length + 'B written';
        if (p === path) dirty = false;
        return true;
      } catch (e) {
        msg = '\x1b[41;37m' + (e.code === 'EACCES' ? '"' + (target || fileArg) + '" E212: Can\'t open file for writing' : e.code === 'ENOSPC' ? 'E514: write error (file system full?)' : 'E212: ' + e.message) + '\x1b[0m';
        return false;
      }
    };
    const search = (pat, dir) => {
      if (!pat) return;
      let re;
      try { re = new RegExp(L.textutil.bre2js(pat)); } catch (e) { msg = 'E486: Pattern not found: ' + pat; return; }
      for (let k = 1; k <= lines.length; k++) {
        const i = ((cy + dir * k) % lines.length + lines.length) % lines.length;
        const from = k === lines.length ? cx + 1 : 0;
        const m = re.exec(lines[i].slice(0));
        if (m && (i !== cy || k === lines.length)) { cy = i; cx = m.index; msg = '/' + pat; if ((dir > 0 && i < cy) || (dir < 0 && i > cy)) msg = 'search hit BOTTOM, continuing at TOP'; return; }
      }
      const m = re.exec(lines[cy].slice(cx + 1));
      if (m) { cx = cx + 1 + m.index; return; }
      msg = '\x1b[41;37mE486: Pattern not found: ' + pat + '\x1b[0m';
    };
    const wordFwd = () => { const l = lines[cy]; let x = cx; const isW = (ch) => /\w/.test(ch); if (x < l.length) { const w = isW(l[x]); while (x < l.length && isW(l[x]) === w && l[x] !== ' ') x++; } while (x < l.length && l[x] === ' ') x++; if (x >= l.length && cy < lines.length - 1) { cy++; cx = 0; while (cx < lines[cy].length && lines[cy][cx] === ' ') cx++; return; } cx = x; };
    const wordBack = () => { const l = lines[cy]; let x = cx - 1; while (x > 0 && l[x] === ' ') x--; const isW = (ch) => /\w/.test(ch); const w = isW(l[x] || ''); while (x > 0 && isW(l[x - 1]) === w && l[x - 1] !== ' ') x--; if (x < 0 && cy > 0) { cy--; cx = Math.max(0, lines[cy].length - 1); return; } cx = Math.max(0, x); };
    const exCommand = (line, done) => {
      const s = line.trim();
      let m;
      if (s === 'w' || (m = /^w\s+(.+)$/.exec(s))) { save(m && m[1]); return; }
      if (s === 'wq' || s === 'x' || s === 'wq!' || s === 'x!') { if (s.startsWith('x') && !dirty) return done(0); if (save()) return done(0); return; }
      if (s === 'q') { if (dirty) { msg = '\x1b[41;37mE37: No write since last change (add ! to override)\x1b[0m'; return; } return done(0); }
      if (s === 'q!' || s === 'qa!' || s === 'cq') return done(0);
      if (s === 'set nu' || s === 'set number') { showNu = true; return; }
      if (s === 'set nonu' || s === 'set nonumber') { showNu = false; return; }
      if (/^set\s/.test(s)) return;
      if (s === '$') { cy = lines.length - 1; return; }
      if (/^\d+$/.test(s)) { cy = Math.max(0, Math.min(lines.length - 1, +s - 1)); cx = 0; return; }
      if ((m = /^(%|\d+(?:,\d+)?|\.)?s(.)(.*?)\2(.*?)(?:\2([gic]*))?$/.exec(s))) {
        const range = m[1] === '%' ? [0, lines.length - 1] : m[1] && m[1] !== '.' ? m[1].split(',').map(x => +x - 1) : [cy, cy];
        if (range.length === 1) range.push(range[0]);
        let re;
        try { re = new RegExp(L.textutil.bre2js(m[3]), (m[5] || '').includes('g') ? 'g' : '' + ((m[5] || '').includes('i') ? 'i' : '')); } catch (e) { msg = 'E486: Pattern not found: ' + m[3]; return; }
        snapshot();
        let n = 0;
        for (let i = range[0]; i <= range[1] && i < lines.length; i++) {
          const before = lines[i];
          lines[i] = lines[i].replace(re, m[4].replace(/\\\//g, '/').replace(/&/g, '$&').replace(/\\(\d)/g, '$$$1'));
          if (lines[i] !== before) { n++; cy = i; }
        }
        if (!n) { undo.pop(); msg = '\x1b[41;37mE486: Pattern not found: ' + m[3] + '\x1b[0m'; } else { dirty = true; msg = n + ' substitution' + (n > 1 ? 's' : '') + ' on ' + n + ' line' + (n > 1 ? 's' : ''); }
        return;
      }
      if ((m = /^(\d+),(\d+)d$/.exec(s)) || s === 'd') { snapshot(); const a = m ? +m[1] - 1 : cy, b = m ? +m[2] - 1 : cy; lines.splice(a, b - a + 1); if (!lines.length) lines = ['']; cy = Math.min(a, lines.length - 1); dirty = true; return; }
      if (s === 'e!') { const r = readFileFor(c, path); lines = (r.text || '').split('\n'); if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); dirty = false; cy = Math.min(cy, lines.length - 1); return; }
      if (s === 'noh' || s === 'nohlsearch') return;
      if (s === 'help' || s === 'h') { msg = 'Ayuda: i=insertar, Esc=normal, :w guardar, :q salir, :wq guardar y salir, :q! salir sin guardar, dd borrar línea, yy copiar, p pegar, u deshacer, /texto buscar'; return; }
      msg = '\x1b[41;37mE492: Not an editor command: ' + s + '\x1b[0m';
    };
    const doNormal = (k, done) => {
      const n = parseInt(count || '1', 10);
      if (/^[1-9]$/.test(k) || (k === '0' && count)) { count += k; return; }
      const op = pending; pending = '';
      if (op === 'r') { if (k.length === 1 && lines[cy].length) { snapshot(); lines[cy] = lines[cy].slice(0, cx) + k + lines[cy].slice(cx + 1); dirty = true; } count = ''; return; }
      if (op === 'g') { if (k === 'g') { cy = count ? n - 1 : 0; cx = 0; } count = ''; return; }
      if (op === 'Z') { if (k === 'Z') { if (!dirty || save()) done(0); } else if (k === 'Q') done(0); count = ''; return; }
      if (op === 'd' || op === 'y' || op === 'c') {
        if ((k === 'd' && op === 'd') || (k === 'y' && op === 'y') || (k === 'c' && op === 'c')) {
          yank = lines.slice(cy, cy + n); yankLines = true;
          if (op !== 'y') {
            snapshot();
            if (op === 'c') { lines.splice(cy, n, ''); cx = 0; mode = 'insert'; }
            else { lines.splice(cy, n); if (!lines.length) lines = ['']; if (cy >= lines.length) cy = lines.length - 1; cx = 0; }
            dirty = true;
            if (n > 2 && op === 'd') msg = n + ' fewer lines';
          } else if (n > 2) msg = n + ' lines yanked';
        } else if (k === 'w' || k === '$' || k === 'e') {
          const l = lines[cy];
          let end = cx;
          if (k === '$') end = l.length;
          else { for (let i = 0; i < n; i++) { let x = end; while (x < l.length && /\w/.test(l[x])) x++; if (x === end) x++; if (k === 'w' && op !== 'c') while (x < l.length && l[x] === ' ') x++; end = x; } }
          yank = [l.slice(cx, end)]; yankLines = false;
          if (op !== 'y') { snapshot(); lines[cy] = l.slice(0, cx) + l.slice(end); dirty = true; if (op === 'c') mode = 'insert'; else clampX(); }
        }
        count = ''; return;
      }
      count = '';
      switch (k) {
        case 'h': case '\x1b[D': case '\x7f': cx = Math.max(0, cx - n); break;
        case 'l': case '\x1b[C': case ' ': cx = Math.min(Math.max(0, lines[cy].length - 1), cx + n); break;
        case 'j': case '\x1b[B': case '\r': cy = Math.min(lines.length - 1, cy + n); clampX(); break;
        case 'k': case '\x1b[A': cy = Math.max(0, cy - n); clampX(); break;
        case '0': case '\x1b[H': cx = 0; break;
        case '^': cx = lines[cy].search(/\S|$/); break;
        case '$': case '\x1b[F': cx = Math.max(0, lines[cy].length - 1); break;
        case 'w': for (let i = 0; i < n; i++) wordFwd(); break;
        case 'b': for (let i = 0; i < n; i++) wordBack(); break;
        case 'e': { const l = lines[cy]; let x = cx + 1; while (x < l.length && !/\w/.test(l[x])) x++; while (x + 1 < l.length && /\w/.test(l[x + 1])) x++; cx = Math.min(x, Math.max(0, l.length - 1)); break; }
        case 'G': cy = count !== '' && n ? Math.min(lines.length - 1, n - 1) : lines.length - 1; cx = 0; break;
        case 'g': pending = 'g'; count = String(n === 1 ? '' : n); break;
        case '\x06': case '\x1b[6~': cy = Math.min(lines.length - 1, cy + rows() - 2); top = Math.min(Math.max(0, lines.length - rows()), top + rows() - 2); break;
        case '\x02': case '\x1b[5~': cy = Math.max(0, cy - rows() + 2); top = Math.max(0, top - rows() + 2); break;
        case '\x04': cy = Math.min(lines.length - 1, cy + Math.floor(rows() / 2)); break;
        case '\x15': cy = Math.max(0, cy - Math.floor(rows() / 2)); break;
        case 'i': case '\x1b[2~': snapshot(); mode = 'insert'; break;
        case 'I': snapshot(); cx = lines[cy].search(/\S|$/); mode = 'insert'; break;
        case 'a': snapshot(); if (lines[cy].length) cx++; mode = 'insert'; break;
        case 'A': snapshot(); cx = lines[cy].length; mode = 'insert'; break;
        case 'o': snapshot(); lines.splice(cy + 1, 0, ''); cy++; cx = 0; mode = 'insert'; dirty = true; break;
        case 'O': snapshot(); lines.splice(cy, 0, ''); cx = 0; mode = 'insert'; dirty = true; break;
        case 'x': case '\x1b[3~': if (lines[cy].length) { snapshot(); yank = [lines[cy].slice(cx, cx + n)]; yankLines = false; lines[cy] = lines[cy].slice(0, cx) + lines[cy].slice(cx + n); clampX(); dirty = true; } break;
        case 'X': if (cx > 0) { snapshot(); lines[cy] = lines[cy].slice(0, cx - 1) + lines[cy].slice(cx); cx--; dirty = true; } break;
        case 'D': snapshot(); yank = [lines[cy].slice(cx)]; yankLines = false; lines[cy] = lines[cy].slice(0, cx); clampX(); dirty = true; break;
        case 'C': snapshot(); lines[cy] = lines[cy].slice(0, cx); mode = 'insert'; dirty = true; break;
        case 'd': case 'y': case 'c': case 'r': case 'Z': pending = k; count = n > 1 ? String(n) : ''; break;
        case 'J': if (cy < lines.length - 1) { snapshot(); cx = lines[cy].length; lines[cy] = lines[cy].replace(/\s+$/, '') + ' ' + lines[cy + 1].replace(/^\s+/, ''); lines.splice(cy + 1, 1); dirty = true; } break;
        case 'p': case 'P': {
          if (!yank) break;
          snapshot();
          if (yankLines) { const at = k === 'p' ? cy + 1 : cy; for (let i = 0; i < n; i++) lines.splice(at, 0, ...yank); cy = at; cx = 0; }
          else { const at = k === 'p' ? Math.min(cx + 1, lines[cy].length) : cx; lines[cy] = lines[cy].slice(0, at) + yank[0].repeat(n) + lines[cy].slice(at); cx = at + yank[0].length * n - 1; }
          dirty = true; break;
        }
        case 'u': { const s = undo.pop(); if (s) { lines = s.lines; cx = s.cx; cy = s.cy; msg = '1 change; before #' + (undo.length + 1); dirty = true; } else msg = 'Already at oldest change'; break; }
        case '.': break;
        case ':': mode = 'cmd'; cmd = ''; break;
        case '/': mode = 'search'; cmd = ''; break;
        case 'n': search(lastSearch, 1); break;
        case 'N': search(lastSearch, -1); break;
        case '\x07': msg = '"' + name + '"' + (dirty ? ' [Modified]' : '') + ' ' + lines.length + ' lines --' + Math.round((cy + 1) / lines.length * 100) + '%--'; break;
        case '\x1b': msg = ''; break;
        case '\x0c': break;
      }
    };
    const doInsert = (k) => {
      const l = lines[cy];
      switch (k) {
        case '\x1b': mode = 'normal'; if (cx > 0) cx--; msg = ''; return;
        case '\r': lines[cy] = l.slice(0, cx); lines.splice(cy + 1, 0, l.slice(cx)); cy++; cx = 0; break;
        case '\x7f': case '\b':
          if (cx > 0) { lines[cy] = l.slice(0, cx - 1) + l.slice(cx); cx--; }
          else if (cy > 0) { cx = lines[cy - 1].length; lines[cy - 1] += l; lines.splice(cy, 1); cy--; }
          break;
        case '\x1b[3~': if (cx < l.length) lines[cy] = l.slice(0, cx) + l.slice(cx + 1); else if (cy < lines.length - 1) { lines[cy] += lines[cy + 1]; lines.splice(cy + 1, 1); } break;
        case '\x1b[D': cx = Math.max(0, cx - 1); return;
        case '\x1b[C': cx = Math.min(l.length, cx + 1); return;
        case '\x1b[A': cy = Math.max(0, cy - 1); clampX(true); return;
        case '\x1b[B': cy = Math.min(lines.length - 1, cy + 1); clampX(true); return;
        case '\x1b[H': cx = 0; return;
        case '\x1b[F': cx = l.length; return;
        case '\t': lines[cy] = l.slice(0, cx) + '    ' + l.slice(cx); cx += 4; break;
        default:
          if (k.length >= 1 && k[0] >= ' ' && !k.startsWith('\x1b')) { lines[cy] = l.slice(0, cx) + k + l.slice(cx); cx += k.length; }
          else return;
      }
      dirty = true;
    };
    await rawSession(c, (k, done) => {
      if (mode === 'insert') {
        // texto pegado llega como una sola cadena
        if (k.length > 1 && !k.startsWith('\x1b')) { for (const ch of k) doInsert(ch === '\n' ? '\r' : ch); return; }
        return doInsert(k);
      }
      if (mode === 'cmd' || mode === 'search') {
        if (k === '\r') {
          const line = cmd; const wasSearch = mode === 'search'; mode = 'normal';
          if (wasSearch) { lastSearch = line; search(line, 1); } else exCommand(line, done);
          return;
        }
        if (k === '\x1b' || k === '\x03') { mode = 'normal'; return; }
        if (k === '\x7f') { if (!cmd) mode = 'normal'; cmd = cmd.slice(0, -1); return; }
        if (k[0] >= ' ' && !k.startsWith('\x1b')) cmd += k;
        return;
      }
      if (k.length > 1 && !k.startsWith('\x1b')) { for (const ch of k) doNormal(ch, done); return; }
      doNormal(k, done);
    }, render);
    return 0;
  };
  C.vim = C.vi;
  C.view = C.vi;

  // ================= nano =================
  C.nano = async (c) => {
    if (!c.term || !c.isTTY) return c.fail('Too many errors from stdin');
    const fileArg = c.args.filter(a => !a.startsWith('-') && !a.startsWith('+'))[0];
    let path = fileArg ? c.resolve(fileArg) : null;
    let st = path ? readFileFor(c, path) : { text: '', isNew: true };
    let lines = (st.text || '').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    let cx = 0, cy = 0, top = 0, dirty = false, cut = [], lastCut = false;
    let msg = st.error ? '[ Error reading ' + fileArg + ': Permission denied ]' : st.isNew ? '[ New File ]' : '[ Read ' + lines.length + ' lines' + (st.ro ? ' (Warning: No write permission)' : '') + ' ]';
    let prompt = null; // {label, value, cb}
    const R = () => c.term.rows - 4, W = () => c.term.cols;
    const inv = (s) => '\x1b[7m' + s + '\x1b[0m';
    const render = () => {
      if (cy < top) top = cy;
      if (cy >= top + R()) top = cy - R() + 1;
      const title = '  GNU nano 5.6.1';
      const fname = fileArg ? P.basename(fileArg) === fileArg ? fileArg : fileArg : 'New Buffer';
      let out = '\x1b[?25l\x1b[H' + inv(title + ' '.repeat(Math.max(1, Math.floor(W() / 2) - title.length - Math.floor(fname.length / 2))) + fname + ' '.repeat(Math.max(1, W() - Math.floor(W() / 2) - Math.ceil(fname.length / 2) - (dirty ? 10 : 0))) + (dirty ? 'Modified  ' : '')).slice(0, W() + 8) + '\r\n';
      for (let r = 0; r < R(); r++) { const i = top + r; out += '\x1b[2K' + (i < lines.length ? lines[i].slice(0, W()) : '') + '\r\n'; }
      out += '\x1b[2K';
      if (prompt) out += inv(prompt.label + prompt.value + ' '.repeat(Math.max(0, W() - prompt.label.length - prompt.value.length)));
      else if (msg) out += ' '.repeat(Math.max(0, Math.floor((W() - msg.length) / 2))) + inv(msg);
      out += '\r\n\x1b[2K';
      if (prompt && prompt.yn) out += inv(' Y') + ' Yes\r\n\x1b[2K' + inv(' N') + ' No           ' + inv('^C') + ' Cancel';
      else out += inv('^G') + ' Help      ' + inv('^O') + ' Write Out ' + inv('^W') + ' Where Is  ' + inv('^K') + ' Cut       ' + inv('^C') + ' Location\r\n\x1b[2K' + inv('^X') + ' Exit      ' + inv('^R') + ' Read File ' + inv('^\\') + ' Replace   ' + inv('^U') + ' Paste     ' + inv('^_') + ' Go To Line';
      if (prompt) out += '\x1b[' + (R() + 2) + ';' + (prompt.label.length + prompt.value.length + 1) + 'H';
      else out += '\x1b[' + (cy - top + 2) + ';' + (Math.min(cx, W() - 1) + 1) + 'H';
      out += '\x1b[?25h';
      c.term.write(out);
    };
    const writeOut = (name) => {
      try {
        const p = c.resolve(name);
        const text = lines.join('\n') + '\n';
        c.fs.write(p, text, { cred: c.cred });
        path = p; dirty = false;
        msg = '[ Wrote ' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ' ]';
        return true;
      } catch (e) { msg = '[ Error writing ' + name + ': ' + e.message + ' ]'; return false; }
    };
    await rawSession(c, (k, done) => {
      if (prompt) {
        if (prompt.yn) {
          if (/^[yY]$/.test(k)) { const cb = prompt.cb; prompt = null; cb(true); }
          else if (/^[nN]$/.test(k)) { const cb = prompt.cb; prompt = null; cb(false); }
          else if (k === '\x03') { prompt = null; msg = '[ Cancelled ]'; }
          return;
        }
        if (k === '\r') { const cb = prompt.cb, v = prompt.value; prompt = null; cb(v); return; }
        if (k === '\x03') { prompt = null; msg = '[ Cancelled ]'; return; }
        if (k === '\x7f') { prompt.value = prompt.value.slice(0, -1); return; }
        if (k[0] >= ' ' && !k.startsWith('\x1b')) prompt.value += k;
        return;
      }
      msg = '';
      const l = lines[cy];
      if (k !== '\x0b') lastCut = false;
      switch (k) {
        case '\x18': // ^X
          if (!dirty) return done(0);
          prompt = { yn: true, label: 'Save modified buffer?  ', value: '', cb: (yes) => {
            if (!yes) return done(0);
            prompt = { label: 'File Name to Write: ', value: fileArg || '', cb: (v) => { if (v && writeOut(v)) done(0); } };
          } };
          return;
        case '\x0f': prompt = { label: 'File Name to Write: ', value: fileArg || '', cb: (v) => { if (v) writeOut(v); } }; return;
        case '\x0b': { const removed = lines.splice(cy, 1)[0]; cut = lastCut ? cut.concat([removed]) : [removed]; lastCut = true; if (!lines.length) lines = ['']; if (cy >= lines.length) cy = lines.length - 1; cx = 0; dirty = true; return; }
        case '\x15': if (cut.length) { lines.splice(cy, 0, ...cut); cy += cut.length; cx = 0; dirty = true; } return;
        case '\x17': prompt = { label: 'Search: ', value: '', cb: (v) => { if (!v) return; for (let k2 = 1; k2 <= lines.length; k2++) { const i = (cy + k2) % lines.length; const x = lines[i].indexOf(v); if (x >= 0) { cy = i; cx = x; return; } } msg = '[ "' + v + '" not found ]'; } }; return;
        case '\x1f': prompt = { label: 'Enter line number, column number: ', value: '', cb: (v) => { const n = parseInt(v, 10); if (n) { cy = Math.min(lines.length - 1, n - 1); cx = 0; } } }; return;
        case '\x03': msg = '[ line ' + (cy + 1) + '/' + lines.length + ' (' + Math.round((cy + 1) / lines.length * 100) + '%), col ' + (cx + 1) + '/' + (l.length + 1) + ' ]'; return;
        case '\x07': msg = '[ Ayuda: ^O guardar, ^X salir, ^K cortar línea, ^U pegar, ^W buscar ]'; return;
        case '\r': lines[cy] = l.slice(0, cx); lines.splice(cy + 1, 0, l.slice(cx)); cy++; cx = 0; dirty = true; return;
        case '\x7f': case '\b': if (cx > 0) { lines[cy] = l.slice(0, cx - 1) + l.slice(cx); cx--; } else if (cy > 0) { cx = lines[cy - 1].length; lines[cy - 1] += l; lines.splice(cy, 1); cy--; } dirty = true; return;
        case '\x1b[3~': if (cx < l.length) lines[cy] = l.slice(0, cx) + l.slice(cx + 1); else if (cy < lines.length - 1) { lines[cy] += lines[cy + 1]; lines.splice(cy + 1, 1); } dirty = true; return;
        case '\x1b[A': cy = Math.max(0, cy - 1); cx = Math.min(cx, lines[cy].length); return;
        case '\x1b[B': cy = Math.min(lines.length - 1, cy + 1); cx = Math.min(cx, lines[cy].length); return;
        case '\x1b[C': if (cx < l.length) cx++; else if (cy < lines.length - 1) { cy++; cx = 0; } return;
        case '\x1b[D': if (cx > 0) cx--; else if (cy > 0) { cy--; cx = lines[cy].length; } return;
        case '\x1b[H': case '\x01': cx = 0; return;
        case '\x1b[F': case '\x05': cx = l.length; return;
        case '\x1b[5~': cy = Math.max(0, cy - R()); return;
        case '\x1b[6~': cy = Math.min(lines.length - 1, cy + R()); return;
        case '\t': lines[cy] = l.slice(0, cx) + '\t' + l.slice(cx); cx++; dirty = true; return;
        default:
          if (k.length > 1 && !k.startsWith('\x1b')) { for (const ch of k) { if (ch === '\r' || ch === '\n') { const l2 = lines[cy]; lines[cy] = l2.slice(0, cx); lines.splice(cy + 1, 0, l2.slice(cx)); cy++; cx = 0; } else { lines[cy] = lines[cy].slice(0, cx) + ch + lines[cy].slice(cx); cx++; } } dirty = true; return; }
          if (k[0] >= ' ' && !k.startsWith('\x1b')) { lines[cy] = l.slice(0, cx) + k + l.slice(cx); cx += k.length; dirty = true; }
      }
    }, render);
    return 0;
  };

  // ================= less / more =================
  async function pager(c, text, title) {
    const all = text.replace(/\n$/, '').split('\n');
    if (!c.term || !c.isTTY) { c.out(text); return 0; }
    const R = () => c.term.rows - 1;
    if (c.name === 'more' && all.length <= R()) { c.out(text); return 0; }
    let top = 0, prompt = null, msg = title || '', lastPat = '';
    const render = () => {
      let out = '\x1b[H';
      for (let r = 0; r < R(); r++) { const i = top + r; out += '\x1b[2K' + (i < all.length ? (lastPat ? all[i].replace(new RegExp(lastPat, 'g'), (m) => '\x1b[7m' + m + '\x1b[0m') : all[i]).slice(0, c.term.cols + 20) : '~') + '\r\n'; }
      out += '\x1b[2K';
      if (prompt !== null) out += '/' + prompt;
      else if (top + R() >= all.length) out += '\x1b[7m(END)\x1b[0m';
      else out += msg ? '\x1b[7m' + msg + '\x1b[0m' : ':';
      c.term.write(out);
    };
    await rawSession(c, (k, done) => {
      if (prompt !== null) {
        if (k === '\r') { lastPat = prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const p = prompt; prompt = null; const i = all.findIndex((l, j) => j > top && l.includes(p)); if (i >= 0) top = i; else msg = 'Pattern not found'; return; }
        if (k === '\x1b') { prompt = null; return; }
        if (k === '\x7f') { prompt = prompt.slice(0, -1); return; }
        prompt += k; return;
      }
      msg = '';
      const max = Math.max(0, all.length - R());
      switch (k) {
        case 'q': case 'Q': case '\x03': return done(0);
        case ' ': case 'f': case '\x1b[6~': case '\x06': top = Math.min(max, top + R()); if (c.name === 'more' && top >= max && k === ' ') return done(0); break;
        case 'b': case '\x1b[5~': case '\x02': top = Math.max(0, top - R()); break;
        case 'j': case '\r': case '\x1b[B': case 'e': top = Math.min(max, top + 1); break;
        case 'k': case '\x1b[A': case 'y': top = Math.max(0, top - 1); break;
        case 'd': top = Math.min(max, top + Math.floor(R() / 2)); break;
        case 'u': top = Math.max(0, top - Math.floor(R() / 2)); break;
        case 'g': case '<': case '\x1b[H': top = 0; break;
        case 'G': case '>': case '\x1b[F': top = max; break;
        case '/': prompt = ''; break;
        case 'n': { const i = all.findIndex((l, j) => j > top && lastPat && new RegExp(lastPat).test(l)); if (i >= 0) top = Math.min(i, max); else msg = 'Pattern not found'; break; }
        case 'N': { let i = -1; for (let j = top - 1; j >= 0; j--) if (lastPat && new RegExp(lastPat).test(all[j])) { i = j; break; } if (i >= 0) top = i; break; }
      }
    }, render);
    return 0;
  }
  C.less = async (c) => {
    const files = c.args.filter(a => !a.startsWith('-') && !a.startsWith('+'));
    let text;
    if (files.length) { try { text = c.fs.read(c.resolve(files[0]), c.cred); } catch (e) { return c.fail(files[0] + ': ' + e.message); } }
    else { if (c.stdinTTY) return c.fail('Missing filename ("less --help" for help)'); text = await c.readAll(); }
    const follow = c.args.includes('+F');
    if (follow) return C.tail(Object.assign({}, c, { args: ['-f', files[0]] }));
    return pager(c, text, files[0]);
  };
  C.more = C.less;
  L.pager = pager;

  // ================= top / htop =================
  C.top = async (c) => {
    const batch = c.args.includes('-b') || !c.term || !c.isTTY;
    const nIdx = c.args.indexOf('-n');
    const iterations = nIdx >= 0 ? +c.args[nIdx + 1] : (batch ? 1 : Infinity);
    let sortBy = 'cpu';
    const frame = () => {
      const vm = c.vm, m = vm.memStats(), la = vm.loadAvg();
      const procs = Array.from(vm.procs.values());
      const cpu = vm.cpuPercent();
      const sec = Math.floor((Date.now() - vm.bootTime) / 1000);
      let s = 'top - ' + U.clock() + ' up ' + U.uptimeStr(sec) + ',  ' + (vm.sessions.size || 1) + ' user,  load average: ' + la.map(x => x.toFixed(2)).join(', ') + '\n';
      s += 'Tasks: ' + U.pad(procs.length + 90, 3) + ' total,   1 running, ' + U.pad(procs.length + 89, 3) + ' sleeping,   0 stopped,   0 zombie\n';
      s += '%Cpu(s): ' + U.pad((cpu * 0.7).toFixed(1), 4) + ' us, ' + U.pad((cpu * 0.3).toFixed(1), 4) + ' sy,  0.0 ni, ' + U.pad((100 - cpu).toFixed(1), 4) + ' id,  0.0 wa,  0.0 hi,  0.1 si,  0.0 st\n';
      s += 'MiB Mem : ' + U.pad(m.total.toFixed(1), 8) + ' total, ' + U.pad(m.free.toFixed(1), 8) + ' free, ' + U.pad(m.used.toFixed(1), 8) + ' used, ' + U.pad(m.cache.toFixed(1), 8) + ' buff/cache\n';
      s += 'MiB Swap: ' + U.pad(vm.swapMB().toFixed(1), 8) + ' total, ' + U.pad(vm.swapMB().toFixed(1), 8) + ' free, ' + U.pad('0.0', 8) + ' used. ' + U.pad(m.available.toFixed(1), 8) + ' avail Mem\n\n';
      s += (batch ? '' : '\x1b[7m') + '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND' + (batch ? '' : ' '.repeat(Math.max(0, c.term.cols - 80)) + '\x1b[0m') + '\n';
      procs.sort((a, b) => sortBy === 'mem' ? b.memMB - a.memMB : (b.cpu || 0) - (a.cpu || 0) || b.memMB - a.memMB);
      const max = batch ? procs.length : c.term.rows - 8;
      for (const p of procs.slice(0, max)) {
        const res = Math.round(p.memMB * 1024);
        s += U.pad(p.pid, 7) + ' ' + U.pad(p.user.slice(0, 8), 8, true) + '  20   0 ' + U.pad(Math.round(res * 1.8), 7) + ' ' + U.pad(res, 6) + ' ' + U.pad(Math.round(res / 8), 6) + ' ' + (p.cpu > 1 ? 'R' : 'S') + ' ' + U.pad((p.cpu || 0).toFixed(1), 5) + ' ' + U.pad((p.memMB / vm.ramMB * 100).toFixed(1), 5) + ' ' + U.pad(Math.floor((Date.now() - p.start) / 60000) + ':' + U.two(Math.floor((Date.now() - p.start) / 1000) % 60) + '.' + U.two(p.pid % 100), 9) + ' ' + p.name + '\n';
      }
      return s;
    };
    if (batch) { for (let i = 0; i < iterations; i++) { c.out(frame()); if (i < iterations - 1) await c.sleep(3000); } return 0; }
    let timer;
    await new Promise((resolve) => {
      const term = c.term;
      term.write(ALT_ON);
      const draw = () => term.write('\x1b[H\x1b[2J' + frame().replace(/\n/g, '\r\n'));
      let n = 0;
      const release = term.raw((k) => {
        if (k === 'q' || k === '\x03') { clearInterval(timer); release(); term.write(ALT_OFF); resolve(); return; }
        if (k === 'M') sortBy = 'mem';
        if (k === 'P') sortBy = 'cpu';
        draw();
      });
      draw();
      timer = setInterval(() => { draw(); if (++n >= iterations) { clearInterval(timer); release(); term.write(ALT_OFF); resolve(); } }, 3000);
    });
    return 0;
  };
  C.htop = C.top;
})(globalThis.JLab = globalThis.JLab || {});
