/*
 * Interfaz de los ejercicios guiados (catálogo en js/exercises/catalog.js).
 */
(function (L) {
  'use strict';
  const { h, esc, toast, confirmBox } = L.ui;

  const EX = L.exercises;


  L.ui.apps.exercises = {
    title: 'Ejercicios', icon: 'exercises',
    open(desk) {
      const lab = desk.lab;
      const win = desk.wm.create({ title: 'Ejercicios guiados', icon: 'exercises', width: 1000, height: 640 });
      win.body.innerHTML = '<div class="ex"><div class="exlist"></div><div class="exdetail"></div></div>';
      const list = win.body.querySelector('.exlist'), det = win.body.querySelector('.exdetail');
      let cur = EX[0];
      const lvl = { b: ['b', 'Básico'], i: ['i', 'Intermedio'], a: ['a', 'Avanzado'] };
      const drawList = () => {
        const done = EX.filter(e => lab.progress[e.id]).length;
        list.innerHTML = '<div class="pad small"><b>Progreso:</b> ' + done + ' / ' + EX.length + '<div class="bar" style="margin-top:6px"><i style="width:' + (done / EX.length * 100) + '%"></i></div></div>';
        EX.forEach((e, i) => {
          const it = h('div', { class: 'exitem' + (e === cur ? ' on' : '') }, '<div class="st ' + (lab.progress[e.id] ? 'done' : '') + '">' + (lab.progress[e.id] ? '✓' : i + 1) + '</div><div><div>' + esc(e.title) + '</div><div class="small muted">' + esc(e.cat) + ' · <span class="lvl ' + lvl[e.level][0] + '">' + lvl[e.level][1] + '</span></div></div>');
          it.onclick = () => { cur = e; drawList(); drawDetail(); };
          list.appendChild(it);
        });
      };
      const drawDetail = () => {
        const e = cur;
        const vms = Array.from(lab.vms.values());
        det.innerHTML = '<h2>' + esc(e.title) + '</h2><div class="row small"><span class="lvl ' + lvl[e.level][0] + '">' + lvl[e.level][1] + '</span><span class="muted">' + esc(e.cat) + '</span>' + (lab.progress[e.id] ? '<span class="pill run">Completado en ' + esc(lab.progress[e.id].vm || '') + '</span>' : '') + '</div>' +
          '<div class="card" style="margin:14px 0"><b>Objetivo</b><p>' + e.goal + '</p></div>' +
          '<div class="row"><label class="row small">VM a verificar: <select class="vmsel">' + vms.map(v => '<option value="' + v.id + '">' + esc(v.name) + ' (' + v.state + ')</option>').join('') + '</select></label><button class="btn primary verify">Verificar</button><button class="btn hint">Mostrar pista</button><button class="btn sol">Ver solución</button><button class="btn term">Abrir terminal</button></div>' +
          '<div class="results" style="margin-top:14px"></div><div class="hints"></div><div class="solbox"></div>';
        let hintN = 0;
        det.querySelector('.hint').onclick = () => {
          if (hintN >= e.hints.length) { toast('No hay más pistas', 'warn'); return; }
          det.querySelector('.hints').insertAdjacentHTML('beforeend', '<div class="notice info" style="margin-top:8px">💡 ' + e.hints[hintN++] + '</div>');
        };
        det.querySelector('.sol').onclick = async () => {
          if (!await confirmBox(win.body, 'Ver solución', 'Intenta resolverlo primero con las pistas: se aprende más. ¿Mostrar la solución de todos modos?', 'Mostrar')) return;
          det.querySelector('.solbox').innerHTML = '<div style="margin-top:12px"><b>Solución de referencia</b><pre class="code">' + esc(e.solution) + '</pre></div>';
        };
        det.querySelector('.term').onclick = () => { const v = lab.vms.get(det.querySelector('.vmsel').value); if (v) desk.open('terminal', { vmId: v.id }); };
        det.querySelector('.verify').onclick = async () => {
          const vm = lab.vms.get(det.querySelector('.vmsel').value);
          const box = det.querySelector('.results');
          if (!vm) { box.innerHTML = '<div class="notice warn">Crea una VM primero.</div>'; return; }
          const res = e.checks.map(([d, fn]) => { let ok = false; try { ok = !!fn(vm); } catch (x) { ok = false; } return [d, ok]; });
          const all = res.every(r => r[1]);
          box.innerHTML = res.map(([d, ok]) => '<div class="check">' + (ok ? '<span style="color:var(--ok)">✔</span>' : '<span style="color:var(--err)">✘</span>') + ' ' + esc(d) + '</div>').join('') + (all ? '<div class="notice ok" style="margin-top:10px">¡Ejercicio completado! 🎉</div>' : '<div class="notice warn" style="margin-top:10px">Aún faltan requisitos. Revisa los marcados con ✘.</div>');
          if (all && !lab.progress[e.id]) { lab.progress[e.id] = { vm: vm.name, at: Date.now() }; await lab.saveMeta(); toast('Ejercicio completado: ' + e.title, 'ok'); drawList(); }
        };
      };
      drawList(); drawDetail();
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
