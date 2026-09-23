/*
 * Interfaz de escritorio: iconos SVG, gestor de ventanas, barra de tareas,
 * menú de inicio, notificaciones y diálogos modales.
 */
(function (L) {
  'use strict';
  const U = L.util;

  // ---------- Iconos (SVG en línea, sin dependencias externas) ----------
  const ICONS = {
    vms: '<svg viewBox="0 0 48 48"><rect x="4" y="8" width="40" height="26" rx="3" fill="#2d333b" stroke="#ee0000" stroke-width="2"/><rect x="9" y="13" width="14" height="16" rx="1" fill="#ee0000"/><rect x="26" y="13" width="13" height="7" rx="1" fill="#58a6ff"/><rect x="26" y="22" width="13" height="7" rx="1" fill="#3fb950"/><rect x="16" y="36" width="16" height="4" rx="1" fill="#6e7681"/></svg>',
    term: '<svg viewBox="0 0 48 48"><rect x="4" y="7" width="40" height="34" rx="4" fill="#0d1117" stroke="#6e7681" stroke-width="2"/><path d="M11 17l7 6-7 6" stroke="#3fb950" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M21 31h13" stroke="#e8e9ee" stroke-width="3" stroke-linecap="round"/></svg>',
    files: '<svg viewBox="0 0 48 48"><path d="M4 12a3 3 0 013-3h11l4 4h19a3 3 0 013 3v22a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#d29922"/><path d="M4 18h40v20a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#e3b341"/></svg>',
    folder: '<svg viewBox="0 0 48 48"><path d="M4 12a3 3 0 013-3h11l4 4h19a3 3 0 013 3v22a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#d29922"/><path d="M4 18h40v20a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="#e3b341"/></svg>',
    file: '<svg viewBox="0 0 48 48"><path d="M10 4h20l10 10v30H10z" fill="#c9d1d9"/><path d="M30 4v10h10" fill="#8b949e"/><path d="M16 22h16M16 28h16M16 34h10" stroke="#6e7681" stroke-width="2"/></svg>',
    xml: '<svg viewBox="0 0 48 48"><path d="M10 4h20l10 10v30H10z" fill="#c9d1d9"/><path d="M30 4v10h10" fill="#8b949e"/><text x="25" y="35" font-size="11" font-family="monospace" text-anchor="middle" fill="#ee0000" font-weight="bold">&lt;/&gt;</text></svg>',
    archive: '<svg viewBox="0 0 48 48"><path d="M10 4h20l10 10v30H10z" fill="#e3b341"/><path d="M22 6v28" stroke="#6e5a1e" stroke-width="3" stroke-dasharray="3 3"/><rect x="19" y="30" width="8" height="8" rx="1" fill="#6e5a1e"/></svg>',
    exec: '<svg viewBox="0 0 48 48"><path d="M10 4h20l10 10v30H10z" fill="#3fb950"/><path d="M17 22l6 5-6 5" stroke="#fff" stroke-width="2.5" fill="none"/><path d="M25 33h8" stroke="#fff" stroke-width="2.5"/></svg>',
    link: '<svg viewBox="0 0 48 48"><path d="M10 4h20l10 10v30H10z" fill="#58a6ff"/><path d="M18 30l12-12M22 18h8v8" stroke="#fff" stroke-width="3" fill="none"/></svg>',
    editor: '<svg viewBox="0 0 48 48"><rect x="6" y="5" width="30" height="38" rx="3" fill="#c9d1d9"/><path d="M12 14h18M12 20h18M12 26h12" stroke="#6e7681" stroke-width="2"/><path d="M40 16l4 4-16 16-6 2 2-6z" fill="#ee0000"/></svg>',
    console: '<svg viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="36" rx="4" fill="#151515"/><rect x="4" y="6" width="40" height="8" rx="4" fill="#ee0000"/><rect x="9" y="19" width="12" height="18" rx="2" fill="#0066cc"/><rect x="24" y="19" width="15" height="7" rx="2" fill="#3e8635"/><rect x="24" y="29" width="15" height="8" rx="2" fill="#f0ab00"/></svg>',
    browser: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="#1f6feb"/><path d="M5 24h38M24 5c-7 7-7 31 0 38M24 5c7 7 7 31 0 38" stroke="#cfe3ff" stroke-width="2" fill="none"/></svg>',
    monitor: '<svg viewBox="0 0 48 48"><rect x="4" y="6" width="40" height="30" rx="3" fill="#0d1117" stroke="#6e7681" stroke-width="2"/><path d="M8 28l8-9 6 6 8-12 10 10" stroke="#3fb950" stroke-width="3" fill="none"/><rect x="18" y="38" width="12" height="4" fill="#6e7681"/></svg>',
    exercises: '<svg viewBox="0 0 48 48"><rect x="8" y="6" width="32" height="38" rx="3" fill="#e8e9ee"/><rect x="17" y="3" width="14" height="7" rx="2" fill="#6e7681"/><path d="M14 20l4 4 7-8M14 32l4 4 7-8" stroke="#3fb950" stroke-width="3" fill="none"/><path d="M29 22h6M29 34h6" stroke="#6e7681" stroke-width="3"/></svg>',
    linux: '<svg viewBox="0 0 48 48"><ellipse cx="24" cy="28" rx="13" ry="16" fill="#111"/><ellipse cx="24" cy="31" rx="8" ry="11" fill="#fff"/><circle cx="20" cy="17" r="2.5" fill="#fff"/><circle cx="28" cy="17" r="2.5" fill="#fff"/><path d="M21 22l3 3 3-3z" fill="#f0ab00"/><ellipse cx="15" cy="44" rx="6" ry="3" fill="#f0ab00"/><ellipse cx="33" cy="44" rx="6" ry="3" fill="#f0ab00"/></svg>',
    help: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="#8957e5"/><path d="M18 19a6 6 0 1112 0c0 4-6 5-6 9" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="24" cy="35" r="2.5" fill="#fff"/></svg>',
    jboss: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#ee0000"/><text x="24" y="30" font-size="16" font-family="sans-serif" text-anchor="middle" fill="#fff" font-weight="bold">JB</text></svg>'
  };
  const icon = (name, cls) => '<span class="ico ' + (cls || '') + '">' + (ICONS[name] || ICONS.file) + '</span>';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const h = (tag, attrs, html) => {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null) e.setAttribute(k, v); }
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = U.escapeHtml;

  // ---------- Notificaciones ----------
  function toast(msg, kind, ms) {
    const box = $('#toasts');
    if (!box) return;
    const t = h('div', { class: 'toast ' + (kind || '') }, esc(msg));
    box.appendChild(t);
    setTimeout(() => t.remove(), ms || 4500);
  }

  // ---------- Modal dentro de una ventana ----------
  function modal(container, title, bodyHtml, buttons) {
    return new Promise((resolve) => {
      const bg = h('div', { class: 'modal-bg' });
      const m = h('div', { class: 'modal' });
      m.innerHTML = '<h3>' + esc(title) + '</h3><div class="mb">' + bodyHtml + '</div><div class="mf"></div>';
      const mf = m.querySelector('.mf');
      for (const b of buttons || [{ label: 'Aceptar', value: true, cls: 'primary' }]) {
        const btn = h('button', { class: 'btn ' + (b.cls || '') }, esc(b.label));
        btn.onclick = async () => {
          if (b.validate) { const ok = await b.validate(m); if (!ok) return; }
          bg.remove(); resolve({ value: b.value, el: m });
        };
        mf.appendChild(btn);
      }
      bg.appendChild(m);
      bg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { bg.remove(); resolve({ value: null, el: m }); } });
      container.appendChild(bg);
      const f = m.querySelector('input,select,textarea');
      if (f) setTimeout(() => f.focus(), 30);
    });
  }
  async function confirmBox(container, title, text, okLabel, danger) {
    const r = await modal(container, title, '<div>' + text + '</div>', [{ label: 'Cancelar', value: false }, { label: okLabel || 'Confirmar', value: true, cls: danger ? 'danger' : 'primary' }]);
    return r.value === true;
  }

  // ---------- Gestor de ventanas ----------
  class WM {
    constructor() {
      this.wins = [];
      this.z = 10;
      this.area = $('#desktop');
    }
    create(o) {
      const area = this.area;
      const W = area.clientWidth, H = area.clientHeight;
      const w = Math.min(o.width || 820, W - 20), hgt = Math.min(o.height || 540, H - 20);
      const n = this.wins.length;
      const x = Math.max(4, Math.min(W - w - 4, (o.x != null ? o.x : 120 + (n % 6) * 28)));
      const y = Math.max(4, Math.min(H - hgt - 4, (o.y != null ? o.y : 30 + (n % 6) * 26)));
      const el = h('div', { class: 'win', style: 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + hgt + 'px' });
      el.innerHTML = '<div class="titlebar">' + icon(o.icon) + '<div class="title"></div>' +
        '<button class="wbtn min" title="Minimizar">&#8212;</button><button class="wbtn maxb" title="Maximizar">&#9633;</button><button class="wbtn close" title="Cerrar">&#10005;</button></div>' +
        '<div class="wbody"></div><div class="resize"></div>';
      area.appendChild(el);
      const win = { el, body: el.querySelector('.wbody'), app: o.app, onClose: o.onClose, onResize: o.onResize, onFocus: o.onFocus, closed: false };
      win.setTitle = (t) => { win.title = t; el.querySelector('.title').textContent = t; if (win.task) win.task.querySelector('.tlabel').textContent = t; };
      win.close = () => { if (win.closed) return; if (win.onClose && win.onClose() === false) return; win.closed = true; el.remove(); win.task.remove(); this.wins = this.wins.filter(x => x !== win); this.focusTop(); };
      win.focus = () => this.focus(win);
      win.setTitle(o.title || '');
      // tarea
      win.task = h('div', { class: 'task', title: o.title || '' }, icon(o.icon) + '<span class="tlabel"></span>');
      win.task.querySelector('.tlabel').textContent = o.title || '';
      win.task.onclick = () => {
        if (el.classList.contains('hidden')) { el.classList.remove('hidden'); win.task.classList.remove('min'); this.focus(win); }
        else if (el.classList.contains('focused')) { el.classList.add('hidden'); win.task.classList.add('min'); this.focusTop(); }
        else this.focus(win);
      };
      $('#tasks').appendChild(win.task);
      // botones
      el.querySelector('.close').onclick = (e) => { e.stopPropagation(); win.close(); };
      el.querySelector('.min').onclick = (e) => { e.stopPropagation(); el.classList.add('hidden'); win.task.classList.add('min'); this.focusTop(); };
      const toggleMax = () => { el.classList.toggle('max'); setTimeout(() => win.onResize && win.onResize(), 30); };
      el.querySelector('.maxb').onclick = (e) => { e.stopPropagation(); toggleMax(); };
      el.addEventListener('mousedown', () => this.focus(win), true);
      el.addEventListener('touchstart', () => this.focus(win), { passive: true, capture: true });
      // arrastrar
      const tb = el.querySelector('.titlebar');
      tb.addEventListener('dblclick', (e) => { if (!e.target.closest('.wbtn')) toggleMax(); });
      const drag = (startEv, onMove) => {
        const pt = (ev) => ev.touches ? ev.touches[0] : ev;
        const s = pt(startEv);
        const sx = s.clientX, sy = s.clientY, ox = el.offsetLeft, oy = el.offsetTop, ow = el.offsetWidth, oh = el.offsetHeight;
        const mm = (ev) => { const p = pt(ev); onMove(p.clientX - sx, p.clientY - sy, ox, oy, ow, oh); if (ev.cancelable) ev.preventDefault(); };
        const up = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', up); document.removeEventListener('touchmove', mm); document.removeEventListener('touchend', up); document.body.style.userSelect = ''; if (win.onResize) win.onResize(); };
        document.addEventListener('mousemove', mm); document.addEventListener('mouseup', up);
        document.addEventListener('touchmove', mm, { passive: false }); document.addEventListener('touchend', up);
        document.body.style.userSelect = 'none';
      };
      const startMove = (e) => {
        if (e.target.closest('.wbtn') || el.classList.contains('max') || window.innerWidth <= 760) return;
        drag(e, (dx, dy, ox, oy) => { el.style.left = Math.max(-el.offsetWidth + 80, Math.min(area.clientWidth - 60, ox + dx)) + 'px'; el.style.top = Math.max(0, Math.min(area.clientHeight - 36, oy + dy)) + 'px'; });
      };
      tb.addEventListener('mousedown', startMove);
      tb.addEventListener('touchstart', startMove, { passive: true });
      el.querySelector('.resize').addEventListener('mousedown', (e) => {
        e.stopPropagation();
        drag(e, (dx, dy, ox, oy, ow, oh) => { el.style.width = Math.max(320, ow + dx) + 'px'; el.style.height = Math.max(180, oh + dy) + 'px'; if (win.onResize) win.onResize(); });
      });
      if (o.maximized || window.innerWidth <= 760) el.classList.add('max');
      this.wins.push(win);
      this.focus(win);
      return win;
    }
    focus(win) {
      if (win.closed) return;
      for (const w of this.wins) { w.el.classList.remove('focused'); w.task.classList.remove('active'); }
      win.el.style.zIndex = ++this.z;
      win.el.classList.add('focused'); win.task.classList.add('active');
      win.el.classList.remove('hidden'); win.task.classList.remove('min');
      if (win.onFocus) win.onFocus();
    }
    focusTop() {
      const vis = this.wins.filter(w => !w.el.classList.contains('hidden')).sort((a, b) => (+b.el.style.zIndex) - (+a.el.style.zIndex));
      if (vis[0]) this.focus(vis[0]);
    }
  }

  L.ui = { ICONS, icon, $, h, esc, toast, modal, confirmBox, WM, apps: {} };
})(globalThis.JLab = globalThis.JLab || {});
