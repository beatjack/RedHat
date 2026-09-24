#!/usr/bin/env node
/*
 * Pruebas de los comandos agregados (texto y datos, sistema/SELinux,
 * builtins del shell, Java y certificados):  node test/commands-tests.js
 */
'use strict';
const assert = require('node:assert/strict');
const { L, makeLab, sh } = require('./harness.js');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
let lab, vm, root, admin;
const out = async (s, line) => (await sh(s, line)).out.replace(/\x1b\[[0-9;]*m/g, '');
const X = '/opt/wildfly-30.0.1.Final/standalone/configuration/standalone.xml';

test('preparar VM con WildFly', async () => {
  lab = await makeLab();
  vm = await lab.create({ name: 'cmds', os: 'rhel9', cpu: 2, ramMB: 4096, diskMB: 20480, jbossDists: ['wf30'], preinstall: true });
  await vm.boot(null);
  root = new L.Shell(vm, { user: 'root' });
  admin = new L.Shell(vm, { user: 'admin' });
  assert.equal((await sh(root, 'dnf install -y jq binutils plocate traceroute vim-enhanced')).code, 0);
});

test('texto: column, comm, fold, shuf, envsubst', async () => {
  assert.equal(await out(admin, 'printf "a b\\nlargo x\\n" | column -t'), 'a      b\nlargo  x\n');
  assert.equal(await out(admin, 'printf "1\\n2\\n3\\n" > /tmp/a; printf "2\\n3\\n4\\n" > /tmp/b; comm -12 /tmp/a /tmp/b'), '2\n3\n');
  assert.equal(await out(admin, 'echo abcdefgh | fold -w 3'), 'abc\ndef\ngh\n');
  assert.equal(await out(admin, 'shuf -i 1-10 | sort -n | tr "\\n" " "'), '1 2 3 4 5 6 7 8 9 10 ');
  assert.equal(await out(admin, 'export P=8180; echo "puerto=${P}" | envsubst'), 'puerto=8180\n');
});

test('volcados: xxd, od, hexdump, strings', async () => {
  assert.match(await out(admin, 'echo -n JBoss | xxd'), /^00000000: 4a42 6f73 73 +JBoss$/m);
  assert.equal(await out(admin, 'printf "a\\r\\n" | od -c'), '0000000   a  \\r  \\n\n0000003\n');
  assert.match(await out(admin, 'echo -n hi | hexdump -C'), /68 69 .*\|hi\|/);
  assert.match(await out(admin, 'strings /usr/bin/ls'), /GLIBC_2\.34/);
});

test('jq: filtros, select, map, construcción y -r', async () => {
  const j = '\'{"ds":[{"n":"A","max":20},{"n":"B","max":5}]}\'';
  assert.equal(await out(admin, 'echo ' + j + ' | jq -r ".ds[] | select(.max > 10) | .n"'), 'A\n');
  assert.equal(await out(admin, 'echo ' + j + ' | jq -c "[.ds[] | {nombre: .n}]"'), '[{"nombre":"A"},{"nombre":"B"}]\n');
  assert.equal(await out(admin, 'echo ' + j + ' | jq ".ds | map(.max) | add"'), '25\n');
  assert.equal(await out(admin, 'echo \'{"b":1,"a":2}\' | jq -c keys'), '["a","b"]\n');
  assert.equal((await sh(admin, 'echo "{" | jq .')).code, 2);
});

test('xmllint: validación, XPath y espacio de nombres por defecto', async () => {
  let r = await sh(admin, 'xmllint --xpath "//socket-binding" ' + X);
  assert.match(r.out, /XPath set is empty/);
  assert.equal(await out(admin, "xmllint --xpath \"//*[local-name()='socket-binding'][@name='http']/@port\" " + X), ' port="${jboss.http.port:8080}"\n');
  assert.equal(await out(admin, "xmllint --xpath \"count(//*[local-name()='datasource'])\" " + X), '1\n');
  r = await sh(admin, 'printf "<a>\\n<b></a>\\n" > /tmp/r.xml; xmllint --noout /tmp/r.xml');
  assert.equal(r.code, 1);
  assert.match(r.out, /Opening and ending tag mismatch: b line 2 and a/);
});

test('zgrep sobre logs comprimidos', async () => {
  assert.equal(await out(admin, 'echo "ERROR fallo" > /tmp/s.log; gzip /tmp/s.log; zgrep -c ERROR /tmp/s.log.gz'), '1\n');
});

test('SELinux: mv conserva etiqueta, systemd bloqueado, restorecon lo corrige', async () => {
  assert.equal(await out(root, 'getenforce'), 'Enforcing\n');
  assert.match(await out(root, 'ls -dZ /opt/wildfly-30.0.1.Final'), /system_u:object_r:usr_t:s0/);
  await sh(root, 'unzip -q /opt/installers/wildfly-30.0.1.Final.zip -d /root/x && mv /root/x/wildfly-30.0.1.Final /opt/wf2 && chown -R jboss:jboss /opt/wf2');
  assert.match(await out(root, 'stat -c %C /opt/wf2/bin/standalone.sh'), /admin_home_t/);
  vm.fs.write('/etc/systemd/system/wf2.service', '[Unit]\nDescription=WF2\n[Service]\nUser=jboss\nExecStart=/opt/wf2/bin/standalone.sh -Djboss.socket.binding.port-offset=300\n[Install]\nWantedBy=multi-user.target\n');
  let r = await sh(root, 'systemctl start wf2');
  assert.equal(r.code, 1);
  assert.match(await out(root, 'ausearch -m avc'), /denied  \{ execute \}.*admin_home_t/);
  await sh(root, 'restorecon -R /opt/wf2');
  assert.match(await out(root, 'stat -c %C /opt/wf2/bin/standalone.sh'), /usr_t/);
  r = await sh(root, 'systemctl start wf2');
  assert.equal(r.code, 0, r.out);
  await sh(root, 'systemctl stop wf2');
  assert.equal((await sh(admin, 'setenforce 0')).code, 1, 'solo root');
});

test('sysctl, getent, nice/renice, whereis, truncate', async () => {
  assert.equal(await out(root, 'sysctl -w vm.swappiness=10'), 'vm.swappiness = 10\n');
  assert.equal(await out(root, 'echo "net.core.somaxconn = 8192" > /etc/sysctl.d/90-jboss.conf; sysctl --system > /dev/null; sysctl -n net.core.somaxconn'), '8192\n');
  assert.match((await sh(admin, 'sysctl -w vm.swappiness=5')).out, /permission denied/);
  assert.match(await out(admin, 'getent passwd jboss'), /^jboss:x:\d+:/);
  assert.equal((await sh(admin, 'getent passwd noexiste')).code, 2);
  assert.match(await out(root, 'renice -n 5 -p 1'), /old priority 0, new priority 5/);
  assert.match(await out(admin, 'whereis java'), /^java: \/usr\/bin\/java/);
  assert.equal(await out(admin, 'truncate -s 2K /tmp/t; stat -c %s /tmp/t'), '2048\n');
});

test('logrotate: rotación forzada con compresión', async () => {
  vm.fs.write('/var/log/app.log', 'linea 1\nlinea 2\n');
  vm.fs.write('/etc/logrotate.d/app', '/var/log/app.log {\n    rotate 2\n    compress\n    create 0640 root root\n    missingok\n}\n');
  await sh(root, 'logrotate -f /etc/logrotate.d/app');
  assert.ok(vm.fs.exists('/var/log/app.log.1.gz'));
  assert.equal(vm.fs.read('/var/log/app.log'), '');
  assert.match(await out(root, 'stat -c "%a %U" /var/log/app.log'), /^640 root/);
  assert.equal(await out(root, 'zgrep -c linea /var/log/app.log.1.gz'), '2\n');
  const d = await out(root, 'logrotate -d /etc/logrotate.conf 2>&1 | head -1');
  assert.match(d, /debug mode/);
});

test('locate/updatedb, nmcli, traceroute', async () => {
  assert.equal((await sh(admin, 'locate standalone.xml')).code, 1, 'sin base de datos');
  await sh(root, 'updatedb');
  assert.match(await out(admin, 'locate -b standalone.xml'), /\/standalone\/configuration\/standalone\.xml/);
  assert.match(await out(admin, 'nmcli device status'), /enp1s0 +ethernet +connected/);
  assert.match(await out(admin, 'traceroute -n localhost'), /1  127\.0\.0\.1/);
});

test('builtins: time, pushd/popd/dirs, hash, type -a', async () => {
  const r = await sh(admin, 'time true');
  assert.match(r.out, /real\t0m0\.\d{3}s\nuser\t/);
  assert.equal(await out(admin, 'cd /opt; pushd /etc > /dev/null; pushd /tmp > /dev/null; dirs'), '/tmp /etc /opt\n');
  assert.equal(await out(admin, 'popd > /dev/null; popd > /dev/null; pwd'), '/opt\n');
  assert.match(await out(admin, 'hash -r; ls > /dev/null; hash'), /1\t\/usr\/bin\/ls/);
  assert.equal(await out(admin, 'type -a echo'), 'echo is a shell builtin\necho is /usr/bin/echo\n');
});

test('openssl: CA, CSR firmada, verify y pkcs12 compatible con keytool', async () => {
  await sh(root, 'cd /root && openssl genrsa -out ca.key 4096 && openssl req -x509 -new -key ca.key -out ca.pem -days 3650 -subj "/O=Lab/CN=Lab CA"');
  await sh(root, 'cd /root && openssl req -new -newkey rsa:2048 -nodes -keyout app.key -out app.csr -subj "/CN=cmds.lab.local" 2>/dev/null && openssl x509 -req -in app.csr -CA ca.pem -CAkey ca.key -out app.pem -days 365 2>/dev/null');
  assert.equal(await out(root, 'cd /root && openssl verify -CAfile ca.pem app.pem'), 'app.pem: OK\n');
  assert.equal((await sh(root, 'cd /root && openssl verify app.pem')).code, 2);
  assert.equal(await out(root, 'cd /root && openssl x509 -in app.pem -noout -issuer'), 'issuer=O = Lab, CN = Lab CA\n');
  await sh(root, 'cd /root && openssl pkcs12 -export -in app.pem -inkey app.key -out app.p12 -name jboss -passout pass:secreto');
  assert.match(await out(root, 'cd /root && keytool -list -keystore app.p12 -storepass secreto'), /jboss, .*PrivateKeyEntry/);
  assert.match(await out(root, 'cd /root && keytool -list -keystore app.p12 -storepass malo'), /keystore password was incorrect/);
});

test('keytool: genkeypair, export/import y printcert -sslserver', async () => {
  await sh(root, 'cd /root && keytool -genkeypair -alias srv -keyalg RSA -keysize 2048 -validity 365 -keystore srv.p12 -storepass cambiame -dname "CN=cmds.lab.local, O=Lab"');
  await sh(root, 'cd /root && keytool -exportcert -alias srv -keystore srv.p12 -storepass cambiame -rfc -file srv.crt && keytool -importcert -alias srv -file srv.crt -keystore trust.p12 -storepass cambiame -noprompt');
  assert.match(await out(root, 'cd /root && keytool -list -keystore trust.p12 -storepass cambiame'), /srv, .*trustedCertEntry/);
  assert.equal(await out(root, 'cd /root && openssl x509 -in srv.crt -noout -subject'), 'subject=O = Lab, CN = cmds.lab.local\n');
  await sh(root, 'sudo -u jboss /opt/wildfly-30.0.1.Final/bin/add-user.sh -u admin -p "Admin#123" > /dev/null; sudo -u jboss nohup /opt/wildfly-30.0.1.Final/bin/standalone.sh > /dev/null 2>&1 &');
  await wait(4000);
  assert.match(await out(root, 'keytool -printcert -sslserver localhost:8443'), /Owner: CN=localhost/);
  assert.match(await out(root, 'openssl s_client -connect localhost:8443 < /dev/null 2>/dev/null'), /Verify return code: 18 \(self-signed certificate\)/);
});

test('API HTTP de gestión + jq; jstat y jinfo', async () => {
  const auth = '--digest -u admin:Admin#123 ';
  assert.equal(await out(root, 'curl -s ' + auth + '"http://localhost:9990/management?operation=attribute&name=server-state"'), '"running"');
  assert.equal(await out(root, 'curl -s ' + auth + 'http://localhost:9990/management/subsystem/datasources?recursive=true | jq -c \'.["data-source"] | keys\''), '["ExampleDS"]\n');
  assert.equal(await out(root, 'curl -s ' + auth + '-d \'{"operation":"read-attribute","name":"product-version"}\' http://localhost:9990/management | jq -r .result'), '30.0.1.Final\n');
  assert.equal(await out(root, 'curl -s -o /dev/null -w "%{http_code}" http://localhost:9990/management'), '401');
  const pid = vm.servers[0].pid;
  assert.match(await out(root, 'jstat -gcutil ' + pid), /S0 +S1 +E +O/);
  assert.equal(await out(root, 'jinfo -flag MaxHeapSize ' + pid), '-XX:MaxHeapSize=536870912\n');
});

test('VMs existentes reciben los comandos base al arrancar', async () => {
  await vm.shutdown(null);
  vm.fs.unlink('/usr/sbin/getenforce');
  vm.fs.unlink('/etc/logrotate.conf');
  await vm.boot(null);
  assert.ok(vm.fs.exists('/usr/sbin/getenforce'));
  assert.ok(vm.fs.exists('/etc/logrotate.conf'));
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
