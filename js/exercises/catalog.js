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
    user1: (vm) => (OS.users.passwd(vm.fs).find(u => u.uid === 1000) || { name: 'admin' }).name,
    ctx: (vm, p) => (L.selinux.contextOf(vm.fs, p).split(':')[2] || '')
  };
  const pemCert = (vm, p) => L.certs.readPem(Q.read(vm, p), 'CERTIFICATE')[0] || null;
  const cn = (dn) => ((dn || []).find(x => x[0] === 'CN') || [])[1];
  const ks = (vm, p, pass) => { const k = L.certs.readKs(Q.read(vm, p)); return k && k.pass === L.util.sha256('ks:' + pass) ? k : null; };
  const json = (vm, p) => { try { return JSON.parse(Q.read(vm, p)); } catch (e) { return null; } };
  const lines = (vm, p) => Q.read(vm, p).split('\n').filter(x => x.trim());

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

  // ================= Ejercicios adicionales de JBoss =================
  const deps = (vm, name) => Q.servers(vm).map(s => s.deployments.get(name)).filter(Boolean);
  const listDir = (vm, p) => { try { return vm.fs.readdir(p); } catch (e) { return []; } };

  EX.push(
    {
      id: 'xml-roto', level: 'i', cat: 'Troubleshooting', title: 'Arranque fallido por XML mal formado',
      goal: 'Detén JBoss, haz una copia de <code>standalone.xml</code> y "rómpelo" borrando el <code>/</code> de una etiqueta (por ejemplo <code>&lt;/system-properties&gt;</code> → <code>&lt;system-properties&gt;</code>). Intenta arrancar, guarda en <code>/tmp/xml-error.txt</code> las líneas del <code>server.log</code> con <b>WFLYCTL0085</b>, corrige el XML y deja JBoss corriendo otra vez.',
      hints: ['El mensaje indica <code>ParseError at [row,col]</code>: ve a esa línea con <code>vi +FILA standalone.xml</code>.', '<code>grep WFLYCTL0085 $JBOSS_HOME/standalone/log/server.log &gt; /tmp/xml-error.txt</code>', 'Si te pierdes, restaura la copia: <code>cp standalone.xml.bak standalone.xml</code>. El editor gráfico tiene el botón "Validar XML".'],
      solution: 'cd /opt/jboss/standalone/configuration\nsudo -u jboss cp standalone.xml standalone.xml.bak\nsudo sed -i "s|</system-properties>|<system-properties>|" standalone.xml\nsudo -u jboss /opt/jboss/bin/standalone.sh      # falla: WFLYCTL0085 / WFLYSRV0056\ngrep WFLYCTL0085 /opt/jboss/standalone/log/server.log > /tmp/xml-error.txt\nsudo -u jboss cp standalone.xml.bak standalone.xml\nsudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &',
      checks: [
        ['/tmp/xml-error.txt contiene WFLYCTL0085', (vm) => /WFLYCTL0085/.test(Q.read(vm, '/tmp/xml-error.txt'))],
        ['standalone.xml vuelve a ser XML válido', (vm) => !!Q.xml(vm)],
        ['JBoss está en ejecución', (vm) => !!Q.server(vm)]
      ]
    },
    {
      id: 'puerto-ocupado', level: 'i', cat: 'Troubleshooting', title: 'Puerto ocupado (Address already in use)',
      goal: 'Con un JBoss ya corriendo, inicia una <b>segunda</b> instancia sobre una copia <code>standalone3</code> <u>sin</u> port-offset. Arrancará "with errors". Guarda en <code>/tmp/conflicto.txt</code> la línea del log con <b>Address already in use</b>, guarda en <code>/tmp/pid-8080.txt</code> el PID del proceso dueño del puerto 8080 y detén la instancia conflictiva.',
      hints: ['<code>sudo -u jboss cp -r $JBOSS_HOME/standalone $JBOSS_HOME/standalone3</code> y arráncala con <code>-Djboss.server.base.dir=...</code>', 'El log de la segunda instancia está en <code>standalone3/log/server.log</code>. Busca también <b>WFLYSRV0026</b>.', '<code>sudo ss -tlnp | grep :8080</code> muestra <code>pid=NNNN</code>.', 'Detén la instancia que arrancó con errores con <code>kill PID</code> (señal TERM = apagado ordenado).'],
      solution: 'cd /opt/jboss\nsudo -u jboss cp -r standalone standalone3\nsudo -u jboss nohup bin/standalone.sh -Djboss.server.base.dir=/opt/jboss/standalone3 > /dev/null 2>&1 &\nsleep 6; grep "Address already in use" standalone3/log/server.log > /tmp/conflicto.txt\nsudo ss -tlnp | grep :8080          # anota pid=NNNN\necho NNNN > /tmp/pid-8080.txt\nps -ef | grep standalone3            # PID de la segunda instancia (java)\nsudo kill PID_SEGUNDA',
      checks: [
        ['/tmp/conflicto.txt contiene "Address already in use"', (vm) => /Address already in use/.test(Q.read(vm, '/tmp/conflicto.txt'))],
        ['/tmp/pid-8080.txt tiene el PID que escucha en 8080', (vm) => { const pid = parseInt(Q.read(vm, '/tmp/pid-8080.txt'), 10); return !!pid && vm.listeners.some(l => l.port === 8080 && l.pid === pid); }],
        ['No queda ninguna instancia corriendo con errores', (vm) => Q.servers(vm).length > 0 && Q.servers(vm).every(s => !s.failedServices)]
      ]
    },
    {
      id: 'java-incompatible', level: 'a', cat: 'Troubleshooting', title: 'Java incompatible con la versión de JBoss',
      goal: 'Requiere una VM con <b>WildFly 30</b> o <b>EAP 8.0</b> instalado (piden Java 11+). Instala <code>java-1.8.0-openjdk</code>, selecciónalo como predeterminado e intenta arrancar: guarda la salida en <code>/tmp/java-error.txt</code>. Luego vuelve a Java 17 y arranca JBoss correctamente.',
      hints: ['<code>sudo alternatives --config java</code> para cambiar la versión activa.', 'Redirige la salida: <code>./standalone.sh &gt; /tmp/java-error.txt 2&gt;&amp;1</code>', 'Busca <b>UnsupportedClassVersionError</b>: "class file version 55.0" = Java 11, "52.0" = Java 8.'],
      solution: 'sudo dnf install -y java-1.8.0-openjdk\nsudo alternatives --config java            # elige java-1.8.0\njava -version\nsudo -u jboss /opt/wildfly-30.0.1.Final/bin/standalone.sh > /tmp/java-error.txt 2>&1\ncat /tmp/java-error.txt\nsudo alternatives --config java            # vuelve a java-17\nsudo -u jboss nohup /opt/wildfly-30.0.1.Final/bin/standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &',
      checks: [
        ['/tmp/java-error.txt contiene UnsupportedClassVersionError', (vm) => /UnsupportedClassVersionError/.test(Q.read(vm, '/tmp/java-error.txt'))],
        ['El Java predeterminado es 11 o superior', (vm) => { const j = Q.java(vm); return !!j && j.major >= 11; }],
        ['Un JBoss que exige Java 11+ está corriendo', (vm) => Q.servers(vm).some(s => s.dist.javaMin >= 11)]
      ]
    },
    {
      id: 'permisos-log', level: 'i', cat: 'Troubleshooting', title: 'Permisos: JBoss no arranca como jboss',
      goal: 'Detén JBoss y cambia el dueño de <code>standalone/log</code> a <b>root</b> (simula que alguien lo arrancó como root). Intenta arrancar como <b>jboss</b>, observa el error <b>WFLYSRV0137</b> y corrige los permisos de toda la instalación. Termina con JBoss corriendo como jboss.',
      hints: ['<code>sudo chown root:root $JBOSS_HOME/standalone/log</code>', '<code>ls -ld $JBOSS_HOME/standalone/*</code> para ver los dueños.', 'La solución habitual: <code>sudo chown -R jboss:jboss $JBOSS_HOME/</code> (con barra final si es un enlace).'],
      solution: 'sudo chown root:root /opt/jboss/standalone/log\nsudo -u jboss /opt/jboss/bin/standalone.sh       # WFLYSRV0137\nls -ld /opt/jboss/standalone/*\nsudo chown -R jboss:jboss /opt/jboss/\nsudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &',
      checks: [
        ['standalone/log, data y tmp pertenecen a jboss', (vm) => { const hm = Q.home(vm); return !!hm && ['log', 'data', 'tmp'].every(d => Q.owner(vm, hm + '/standalone/' + d) === 'jboss'); }],
        ['JBoss corre como jboss', (vm) => Q.servers(vm).some(s => s.user === 'jboss')]
      ]
    },
    {
      id: 'exploded', level: 'i', cat: 'Despliegues', title: 'Despliegue explotado con .dodeploy',
      goal: 'Crea en <code>standalone/deployments</code> un <b>directorio</b> <code>miapp.war</code> con <code>index.html</code> y <code>WEB-INF/web.xml</code>. Un despliegue explotado no se despliega solo: usa el marcador <code>.dodeploy</code>. Verifica con <code>curl http://localhost:8080/miapp/</code>.',
      hints: ['<code>mkdir -p miapp.war/WEB-INF</code> dentro de deployments (como jboss).', 'El web.xml mínimo: <code>&lt;web-app version="5.0"&gt;&lt;/web-app&gt;</code>', '<code>touch miapp.war.dodeploy</code> y espera unos segundos: aparecerá <code>miapp.war.deployed</code>.', 'Si editas index.html, vuelve a crear el .dodeploy para redesplegar.'],
      solution: 'cd /opt/jboss/standalone/deployments\nsudo -u jboss mkdir -p miapp.war/WEB-INF\necho "<h1>Mi app explotada</h1>" | sudo -u jboss tee miapp.war/index.html\necho \'<web-app version="5.0"></web-app>\' | sudo -u jboss tee miapp.war/WEB-INF/web.xml\nsudo -u jboss touch miapp.war.dodeploy\nsleep 6; ls; curl http://localhost:8080/miapp/',
      checks: [
        ['deployments/miapp.war es un directorio', (vm) => Q.servers(vm).some(s => { const c = s.scannerConfig(); return c && vm.fs.isDir(c.dir + '/miapp.war'); })],
        ['miapp.war desplegado (OK)', (vm) => deps(vm, 'miapp.war').some(d => d.status === 'OK')],
        ['Existe el marcador miapp.war.deployed', (vm) => Q.servers(vm).some(s => { const c = s.scannerConfig(); return c && vm.fs.exists(c.dir + '/miapp.war.deployed'); })]
      ]
    },
    {
      id: 'undeploy-marcador', level: 'b', cat: 'Despliegues', title: 'Retirar una app con marcadores',
      goal: 'Con <code>hello.war</code> desplegado por el scanner, retíralo <u>sin borrar el .war</u>: elimina el marcador <code>hello.war.deployed</code> y comprueba que aparece <code>hello.war.undeployed</code> y que <code>/hello/</code> responde 404.',
      hints: ['Lee <code>standalone/deployments/README.txt</code>: explica cada marcador.', '<code>rm hello.war.deployed</code> y espera 5 segundos.', 'Para volver a desplegarlo: <code>touch hello.war.dodeploy</code>.'],
      solution: 'cd /opt/jboss/standalone/deployments\nsudo rm hello.war.deployed\nsleep 6; ls\ncurl -I http://localhost:8080/hello/',
      checks: [
        ['Existe hello.war.undeployed', (vm) => Q.servers(vm).some(s => { const c = s.scannerConfig(); return c && vm.fs.exists(c.dir + '/hello.war.undeployed'); })],
        ['hello.war sigue en deployments', (vm) => Q.servers(vm).some(s => { const c = s.scannerConfig(); return c && vm.fs.exists(c.dir + '/hello.war'); })],
        ['hello.war ya no está activo', (vm) => Q.servers(vm).length > 0 && !deps(vm, 'hello.war').some(d => d.status === 'OK')]
      ]
    },
    {
      id: 'empaquetar', level: 'i', cat: 'Despliegues', title: 'Empaquetar tu propia app con jar',
      goal: 'En tu home crea la carpeta <code>tienda/</code> con <code>index.html</code>, <code>WEB-INF/web.xml</code> y <code>WEB-INF/jboss-web.xml</code> con context-root <b>/tienda</b>. Empaqueta con <code>jar -cvf tienda.war -C tienda .</code> y despliégala con <b>jboss-cli</b>.',
      hints: ['jboss-web.xml: <code>&lt;jboss-web&gt;&lt;context-root&gt;/tienda&lt;/context-root&gt;&lt;/jboss-web&gt;</code>', 'Revisa el contenido con <code>jar -tf tienda.war</code>.', '<code>jboss-cli.sh -c --command="deploy ~/tienda.war"</code> (usa la ruta completa).'],
      solution: 'mkdir -p ~/tienda/WEB-INF && cd ~\necho "<h1>Tienda</h1>" > tienda/index.html\necho \'<web-app version="5.0"></web-app>\' > tienda/WEB-INF/web.xml\necho \'<jboss-web><context-root>/tienda</context-root></jboss-web>\' > tienda/WEB-INF/jboss-web.xml\njar -cvf tienda.war -C tienda .\nsudo /opt/jboss/bin/jboss-cli.sh -c --command="deploy $HOME/tienda.war"\ncurl http://localhost:8080/tienda/',
      checks: [
        ['Existe tienda.war en tu home', (vm) => vm.fs.isFile(Q.home1(vm) + '/tienda.war')],
        ['tienda.war incluye WEB-INF/jboss-web.xml', (vm) => { const a = L.archive.decode(Q.read(vm, Q.home1(vm) + '/tienda.war')); return !!a && a.entries.some(e => e.p === 'WEB-INF/jboss-web.xml'); }],
        ['Desplegada por CLI en /tienda', (vm) => deps(vm, 'tienda.war').some(d => d.managed && d.status === 'OK' && d.contextRoot === '/tienda')]
      ]
    },
    {
      id: 'deshabilitar', level: 'b', cat: 'JBoss CLI', title: 'Deshabilitar y rehabilitar un despliegue',
      goal: 'Despliega <code>/opt/installers/apps/portal.war</code> con la CLI y luego <b>deshabilítalo</b> sin eliminarlo del repositorio de contenido (<code>:undeploy</code>). Debe quedar registrado en <code>standalone.xml</code> como <code>enabled="false"</code>.',
      hints: ['<code>deploy /opt/installers/apps/portal.war</code>', '<code>/deployment=portal.war:undeploy</code> lo deshabilita; <code>/deployment=portal.war:deploy</code> lo vuelve a habilitar.', '<code>deployment-info</code> muestra la columna ENABLED.'],
      solution: '/opt/jboss/bin/jboss-cli.sh -c\ndeploy /opt/installers/apps/portal.war\n/deployment=portal.war:undeploy\ndeployment-info\nquit\ngrep -A2 \'name="portal.war"\' /opt/jboss/standalone/configuration/standalone.xml',
      checks: [
        ['portal.war registrado como despliegue administrado', (vm) => { const d = Q.xml(vm); return !!d && X.find(d, 'deployment', n => X.attr(n, 'name') === 'portal.war').length > 0; }],
        ['Deshabilitado en standalone.xml (enabled="false")', (vm) => { const d = Q.xml(vm); return !!d && X.find(d, 'deployment', n => X.attr(n, 'name') === 'portal.war' && X.attr(n, 'enabled') === 'false').length > 0; }]
      ]
    },
    {
      id: 'embed-server', level: 'a', cat: 'JBoss CLI', title: 'Configuración offline con embed-server',
      goal: 'Con JBoss <b>detenido</b>, usa <code>jboss-cli.sh</code> con <code>embed-server</code> para agregar la propiedad de sistema <b>modo.mantenimiento=true</b> y un logger <b>org.hibernate</b> en <b>WARN</b>. Útil cuando no puedes arrancar el servidor para configurarlo.',
      hints: ['<code>jboss-cli.sh</code> (sin -c) → <code>embed-server --server-config=standalone.xml</code>', '<code>/system-property=modo.mantenimiento:add(value=true)</code>', '<code>/subsystem=logging/logger=org.hibernate:add(level=WARN)</code> y <code>stop-embedded-server</code>.'],
      solution: 'sudo -u jboss /opt/jboss/bin/jboss-cli.sh\nembed-server --server-config=standalone.xml\n/system-property=modo.mantenimiento:add(value=true)\n/subsystem=logging/logger=org.hibernate:add(level=WARN)\nstop-embedded-server\nquit',
      checks: [
        ['Propiedad modo.mantenimiento=true en standalone.xml', (vm) => { const d = Q.xml(vm); return !!d && X.find(d, 'property', n => X.attr(n, 'name') === 'modo.mantenimiento' && X.attr(n, 'value') === 'true').length > 0; }],
        ['Logger org.hibernate en WARN', (vm) => { const d = Q.xml(vm); if (!d) return false; const lg = X.find(d, 'logger', n => X.attr(n, 'category') === 'org.hibernate')[0]; return !!lg && X.attr(X.kid(lg, 'level'), 'name') === 'WARN'; }]
      ]
    },
    {
      id: 'backup-config', level: 'b', cat: 'Operación', title: 'Respaldo de la configuración',
      goal: 'Crea <code>/backup</code> y genera un respaldo comprimido de <code>standalone/configuration</code> llamado <code>jboss-config-AAAAMMDD.tar.gz</code> (con la fecha de hoy). Comprueba su contenido con <code>tar -tzf</code>.',
      hints: ['La fecha en ese formato: <code>date +%Y%m%d</code>', '<code>sudo tar -czf /backup/jboss-config-$(date +%Y%m%d).tar.gz -C $JBOSS_HOME/standalone configuration</code>'],
      solution: 'sudo mkdir -p /backup\nsudo tar -czf /backup/jboss-config-$(date +%Y%m%d).tar.gz -C /opt/jboss/standalone configuration\ntar -tzf /backup/jboss-config-*.tar.gz | head',
      checks: [
        ['Existe /backup/jboss-config-AAAAMMDD.tar.gz', (vm) => listDir(vm, '/backup').some(f => /^jboss-config-\d{8}\.tar\.gz$/.test(f))],
        ['Es un tar.gz que contiene standalone.xml', (vm) => listDir(vm, '/backup').filter(f => /^jboss-config-\d{8}\.tar\.gz$/.test(f)).some(f => { const a = L.archive.decode(Q.read(vm, '/backup/' + f)); return !!a && a.format === 'tar.gz' && a.entries.some(e => /(^|\/)standalone\.xml$/.test(e.p)); })]
      ]
    },
    {
      id: 'thread-dump', level: 'i', cat: 'Troubleshooting', title: 'Thread dump para soporte',
      goal: 'Ante un servidor "colgado", soporte suele pedir un <b>thread dump</b>. Encuentra el PID de la JVM de JBoss con <code>jps</code> o <code>pgrep</code> y guarda el volcado en <code>/tmp/threaddump.txt</code>.',
      hints: ['<code>sudo jps -l</code> o <code>pgrep -f jboss-modules</code>', 'jstack debe ejecutarse como el mismo usuario que la JVM: <code>sudo -u jboss jstack PID</code>.', 'Alternativa: <code>jcmd PID Thread.print</code>.'],
      solution: 'PID=$(pgrep -f jboss-modules | head -1)\nsudo -u jboss jstack $PID > /tmp/threaddump.txt\nhead /tmp/threaddump.txt',
      checks: [['/tmp/threaddump.txt contiene "Full thread dump"', (vm) => /Full thread dump/.test(Q.read(vm, '/tmp/threaddump.txt'))]]
    },
    {
      id: 'jdr', level: 'b', cat: 'Operación', title: 'Reporte JDR para Red Hat',
      goal: 'Genera un reporte de diagnóstico con <code>jdr.sh</code> (JBoss Diagnostic Reporter) y localiza el <code>.zip</code> generado. Es lo que Red Hat pide al abrir un caso de soporte.',
      hints: ['<code>sudo -u jboss $JBOSS_HOME/bin/jdr.sh</code>', 'La salida indica la ruta: <code>standalone/tmp/jdr_*.zip</code>.', 'Revisa su contenido con <code>unzip -l</code>.'],
      solution: 'sudo -u jboss /opt/jboss/bin/jdr.sh\nls -l /opt/jboss/standalone/tmp/\nunzip -l /opt/jboss/standalone/tmp/jdr_*.zip | head',
      checks: [['Existe un reporte standalone/tmp/jdr_*.zip', (vm) => Q.homes(vm).some(hm => listDir(vm, hm + '/standalone/tmp').some(f => /^jdr_.*\.zip$/.test(f)))]]
    },
    {
      id: 'usuario-grupo', level: 'b', cat: 'JBoss', title: 'Usuario de consola con grupo',
      goal: 'Crea el usuario de gestión <b>operador</b> que pertenezca al grupo <b>operadores</b> usando <code>add-user.sh</code>, y verifica ambos archivos: <code>mgmt-users.properties</code> y <code>mgmt-groups.properties</code>.',
      hints: ['<code>add-user.sh -u operador -p \'Oper#2024\' -g operadores</code>', '<code>grep operador $JBOSS_HOME/standalone/configuration/mgmt-*.properties</code>'],
      solution: 'sudo -u jboss /opt/jboss/bin/add-user.sh -u operador -p \'Oper#2024\' -g operadores\ngrep operador /opt/jboss/standalone/configuration/mgmt-*.properties',
      checks: [
        ['operador está en mgmt-users.properties', (vm) => Q.homes(vm).some(hm => /^operador=[0-9a-f]{32}$/m.test(Q.read(vm, hm + '/standalone/configuration/mgmt-users.properties')))],
        ['operador pertenece al grupo operadores', (vm) => Q.homes(vm).some(hm => /^operador=.*\boperadores\b/m.test(Q.read(vm, hm + '/standalone/configuration/mgmt-groups.properties')))]
      ]
    },
    {
      id: 'script-monitoreo', level: 'a', cat: 'Operación', title: 'Script de monitoreo del servidor',
      goal: 'Escribe <code>/usr/local/bin/check-jboss.sh</code> (ejecutable) que consulte el estado con <code>jboss-cli.sh --command=":read-attribute(name=server-state)"</code> y muestre <b>OK</b> si el resultado es <code>running</code> o <b>FALLA</b> en caso contrario. Ejecútalo y guarda su salida en <code>/tmp/estado.txt</code>.',
      hints: ['Empieza con <code>#!/bin/bash</code>.', 'Guarda la salida en una variable: <code>R=$(/opt/jboss/bin/jboss-cli.sh -c --command=":read-attribute(name=server-state)")</code>', '<code>if echo "$R" | grep -q running; then echo OK; else echo FALLA; fi</code>', '<code>sudo chmod +x /usr/local/bin/check-jboss.sh</code>'],
      solution: 'sudo tee /usr/local/bin/check-jboss.sh <<\'EOF\'\n#!/bin/bash\nR=$(/opt/jboss/bin/jboss-cli.sh -c --command=":read-attribute(name=server-state)" 2>&1)\nif echo "$R" | grep -q running; then\n    echo "OK - JBoss en ejecución"\nelse\n    echo "FALLA - $R"\n    exit 2\nfi\nEOF\nsudo chmod +x /usr/local/bin/check-jboss.sh\nsudo /usr/local/bin/check-jboss.sh > /tmp/estado.txt; cat /tmp/estado.txt',
      checks: [
        ['El script existe y es ejecutable', (vm) => { const n = Q.node(vm, '/usr/local/bin/check-jboss.sh'); return !!n && n.t === 'f' && (n.m & 0o111) !== 0; }],
        ['Consulta server-state con jboss-cli', (vm) => /jboss-cli\.sh[\s\S]*server-state/.test(Q.read(vm, '/usr/local/bin/check-jboss.sh'))],
        ['/tmp/estado.txt indica OK', (vm) => /\bOK\b/.test(Q.read(vm, '/tmp/estado.txt'))]
      ]
    },

    // ---------- SELinux ----------
    {
      id: 'selinux-servicio', level: 'a', cat: 'SELinux', title: 'Servicio bloqueado por SELinux (203/EXEC)',
      goal: 'Reproduce un error muy común en producción: descomprime en <code>/root/jb</code> el ZIP de JBoss que tengas en <code>/opt/installers</code>, mueve la carpeta resultante con <code>mv</code> a <code>/opt/jboss-se</code> y crea el servicio <code>jboss-se.service</code> (User=jboss). Al arrancarlo, systemd fallará con <b>status=203/EXEC</b> aunque los permisos sean correctos. Guarda la denegación AVC en <code>/tmp/avc.txt</code>, corrige las etiquetas y deja el servicio activo.',
      hints: ['<code>sudo unzip -q /opt/installers/&lt;zip&gt; -d /root/jb</code> y luego <code>sudo mv /root/jb/* /opt/jboss-se</code>', '<code>mv</code> conserva el contexto SELinux de origen (<code>admin_home_t</code>); <code>cp</code> toma el del destino. Compáralo con <code>ls -Z</code>.', '<code>sudo ausearch -m avc -ts recent</code> muestra la denegación <code>denied { execute }</code>.', '<code>sudo restorecon -Rv /opt/jboss-se</code> aplica el contexto por defecto de la ruta (<code>usr_t</code>). No desactives SELinux: corrige la etiqueta.', 'Si ya hay otro JBoss corriendo, agrega <code>-Djboss.socket.binding.port-offset=100</code> al ExecStart.'],
      solution: 'ZIP=$(ls /opt/installers/*.zip | head -1)\nsudo unzip -q $ZIP -d /root/jb\nsudo mv /root/jb/* /opt/jboss-se\nsudo chown -R jboss:jboss /opt/jboss-se\nsudo tee /etc/systemd/system/jboss-se.service <<EOF\n[Unit]\nDescription=JBoss (ejercicio SELinux)\nAfter=network.target\n\n[Service]\nUser=jboss\nExecStart=/opt/jboss-se/bin/standalone.sh -b 0.0.0.0 -Djboss.socket.binding.port-offset=100\n\n[Install]\nWantedBy=multi-user.target\nEOF\nsudo systemctl daemon-reload\nsudo systemctl start jboss-se        # falla: status=203/EXEC\nsudo journalctl -u jboss-se | tail -3\nls -Z /opt/jboss-se/bin/standalone.sh  # admin_home_t\nsudo ausearch -m avc > /tmp/avc.txt\nsudo restorecon -Rv /opt/jboss-se\nsudo systemctl start jboss-se\nsystemctl status jboss-se',
      checks: [
        ['/tmp/avc.txt contiene la denegación (denied … admin_home_t)', (vm) => /denied[\s\S]*admin_home_t/.test(Q.read(vm, '/tmp/avc.txt'))],
        ['/opt/jboss-se/bin/standalone.sh tiene el tipo usr_t', (vm) => vm.fs.exists('/opt/jboss-se/bin/standalone.sh') && Q.ctx(vm, '/opt/jboss-se/bin/standalone.sh') === 'usr_t'],
        ['SELinux sigue en Enforcing', (vm) => L.selinux.selinuxMode(vm) === 'enforcing'],
        ['jboss-se.service está activo', (vm) => vm.fs.isFile('/etc/systemd/system/jboss-se.service') && vm.unitState('jboss-se').active]
      ]
    },
    {
      id: 'selinux-etiquetas', level: 'i', cat: 'SELinux', title: 'Contextos SELinux: cp, mv, chcon y restorecon',
      goal: 'Guarda la salida de <code>sestatus</code> en <code>/tmp/sestatus.txt</code>. Crea en <code>/root</code> los archivos <code>a.txt</code> y <code>b.txt</code>: <b>copia</b> a.txt a <code>/opt/demo-cp.txt</code> y <b>mueve</b> b.txt a <code>/opt/demo-mv.txt</code>. Guarda <code>ls -Z /opt/demo-*</code> en <code>/tmp/contextos.txt</code> y corrige el archivo mal etiquetado. Por último cambia <u>temporalmente</u> el tipo de <code>/opt/demo-cp.txt</code> a <b>httpd_sys_content_t</b> con <code>chcon</code>.',
      hints: ['<code>sestatus</code> muestra el modo actual y el de <code>/etc/selinux/config</code>.', 'Tras el <code>mv</code>, <code>demo-mv.txt</code> conserva <code>admin_home_t</code>; <code>demo-cp.txt</code> queda como <code>usr_t</code>.', '<code>restorecon -v /opt/demo-mv.txt</code> corrige la etiqueta.', '<code>chcon -t httpd_sys_content_t /opt/demo-cp.txt</code>. Un <code>restorecon</code> posterior lo revertiría: para cambios permanentes se usa <code>semanage fcontext</code>.'],
      solution: 'sestatus > /tmp/sestatus.txt\nsudo touch /root/a.txt /root/b.txt\nsudo cp /root/a.txt /opt/demo-cp.txt\nsudo mv /root/b.txt /opt/demo-mv.txt\nls -Z /opt/demo-* > /tmp/contextos.txt; cat /tmp/contextos.txt\nsudo restorecon -v /opt/demo-mv.txt\nsudo chcon -t httpd_sys_content_t /opt/demo-cp.txt\nls -Z /opt/demo-*',
      checks: [
        ['/tmp/sestatus.txt muestra el estado de SELinux', (vm) => /SELinux status:\s+enabled/.test(Q.read(vm, '/tmp/sestatus.txt'))],
        ['/tmp/contextos.txt registra admin_home_t en demo-mv.txt', (vm) => /admin_home_t\S*\s+\S*demo-mv\.txt/.test(Q.read(vm, '/tmp/contextos.txt'))],
        ['/opt/demo-mv.txt quedó corregido (usr_t)', (vm) => vm.fs.exists('/opt/demo-mv.txt') && Q.ctx(vm, '/opt/demo-mv.txt') === 'usr_t'],
        ['/opt/demo-cp.txt tiene el tipo httpd_sys_content_t', (vm) => vm.fs.exists('/opt/demo-cp.txt') && Q.ctx(vm, '/opt/demo-cp.txt') === 'httpd_sys_content_t']
      ]
    },

    // ---------- Certificados ----------
    {
      id: 'ca-propia', level: 'a', cat: 'Certificados', title: 'CA propia y certificado firmado',
      goal: 'En <code>/root/pki</code> crea una autoridad certificadora (<code>ca.key</code>, <code>ca.pem</code> con CN <b>Lab CA</b>) y un certificado para el nombre completo de la VM (<code>hostname -f</code>): <code>app.key</code>, <code>app.csr</code> y <code>app.pem</code>, firmado por tu CA. Guarda el resultado de <code>openssl verify</code> en <code>/root/pki/verify.txt</code>.',
      hints: ['CA: <code>openssl genrsa -out ca.key 4096</code> y <code>openssl req -x509 -new -key ca.key -out ca.pem -days 3650 -subj "/O=Lab/CN=Lab CA"</code>', 'Solicitud: <code>openssl req -new -newkey rsa:2048 -nodes -keyout app.key -out app.csr -subj "/CN=$(hostname -f)"</code>', 'Firma: <code>openssl x509 -req -in app.csr -CA ca.pem -CAkey ca.key -out app.pem -days 365</code>', 'Revisa con <code>openssl x509 -in app.pem -noout -subject -issuer -dates</code>.'],
      solution: 'sudo -i\nmkdir -p /root/pki && cd /root/pki\nopenssl genrsa -out ca.key 4096\nopenssl req -x509 -new -key ca.key -out ca.pem -days 3650 -subj "/O=Lab/CN=Lab CA"\nopenssl req -new -newkey rsa:2048 -nodes -keyout app.key -out app.csr -subj "/CN=$(hostname -f)"\nopenssl x509 -req -in app.csr -CA ca.pem -CAkey ca.key -out app.pem -days 365\nopenssl verify -CAfile ca.pem app.pem > verify.txt; cat verify.txt',
      checks: [
        ['ca.pem es un certificado de CA con CN=Lab CA', (vm) => { const c = pemCert(vm, '/root/pki/ca.pem'); return !!c && cn(c.subject) === 'Lab CA' && cn(c.issuer) === 'Lab CA'; }],
        ['app.pem es para el nombre de la VM', (vm) => { const c = pemCert(vm, '/root/pki/app.pem'); return !!c && [vm.hostname, vm.hostname.split('.')[0]].includes(cn(c.subject)); }],
        ['app.pem está firmado por la CA', (vm) => { const a = pemCert(vm, '/root/pki/app.pem'), ca = pemCert(vm, '/root/pki/ca.pem'); return !!a && !!ca && a.signerKeyId === ca.keyId && cn(a.issuer) === 'Lab CA'; }],
        ['verify.txt indica app.pem: OK', (vm) => /app\.pem: OK/.test(Q.read(vm, '/root/pki/verify.txt'))]
      ]
    },
    {
      id: 'keystore', level: 'a', cat: 'Certificados', title: 'Keystore y truststore PKCS12',
      goal: 'Continúa el ejercicio anterior. Empaqueta <code>app.pem</code> + <code>app.key</code> en <code>/root/pki/app.p12</code> con alias <b>jboss</b> y contraseña <b>cambiame</b>. Crea el truststore <code>/root/pki/truststore.p12</code> (misma contraseña) con la CA importada como <b>labca</b>. Con JBoss corriendo, guarda en <code>/tmp/tls.txt</code> el certificado que presenta el puerto <b>8443</b>.',
      hints: ['<code>openssl pkcs12 -export -in app.pem -inkey app.key -name jboss -out app.p12 -passout pass:cambiame</code>', '<code>keytool -importcert -alias labca -file ca.pem -keystore truststore.p12 -storepass cambiame -noprompt</code>', 'Confirma con <code>keytool -list -v -keystore app.p12 -storepass cambiame</code>.', '<code>keytool -printcert -sslserver localhost:8443</code> o <code>openssl s_client -connect localhost:8443 &lt; /dev/null</code>'],
      solution: 'sudo -i\ncd /root/pki\nopenssl pkcs12 -export -in app.pem -inkey app.key -name jboss -out app.p12 -passout pass:cambiame\nkeytool -list -keystore app.p12 -storepass cambiame\nkeytool -importcert -alias labca -file ca.pem -keystore truststore.p12 -storepass cambiame -noprompt\nkeytool -printcert -sslserver localhost:8443 > /tmp/tls.txt; head /tmp/tls.txt',
      checks: [
        ['app.p12 (contraseña cambiame) tiene la clave privada "jboss"', (vm) => { const k = ks(vm, '/root/pki/app.p12', 'cambiame'); return !!k && k.entries.some(e => e.alias === 'jboss' && e.kind === 'PrivateKeyEntry'); }],
        ['La entrada jboss contiene app.pem', (vm) => { const k = ks(vm, '/root/pki/app.p12', 'cambiame'), a = pemCert(vm, '/root/pki/app.pem'); return !!k && !!a && k.entries.some(e => e.alias === 'jboss' && e.cert.serial === a.serial); }],
        ['truststore.p12 confía en la CA como labca', (vm) => { const k = ks(vm, '/root/pki/truststore.p12', 'cambiame'), ca = pemCert(vm, '/root/pki/ca.pem'); return !!k && !!ca && k.entries.some(e => e.alias === 'labca' && e.kind === 'trustedCertEntry' && e.cert.serial === ca.serial); }],
        ['/tmp/tls.txt muestra el certificado del puerto 8443', (vm) => /Owner: CN=localhost|subject=CN = localhost|s:CN = localhost/.test(Q.read(vm, '/tmp/tls.txt'))]
      ]
    },

    // ---------- Datos y API ----------
    {
      id: 'api-jq', level: 'i', cat: 'Datos y API', title: 'Estado por la API HTTP de gestión con jq',
      goal: 'Sin usar jboss-cli, consulta la <b>API HTTP de gestión</b> (puerto 9990, autenticación Digest) y genera <code>/tmp/estado.json</code> con la forma <code>{"estado": "running", "despliegues": ["hello.war", …]}</code>. Despliega antes al menos una aplicación. Necesitas un usuario de gestión (add-user.sh) y el paquete <b>jq</b>.',
      hints: ['<code>sudo dnf install -y jq</code>', 'GET: <code>curl -s --digest -u admin:Admin#123 "http://localhost:9990/management?operation=attribute&amp;name=server-state"</code>', 'POST: <code>curl -s --digest -u admin:Admin#123 -H "Content-Type: application/json" -d \'{"operation":"read-children-names","child-type":"deployment"}\' http://localhost:9990/management | jq .result</code>', 'Une ambos con <code>jq -n --arg e "$E" --argjson d "$D" \'{estado: $e, despliegues: $d}\'</code>, o con <code>jq -n "{estado: …}"</code>.'],
      solution: 'sudo dnf install -y jq\nsudo -u jboss cp /opt/installers/apps/hello.war /opt/jboss/standalone/deployments/\nU="admin:Admin#123"\nE=$(curl -s --digest -u $U "http://localhost:9990/management?operation=attribute&name=server-state" | jq -r .)\nD=$(curl -s --digest -u $U -d \'{"operation":"read-children-names","child-type":"deployment"}\' http://localhost:9990/management | jq -c .result)\njq -n --arg e "$E" --argjson d "$D" \'{estado: $e, despliegues: $d}\' > /tmp/estado.json\ncat /tmp/estado.json',
      checks: [
        ['/tmp/estado.json es JSON válido', (vm) => !!json(vm, '/tmp/estado.json')],
        ['estado = "running"', (vm) => { const j = json(vm, '/tmp/estado.json'); return !!j && j.estado === 'running'; }],
        ['despliegues coincide con lo desplegado en el servidor', (vm) => { const j = json(vm, '/tmp/estado.json'); if (!j || !Array.isArray(j.despliegues) || !j.despliegues.length) return false; return j.despliegues.every(n => deps(vm, n).length > 0); }]
      ]
    },
    {
      id: 'xmllint-puertos', level: 'i', cat: 'Datos y API', title: 'Puertos de standalone.xml con xmllint',
      goal: 'Usa <code>xmllint --xpath</code> sobre <code>standalone.xml</code> para: (1) guardar en <code>/tmp/puertos.txt</code> el atributo <b>port</b> de <u>todos</u> los <code>socket-binding</code>; (2) guardar en <code>/tmp/http-port.txt</code> <u>solo</u> el valor del puerto del binding <b>http</b>. Antes comprueba que el XML está bien formado con <code>--noout</code>.',
      hints: ['Prueba primero <code>xmllint --xpath "//socket-binding" standalone.xml</code>: responde <i>XPath set is empty</i> porque el documento usa un <b>namespace por defecto</b>.', 'Ignora el namespace con <code>local-name()</code>: <code>//*[local-name()=\'socket-binding\']/@port</code>', 'Para el valor sin <code>port="…"</code> usa <code>string(…)</code>: <code>string(//*[local-name()=\'socket-binding\'][@name=\'http\']/@port)</code>'],
      solution: 'cd /opt/jboss/standalone/configuration\nxmllint --noout standalone.xml && echo "XML bien formado"\nxmllint --xpath "//socket-binding" standalone.xml        # XPath set is empty\nxmllint --xpath "//*[local-name()=\'socket-binding\']/@port" standalone.xml > /tmp/puertos.txt\nxmllint --xpath "string(//*[local-name()=\'socket-binding\'][@name=\'http\']/@port)" standalone.xml > /tmp/http-port.txt\ncat /tmp/puertos.txt /tmp/http-port.txt',
      checks: [
        ['/tmp/puertos.txt contiene los puertos http, https y management', (vm) => { const t = Q.read(vm, '/tmp/puertos.txt'); return /port="\$\{jboss\.http\.port:8080\}"/.test(t) && /8443/.test(t) && /9990/.test(t); }],
        ['/tmp/http-port.txt contiene solo el valor del puerto http', (vm) => Q.read(vm, '/tmp/http-port.txt').trim() === '${jboss.http.port:8080}']
      ]
    },
    {
      id: 'analisis-log', level: 'b', cat: 'Datos y API', title: 'Códigos WFLY más frecuentes en server.log',
      goal: 'Genera <code>/tmp/codigos.txt</code> con los códigos de mensaje de JBoss (<code>WFLYSRV0025</code>, <code>WFLYUT0006</code>…) que aparecen en <code>server.log</code>, contados y ordenados de mayor a menor (formato de <code>uniq -c</code>). Guarda también en <code>/tmp/niveles.txt</code> una tabla alineada con <code>column -t</code> del número de líneas por nivel (INFO, WARN, ERROR).',
      hints: ['<code>grep -o</code> imprime solo la parte que coincide: <code>grep -oE "WFLY[A-Z]+[0-9]{4}" server.log</code>', 'Cadena clásica: <code>| sort | uniq -c | sort -rn</code>', 'El nivel es la tercera columna: <code>awk \'{print $3}\' server.log | sort | uniq -c | column -t</code>'],
      solution: 'cd /opt/jboss/standalone/log\ngrep -oE "WFLY[A-Z]+[0-9]{4}" server.log | sort | uniq -c | sort -rn > /tmp/codigos.txt\nhead /tmp/codigos.txt\nawk \'$3 ~ /^(INFO|WARN|ERROR)$/ {print $3}\' server.log | sort | uniq -c | column -t > /tmp/niveles.txt\ncat /tmp/niveles.txt',
      checks: [
        ['/tmp/codigos.txt tiene formato "N WFLYxxx####" (3+ líneas)', (vm) => { const l = lines(vm, '/tmp/codigos.txt'); return l.length >= 3 && l.every(x => /^\s*\d+\s+WFLY[A-Z]+\d{4}$/.test(x)); }],
        ['Está ordenado de mayor a menor', (vm) => { const n = lines(vm, '/tmp/codigos.txt').map(x => parseInt(x, 10)); return n.length >= 3 && n.every((v, i) => !i || n[i - 1] >= v); }],
        ['Incluye WFLYSRV0025 (arranque completo)', (vm) => /\bWFLYSRV0025\b/.test(Q.read(vm, '/tmp/codigos.txt'))],
        ['/tmp/niveles.txt cuenta las líneas INFO', (vm) => /^\d+\s+INFO\s*$/m.test(Q.read(vm, '/tmp/niveles.txt'))]
      ]
    },

    // ---------- Sistema ----------
    {
      id: 'logrotate-consola', level: 'i', cat: 'Sistema', title: 'Rotar console.log con logrotate',
      goal: 'JBoss rota <code>server.log</code> por sí mismo, pero la salida de consola que rediriges con nohup crece sin límite. Arranca JBoss enviando la salida a <code>/var/log/jboss/console.log</code> y crea <code>/etc/logrotate.d/jboss</code> para ese archivo: <b>daily</b>, <b>rotate 7</b>, <b>compress</b>, <b>missingok</b> y <b>copytruncate</b>. Fuerza una rotación y comprueba que se generó <code>console.log.1.gz</code>.',
      hints: ['<code>sudo mkdir -p /var/log/jboss &amp;&amp; sudo chown jboss:jboss /var/log/jboss</code>', '<code>copytruncate</code> es necesario porque java mantiene el archivo abierto: logrotate copia y luego vacía el original.', 'Prueba sin cambiar nada con <code>logrotate -d /etc/logrotate.d/jboss</code> y fuerza con <code>-f</code>.', 'El estado se guarda en <code>/var/lib/logrotate/logrotate.status</code>.'],
      solution: 'sudo mkdir -p /var/log/jboss && sudo chown jboss:jboss /var/log/jboss\nsudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /var/log/jboss/console.log 2>&1 &\nsudo tee /etc/logrotate.d/jboss <<EOF\n/var/log/jboss/console.log {\n    daily\n    rotate 7\n    compress\n    missingok\n    copytruncate\n}\nEOF\nsudo logrotate -d /etc/logrotate.d/jboss\nsudo logrotate -f /etc/logrotate.d/jboss\nls -l /var/log/jboss/',
      checks: [
        ['/etc/logrotate.d/jboss rota /var/log/jboss/console.log', (vm) => /\/var\/log\/jboss\/console\.log[^{]*\{/.test(Q.read(vm, '/etc/logrotate.d/jboss'))],
        ['Incluye daily, rotate 7, compress, missingok y copytruncate', (vm) => { const t = Q.read(vm, '/etc/logrotate.d/jboss'); return ['daily', 'rotate\\s+7', 'compress', 'missingok', 'copytruncate'].every(d => new RegExp('^\\s*' + d + '\\s*$', 'm').test(t)); }],
        ['Existe console.log.1.gz y console.log sigue presente', (vm) => vm.fs.isFile('/var/log/jboss/console.log.1.gz') && vm.fs.isFile('/var/log/jboss/console.log')]
      ]
    },
    {
      id: 'sysctl-jboss', level: 'i', cat: 'Sistema', title: 'Parámetros de kernel persistentes',
      goal: 'Ajusta el kernel para un servidor de aplicaciones: <b>net.core.somaxconn = 8192</b>, <b>net.ipv4.tcp_keepalive_time = 600</b> y <b>vm.swappiness = 10</b>. Deben quedar <u>persistentes</u> en <code>/etc/sysctl.d/90-jboss.conf</code> y <u>aplicados</u> en el sistema en ejecución sin reiniciar.',
      hints: ['<code>sysctl -w</code> cambia el valor en caliente, pero se pierde al reiniciar.', 'Formato del archivo: una línea <code>clave = valor</code> por parámetro.', '<code>sudo sysctl -p /etc/sysctl.d/90-jboss.conf</code> o <code>sudo sysctl --system</code> aplica los archivos.', 'Comprueba con <code>sysctl net.core.somaxconn vm.swappiness</code> o <code>cat /proc/sys/vm/swappiness</code>.'],
      solution: 'sudo tee /etc/sysctl.d/90-jboss.conf <<EOF\nnet.core.somaxconn = 8192\nnet.ipv4.tcp_keepalive_time = 600\nvm.swappiness = 10\nEOF\nsudo sysctl --system\nsysctl net.core.somaxconn net.ipv4.tcp_keepalive_time vm.swappiness',
      checks: [
        ['/etc/sysctl.d/90-jboss.conf define los 3 parámetros', (vm) => { const t = Q.read(vm, '/etc/sysctl.d/90-jboss.conf'); return /^\s*net\.core\.somaxconn\s*=\s*8192\s*$/m.test(t) && /^\s*net\.ipv4\.tcp_keepalive_time\s*=\s*600\s*$/m.test(t) && /^\s*vm\.swappiness\s*=\s*10\s*$/m.test(t); }],
        ['Valores aplicados en el sistema en ejecución', (vm) => { const s = vm.sysctl; return !!s && vm.sysctlBoot === vm.bootTime && s['net.core.somaxconn'] === '8192' && s['net.ipv4.tcp_keepalive_time'] === '600' && s['vm.swappiness'] === '10'; }]
      ]
    },
    {
      id: 'prioridad', level: 'b', cat: 'Sistema', title: 'Prioridad de procesos con nice y renice',
      goal: 'Simula una tarea batch que no debe quitarle CPU a JBoss: lánzala en segundo plano con <code>nice -n 10 sleep 3600 &amp;</code>. Después bájale aún más la prioridad a <b>19</b> con <code>renice</code> y guarda en <code>/tmp/prioridad.txt</code> la salida de <code>ps -o pid,ni,comm -p PID</code>.',
      hints: ['<code>$!</code> contiene el PID del último proceso lanzado en segundo plano.', 'Valores de nice: -20 (más prioridad) a 19 (menos). Un usuario normal solo puede <b>subir</b> su nice; bajarlo requiere root.', 'En <code>top</code> la columna <b>NI</b> muestra el valor.'],
      solution: 'nice -n 10 sleep 3600 &\nPID=$!\nps -o pid,ni,comm -p $PID\nrenice -n 19 -p $PID\nps -o pid,ni,comm -p $PID > /tmp/prioridad.txt\ncat /tmp/prioridad.txt',
      checks: [
        ['Hay un proceso sleep en ejecución con nice 19', (vm) => [...vm.procs.values()].some(p => p.name === 'sleep' && p.ni === 19)],
        ['/tmp/prioridad.txt muestra PID, NI=19 y sleep', (vm) => /^\s*(\d+)\s+19\s+sleep\s*$/m.test(Q.read(vm, '/tmp/prioridad.txt')) && /\bNI\b/.test(Q.read(vm, '/tmp/prioridad.txt'))]
      ]
    }
  );


  L.exercises = EX;
  L.exercisesQ = Q;
})(globalThis.JLab = globalThis.JLab || {});
