/*
 * Sistema de archivos virtual (VFS) estilo POSIX.
 *  - Directorios, archivos y enlaces simbólicos
 *  - Permisos rwx (propietario/grupo/otros), sticky bit, uid/gid
 *  - Cuota de disco (ENOSPC "No space left on device")
 *  - Archivos dinámicos (/proc/*) y dispositivos (/dev/null)
 * Se serializa a JSON para guardarlo en IndexedDB/localStorage.
 */
(function (L) {
  'use strict';
  const P = L.path;

  const MESSAGES = {
    ENOENT: 'No such file or directory', EEXIST: 'File exists', ENOTDIR: 'Not a directory',
    EISDIR: 'Is a directory', EACCES: 'Permission denied', ENOSPC: 'No space left on device',
    ENOTEMPTY: 'Directory not empty', EINVAL: 'Invalid argument', ELOOP: 'Too many levels of symbolic links',
    EPERM: 'Operation not permitted', EROFS: 'Read-only file system', EBUSY: 'Device or resource busy'
  };
  class FsError extends Error {
    constructor(code, p) { super(MESSAGES[code] || code); this.code = code; this.path = p; }
  }

  const ROOT_CRED = { uid: 0, gid: 0, gids: [0] };

  function mkNode(t, mode, uid, gid, extra) {
    const n = { t, m: mode, u: uid, g: gid, mt: Date.now() };
    if (t === 'd') n.c = {};
    if (t === 'f') n.d = '';
    return Object.assign(n, extra || {});
  }

  class VFS {
    constructor(json) {
      this.root = json && json.root ? json.root : mkNode('d', 0o755, 0, 0);
      this.limit = json && json.limit || 1024 * 1024 * 1024; // bytes disponibles para datos
      this.dynamic = {};   // key -> function() => string   (p. ej. /proc/meminfo)
      this.onChange = null;
      this.used = this._sizeOf(this.root);
    }
    toJSON() { return { root: this.root, limit: this.limit }; }

    // ---------- tamaño / cuota ----------
    nodeSize(n) {
      if (n.t === 'f') return n.vs != null ? n.vs : (n.d ? n.d.length : 0);
      if (n.t === 'l') return n.tg.length;
      return 4096;
    }
    _sizeOf(n) {
      let s = this.nodeSize(n);
      if (n.t === 'd') for (const k in n.c) s += this._sizeOf(n.c[k]);
      return s;
    }
    free() { return Math.max(0, this.limit - this.used); }
    _charge(delta, p) {
      if (delta > 0 && this.used + delta > this.limit) throw new FsError('ENOSPC', p);
      this.used += delta;
    }
    _changed(p) { if (this.onChange) this.onChange(p); }

    // ---------- permisos ----------
    can(n, cred, want) {
      if (!cred || cred.uid === 0) {
        if (want === 'x' && n.t === 'f') return (n.m & 0o111) !== 0;
        return true;
      }
      let shift;
      if (n.u === cred.uid) shift = 6;
      else if ((cred.gids || [cred.gid]).includes(n.g)) shift = 3;
      else shift = 0;
      const bit = want === 'r' ? 4 : want === 'w' ? 2 : 1;
      return ((n.m >> shift) & bit) !== 0;
    }
    _need(n, cred, want, p) { if (!this.can(n, cred, want)) throw new FsError('EACCES', p); }

    // ---------- resolución de rutas ----------
    lookup(p, opts) {
      opts = opts || {};
      const follow = opts.follow !== false;
      const cred = opts.cred;
      let depth = 0;
      const walk = (abs, followLast) => {
        const parts = P.split(abs);
        let node = this.root, parent = null, name = '/', cur = '';
        for (let i = 0; i < parts.length; i++) {
          if (node.t !== 'd') throw new FsError('ENOTDIR', p);
          this._need(node, cred, 'x', p);
          const child = node.c[parts[i]];
          if (!child) {
            if (opts.parentOk && i === parts.length - 1) return { node: null, parent: node, name: parts[i], path: cur + '/' + parts[i] };
            throw new FsError('ENOENT', p);
          }
          const last = i === parts.length - 1;
          if (child.t === 'l' && (!last || followLast)) {
            if (++depth > 40) throw new FsError('ELOOP', p);
            const target = P.resolve(cur || '/', child.tg);
            const rest = parts.slice(i + 1).join('/');
            return walk(rest ? target + '/' + rest : target, followLast);
          }
          parent = node; node = child; name = parts[i]; cur += '/' + parts[i];
        }
        return { node, parent, name, path: cur || '/' };
      };
      return walk(P.normalize(p), follow);
    }
    tryLookup(p, opts) { try { return this.lookup(p, opts); } catch (e) { return null; } }
    exists(p) { return !!this.tryLookup(p); }
    stat(p, opts) { return this.lookup(p, opts).node; }
    lstat(p, opts) { return this.lookup(p, Object.assign({}, opts, { follow: false })).node; }
    isDir(p) { const r = this.tryLookup(p); return !!(r && r.node.t === 'd'); }
    isFile(p) { const r = this.tryLookup(p); return !!(r && r.node.t === 'f'); }
    realpath(p) { return this.lookup(p).path; }

    _parentFor(p, cred) {
      const r = this.lookup(p, { parentOk: true, cred, follow: false });
      if (r.node) return r;
      return r;
    }

    // ---------- lectura ----------
    readdir(p, cred) {
      const { node } = this.lookup(p, { cred });
      if (node.t !== 'd') throw new FsError('ENOTDIR', p);
      this._need(node, cred, 'r', p);
      return Object.keys(node.c).sort();
    }
    read(p, cred) {
      const { node, path } = this.lookup(p, { cred });
      if (node.t === 'd') throw new FsError('EISDIR', p);
      this._need(node, cred, 'r', p);
      if (node.dev) return node.dev === 'zero' ? '' : '';
      if (node.dyn) return this.dynamic[node.dyn] ? String(this.dynamic[node.dyn](path)) : '';
      return node.d || '';
    }

    // ---------- escritura ----------
    write(p, data, opts) {
      opts = opts || {};
      const cred = opts.cred;
      data = data == null ? '' : String(data);
      const r = this.lookup(p, { parentOk: true, cred });
      if (r.node) {
        const n = r.node;
        if (n.t === 'd') throw new FsError('EISDIR', p);
        this._need(n, cred, 'w', p);
        if (n.dev) return;
        if (n.dyn || n.ro) throw new FsError('EACCES', p);
        const old = this.nodeSize(n);
        const next = opts.append ? (n.d || '') + data : data;
        const add = opts.append ? data.length : next.length - old;
        this._charge(add, p);
        n.d = next; delete n.vs; delete n.bin;
        if (opts.bin) n.bin = true;
        n.mt = Date.now();
        this._changed(r.path);
        return;
      }
      const parent = r.parent;
      if (parent.t !== 'd') throw new FsError('ENOTDIR', p);
      this._need(parent, cred, 'w', p);
      const c = cred || ROOT_CRED;
      const n = mkNode('f', opts.mode != null ? opts.mode : 0o644, opts.uid != null ? opts.uid : c.uid, opts.gid != null ? opts.gid : c.gid);
      const size = opts.vsize != null ? opts.vsize : data.length;
      this._charge(size, p);
      n.d = data;
      if (opts.bin) n.bin = true;
      if (opts.vsize != null) n.vs = opts.vsize;
      parent.c[r.name] = n;
      parent.mt = Date.now();
      this._changed(r.path);
    }
    touch(p, cred) {
      const r = this.tryLookup(p, { cred });
      if (r) { r.node.mt = Date.now(); this._changed(r.path); return; }
      this.write(p, '', { cred });
    }
    mkdir(p, opts) {
      opts = opts || {};
      const cred = opts.cred;
      const c = cred || ROOT_CRED;
      if (opts.parents) {
        const parts = P.split(p);
        let cur = '';
        for (const part of parts) {
          cur += '/' + part;
          const r = this.tryLookup(cur, { cred });
          if (r) { if (r.node.t !== 'd') throw new FsError('ENOTDIR', cur); continue; }
          this.mkdir(cur, { cred, mode: opts.mode, uid: opts.uid, gid: opts.gid });
        }
        return;
      }
      const r = this.lookup(p, { parentOk: true, cred });
      if (r.node) throw new FsError('EEXIST', p);
      if (r.parent.t !== 'd') throw new FsError('ENOTDIR', p);
      this._need(r.parent, cred, 'w', p);
      this._charge(4096, p);
      r.parent.c[r.name] = mkNode('d', opts.mode != null ? opts.mode : 0o755, opts.uid != null ? opts.uid : c.uid, opts.gid != null ? opts.gid : c.gid);
      r.parent.mt = Date.now();
      this._changed(r.path);
    }
    symlink(target, p, cred) {
      const r = this.lookup(p, { parentOk: true, cred, follow: false });
      if (r.node) throw new FsError('EEXIST', p);
      this._need(r.parent, cred, 'w', p);
      const c = cred || ROOT_CRED;
      r.parent.c[r.name] = mkNode('l', 0o777, c.uid, c.gid, { tg: target });
      this._changed(r.path);
    }

    _checkDelete(parent, node, cred, p) {
      this._need(parent, cred, 'w', p);
      if (cred && cred.uid !== 0 && (parent.m & 0o1000) && node.u !== cred.uid && parent.u !== cred.uid)
        throw new FsError('EPERM', p);
    }
    unlink(p, cred) {
      const r = this.lookup(p, { cred, follow: false });
      if (!r.parent) throw new FsError('EBUSY', p);
      if (r.node.t === 'd') throw new FsError('EISDIR', p);
      this._checkDelete(r.parent, r.node, cred, p);
      this.used -= this.nodeSize(r.node);
      delete r.parent.c[r.name];
      r.parent.mt = Date.now();
      this._changed(r.path);
    }
    rmdir(p, cred) {
      const r = this.lookup(p, { cred, follow: false });
      if (r.node.t !== 'd') throw new FsError('ENOTDIR', p);
      if (!r.parent) throw new FsError('EBUSY', p);
      if (Object.keys(r.node.c).length) throw new FsError('ENOTEMPTY', p);
      this._checkDelete(r.parent, r.node, cred, p);
      this.used -= 4096;
      delete r.parent.c[r.name];
      this._changed(r.path);
    }
    // rm -r: devuelve lista de errores (como rm real, continúa con el resto)
    rmrf(p, cred, errors) {
      errors = errors || [];
      const r = this.lookup(p, { cred, follow: false });
      if (!r.parent) { errors.push(new FsError('EPERM', '/')); return errors; }
      if (r.node.t === 'd') {
        const sub = r.path;
        if (!this.can(r.node, cred, 'r') || !this.can(r.node, cred, 'w') || !this.can(r.node, cred, 'x')) {
          errors.push(new FsError('EACCES', sub)); return errors;
        }
        for (const k of Object.keys(r.node.c)) this.rmrf(sub + '/' + k, cred, errors);
        if (Object.keys(r.node.c).length) return errors;
      }
      try {
        this._checkDelete(r.parent, r.node, cred, p);
        this.used -= this._sizeOf(r.node);
        delete r.parent.c[r.name];
        this._changed(r.path);
      } catch (e) { errors.push(e); }
      return errors;
    }
    rename(src, dst, cred) {
      const s = this.lookup(src, { cred, follow: false });
      if (!s.parent) throw new FsError('EBUSY', src);
      let d = this.lookup(dst, { parentOk: true, cred });
      if (d.node && d.node.t === 'd') d = this.lookup(P.join(d.path, s.name), { parentOk: true, cred });
      if (d.node && d.node === s.node) return;
      if (s.node.t === 'd' && (d.path + '/').startsWith(s.path + '/')) throw new FsError('EINVAL', dst);
      this._checkDelete(s.parent, s.node, cred, src);
      this._need(d.parent, cred, 'w', dst);
      if (d.node) {
        if (d.node.t === 'd') throw new FsError('EISDIR', dst);
        this.used -= this.nodeSize(d.node);
      }
      d.parent.c[d.name] = s.node;
      delete s.parent.c[s.name];
      s.node.mt = Date.now();
      this._changed(s.path); this._changed(d.path);
    }
    copy(src, dst, opts) {
      opts = opts || {};
      const cred = opts.cred;
      const s = this.lookup(src, { cred });
      this._need(s.node, cred, 'r', src);
      let d = this.lookup(dst, { parentOk: true, cred });
      if (d.node && d.node.t === 'd') d = this.lookup(P.join(d.path, s.name), { parentOk: true, cred });
      if (s.node.t === 'd') {
        if (!opts.recursive) throw new FsError('EISDIR', src);
        if ((d.path + '/').startsWith(s.path + '/')) throw new FsError('EINVAL', dst);
        if (!d.node) this.mkdir(d.path, { cred, mode: s.node.m });
        for (const k of Object.keys(s.node.c)) this.copy(s.path + '/' + k, d.path + '/' + k, opts);
        if (opts.preserve) { const n = this.stat(d.path); n.u = s.node.u; n.g = s.node.g; n.m = s.node.m; }
        return;
      }
      if (d.node && d.node.t === 'd') throw new FsError('EISDIR', dst);
      const vs = s.node.vs;
      const data = s.node.dyn ? this.read(s.path) : (s.node.d || '');
      if (d.node) {
        this.write(d.path, data, { cred, bin: s.node.bin });
        const n = this.stat(d.path);
        if (vs != null) { this._charge(vs - this.nodeSize(n), dst); n.vs = vs; }
      } else {
        this.write(d.path, data, { cred, mode: s.node.m, bin: s.node.bin, vsize: vs });
      }
      const n = this.stat(d.path);
      if (opts.preserve) { n.u = s.node.u; n.g = s.node.g; n.m = s.node.m; n.mt = s.node.mt; }
    }
    chmod(p, mode, cred) {
      const r = this.lookup(p, { cred });
      if (cred && cred.uid !== 0 && r.node.u !== cred.uid) throw new FsError('EPERM', p);
      r.node.m = (r.node.m & ~0o7777) | (mode & 0o7777);
      this._changed(r.path);
    }
    chown(p, uid, gid, cred) {
      const r = this.lookup(p, { cred });
      if (cred && cred.uid !== 0) throw new FsError('EPERM', p);
      if (uid != null) r.node.u = uid;
      if (gid != null) r.node.g = gid;
      this._changed(r.path);
    }
    // Recorre un árbol: fn(path, node, depth)
    walk(p, fn, cred, maxDepth) {
      const start = this.lookup(p, { cred });
      const rec = (path, node, depth) => {
        if (fn(path, node, depth) === false) return;
        if (node.t !== 'd' || (maxDepth != null && depth >= maxDepth)) return;
        if (cred && !this.can(node, cred, 'r')) return;
        for (const k of Object.keys(node.c).sort()) rec(path === '/' ? '/' + k : path + '/' + k, node.c[k], depth + 1);
      };
      rec(start.path, start.node, 0);
    }
    du(p) { return this._sizeOf(this.lookup(p).node); }

    // Crea en bloque desde un objeto { 'ruta': contenido | {dir:true} | {...opciones} }
    populate(entries, defaults) {
      for (const [p, v] of Object.entries(entries)) {
        const o = Object.assign({}, defaults || {}, typeof v === 'string' ? { data: v } : v);
        this.mkdir(P.dirname(p), { parents: true, uid: o.uid, gid: o.gid });
        if (o.dir) {
          if (!this.exists(p)) this.mkdir(p, { mode: o.mode != null ? o.mode : 0o755, uid: o.uid, gid: o.gid });
          else if (o.mode != null) this.stat(p).m = o.mode;
          if (o.uid != null) { const n = this.stat(p); n.u = o.uid; n.g = o.gid != null ? o.gid : n.g; }
          continue;
        }
        if (o.link) { if (!this.tryLookup(p, { follow: false })) this.symlink(o.link, p); continue; }
        this.write(p, o.data || '', { mode: o.mode != null ? o.mode : 0o644, uid: o.uid, gid: o.gid, vsize: o.vsize, bin: o.bin });
        const n = this.stat(p);
        if (o.dyn) n.dyn = o.dyn;
        if (o.dev) n.dev = o.dev;
        if (o.ro) n.ro = true;
        if (o.mode != null) n.m = o.mode;
        if (o.uid != null) n.u = o.uid;
        if (o.gid != null) n.g = o.gid;
      }
    }
  }

  // Cadena de permisos estilo ls: drwxr-xr-x
  function modeString(n) {
    const t = n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : n.dev ? 'c' : '-';
    const m = n.m;
    const r = (s) => ((m >> s) & 4 ? 'r' : '-') + ((m >> s) & 2 ? 'w' : '-');
    let u = r(6) + ((m & 0o4000) ? ((m & 0o100) ? 's' : 'S') : ((m & 0o100) ? 'x' : '-'));
    let g = r(3) + ((m & 0o2000) ? ((m & 0o010) ? 's' : 'S') : ((m & 0o010) ? 'x' : '-'));
    let o = r(0) + ((m & 0o1000) ? ((m & 0o001) ? 't' : 'T') : ((m & 0o001) ? 'x' : '-'));
    return t + u + g + o;
  }

  // chmod simbólico: u+x, g-w, o=r, a+rx, +x, u=rwx,g=rx,o=
  function applySymbolicMode(mode, spec, isDir) {
    let out = mode;
    for (const clause of spec.split(',')) {
      const m = /^([ugoa]*)([+\-=])([rwxXst]*)$/.exec(clause);
      if (!m) return null;
      const who = m[1] || 'a';
      let bits = 0;
      for (const ch of m[3]) {
        const b = { r: 4, w: 2, x: 1, X: (isDir || (mode & 0o111)) ? 1 : 0, s: 0, t: 0 }[ch];
        bits |= b;
      }
      let mask = 0, special = 0;
      for (const w of who === 'a' ? 'ugo' : who) {
        const sh = { u: 6, g: 3, o: 0 }[w];
        mask |= bits << sh;
        if (m[3].includes('s') && w === 'u') special |= 0o4000;
        if (m[3].includes('s') && w === 'g') special |= 0o2000;
        if (m[3].includes('t') && w === 'o') special |= 0o1000;
      }
      if (m[3].includes('t') && who === 'a') special |= 0o1000;
      if (m[2] === '+') out |= mask | special;
      else if (m[2] === '-') out &= ~(mask | special);
      else {
        let clear = 0;
        for (const w of who === 'a' ? 'ugo' : who) clear |= 7 << { u: 6, g: 3, o: 0 }[w];
        out = (out & ~clear) | mask | special;
      }
    }
    return out;
  }

  L.VFS = VFS;
  L.FsError = FsError;
  L.fsutil = { modeString, applySymbolicMode, ROOT_CRED, MESSAGES };
})(globalThis.JLab = globalThis.JLab || {});
