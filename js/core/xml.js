/*
 * Parser/serializador XML mínimo. Conserva comentarios, espacios e
 * indentación del documento original para que standalone.xml siga siendo
 * legible después de modificarlo desde jboss-cli o la consola web.
 * Informa errores con número de línea (igual que el arranque real de JBoss
 * cuando el XML está mal formado).
 */
(function (L) {
  'use strict';

  class XmlError extends Error {
    constructor(msg, line, col, java, libxml) { super(msg); this.line = line; this.col = col; this.java = java || msg; this.libxml = libxml || msg; }
  }

  class XNode {
    constructor(type, props) { this.type = type; Object.assign(this, props); }
  }

  function el(name, attrs, children) {
    return new XNode('element', { name, attrs: attrs || [], children: children || [], parent: null });
  }

  function parse(src) {
    let i = 0, line = 1, col = 1;
    const doc = new XNode('document', { children: [], parent: null });
    const stack = [doc];
    const adv = (n) => {
      for (let k = 0; k < n; k++) {
        if (src[i] === '\n') { line++; col = 1; } else col++;
        i++;
      }
    };
    // m: mensaje en español (editor); java: estilo Woodstox (server.log); lib: estilo libxml2 (xmllint)
    const fail = (m, java, lib) => { throw new XmlError(m, line, col, java, lib); };
    const top = () => stack[stack.length - 1];
    const push = (node) => { node.parent = top(); top().children.push(node); };

    while (i < src.length) {
      if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        if (e < 0) fail('Comentario sin cerrar', 'Unexpected EOF in comment', 'Comment not terminated');
        push(new XNode('comment', { value: src.slice(i + 4, e) }));
        adv(e + 3 - i);
      } else if (src.startsWith('<?', i)) {
        const e = src.indexOf('?>', i);
        if (e < 0) fail('Instrucción de procesamiento sin cerrar', 'Unexpected EOF in processing instruction', 'ParsePI: PI never end ...');
        push(new XNode('pi', { value: src.slice(i + 2, e) }));
        adv(e + 2 - i);
      } else if (src.startsWith('<![CDATA[', i)) {
        const e = src.indexOf(']]>', i);
        if (e < 0) fail('CDATA sin cerrar', 'Unexpected EOF in CDATA section', 'CData section not finished');
        push(new XNode('cdata', { value: src.slice(i + 9, e) }));
        adv(e + 3 - i);
      } else if (src.startsWith('<!', i)) {
        const e = src.indexOf('>', i);
        push(new XNode('doctype', { value: src.slice(i + 2, e) }));
        adv(e + 1 - i);
      } else if (src.startsWith('</', i)) {
        const e = src.indexOf('>', i);
        if (e < 0) fail('Etiqueta de cierre sin terminar', 'Unexpected EOF; was expecting a close tag', "expected '>'");
        const name = src.slice(i + 2, e).trim();
        const cur = top();
        if (cur.type !== 'element') fail("Etiqueta de cierre inesperada '</" + name + ">'", 'Unexpected close tag </' + name + '>; no open start tag', 'Extra content at the end of the document');
        if (cur.name !== name) fail("Se esperaba '</" + cur.name + ">' pero se encontró '</" + name + ">'", 'Unexpected close tag </' + name + '>; expected </' + cur.name + '>.', 'Opening and ending tag mismatch: ' + cur.name + ' line ' + (cur.line || 1) + ' and ' + name);
        stack.pop();
        adv(e + 1 - i);
      } else if (src[i] === '<') {
        adv(1);
        const m = /^[A-Za-z_][\w.:-]*/.exec(src.slice(i));
        if (!m) fail('Nombre de elemento inválido', "Unexpected character '" + (src[i] || '') + "' (code " + (src.charCodeAt(i) || 0) + ') in start tag', 'StartTag: invalid element name');
        const node = el(m[0]);
        node.line = line;
        adv(m[0].length);
        for (;;) {
          while (/\s/.test(src[i] || '')) adv(1);
          if (i >= src.length) fail("Elemento '" + node.name + "' sin cerrar", 'Unexpected EOF; was expecting a close tag for element <' + node.name + '>', "Couldn't find end of Start Tag " + node.name + ' line ' + node.line);
          if (src.startsWith('/>', i)) { adv(2); push(node); break; }
          if (src[i] === '>') { adv(1); push(node); stack.push(node); break; }
          const am = /^([A-Za-z_][\w.:-]*)\s*=\s*/.exec(src.slice(i));
          if (!am) fail("Atributo mal formado en '" + node.name + "'", "Unexpected character '" + (src[i] || '') + "' (code " + (src.charCodeAt(i) || 0) + '); expected a space between attributes', 'attributes construct error');
          adv(am[0].length);
          const q = src[i];
          if (q !== '"' && q !== "'") fail("Valor de atributo '" + am[1] + "' debe ir entre comillas", "Unexpected character '" + (src[i] || '') + "' (code " + (src.charCodeAt(i) || 0) + '); expected a quote character enclosing value for \'' + am[1] + "'", 'AttValue: " or \' expected');
          const e = src.indexOf(q, i + 1);
          if (e < 0) fail("Valor de atributo '" + am[1] + "' sin cerrar", 'Unexpected EOF in attribute value', "AttValue: ' expected");
          if (node.attrs.some(a => a[0] === am[1])) fail("Atributo '" + am[1] + "' duplicado", "Duplicate attribute '" + am[1] + "'.", 'Attribute ' + am[1] + ' redefined');
          node.attrs.push([am[1], decode(src.slice(i + 1, e))]);
          adv(e + 1 - i);
        }
      } else {
        const e = src.indexOf('<', i);
        const end = e < 0 ? src.length : e;
        const text = src.slice(i, end);
        push(new XNode('text', { value: decode(text) }));
        adv(end - i);
      }
    }
    if (stack.length > 1) fail("Elemento '" + top().name + "' no fue cerrado (fin de archivo)", 'Unexpected EOF; was expecting a close tag for element <' + top().name + '>', 'Premature end of data in tag ' + top().name + ' line ' + (top().line || 1));
    if (!doc.children.some(c => c.type === 'element')) fail('Documento vacío: no hay elemento raíz', 'Unexpected EOF in prolog', 'Document is empty');
    return doc;
  }

  function decode(s) {
    return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
      switch (e) {
        case 'lt': return '<'; case 'gt': return '>'; case 'amp': return '&';
        case 'quot': return '"'; case 'apos': return "'";
      }
      return e[1] === 'x' || e[1] === 'X' ? String.fromCharCode(parseInt(e.slice(2), 16)) : String.fromCharCode(+e.slice(1));
    });
  }
  function encAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function encText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  function serialize(node) {
    switch (node.type) {
      case 'document': return node.children.map(serialize).join('');
      case 'text': return encText(node.value);
      case 'comment': return '<!--' + node.value + '-->';
      case 'pi': return '<?' + node.value + '?>';
      case 'cdata': return '<![CDATA[' + node.value + ']]>';
      case 'doctype': return '<!' + node.value + '>';
      case 'element': {
        let s = '<' + node.name + node.attrs.map(a => ' ' + a[0] + '="' + encAttr(a[1]) + '"').join('');
        if (!node.children.length) return s + '/>';
        return s + '>' + node.children.map(serialize).join('') + '</' + node.name + '>';
      }
    }
    return '';
  }

  // ---------- Utilidades de navegación ----------
  const X = {
    parse, serialize, XmlError, el,
    root(doc) { return doc.children.find(c => c.type === 'element'); },
    local(name) { const i = name.indexOf(':'); return i < 0 ? name : name.slice(i + 1); },
    kids(node, name) {
      return (node && node.children || []).filter(c => c.type === 'element' && (!name || X.local(c.name) === name));
    },
    kid(node, name) { return X.kids(node, name)[0] || null; },
    attr(node, name) { const a = node && node.attrs.find(a => a[0] === name); return a ? a[1] : undefined; },
    setAttr(node, name, value) {
      const a = node.attrs.find(a => a[0] === name);
      if (value === undefined || value === null) { node.attrs = node.attrs.filter(a => a[0] !== name); return; }
      if (a) a[1] = String(value); else node.attrs.push([name, String(value)]);
    },
    text(node) {
      return (node && node.children || []).filter(c => c.type === 'text' || c.type === 'cdata').map(c => c.value).join('').trim();
    },
    setText(node, value) {
      node.children = [new XNode('text', { value: String(value), parent: node })];
    },
    // Busca descendientes por nombre local
    find(node, name, pred) {
      const out = [];
      (function walk(n) {
        for (const c of n.children || []) {
          if (c.type !== 'element') continue;
          if (X.local(c.name) === name && (!pred || pred(c))) out.push(c);
          walk(c);
        }
      })(node);
      return out;
    },
    // Subsistema por fragmento de namespace (p. ej. "datasources", "undertow")
    subsystem(doc, ns) {
      return X.find(doc, 'subsystem', s => (X.attr(s, 'xmlns') || '').includes(':' + ns + ':')).shift() || null;
    },
    indentOf(node) {
      // Indentación que precede a un nodo dentro de su padre
      const p = node.parent; if (!p) return '';
      const idx = p.children.indexOf(node);
      const prev = p.children[idx - 1];
      if (prev && prev.type === 'text') { const m = /\n([ \t]*)$/.exec(prev.value); if (m) return m[1]; }
      return '';
    },
    // Inserta un hijo respetando la indentación del documento
    append(parent, child, before) {
      child.parent = parent;
      const pInd = X.indentOf(parent);
      const existing = X.kids(parent);
      const ind = existing.length ? X.indentOf(existing[0]) : pInd + '    ';
      if (!parent.children.length) {
        parent.children.push(new XNode('text', { value: '\n' + ind, parent }), child, new XNode('text', { value: '\n' + pInd, parent }));
        return child;
      }
      let at = before ? parent.children.indexOf(before) : -1;
      if (at < 0) {
        // Antes del texto final (el salto de línea antes de </parent>)
        at = parent.children.length;
        const last = parent.children[at - 1];
        if (last && last.type === 'text' && /\n[ \t]*$/.test(last.value)) {
          const m = /^([\s\S]*?)(\n[ \t]*)$/.exec(last.value);
          last.value = m[1] + '\n' + ind;
          parent.children.push(child, new XNode('text', { value: m[2], parent }));
          return child;
        }
        parent.children.push(new XNode('text', { value: '\n' + ind, parent }), child);
        return child;
      }
      parent.children.splice(at, 0, child, new XNode('text', { value: '\n' + ind, parent }));
      return child;
    },
    remove(node) {
      const p = node.parent; if (!p) return;
      const idx = p.children.indexOf(node);
      const prev = p.children[idx - 1];
      if (prev && prev.type === 'text' && /^\s*$/.test(prev.value)) p.children.splice(idx - 1, 2);
      else p.children.splice(idx, 1);
      node.parent = null;
    },
    // Construye un elemento desde un fragmento de texto
    fragment(xml) { const d = parse(xml); const r = X.root(d); r.parent = null; return r; },
    // Resuelve expresiones ${prop:default}
    expr(value, props) {
      if (value == null) return value;
      return String(value).replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (m, k, def) => {
        const alts = k.split(',');
        for (const a of alts) if (props && props[a.trim()] !== undefined) return props[a.trim()];
        return def !== undefined ? def : m;
      });
    }
  };

  L.xml = X;
})(globalThis.JLab = globalThis.JLab || {});
