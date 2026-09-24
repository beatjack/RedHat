/*
 * Guía del laboratorio: arquitectura, primeros pasos y referencia rápida.
 */
(function (L) {
  'use strict';
  const DIAGRAM = `
<svg viewBox="0 0 860 430" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="13">
  <rect x="10" y="10" width="840" height="410" rx="12" fill="#1b1d23" stroke="#3d4250"/>
  <text x="30" y="38" fill="#e8e9ee" font-weight="bold" font-size="15">Tu navegador (100% local, sin nube)</text>
  <rect x="30" y="54" width="800" height="56" rx="8" fill="#23262e" stroke="#3d4250"/>
  <text x="46" y="78" fill="#e8e9ee" font-weight="bold">Escritorio</text>
  <text x="46" y="98" fill="#9aa0ad">Gestor de VMs · Terminal (xterm.js) · Archivos · Editor · Consola JBoss · Navegador · Monitor · Ejercicios</text>
  <rect x="30" y="126" width="520" height="280" rx="8" fill="#23262e" stroke="#ee0000"/>
  <text x="46" y="150" fill="#ff4d4d" font-weight="bold">Motor simulado (JavaScript)</text>
  <g>
    <rect x="46" y="164" width="150" height="104" rx="6" fill="#2c3039" stroke="#3d4250"/>
    <text x="58" y="186" fill="#e8e9ee" font-weight="bold">VM jboss01</text>
    <text x="58" y="206" fill="#9aa0ad">10.0.0.11</text>
    <text x="58" y="224" fill="#9aa0ad">shell bash · VFS</text>
    <text x="58" y="242" fill="#9aa0ad">systemd · firewalld</text>
    <text x="58" y="260" fill="#58a6ff">JBoss :8080 :9990</text>
    <rect x="212" y="164" width="150" height="104" rx="6" fill="#2c3039" stroke="#3d4250"/>
    <text x="224" y="186" fill="#e8e9ee" font-weight="bold">VM jboss02</text>
    <text x="224" y="206" fill="#9aa0ad">10.0.0.12</text>
    <text x="224" y="224" fill="#9aa0ad">shell bash · VFS</text>
    <text x="224" y="242" fill="#9aa0ad">systemd · firewalld</text>
    <text x="224" y="260" fill="#58a6ff">WildFly :8080</text>
    <rect x="378" y="164" width="156" height="104" rx="6" fill="#2c3039" stroke="#3d4250" stroke-dasharray="4 3"/>
    <text x="392" y="210" fill="#9aa0ad">… más VMs</text>
    <text x="392" y="228" fill="#9aa0ad">(límite: host)</text>
  </g>
  <line x1="46" y1="290" x2="534" y2="290" stroke="#3fb950" stroke-width="3"/>
  <text x="46" y="310" fill="#3fb950">Red virtual 10.0.0.0/24 (ping, ssh, scp, curl entre VMs)</text>
  <rect x="46" y="324" width="488" height="66" rx="6" fill="#15171c" stroke="#3d4250"/>
  <text x="58" y="346" fill="#e8e9ee">Persistencia: IndexedDB del navegador (discos de las VMs, snapshots)</text>
  <text x="58" y="366" fill="#9aa0ad">Exportar/Importar VM como .json · Host simulado: CPU / RAM / Disco</text>
  <text x="58" y="382" fill="#9aa0ad">asignados sin sobreasignar RAM al encender</text>
  <rect x="566" y="126" width="264" height="280" rx="8" fill="#23262e" stroke="#58a6ff"/>
  <text x="582" y="150" fill="#58a6ff" font-weight="bold">Linux real (v86 · WebAssembly)</text>
  <text x="582" y="176" fill="#9aa0ad">Emulador x86 de 32 bits</text>
  <text x="582" y="196" fill="#9aa0ad">Kernel Linux verdadero</text>
  <text x="582" y="216" fill="#9aa0ad">desde una ISO de tu equipo</text>
  <text x="582" y="246" fill="#e8e9ee">✔ comandos Linux reales</text>
  <text x="582" y="266" fill="#e8e9ee">✘ JBoss (demasiado pesado)</text>
  <text x="582" y="300" fill="#9aa0ad">Mismo principio que</text>
  <text x="582" y="318" fill="#9aa0ad">bellard.org/jslinux</text>
</svg>`;

  L.ui.apps.help = {
    title: 'Guía', icon: 'help',
    open(desk) {
      const win = desk.wm.create({ title: 'Guía del laboratorio', icon: 'help', width: 960, height: 660 });
      win.body.innerHTML = '<div class="doc">' +
        '<h1>JBoss Virtual Lab</h1><p>Laboratorio local para practicar administración de <b>Linux</b> y <b>JBoss EAP / WildFly</b> desde el navegador. Todo corre en tu equipo; no se usa ningún servicio en la nube.</p>' +
        '<h2>Cómo está construido</h2>' + DIAGRAM +
        '<p>Hay dos motores:</p><ul><li><b>Motor simulado</b> (predeterminado): cada VM tiene su propio sistema de archivos con permisos, usuarios, procesos, puertos, systemd, firewalld y un JBoss simulado que lee y escribe <code>standalone.xml</code>, genera <code>server.log</code> con los códigos reales (WFLYSRV0025, WFLYCTL0412…), respeta <code>standalone.conf</code>, el deployment-scanner y la CLI.</li><li><b>Linux real</b> (v86): emulación de hardware para practicar comandos con un kernel verdadero.</li></ul>' +
        '<h2>Primeros pasos (10 minutos)</h2><ol>' +
        '<li>Abre el <b>Gestor de VMs</b> → <b>+ Nueva VM</b>. Para practicar todo, elige "Solo instaladores".</li>' +
        '<li>Pulsa <b>▶ Encender</b>: se abre la terminal con el arranque. Inicia sesión con las credenciales que se muestran.</li>' +
        '<li>Ejecuta <code>help</code> para ver los comandos y <code>man &lt;comando&gt;</code> para la ayuda en español.</li>' +
        '<li>Sigue los <b>Ejercicios</b> en orden: usuario jboss → Java → instalar JBoss → arrancar → desplegar → CLI → firewall → systemd.</li>' +
        '<li>Abre el <b>Navegador</b> y visita <code>http://&lt;IP-de-la-VM&gt;:8080/hello/</code> para ver tu app (recuerda <code>-b 0.0.0.0</code> y el firewall).</li></ol>' +
        '<h2>Ejemplo aplicado: de cero a una app desplegada</h2><pre class="code">sudo dnf install -y java-17-openjdk unzip          # dependencias\nsudo groupadd -r jboss && sudo useradd -r -g jboss -d /opt/jboss -s /bin/bash jboss\nsudo unzip -q /opt/installers/jboss-eap-7.4.0.zip -d /opt\nsudo ln -s /opt/jboss-eap-7.4 /opt/jboss && sudo chown -R jboss:jboss /opt/jboss-eap-7.4\nfree -m                                            # ¿cabe el heap por defecto (1303m)?\nsudo sed -i "s/-Xms1303m -Xmx1303m/-Xms512m -Xmx1024m/" /opt/jboss/bin/standalone.conf\nsudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0 &gt; /dev/null 2&gt;&amp;1 &amp;\ntail -f /opt/jboss/standalone/log/server.log        # espera WFLYSRV0025 y Ctrl+C\nsudo -u jboss cp /opt/installers/apps/hello.war /opt/jboss/standalone/deployments/\ncurl http://localhost:8080/hello/\nsudo firewall-cmd --permanent --add-port={8080,9990}/tcp   # (o dos --add-port)\nsudo firewall-cmd --reload</pre>' +
        '<h2>Atajos</h2><ul><li>Terminal: <kbd>Tab</kbd> autocompleta · <kbd>↑</kbd>/<kbd>↓</kbd> historial · <kbd>Ctrl</kbd>+<kbd>C</kbd> interrumpe · <kbd>Ctrl</kbd>+<kbd>L</kbd> limpia · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copiar/pegar</li><li>vi: <kbd>i</kbd> insertar · <kbd>Esc</kbd> · <code>:wq</code> · <code>:q!</code> · <code>dd</code> · <code>/buscar</code></li><li>Ventanas: doble clic en la barra de título para maximizar.</li></ul>' +
        '<h2>Administración de recursos</h2><ul><li>El host simulado tiene CPU, RAM y disco configurables (Gestor → Recursos del host).</li><li>Una VM no enciende si no hay RAM libre en el host (sin sobreasignación). vCPU admite sobreasignación 4:1.</li><li>El disco de cada VM tiene cuota real: si se llena verás <code>No space left on device</code>.</li><li>La memoria de JBoss depende de <code>-Xms/-Xmx</code>: si no cabe en la VM, el arranque falla como en la vida real.</li><li>Snapshots, clonado y exportación te permiten experimentar sin miedo.</li></ul>' +
        '<h2>Fidelidad de la simulación</h2><p>Estructura de directorios, scripts, mensajes y comportamiento se basan en la documentación y el código fuente de WildFly/EAP. Valores verificados: WildFly 30.0.1.Final usa WildFly Core 22.0.2.Final y <code>-Xms64m -Xmx512m</code> por defecto. Los números de versión de los esquemas XML y algunos detalles de EAP son representativos. Consulta <code>docs/FIDELIDAD.md</code> en el repositorio.</p>' +
        '<h2>Datos y privacidad</h2><p>Los discos virtuales se guardan en el almacenamiento del navegador (IndexedDB) de este equipo. Borrar los datos del sitio elimina las VMs: usa <b>Exportar</b> para respaldos.</p>' +
        '</div>';
      return win;
    }
  };
})(globalThis.JLab = globalThis.JLab || {});
