/*
 * Formato de archivo comprimido simulado (tar, tar.gz, zip, war, ear, jar).
 * Un archivo empaquetado es un archivo normal del VFS cuyo contenido es:
 *     JLAB-ARCHIVE/1 <formato>\n<JSON con las entradas>
 * Así tar, unzip, jar, jboss-cli (deploy) y el deployment-scanner pueden
 * leer su contenido real (por ejemplo WEB-INF/web.xml dentro de un .war).
 */
(function (L) {
  'use strict';
  const P = L.path;
  const MAGIC = 'JLAB-ARCHIVE/1 ';

  function isArchive(data) { return typeof data === 'string' && data.startsWith(MAGIC); }

  function decode(data) {
    if (!isArchive(data)) return null;
    const nl = data.indexOf('\n');
    const format = data.slice(MAGIC.length, nl).trim();
    try {
      const body = JSON.parse(data.slice(nl + 1));
      return { format, entries: body.entries || [], meta: body.meta || {} };
    } catch (e) { return null; }
  }
  function encode(format, entries, meta) {
    return MAGIC + format + '\n' + JSON.stringify({ meta: meta || {}, entries });
  }

  // Empaqueta rutas (relativas a baseDir) en una lista de entradas
  function collect(vfs, baseDir, relPaths, cred) {
    const entries = [];
    for (const rel of relPaths) {
      const abs = P.resolve(baseDir, rel);
      const start = vfs.lookup(abs, { cred, follow: false });
      const prefix = P.normalize(rel).replace(/^\/+/, '').replace(/^\.\//, '');
      const walk = (absPath, relPath, node) => {
        const e = { p: relPath, t: node.t, m: node.m, mt: node.mt };
        if (node.t === 'f') {
          if (!vfs.can(node, cred, 'r')) throw new L.FsError('EACCES', absPath);
          e.d = node.dyn ? vfs.read(absPath) : (node.d || '');
          if (node.vs != null) e.vs = node.vs;
          if (node.bi) e.bi = node.bi;
          if (node.bin) e.bin = true;
        } else if (node.t === 'l') e.tg = node.tg;
        if (relPath && relPath !== '.') entries.push(e);
        if (node.t === 'd') {
          for (const k of Object.keys(node.c).sort()) {
            walk(absPath + '/' + k, (relPath && relPath !== '.' ? relPath + '/' : '') + k, node.c[k]);
          }
        }
      };
      walk(start.path, prefix === '.' ? '' : prefix, start.node);
    }
    return entries;
  }

  // Tamaño "virtual" de un paquete: suma de contenidos con compresión estimada
  function virtualSize(entries, format) {
    let s = 0;
    for (const e of entries) s += e.t === 'f' ? (e.vs != null ? e.vs : (e.d || '').length) : 512;
    const ratio = /gz|zip|war|ear|jar/.test(format) ? 0.45 : 1;
    return Math.max(64, Math.round(s * ratio));
  }

  function create(vfs, file, format, baseDir, relPaths, cred, meta) {
    const entries = collect(vfs, baseDir, relPaths, cred);
    const data = encode(format, entries, meta);
    const vs = Math.max(data.length, virtualSize(entries, format));
    if (vfs.exists(file)) vfs.write(file, data, { cred });
    else vfs.write(file, data, { cred, bin: true });
    const n = vfs.stat(file);
    n.bin = true;
    if (vs > data.length) { vfs.used += vs - data.length; n.vs = vs; }
    return entries;
  }

  // Extrae entradas en destDir. owner: {uid,gid} para archivos nuevos.
  function extract(vfs, destDir, archive, cred, opts) {
    opts = opts || {};
    const done = [];
    const own = opts.owner || cred || L.fsutil.ROOT_CRED;
    for (const e of archive.entries) {
      if (opts.filter && !opts.filter(e.p)) continue;
      const abs = P.resolve(destDir, e.p);
      if (e.t === 'd') {
        if (!vfs.exists(abs)) vfs.mkdir(abs, { parents: true, cred, mode: e.m, uid: own.uid, gid: own.gid });
      } else if (e.t === 'l') {
        vfs.mkdir(P.dirname(abs), { parents: true, cred });
        if (!vfs.tryLookup(abs, { follow: false })) vfs.symlink(e.tg, abs, cred);
      } else {
        vfs.mkdir(P.dirname(abs), { parents: true, cred });
        if (vfs.exists(abs)) {
          if (opts.noOverwrite) continue;
          vfs.unlink(abs, cred);
        }
        vfs.write(abs, e.d || '', { cred, mode: e.m, vsize: e.vs, bin: e.bin, uid: own.uid, gid: own.gid });
        const n = vfs.stat(abs);
        if (e.bi) n.bi = e.bi;
        if (e.mt) n.mt = e.mt;
      }
      done.push(e);
    }
    return done;
  }

  // Busca una entrada por ruta (p. ej. "WEB-INF/web.xml")
  function entry(archive, p) {
    p = p.replace(/^\/+/, '');
    return archive.entries.find(e => e.p === p) || null;
  }

  L.archive = { MAGIC, isArchive, decode, encode, collect, create, extract, entry, virtualSize };
})(globalThis.JLab = globalThis.JLab || {});
