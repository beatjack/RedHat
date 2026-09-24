/*
 * JBoss Virtual Lab - utilidades comunes.
 * Todos los módulos cuelgan del espacio de nombres global JLab para poder
 * cargarse con <script> clásico (funciona abriendo index.html con file://).
 */
(function (L) {
  'use strict';

  // ---------- Emisor de eventos mínimo ----------
  class Emitter {
    constructor() { this._h = {}; }
    on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return () => this.off(ev, fn); }
    off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter(f => f !== fn); }
    emit(ev, ...a) { (this._h[ev] || []).slice().forEach(f => { try { f(...a); } catch (e) { console.error(e); } }); }
  }

  // ---------- Rutas POSIX ----------
  const path = {
    normalize(p) {
      const abs = p.startsWith('/');
      const out = [];
      for (const part of p.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') { if (out.length) out.pop(); continue; }
        out.push(part);
      }
      return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
    },
    resolve(cwd, p) {
      if (!p) return path.normalize(cwd);
      return path.normalize(p.startsWith('/') ? p : cwd + '/' + p);
    },
    dirname(p) {
      p = path.normalize(p);
      if (p === '/') return '/';
      const i = p.lastIndexOf('/');
      return i <= 0 ? (p.startsWith('/') ? '/' : '.') : p.slice(0, i);
    },
    basename(p, ext) {
      p = p.replace(/\/+$/, '');
      let b = p.slice(p.lastIndexOf('/') + 1) || '/';
      if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
      return b;
    },
    join(...parts) { return path.normalize(parts.join('/')); },
    split(p) { return path.normalize(p).split('/').filter(Boolean); }
  };

  // ---------- Formatos ----------
  function human(bytes, si) {
    const u = ['B', 'K', 'M', 'G', 'T'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    if (i === 0) return String(bytes);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + u[i];
  }
  function pad(s, n, right) {
    s = String(s);
    if (s.length >= n) return s;
    return right ? s + ' '.repeat(n - s.length) : ' '.repeat(n - s.length) + s;
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function two(n) { return String(n).padStart(2, '0'); }
  function lsDate(ms) {
    const d = new Date(ms), now = Date.now();
    const recent = Math.abs(now - ms) < 180 * 86400e3;
    return MONTHS[d.getMonth()] + ' ' + pad(d.getDate(), 2) + ' ' +
      (recent ? two(d.getHours()) + ':' + two(d.getMinutes()) : ' ' + d.getFullYear());
  }
  function dateStr(ms) {
    const d = new Date(ms);
    return DAYS[d.getDay()] + ' ' + MONTHS[d.getMonth()] + ' ' + pad(d.getDate(), 2) + ' ' +
      two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ' ' +
      (tzName()) + ' ' + d.getFullYear();
  }
  function tzName() { return 'UTC'; }
  // Formato de log JBoss: 2026-09-23 21:30:01,123
  function logTime(ms) {
    const d = new Date(ms || Date.now());
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' +
      two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + ',' +
      String(d.getMilliseconds()).padStart(3, '0');
  }
  function clock(ms) {
    const d = new Date(ms || Date.now());
    return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }
  function uptimeStr(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
    let s = '';
    if (d) s += d + (d === 1 ? ' day, ' : ' days, ');
    if (h) s += h + ':' + two(m); else s += m + ' min';
    return s;
  }

  function uid(prefix) {
    return (prefix || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function globToRegex(glob, flags) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else if (c === '[') {
        const j = glob.indexOf(']', i + 1);
        if (j < 0) { re += '\\['; continue; }
        let cls = glob.slice(i + 1, j);
        if (cls[0] === '!') cls = '^' + cls.slice(1);
        re += '[' + cls.replace(/\\/g, '\\\\') + ']';
        i = j;
      } else re += c.replace(/[.+^${}()|\\\/]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', flags || '');
  }

  // ---------- Hash MD5 (usado por add-user.sh, formato real de mgmt-users.properties) ----------
  function md5(str) {
    const utf8 = unescape(encodeURIComponent(str));
    const K = [], S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const n = utf8.length, words = [];
    for (let i = 0; i < n; i++) words[i >> 2] |= utf8.charCodeAt(i) << ((i % 4) * 8);
    words[n >> 2] |= 0x80 << ((n % 4) * 8);
    const total = (((n + 8) >> 6) + 1) * 16;
    for (let i = words.length; i < total; i++) words[i] = words[i] || 0;
    words[total - 2] = n * 8;
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let o = 0; o < total; o += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        const s = S[(i >> 4) * 4 + (i % 4)];
        const tmp = D; D = C; C = B;
        const x = (A + F + K[i] + (words[o + g] | 0)) | 0;
        B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
        A = tmp;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map(v => {
      let h = '';
      for (let i = 0; i < 4; i++) h += ((v >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
      return h;
    }).join('');
  }

  // ---------- SHA-256 (para sha256sum y hash de contraseñas en /etc/shadow) ----------
  function sha256(str) {
    const utf8 = unescape(encodeURIComponent(str));
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    let H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < bytes.length; o += 64) {
      const W = new Array(64);
      for (let i = 0; i < 16; i++) W[i] = (bytes[o + i * 4] << 24) | (bytes[o + i * 4 + 1] << 16) | (bytes[o + i * 4 + 2] << 8) | bytes[o + i * 4 + 3];
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) | 0);
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(str) { return decodeURIComponent(escape(atob(str.replace(/\s+/g, '')))); }

  L.Emitter = Emitter;
  L.path = path;
  L.util = {
    human, pad, lsDate, dateStr, logTime, clock, uptimeStr, uid, clone, sleep, escapeHtml,
    globToRegex, md5, sha256, b64encode, b64decode, MONTHS, DAYS, two
  };
})(globalThis.JLab = globalThis.JLab || {});
