/*
 * Arranque del escritorio: inicializa el laboratorio, iconos, menú de inicio,
 * barra de tareas y restaura las VMs que estaban encendidas.
 */
(function (L) {
  'use strict';
  const { $, h, esc, icon, toast } = L.ui;

  const LAUNCHERS = [
    ['vmmanager', 'Gestor de VMs', 'Crear, encender y administrar máquinas'],
    ['terminal', 'Terminal', 'Consola de la VM (bash)'],
    ['files', 'Archivos', 'Explorador del disco de la VM'],
    ['editor', 'Editor', 'Editor de texto con validación XML'],
    ['console', 'Consola JBoss', 'Administración web (estilo HAL)'],
    ['browser', 'Navegador', 'Ver aplicaciones desplegadas'],
    ['monitor', 'Monitor', 'CPU, memoria, disco y procesos'],
    ['exercises', 'Ejercicios', 'Retos guiados con verificación'],
    ['realvm', 'Linux real (v86)', 'Emulador x86 con kernel real'],
    ['help', 'Guía', 'Cómo usar el laboratorio']
  ];

  async function start() {
    const lab = new L.Lab();
    const desk = { lab, wm: new L.ui.WM() };
    desk.open = (app, o) => {
      const a = L.ui.apps[app];
      if (!a) return toast('Aplicación no disponible: ' + app, 'err');
      try { return a.open(desk, o); } catch (e) { console.error(e); toast('Error al abrir ' + a.title + ': ' + e.message, 'err'); }
    };
    const origFocus = desk.wm.focus.bind(desk.wm);
    desk.wm.focus = (w) => { origFocus(w); if (desk.onFocusChange) desk.onFocusChange(w); };
    window.JLabDesk = desk;

    // iconos del escritorio
    const icons = $('#icons');
    for (const [id, name] of LAUNCHERS) {
      const d = h('div', { class: 'dicon', tabindex: '0' }, icon(L.ui.apps[id].icon) + '<div>' + esc(name) + '</div>');
      d.onclick = () => { icons.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); if (window.innerWidth <= 760) desk.open(id); };
      d.ondblclick = () => desk.open(id);
      d.onkeydown = (e) => { if (e.key === 'Enter') desk.open(id); };
      icons.appendChild(d);
    }
    // menú de inicio
    const menu = $('#startmenu');
    menu.innerHTML = '<h4>Aplicaciones</h4>';
    for (const [id, name, desc] of LAUNCHERS) {
      const m = h('div', { class: 'mitem' }, icon(L.ui.apps[id].icon) + '<div>' + esc(name) + '<small>' + esc(desc) + '</small></div>');
      m.onclick = () => { menu.classList.remove('open'); desk.open(id); };
      menu.appendChild(m);
    }
    $('#startbtn').onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('open'); });

    // reloj y medidores del host
    const tick = () => {
      const d = new Date();
      $('#clock').textContent = L.util.two(d.getHours()) + ':' + L.util.two(d.getMinutes());
      const a = lab.allocated();
      $('#hostram').style.width = Math.min(100, a.runRam / lab.host.ramMB * 100) + '%';
      $('#hostcpu').style.width = Math.min(100, a.runCpu / lab.host.cpu * 100) + '%';
      $('#vmcount').textContent = Array.from(lab.vms.values()).filter(v => v.state === 'running').length + '/' + lab.vms.size + ' VMs';
    };

    try { await lab.init(); }
    catch (e) { console.error(e); toast('No se pudo abrir el almacenamiento: ' + e.message + '. Los cambios no se guardarán.', 'err', 10000); }
    lab.on('error', (m) => toast(m, 'err', 8000));
    if (lab.store.kind === 'memory') toast('El navegador no permite almacenamiento local en este modo: las VMs no se guardarán al cerrar. Use "Exportar" o sirva la página con un servidor local.', 'warn', 12000);
    tick(); setInterval(tick, 2000);

    // restaura VMs que estaban encendidas (equivale a reiniciar el host)
    for (const vm of lab.vms.values()) {
      if (vm.wasRunning && lab.canStart(vm).ok) vm.boot(null).then(() => vm.restoreServers());
    }
    window.addEventListener('beforeunload', () => { for (const vm of lab.vms.values()) lab.saveNow(vm); });

    if (!lab.vms.size) { desk.open('help'); desk.open('vmmanager'); }
    else desk.open('vmmanager');
  }

  L.ui.start = start;
})(globalThis.JLab = globalThis.JLab || {});
