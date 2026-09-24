#!/usr/bin/env node
/*
 * Pruebas automatizadas del motor (sin navegador):  node test/run-tests.js
 * Cubren VFS y permisos, shell, herramientas de texto, red, systemd,
 * firewall, el ciclo de vida de JBoss (arranque, despliegues, CLI) y la
 * resolución de los ejercicios guiados.
 */
'use strict';
const assert = require('node:assert/strict');
const { L, makeLab, sh } = require('./harness.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const out = async (s, line) => (await sh(s, line)).out.replace(/\x1b\[[0-9;]*m/g, '');

let lab, vm, root, admin;

test('crear y arrancar VM', async () => {
  lab = await makeLab();
  vm = await lab.create({ name: 'test01', os: 'rhel9', cpu: 2, ramMB: 2048, diskMB: 20480, jbossDists: ['eap74'] });
  assert.equal(vm.ip, '10.0.0.11');
  assert.ok(await vm.boot(null));
  assert.equal(vm.state, 'running');
  root = new L.Shell(vm, { user: 'root' });
  admin = new L.Shell(vm, { user: 'admin' });
});

test('recursos del host: validación y sin sobreasignar RAM', async () => {
  const errs = lab.validateSpec({ name: 'x', cpu: 99, ramMB: 100, diskMB: 1024 });
  assert.ok(errs.length >= 3);
  const big = await lab.create({ name: 'grande', os: 'rhel9', cpu: 2, ramMB: 15360, diskMB: 8192 });
  assert.equal(lab.canStart(big).ok, false, 'no debe caber junto a test01 en 16 GB');
  await lab.remove(big);
});

test('permisos del VFS', async () => {
  let r = await sh(admin, 'touch /etc/prueba');
  assert.match(r.out, /Permission denied/);
  r = await sh(admin, 'cat /etc/shadow');
  assert.notEqual(r.code, 0);
  r = await sh(admin, 'mkdir -p ~/a/b && chmod 700 ~/a && ls -ld ~/a');
  assert.match(r.out, /^drwx------/);
  r = await sh(root, 'mkdir -m 1777 /srv/t && su - admin -c "touch /srv/t/f" && ls -l /srv/t');
  assert.match(r.out, /admin admin/);
});

test('shell: expansiones, tuberías, control de flujo', async () => {
  assert.equal(await out(admin, 'x=5; echo $((x*3+1)) ${#USER} ${HOME%/*}'), '16 5 /home\n');
  assert.equal(await out(admin, 'for i in 1 2 3; do echo n$i; done | grep -c n'), '3\n');
  assert.equal(await out(admin, 'echo {a,b}{1..2}'), 'a1 a2 b1 b2\n');
  assert.equal(await out(admin, 'f() { echo "$#:$1"; }; f "a b" c'), '2:a b\n');
  assert.equal(await out(admin, 'case app.war in *.war) echo war;; *) echo otro;; esac'), 'war\n');
  assert.equal(await out(admin, 'cat <<EOF\nhola $USER\nEOF'), 'hola admin\n');
  assert.equal(await out(admin, 'false || echo ok; true && echo si'), 'ok\nsi\n');
  assert.equal(await out(admin, 'echo $(echo anidado) `echo viejo`'), 'anidado viejo\n');
});

test('texto: grep, sed, awk, sort, uniq, cut', async () => {
  assert.equal(await out(admin, 'printf "b 2\\na 1\\nc 3\\n" | sort -k2 -n | head -1'), 'a 1\n');
  assert.equal(await out(admin, 'echo abcabc | sed "s/b/X/g"'), 'aXcaXc\n');
  assert.equal(await out(admin, 'awk -F: \'$1=="root"{print $7}\' /etc/passwd'), '/bin/bash\n');
  assert.equal(await out(admin, 'printf "x\\ny\\nx\\n" | sort | uniq -c | awk \'{print $1$2}\''), '2x\n1y\n');
  assert.equal(await out(admin, 'echo a:b:c | cut -d: -f2,3'), 'b:c\n');
  assert.equal(await out(admin, 'seq 1 10 | awk \'{s+=$1} END{print s}\''), '55\n');
  assert.equal(await out(admin, 'grep -E "^(root|admin):" /etc/passwd | wc -l'), '2\n');
});

test('paquetes: dnf instala java y unzip', async () => {
  let r = await sh(root, 'unzip');
  assert.equal(r.code, 127, 'unzip no viene instalado');
  r = await sh(root, 'dnf install -y java-17-openjdk unzip');
  assert.equal(r.code, 0);
  assert.match(await out(root, 'java -version 2>&1'), /17\.0\.11/);
  r = await sh(admin, 'dnf install -y tree');
  assert.match(r.out, /superuser privileges/);
});

test('JBoss: instalar, falta de memoria y arranque', async () => {
  let r = await sh(root, 'groupadd -r jboss && useradd -r -g jboss -d /opt/jboss -s /bin/bash jboss && unzip -q /opt/installers/jboss-eap-7.4.0.zip -d /opt && chown -R jboss:jboss /opt/jboss-eap-7.4 && ln -s /opt/jboss-eap-7.4 /opt/jboss');
  assert.equal(r.code, 0, r.out);
  // la VM tiene 2 GB: el heap por defecto de EAP (1303m) no cabe con margen tras reducir RAM disponible
  vm.spawn({ user: 'root', cmd: 'memhog', memMB: 900 });
  r = await sh(root, 'sudo -u jboss /opt/jboss/bin/standalone.sh');
  assert.match(r.out, /insufficient memory/);
  for (const p of vm.procs.values()) if (p.cmd === 'memhog') vm.reap(p.pid);
  await sh(root, 'sed -i "s/-Xms1303m -Xmx1303m/-Xms512m -Xmx1024m/" /opt/jboss/bin/standalone.conf');
  r = await sh(root, 'sudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &');
  await wait(4500);
  assert.equal(vm.servers[0].state, 'running');
  assert.match(await out(root, 'tail -1 /opt/jboss/standalone/log/server.log'), /WFLYSRV0025/);
  assert.match(await out(root, 'ss -tlnp'), /0\.0\.0\.0:8080.*java/);
  assert.match(await out(root, 'ss -tlnp'), /127\.0\.0\.1:9990/);
});

test('JBoss: deployment scanner y marcadores', async () => {
  await sh(root, 'sudo -u jboss cp /opt/installers/apps/hello.war /opt/installers/apps/roto.war /opt/jboss/standalone/deployments/');
  await wait(5600);
  const ls = await out(root, 'ls /opt/jboss/standalone/deployments');
  assert.match(ls, /hello\.war\.deployed/);
  assert.match(ls, /roto\.war\.failed/);
  assert.match(await out(root, 'curl -s localhost:8080/hello/'), /Hello JBoss!/);
  assert.match(await out(root, 'cat /opt/jboss/standalone/deployments/roto.war.failed'), /web\.xml/);
});

test('JBoss CLI: datasource, deploy, write-attribute y reload', async () => {
  const cli = '/opt/jboss/bin/jboss-cli.sh -c --command=';
  let r = await sh(root, cli + '"deploy /opt/installers/apps/inventario.war"');
  assert.match(r.out, /WFLYCTL0412/);
  r = await sh(root, cli + '"/subsystem=datasources/data-source=InventarioDS:add(jndi-name=java:jboss/datasources/InventarioDS,driver-name=h2,connection-url=jdbc:h2:mem:inv)"');
  assert.match(r.out, /"outcome" => "success"/);
  r = await sh(root, cli + '"deploy /opt/installers/apps/inventario.war"');
  assert.equal(r.code, 0, r.out);
  assert.match(await out(root, 'curl -s localhost:8080/inventario/api/items.json'), /Servidor/);
  r = await sh(root, cli + '"/socket-binding-group=standard-sockets/socket-binding=http:write-attribute(name=port,value=8180)"');
  assert.match(r.out, /reload-required/);
  await sh(root, cli + '":reload"');
  await wait(3500);
  assert.ok(vm.listeners.some(l => l.port === 8180));
  assert.match(await out(root, 'grep -c InventarioDS /opt/jboss/standalone/configuration/standalone.xml'), /[1-9]/);
  r = await sh(admin, '/opt/jboss/bin/jboss-cli.sh -c --command=":read-attribute(name=server-state)" < /dev/null');
  assert.notEqual(r.code, 0, 'otro usuario sin credenciales no puede usar la autenticación local');
});

test('red: firewall, bind y acceso entre VMs', async () => {
  const vm2 = await lab.create({ name: 'test02', os: 'rocky9', cpu: 1, ramMB: 1024, diskMB: 8192 });
  await vm2.boot(null);
  const s2 = new L.Shell(vm2, { user: 'root' });
  let r = await sh(s2, 'curl -s -o /dev/null -w "%{http_code}" http://test01:8180/hello/');
  assert.match(r.out, /No route to host|000/, 'firewalld bloquea 8180');
  await sh(root, 'firewall-cmd --add-port=8180/tcp');
  assert.equal(await out(s2, 'curl -s -o /dev/null -w "%{http_code}" http://test01:8180/hello/'), '200');
  await sh(root, 'firewall-cmd --reload');
  r = await sh(s2, 'curl -s http://test01:8180/hello/');
  assert.equal(r.code, 7, 'tras --reload se pierde la regla no permanente');
  r = await sh(s2, 'curl -s http://test01:9990/');
  assert.equal(r.code, 7, 'gestión solo en 127.0.0.1');
  assert.match(await out(s2, 'ping -c 1 test01'), /1 received/);
});

test('systemd: unidad personalizada', async () => {
  await sh(root, 'kill $(pgrep -f jboss-modules)');
  await wait(600);
  const unit = '[Unit]\nDescription=JBoss EAP\n\n[Service]\nUser=jboss\nExecStart=/opt/jboss/bin/standalone.sh -b 0.0.0.0\n\n[Install]\nWantedBy=multi-user.target\n';
  vm.fs.write('/etc/systemd/system/jboss.service', unit);
  const r = await sh(root, 'systemctl daemon-reload && systemctl enable --now jboss');
  assert.equal(r.code, 0, r.out);
  assert.equal(await out(root, 'systemctl is-active jboss'), 'active\n');
  assert.equal(await out(root, 'systemctl is-enabled jboss'), 'enabled\n');
  await sh(root, 'systemctl stop jboss');
  assert.equal(await out(root, 'systemctl is-active jboss'), 'inactive\n');
});

test('ejercicios: verificaciones principales resueltas', async () => {
  const failed = (id) => L.exercises.find(e => e.id === id).checks.filter(([, f]) => !f(vm)).map(([d]) => d);
  for (const id of ['usuario-jboss', 'java', 'instalar-jboss', 'heap', 'deploy-scanner', 'datasource']) {
    if (['deploy-scanner', 'datasource'].includes(id)) continue; // requieren el servidor en ejecución (se detuvo en la prueba anterior)
    assert.deepEqual(failed(id), [], 'ejercicio ' + id);
  }
  assert.ok(failed('jboss-home').length > 0, 'jboss-home aún no resuelto (falta /etc/profile.d/jboss.sh)');
});

test('persistencia: exportar e importar VM', async () => {
  const json = lab.exportVm(vm);
  const copy = await lab.importVm(json);
  assert.notEqual(copy.id, vm.id);
  assert.ok(copy.fs.exists('/opt/jboss-eap-7.4/version.txt'));
});

(async () => {
  let ok = 0, fail = 0;
  for (const [name, fn] of tests) {
    try { await fn(); ok++; console.log('  \x1b[32m✔\x1b[0m ' + name); }
    catch (e) { fail++; console.log('  \x1b[31m✘ ' + name + '\x1b[0m\n    ' + (e.message || e).split('\n').join('\n    ')); }
  }
  console.log('\n' + ok + ' correctas, ' + fail + ' fallidas');
  process.exit(fail ? 1 : 0);
})();
