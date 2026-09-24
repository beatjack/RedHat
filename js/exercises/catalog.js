/*
 * Catálogo de ejercicios guiados y verificaciones automáticas sobre el
 * estado de la VM (independiente de la interfaz: también lo usan las pruebas).
 */
(function (L) {
  'use strict';
  const X = L.xml, OS = L.os;

  // ---------- utilidades de verificación ----------
  const Q = {
    exists: (vm, p) => vm.fs.exists(p),
    dir: (vm, p) => vm.fs.isDir(p),
    read: (vm, p) => { try { return vm.fs.read(p); } catch (e) { return ''; } },
    node: (vm, p, nofollow) => { const r = vm.fs.tryLookup(p, { follow: !nofollow }); return r ? r.node : null; },
    owner: (vm, p) => { const n = Q.node(vm, p); return n ? OS.users.userName(vm.fs, n.u) : null; },
    user: (vm, u) => OS.users.byName(vm.fs, u),
    group: (vm, g) => OS.users.groups(vm.fs).find(x => x.name === g),
    pkg: (vm, n) => !!OS.installedList(vm.fs)[n],
    java: (vm) => OS.detectJava(vm.fs),
    homes: (vm) => { try { return vm.fs.readdir('/opt').map(d => '/opt/' + d).filter(d => vm.fs.isFile(d + '/version.txt') && vm.fs.isFile(d + '/bin/standalone.sh')); } catch (e) { return []; } },
    home: (vm) => Q.homes(vm)[0] || null,
    servers: (vm) => vm.servers.filter(s => s.state === 'running'),
    server: (vm) => Q.servers(vm)[0] || null,
    conf: (vm) => { const hm = Q.home(vm); return hm ? Q.read(vm, hm + '/bin/standalone.conf') : ''; },
    xml: (vm) => { const hm = Q.home(vm); try { return X.parse(Q.read(vm, hm + '/standalone/configuration/standalone.xml')); } catch (e) { return null; } },
    home1: (vm) => (OS.users.passwd(vm.fs).find(u => u.uid === 1000) || { home: '/home/admin' }).home,
    user1: (vm) => (OS.users.passwd(vm.fs).find(u => u.uid === 1000) || { name: 'admin' }).name
  };

  const EX = [
    {
      id: 'fs-basico', level: 'b', cat: 'Linux', title: 'Archivos y directorios',
      goal: 'Como tu usuario administrador, crea en tu home la carpeta <code>practica/logs</code> y dentro de <code>practica</code> un archivo <code>README.txt</code> que contenga la palabra <b>laboratorio</b>.',
      hints: ['<code>mkdir -p</code> crea directorios anidados.', 'Puedes escribir con <code>echo "texto" &gt; archivo</code>.', 'Verifica con <code>ls -R ~/practica</code> y <code>cat</code>.'],
      solution: 'cd ~\nmkdir -p practica/logs\necho "Este es mi laboratorio" > practica/README.txt\nls -R practica',
      checks: [
        ['Existe ~/practica/logs', (vm) => Q.dir(vm, Q.home1(vm) + '/practica/logs')],
        ['README.txt contiene "laboratorio"', (vm) => /laboratorio/i.test(Q.read(vm, Q.home1(vm) + '/practica/README.txt'))],
        ['El dueño es tu usuario', (vm) => Q.owner(vm, Q.home1(vm) + '/practica') === Q.user1(vm)]
      ]
    },
    {
      id: 'permisos', level: 'b', cat: 'Linux', title: 'Permisos y propietarios',
      goal: 'Crea el directorio <code>/srv/compartido</code> con permisos <b>770</b>, propietario <b>root</b> y grupo <b>wheel</b>. Dentro crea <code>config.properties</code> con permisos <b>640</b>.',
      hints: ['Necesitas privilegios: <code>sudo</code>.', '<code>chmod 770</code>, <code>chown root:wheel</code>.', 'Comprueba con <code>ls -ld /srv/compartido</code>.'],
      solution: 'sudo mkdir /srv/compartido\nsudo chown root:wheel /srv/compartido\nsudo chmod 770 /srv/compartido\nsudo touch /srv/compartido/config.properties\nsudo chmod 640 /srv/compartido/config.properties\nls -l /srv/compartido',
      checks: [
        ['/srv/compartido existe con modo 770', (vm) => { const n = Q.node(vm, '/srv/compartido'); return n && n.t === 'd' && (n.m & 0o777) === 0o770; }],
        ['Grupo wheel', (vm) => { const n = Q.node(vm, '/srv/compartido'); return n && OS.users.groupName(vm.fs, n.g) === 'wheel'; }],
        ['config.properties con modo 640', (vm) => { const n = Q.node(vm, '/srv/compartido/config.properties'); return n && (n.m & 0o777) === 0o640; }]
      ]
    },
    {
      id: 'usuario-jboss', level: 'b', cat: 'Linux', title: 'Usuario de servicio jboss',
      goal: 'Crea el grupo <b>jboss</b> y el usuario de sistema <b>jboss</b> (grupo primario jboss, shell <code>/bin/bash</code>, home <code>/opt/jboss</code>). Es buena práctica que JBoss <u>no</u> corra como root.',
      hints: ['<code>groupadd</code> y <code>useradd -r -g jboss -d /opt/jboss -s /bin/bash jboss</code>.', 'Verifica con <code>id jboss</code> y <code>grep jboss /etc/passwd</code>.'],
      solution: 'sudo groupadd -r jboss\nsudo useradd -r -g jboss -d /opt/jboss -s /bin/bash jboss\nid jboss',
      checks: [
        ['Existe el grupo jboss', (vm) => !!Q.group(vm, 'jboss')],
        ['Existe el usuario jboss', (vm) => !!Q.user(vm, 'jboss')],
        ['Grupo primario jboss', (vm) => { const u = Q.user(vm, 'jboss'), g = Q.group(vm, 'jboss'); return u && g && u.gid === g.gid; }]
      ]
    },
    {
      id: 'java', level: 'b', cat: 'Paquetes', title: 'Instalar Java y unzip',
      goal: 'Instala <b>OpenJDK 17</b> y la herramienta <b>unzip</b>. Luego confirma con <code>java -version</code> que la versión activa es la 17.',
      hints: ['<code>sudo dnf install -y java-17-openjdk unzip</code>', 'Si hay varias versiones: <code>sudo alternatives --config java</code>.'],
      solution: 'sudo dnf install -y java-17-openjdk unzip\njava -version',
      checks: [
        ['Paquete java-17-openjdk instalado', (vm) => Q.pkg(vm, 'java-17-openjdk')],
        ['Paquete unzip instalado', (vm) => Q.pkg(vm, 'unzip')],
        ['Java 17 es el predeterminado', (vm) => { const j = Q.java(vm); return !!j && j.major === 17; }]
      ]
    },
    {
      id: 'instalar-jboss', level: 'i', cat: 'JBoss', title: 'Instalar JBoss desde el ZIP',
      goal: 'Descomprime el instalador de <code>/opt/installers</code> en <code>/opt</code> y haz que toda la instalación pertenezca a <b>jboss:jboss</b>.',
      hints: ['<code>ls /opt/installers</code> para ver el ZIP disponible.', '<code>sudo unzip -q /opt/installers/&lt;archivo&gt;.zip -d /opt</code>', '<code>sudo chown -R jboss:jboss /opt/jboss-eap-7.4</code> (ajusta la versión).'],
      solution: 'ls /opt/installers\nsudo unzip -q /opt/installers/jboss-eap-7.4.0.zip -d /opt\nsudo chown -R jboss:jboss /opt/jboss-eap-7.4\nls -l /opt',
      checks: [
        ['Hay una instalación de JBoss en /opt', (vm) => !!Q.home(vm)],
        ['El directorio es de jboss', (vm) => { const hm = Q.home(vm); return !!hm && Q.owner(vm, hm) === 'jboss'; }],
        ['standalone/configuration es de jboss', (vm) => { const hm = Q.home(vm); return !!hm && Q.owner(vm, hm + '/standalone/configuration') === 'jboss'; }]
      ]
    },
    {
      id: 'jboss-home', level: 'i', cat: 'JBoss', title: 'Enlace /opt/jboss y JBOSS_HOME',
      goal: 'Crea el enlace simbólico <code>/opt/jboss</code> apuntando a tu instalación y define <code>JBOSS_HOME=/opt/jboss</code> para todos los usuarios en <code>/etc/profile.d/jboss.sh</code>.',
      hints: ['<code>sudo ln -s /opt/jboss-eap-7.4 /opt/jboss</code>', '<code>echo \'export JBOSS_HOME=/opt/jboss\' | sudo tee /etc/profile.d/jboss.sh</code>', 'Abre una nueva sesión o ejecuta <code>source /etc/profile.d/jboss.sh</code>.'],
      solution: 'sudo ln -s /opt/jboss-eap-7.4 /opt/jboss\necho \'export JBOSS_HOME=/opt/jboss\' | sudo tee /etc/profile.d/jboss.sh\nsource /etc/profile.d/jboss.sh && echo $JBOSS_HOME',
      checks: [
        ['/opt/jboss es un enlace simbólico', (vm) => { const n = Q.node(vm, '/opt/jboss', true); return !!n && n.t === 'l'; }],
        ['El enlace lleva a una instalación válida', (vm) => Q.exists(vm, '/opt/jboss/bin/standalone.sh')],
        ['/etc/profile.d/jboss.sh exporta JBOSS_HOME', (vm) => /export\s+JBOSS_HOME=\/opt\/jboss\/?\s*$/m.test(Q.read(vm, '/etc/profile.d/jboss.sh'))]
      ]
    },
    {
      id: 'heap', level: 'i', cat: 'JBoss', title: 'Ajustar la memoria (heap) de la JVM',
      goal: 'Edita <code>$JBOSS_HOME/bin/standalone.conf</code> para que el heap sea <b>-Xms512m -Xmx1024m</b>. Tip: en EAP el valor por defecto (1303m) puede no caber en una VM pequeña.',
      hints: ['Busca la línea con <code>grep -n Xms standalone.conf</code>.', 'Edita con <code>vi</code> o usa <code>sed -i</code>.', 'Comprueba el tamaño de RAM de tu VM con <code>free -m</code>.'],
      solution: 'cd $JBOSS_HOME/bin\nsudo cp standalone.conf standalone.conf.bak\nsudo sed -i \'s/-Xms[0-9]*m -Xmx[0-9]*m/-Xms512m -Xmx1024m/\' standalone.conf\ngrep -n Xms standalone.conf',
      checks: [
        ['JBOSS_JAVA_SIZING con -Xms512m', (vm) => /^\s*JBOSS_JAVA_SIZING="[^"]*-Xms512m/m.test(Q.conf(vm)) || /^\s*JAVA_OPTS="[^"]*-Xms512m/m.test(Q.conf(vm))],
        ['y -Xmx1024m', (vm) => /^\s*(JBOSS_JAVA_SIZING|JAVA_OPTS)="[^"]*-Xmx1024m/m.test(Q.conf(vm))]
      ]
    },
    {
      id: 'arrancar', level: 'i', cat: 'JBoss', title: 'Arrancar JBoss como jboss y en todas las interfaces',
      goal: 'Inicia JBoss en segundo plano como usuario <b>jboss</b>, escuchando HTTP en <b>0.0.0.0</b> y la gestión en <b>0.0.0.0</b>. Comprueba con <code>ss -tlnp</code> y <code>curl</code>.',
      hints: ['<code>sudo -u jboss nohup $JBOSS_HOME/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0 &gt; /dev/null 2&gt;&amp;1 &amp;</code>', 'Sigue el arranque con <code>tail -f $JBOSS_HOME/standalone/log/server.log</code> (busca WFLYSRV0025).', 'Si falla, revisa permisos y memoria.'],
      solution: 'sudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0 > /dev/null 2>&1 &\ntail -f /opt/jboss/standalone/log/server.log   # Ctrl+C para salir\nss -tlnp\ncurl -I http://localhost:8080/',
      checks: [
        ['JBoss está en ejecución', (vm) => !!Q.server(vm)],
        ['El proceso corre como jboss', (vm) => Q.servers(vm).some(s => s.user === 'jboss')],
        ['HTTP escucha en 0.0.0.0', (vm) => Q.servers(vm).some(s => s.httpOk && s.httpBinding().addr === '0.0.0.0')],
        ['Gestión escucha en 0.0.0.0', (vm) => Q.servers(vm).some(s => s.mgmtOk && s.mgmtBinding().addr === '0.0.0.0')]
      ]
    },
    {
      id: 'add-user', level: 'b', cat: 'JBoss', title: 'Usuario de administración',
      goal: 'Crea el usuario de gestión <b>admin</b> con <code>add-user.sh</code> (contraseña que cumpla la política, p. ej. <code>Admin#123</code>). Luego entra a la <b>Consola JBoss</b> del escritorio.',
      hints: ['<code>sudo -u jboss $JBOSS_HOME/bin/add-user.sh -u admin -p \'Admin#123\'</code>', 'Se guarda en <code>standalone/configuration/mgmt-users.properties</code> como HEX(MD5(usuario:realm:clave)).'],
      solution: 'sudo -u jboss /opt/jboss/bin/add-user.sh -u admin -p \'Admin#123\'\ngrep admin /opt/jboss/standalone/configuration/mgmt-users.properties',
      checks: [['mgmt-users.properties contiene admin', (vm) => { const hm = Q.home(vm); return !!hm && /^admin=[0-9a-f]{32}$/m.test(Q.read(vm, hm + '/standalone/configuration/mgmt-users.properties')); }]]
    },
    {
      id: 'deploy-scanner', level: 'b', cat: 'Despliegues', title: 'Desplegar con el deployment-scanner',
      goal: 'Despliega <code>/opt/installers/apps/hello.war</code> copiándolo a <code>standalone/deployments</code>. Verifica el marcador <code>.deployed</code> y que <code>curl http://localhost:8080/hello/</code> responde.',
      hints: ['El scanner revisa la carpeta cada 5 segundos.', 'Copia como jboss o ajusta el dueño después.', 'Si aparece <code>.failed</code>, lee su contenido.'],
      solution: 'sudo -u jboss cp /opt/installers/apps/hello.war /opt/jboss/standalone/deployments/\nsleep 6; ls /opt/jboss/standalone/deployments/\ncurl http://localhost:8080/hello/',
      checks: [
        ['hello.war desplegado (OK)', (vm) => Q.servers(vm).some(s => { const d = s.deployments.get('hello.war'); return d && d.status === 'OK'; })],
        ['Existe el marcador hello.war.deployed', (vm) => Q.servers(vm).some(s => { const c = s.scannerConfig(); return c && vm.fs.exists(c.dir + '/hello.war.deployed'); })]
      ]
    },
    {
      id: 'diagnostico', level: 'i', cat: 'Troubleshooting', title: 'Diagnosticar un despliegue fallido',
      goal: 'Copia <code>roto.war</code> a deployments, observa que falla y guarda en <code>/tmp/error-roto.txt</code> las líneas <b>ERROR</b> del <code>server.log</code> que mencionan roto.war. Finalmente quita roto.war de deployments.',
      hints: ['<code>grep ERROR server.log | grep roto.war &gt; /tmp/error-roto.txt</code>', 'Lee también <code>roto.war.failed</code>: ¿qué archivo tiene el error y en qué línea?', 'Elimina roto.war y su marcador .failed.'],
      solution: 'cd /opt/jboss/standalone\nsudo -u jboss cp /opt/installers/apps/roto.war deployments/\nsleep 6; cat deployments/roto.war.failed\ngrep ERROR log/server.log | grep roto.war > /tmp/error-roto.txt\nsudo rm deployments/roto.war*',
      checks: [
        ['/tmp/error-roto.txt contiene líneas ERROR de roto.war', (vm) => { const t = Q.read(vm, '/tmp/error-roto.txt'); return /ERROR/.test(t) && /roto\.war/.test(t); }],
        ['roto.war ya no está en deployments', (vm) => { const hm = Q.home(vm); return !!hm && !vm.fs.exists(hm + '/standalone/deployments/roto.war'); }]
      ]
    },
    {
      id: 'datasource', level: 'i', cat: 'JBoss CLI', title: 'Datasource y despliegue administrado',
      goal: '<code>inventario.war</code> necesita <code>java:jboss/datasources/InventarioDS</code>. Con <b>jboss-cli.sh</b> crea el datasource (driver h2) y luego despliega la app con <code>deploy</code>.',
      hints: ['Conéctate: <code>$JBOSS_HOME/bin/jboss-cli.sh -c</code>', '<code>/subsystem=datasources/data-source=InventarioDS:add(jndi-name=java:jboss/datasources/InventarioDS,driver-name=h2,connection-url=jdbc:h2:mem:inv)</code>', '<code>deploy /opt/installers/apps/inventario.war</code> y luego <code>deployment-info</code>.'],
      solution: '/opt/jboss/bin/jboss-cli.sh -c\n/subsystem=datasources/data-source=InventarioDS:add(jndi-name=java:jboss/datasources/InventarioDS,driver-name=h2,connection-url=jdbc:h2:mem:inv,user-name=sa,password=sa)\n/subsystem=datasources/data-source=InventarioDS:test-connection-in-pool\ndeploy /opt/installers/apps/inventario.war\ndeployment-info\nquit\ncurl localhost:8080/inventario/api/items.json',
      checks: [
        ['InventarioDS enlazado', (vm) => Q.servers(vm).some(s => s.boundDs.has('java:jboss/datasources/InventarioDS'))],
        ['inventario.war desplegado (administrado)', (vm) => Q.servers(vm).some(s => { const d = s.deployments.get('inventario.war'); return d && d.status === 'OK' && d.managed; })]
      ]
    },
    {
      id: 'puerto', level: 'i', cat: 'JBoss CLI', title: 'Cambiar el puerto HTTP y recargar',
      goal: 'Cambia el puerto del socket-binding <b>http</b> a <b>8180</b> usando la CLI y aplica el cambio con <code>reload</code>. Verifica con <code>ss -tlnp</code>.',
      hints: ['<code>/socket-binding-group=standard-sockets/socket-binding=http:write-attribute(name=port,value=8180)</code>', 'La respuesta indica <code>reload-required</code>.', 'Luego <code>reload</code>.'],
      solution: '/opt/jboss/bin/jboss-cli.sh -c --command="/socket-binding-group=standard-sockets/socket-binding=http:write-attribute(name=port,value=8180)"\n/opt/jboss/bin/jboss-cli.sh -c --command="reload"\nss -tlnp | grep 8180',
      checks: [
        ['http configurado en 8180', (vm) => { const d = Q.xml(vm); if (!d) return false; const sb = X.find(d, 'socket-binding', n => X.attr(n, 'name') === 'http')[0]; return !!sb && /8180/.test(X.attr(sb, 'port')); }],
        ['El servidor escucha en 8180', (vm) => vm.listeners.some(l => l.port === 8180)],
        ['Sin reload pendiente', (vm) => Q.servers(vm).length > 0 && Q.servers(vm).every(s => !s.reloadRequired)]
      ]
    },
    {
      id: 'firewall', level: 'i', cat: 'Red', title: 'Abrir el puerto en firewalld',
      goal: 'Permite el acceso externo al puerto HTTP de JBoss (<b>8080/tcp</b>) y a la gestión (<b>9990/tcp</b>) de forma <u>permanente y activa</u>. Comprueba desde el <b>Navegador</b> del escritorio.',
      hints: ['<code>--permanent</code> guarda en disco, pero no aplica hasta <code>--reload</code>.', '<code>sudo firewall-cmd --list-all</code>'],
      solution: 'sudo firewall-cmd --permanent --add-port=8080/tcp --add-port=9990/tcp\nsudo firewall-cmd --reload\nsudo firewall-cmd --list-ports',
      checks: [
        ['8080/tcp activo', (vm) => vm.fw.running && vm.fw.ports.includes('8080/tcp')],
        ['9990/tcp activo', (vm) => vm.fw.running && vm.fw.ports.includes('9990/tcp')],
        ['Ambos también permanentes', (vm) => { const p = vm.fwPermanent().ports; return p.includes('8080/tcp') && p.includes('9990/tcp'); }]
      ]
    },
    {
      id: 'systemd', level: 'a', cat: 'Servicios', title: 'JBoss como servicio systemd',
      goal: 'Crea <code>/etc/systemd/system/jboss.service</code> que ejecute <code>standalone.sh -b 0.0.0.0</code> como <b>User=jboss</b>, habilítalo para el arranque y actívalo. (Detén antes cualquier JBoss iniciado a mano.)',
      hints: ['Hay un ejemplo en <code>$JBOSS_HOME/docs/contrib/scripts/systemd/</code>.', 'Secciones: [Unit], [Service] (User, ExecStart), [Install] (WantedBy=multi-user.target).', '<code>sudo systemctl daemon-reload && sudo systemctl enable --now jboss</code>'],
      solution: 'sudo tee /etc/systemd/system/jboss.service <<EOF\n[Unit]\nDescription=JBoss Application Server\nAfter=network.target\n\n[Service]\nUser=jboss\nGroup=jboss\nExecStart=/opt/jboss/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0\n\n[Install]\nWantedBy=multi-user.target\nEOF\nsudo systemctl daemon-reload\nsudo systemctl enable --now jboss\nsystemctl status jboss',
      checks: [
        ['La unidad jboss.service existe', (vm) => vm.fs.isFile('/etc/systemd/system/jboss.service')],
        ['Está habilitada', (vm) => vm.unitEnabled('jboss')],
        ['Está activa', (vm) => vm.unitState('jboss').active],
        ['Corre como jboss', (vm) => { const s = vm.units.jboss && vm.units.jboss.server; return !!s && s.user === 'jboss'; }]
      ]
    },
    {
      id: 'offset', level: 'a', cat: 'JBoss', title: 'Segunda instancia con port-offset',
      goal: 'Ejecuta una <b>segunda instancia</b> en la misma VM: copia <code>standalone</code> a <code>standalone2</code> e iníciala con <code>-Djboss.server.base.dir</code> apuntando a esa copia y <code>-Djboss.socket.binding.port-offset=100</code> (HTTP en 8180).',
      hints: ['<code>sudo -u jboss cp -r $JBOSS_HOME/standalone $JBOSS_HOME/standalone2</code>', 'Si 8180 ya está en uso (ejercicio de puerto), elige otro offset.', 'Dos instancias con el mismo puerto producen "Address already in use".'],
      solution: 'cd /opt/jboss\nsudo -u jboss cp -r standalone standalone2\nsudo -u jboss nohup bin/standalone.sh -Djboss.server.base.dir=/opt/jboss/standalone2 -Djboss.socket.binding.port-offset=100 -b 0.0.0.0 > /dev/null 2>&1 &\nsleep 5; ss -tlnp | grep java',
      checks: [
        ['Hay 2 servidores JBoss en ejecución', (vm) => Q.servers(vm).length >= 2],
        ['Uno usa port-offset 100', (vm) => Q.servers(vm).some(s => s.portOffset() === 100)],
        ['Usa un base.dir distinto', (vm) => new Set(Q.servers(vm).map(s => s.baseDir)).size >= 2]
      ]
    },
    {
      id: 'driver', level: 'a', cat: 'JBoss CLI', title: 'Módulo y driver JDBC de PostgreSQL',
      goal: 'Registra el driver de PostgreSQL: crea el módulo <b>org.postgresql</b> con el JAR de <code>/opt/installers/drivers</code> y agrega el <b>jdbc-driver</b> "postgresql".',
      hints: ['<code>module add --name=org.postgresql --resources=/opt/installers/drivers/postgresql-42.7.3.jar --dependencies=javax.api,javax.transaction.api</code>', '<code>/subsystem=datasources/jdbc-driver=postgresql:add(driver-name=postgresql,driver-module-name=org.postgresql,driver-class-name=org.postgresql.Driver)</code>'],
      solution: '/opt/jboss/bin/jboss-cli.sh -c\nmodule add --name=org.postgresql --resources=/opt/installers/drivers/postgresql-42.7.3.jar --dependencies=javax.api,javax.transaction.api\n/subsystem=datasources/jdbc-driver=postgresql:add(driver-name=postgresql,driver-module-name=org.postgresql,driver-class-name=org.postgresql.Driver)\n/subsystem=datasources:read-resource',
      checks: [
        ['Existe modules/org/postgresql/main/module.xml', (vm) => Q.homes(vm).some(hm => vm.fs.isFile(hm + '/modules/org/postgresql/main/module.xml'))],
        ['jdbc-driver postgresql registrado', (vm) => { const d = Q.xml(vm); return !!d && X.find(d, 'driver', n => X.attr(n, 'name') === 'postgresql' && X.attr(n, 'module') === 'org.postgresql').length > 0; }]
      ]
    },
    {
      id: 'logging', level: 'i', cat: 'JBoss CLI', title: 'Logger de aplicación en DEBUG',
      goal: 'Agrega un logger para la categoría <b>com.miempresa</b> con nivel <b>DEBUG</b> sin reiniciar el servidor, y crea un snapshot de la configuración.',
      hints: ['<code>/subsystem=logging/logger=com.miempresa:add(level=DEBUG)</code>', '<code>:take-snapshot</code> guarda una copia en standalone_xml_history/snapshot.'],
      solution: '/opt/jboss/bin/jboss-cli.sh -c --command="/subsystem=logging/logger=com.miempresa:add(level=DEBUG)"\n/opt/jboss/bin/jboss-cli.sh -c --command=":take-snapshot"',
      checks: [
        ['Logger com.miempresa en DEBUG', (vm) => { const d = Q.xml(vm); if (!d) return false; const lg = X.find(d, 'logger', n => X.attr(n, 'category') === 'com.miempresa')[0]; return !!lg && X.attr(X.kid(lg, 'level'), 'name') === 'DEBUG'; }],
        ['Existe al menos un snapshot', (vm) => Q.homes(vm).some(hm => { try { return vm.fs.readdir(hm + '/standalone/configuration/standalone_xml_history/snapshot').length > 0; } catch (e) { return false; } })]
      ]
    },
    {
      id: 'ssh', level: 'a', cat: 'Red', title: 'SSH con claves entre dos VMs',
      goal: 'Necesitas <b>2 VMs encendidas</b>. Desde esta VM genera una clave SSH para tu usuario, cópiala a la otra VM y envía <code>hello.war</code> a su <code>/tmp</code> con <code>scp</code> sin escribir contraseña.',
      hints: ['<code>ssh-keygen</code> (Enter a todo)', '<code>ssh-copy-id admin@&lt;otra-vm&gt;</code>', '<code>scp /opt/installers/apps/hello.war admin@&lt;otra-vm&gt;:/tmp/</code>'],
      solution: 'ssh-keygen\nssh-copy-id admin@jboss02\nscp /opt/installers/apps/hello.war admin@jboss02:/tmp/\nssh admin@jboss02 ls -l /tmp',
      checks: [
        ['Tu usuario tiene clave ~/.ssh/id_rsa.pub', (vm) => vm.fs.isFile(Q.home1(vm) + '/.ssh/id_rsa.pub')],
        ['La clave está autorizada en otra VM', (vm) => { const pub = Q.read(vm, Q.home1(vm) + '/.ssh/id_rsa.pub').trim(); if (!pub) return false; return Array.from(vm.lab.vms.values()).some(o => o !== vm && OS.users.passwd(o.fs).some(u => Q.read(o, u.home + '/.ssh/authorized_keys').includes(pub))); }],
        ['hello.war copiado a /tmp de otra VM', (vm) => Array.from(vm.lab.vms.values()).some(o => o !== vm && o.fs.isFile('/tmp/hello.war'))]
      ]
    },
    {
      id: 'snapshot', level: 'b', cat: 'Laboratorio', title: 'Snapshot antes de un cambio',
      goal: 'Antes de un cambio riesgoso, toma desde el <b>Gestor de VMs</b> un snapshot llamado <b>antes-cambio</b>. Luego borra por error <code>/tmp/*</code> y practica revertir.',
      hints: ['Gestor de VMs → Snapshots → nombre → Tomar snapshot.', 'Revertir apaga la VM y restaura el disco.'],
      solution: '(Interfaz gráfica) Gestor de VMs → botón "Snapshots" de la VM → "antes-cambio" → Tomar snapshot',
      checks: [['Existe el snapshot "antes-cambio"', (vm) => vm.snapshots.some(s => s.name === 'antes-cambio')]]
    }
  ];

  L.exercises = EX;
  L.exercisesQ = Q;
})(globalThis.JLab = globalThis.JLab || {});
