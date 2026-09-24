#!/usr/bin/env node
/*
 * Resuelve con su solución de referencia cada ejercicio adicional de JBoss
 * y comprueba que sus verificaciones pasen:  node test/exercises-tests.js
 */
'use strict';
const { L, makeLab, sh } = require('./harness.js');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const lab = await makeLab();
  const vm = await lab.create({ name: 'ej', os: 'rhel9', cpu: 2, ramMB: 4096, diskMB: 20480, jbossDists: ['eap74', 'wf30'], preinstall: true });
  await vm.boot(null);
  const r = new L.Shell(vm, { user: 'root' });
  const run = async (c) => sh(r, c);
  const check = (id) => { const e = L.exercises.find(x => x.id === id); const res = e.checks.map(([d, f]) => { let ok; try { ok = !!f(vm); } catch (x) { ok = 'ERR ' + x.message; } return (ok === true ? '✔ ' : '✘ ') + d + (ok !== true && ok !== false ? ' ' + ok : ''); }); const pass = res.every(x => x.startsWith('✔')); console.log('  ' + (pass ? '\x1b[32m✔\x1b[0m ' : '\x1b[31m✘ ') + id + (pass ? '' : '\x1b[0m\n      ' + res.filter(x => !x.startsWith('✔')).join('\n      '))); return pass; };
  const ids = ['xml-roto', 'puerto-ocupado', 'java-incompatible', 'permisos-log', 'exploded', 'undeploy-marcador', 'empaquetar', 'deshabilitar', 'embed-server', 'backup-config', 'thread-dump', 'jdr', 'usuario-grupo', 'script-monitoreo'];
  const early = ids.filter(id => L.exercises.find(x => x.id === id).checks.every(([, f]) => { try { return f(vm); } catch (e) { return false; } }));
  if (early.length) { console.log('Ejercicios que pasan sin resolverse: ' + early.join(', ')); process.exit(1); }
  await run('sed -i "s/-Xms1303m -Xmx1303m/-Xms256m -Xmx512m/" /opt/jboss-eap-7.4/bin/standalone.conf; ln -s /opt/jboss-eap-7.4 /opt/jboss; dnf install -y java-17-openjdk >/dev/null');
  const ok = {};
  // embed-server (con servidor detenido)
  await run('sudo -u jboss /opt/jboss/bin/jboss-cli.sh --commands="embed-server --server-config=standalone.xml,/system-property=modo.mantenimiento:add(value=true),/subsystem=logging/logger=org.hibernate:add(level=WARN),stop-embedded-server"');
  ok['embed-server'] = check('embed-server');
  // xml roto
  await run('cd /opt/jboss/standalone/configuration && sudo -u jboss cp standalone.xml standalone.xml.bak && sed -i "s|</system-properties>|<system-properties>|" standalone.xml && sudo -u jboss /opt/jboss/bin/standalone.sh > /tmp/arr.txt 2>&1; grep WFLYCTL0085 /opt/jboss/standalone/log/server.log > /tmp/xml-error.txt; cat /tmp/xml-error.txt | cut -c1-150; sudo -u jboss cp standalone.xml.bak standalone.xml');
  // permisos
  await run('chown root:root /opt/jboss/standalone/log; sudo -u jboss /opt/jboss/bin/standalone.sh 2>&1 | head -3');
  await run('chown -R jboss:jboss /opt/jboss/ && sudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &');
  await wait(4500);
  ok['xml-roto'] = check('xml-roto');
  ok['permisos-log'] = check('permisos-log');
  // puerto ocupado
  await run('cd /opt/jboss && sudo -u jboss cp -r standalone standalone3 && sudo -u jboss nohup bin/standalone.sh -Djboss.server.base.dir=/opt/jboss/standalone3 > /dev/null 2>&1 &');
  await wait(4500);
  await run('grep "Address already in use" /opt/jboss/standalone3/log/server.log > /tmp/conflicto.txt; ss -tlnp | grep :8080 | grep -o "pid=[0-9]*" | cut -d= -f2 > /tmp/pid-8080.txt; cat /tmp/pid-8080.txt; tail -1 /opt/jboss/standalone3/log/server.log | cut -c1-140');
  await run('kill $(pgrep -f standalone3 | tail -1)');
  await wait(800);
  ok['puerto-ocupado'] = check('puerto-ocupado');
  // exploded + undeploy + hello
  await run('cd /opt/jboss/standalone/deployments && sudo -u jboss cp /opt/installers/apps/hello.war . && sudo -u jboss mkdir -p miapp.war/WEB-INF && echo "<h1>Explotada</h1>" | sudo -u jboss tee miapp.war/index.html >/dev/null && echo \'<web-app version="5.0"></web-app>\' | sudo -u jboss tee miapp.war/WEB-INF/web.xml >/dev/null && sudo -u jboss touch miapp.war.dodeploy');
  await wait(5600);
  await run('curl -s localhost:8080/miapp/; ls /opt/jboss/standalone/deployments');
  ok['exploded'] = check('exploded');
  await run('rm /opt/jboss/standalone/deployments/hello.war.deployed'); await wait(5600);
  await run('ls /opt/jboss/standalone/deployments; curl -s -o /dev/null -w "%{http_code}\\n" localhost:8080/hello/');
  ok['undeploy-marcador'] = check('undeploy-marcador');
  // empaquetar
  const a = new L.Shell(vm, { user: 'admin' });
  await sh(a, 'mkdir -p ~/tienda/WEB-INF && cd ~ && echo "<h1>Tienda</h1>" > tienda/index.html && echo \'<web-app version="5.0"></web-app>\' > tienda/WEB-INF/web.xml && echo \'<jboss-web><context-root>/tienda</context-root></jboss-web>\' > tienda/WEB-INF/jboss-web.xml && jar -cvf tienda.war -C tienda .');
  await run('/opt/jboss/bin/jboss-cli.sh -c --command="deploy /home/admin/tienda.war"; curl -s localhost:8080/tienda/');
  ok['empaquetar'] = check('empaquetar');
  await run('/opt/jboss/bin/jboss-cli.sh -c --commands="deploy /opt/installers/apps/portal.war,/deployment=portal.war:undeploy,deployment-info"');
  ok['deshabilitar'] = check('deshabilitar');
  await run('mkdir -p /backup && tar -czf /backup/jboss-config-$(date +%Y%m%d).tar.gz -C /opt/jboss/standalone configuration && ls /backup && tar -tzf /backup/jboss-config-*.tar.gz | head -3');
  ok['backup-config'] = check('backup-config');
  await run('PID=$(pgrep -f jboss-modules | head -1); sudo -u jboss jstack $PID > /tmp/threaddump.txt; head -2 /tmp/threaddump.txt');
  ok['thread-dump'] = check('thread-dump');
  await run('sudo -u jboss /opt/jboss/bin/jdr.sh | tail -1');
  ok['jdr'] = check('jdr');
  await run("sudo -u jboss /opt/jboss/bin/add-user.sh -u operador -p 'Oper#2024' -g operadores >/dev/null; grep operador /opt/jboss/standalone/configuration/mgmt-*.properties");
  ok['usuario-grupo'] = check('usuario-grupo');
  await run(`tee /usr/local/bin/check-jboss.sh >/dev/null <<'EOF'
#!/bin/bash
R=$(/opt/jboss/bin/jboss-cli.sh -c --command=":read-attribute(name=server-state)" 2>&1)
if echo "$R" | grep -q running; then
    echo "OK - JBoss en ejecución"
else
    echo "FALLA - $R"
    exit 2
fi
EOF
chmod +x /usr/local/bin/check-jboss.sh; /usr/local/bin/check-jboss.sh > /tmp/estado.txt; cat /tmp/estado.txt`);
  ok['script-monitoreo'] = check('script-monitoreo');
  // java incompatible con WildFly 30
  await run('kill $(pgrep -f jboss-modules); sleep 1; unzip -q /opt/installers/wildfly-30.0.1.Final.zip -d /opt && chown -R jboss:jboss /opt/wildfly-30.0.1.Final && dnf install -y java-1.8.0-openjdk > /dev/null && alternatives --set java /usr/lib/jvm/java-1.8.0-openjdk/bin/java && java -version 2>&1 | head -1; sudo -u jboss /opt/wildfly-30.0.1.Final/bin/standalone.sh > /tmp/java-error.txt 2>&1; grep Unsupported /tmp/java-error.txt | cut -c1-160');
  await run('alternatives --set java /usr/lib/jvm/java-17-openjdk/bin/java && sudo -u jboss nohup /opt/wildfly-30.0.1.Final/bin/standalone.sh > /dev/null 2>&1 &');
  await wait(4000);
  ok['java-incompatible'] = check('java-incompatible');

  // ---------- Ejercicios de los comandos nuevos (VM nueva con EAP 7.4) ----------
  const ids2 = ['selinux-servicio', 'selinux-etiquetas', 'ca-propia', 'keystore', 'api-jq', 'xmllint-puertos', 'analisis-log', 'logrotate-consola', 'sysctl-jboss', 'prioridad'];
  await vm.shutdown(null);
  const vm2 = await lab.create({ name: 'ej2', os: 'rhel9', cpu: 2, ramMB: 4096, diskMB: 20480, jbossDists: ['eap74'], preinstall: true });
  await vm2.boot(null);
  const r2 = new L.Shell(vm2, { user: 'root' });
  const run2 = (c) => sh(r2, c);
  const verify2 = (id) => L.exercises.find(x => x.id === id).checks.map(([d, f]) => { let v; try { v = !!f(vm2); } catch (x) { v = 'ERR ' + x.message; } return [d, v]; });
  const check2 = (id) => { const res = verify2(id); const bad = res.filter(([, v]) => v !== true); console.log('  ' + (bad.length ? '\x1b[31m✘ ' + id + '\x1b[0m\n      ' + bad.map(([d, v]) => '✘ ' + d + (v !== false ? ' ' + v : '')).join('\n      ') : '\x1b[32m✔\x1b[0m ' + id)); return !bad.length; };
  const early2 = ids2.filter(id => verify2(id).every(([, v]) => v === true));
  if (early2.length) { console.log('Ejercicios que pasan sin resolverse: ' + early2.join(', ')); process.exit(1); }
  await run2('sed -i "s/-Xms1303m -Xmx1303m/-Xms256m -Xmx512m/" /opt/jboss-eap-7.4/bin/standalone.conf; ln -s /opt/jboss-eap-7.4 /opt/jboss; dnf install -y java-17-openjdk jq > /dev/null');
  // sysctl
  await run2('printf "net.core.somaxconn = 8192\\nnet.ipv4.tcp_keepalive_time = 600\\nvm.swappiness = 10\\n" > /etc/sysctl.d/90-jboss.conf; sysctl --system > /dev/null');
  ok['sysctl-jboss'] = check2('sysctl-jboss');
  // SELinux: etiquetas
  await run2('sestatus > /tmp/sestatus.txt; touch /root/a.txt /root/b.txt; cp /root/a.txt /opt/demo-cp.txt; mv /root/b.txt /opt/demo-mv.txt; ls -Z /opt/demo-* > /tmp/contextos.txt; restorecon -v /opt/demo-mv.txt; chcon -t httpd_sys_content_t /opt/demo-cp.txt');
  ok['selinux-etiquetas'] = check2('selinux-etiquetas');
  // SELinux: JBoss movido desde /root -> 203/EXEC -> restorecon
  await run2('unzip -q $(ls /opt/installers/*.zip | head -1) -d /root/jb && mv /root/jb/* /opt/jboss-se && chown -R jboss:jboss /opt/jboss-se');
  vm2.fs.write('/etc/systemd/system/jboss-se.service', '[Unit]\nDescription=JBoss\nAfter=network.target\n\n[Service]\nUser=jboss\nExecStart=/opt/jboss-se/bin/standalone.sh -b 0.0.0.0 -Djboss.socket.binding.port-offset=100\n\n[Install]\nWantedBy=multi-user.target\n');
  await run2('systemctl daemon-reload; systemctl start jboss-se');
  if (vm2.unitState('jboss-se').active) { console.log('  jboss-se.service no debería arrancar con admin_home_t'); process.exit(1); }
  await run2('ausearch -m avc > /tmp/avc.txt; restorecon -Rv /opt/jboss-se > /dev/null; systemctl start jboss-se');
  await wait(3500);
  ok['selinux-servicio'] = check2('selinux-servicio');
  // EAP con la consola en /var/log/jboss
  await run2('mkdir -p /var/log/jboss && chown jboss:jboss /var/log/jboss; sudo -u jboss /opt/jboss/bin/add-user.sh -u admin -p "Admin#123" > /dev/null; sudo -u jboss cp /opt/installers/apps/hello.war /opt/jboss/standalone/deployments/; sudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 > /var/log/jboss/console.log 2>&1 &');
  await wait(9000);
  vm2.fs.write('/etc/logrotate.d/jboss', '/var/log/jboss/console.log {\n    daily\n    rotate 7\n    compress\n    missingok\n    copytruncate\n}\n');
  await run2('logrotate -f /etc/logrotate.d/jboss');
  ok['logrotate-consola'] = check2('logrotate-consola');
  // API de gestión + jq
  await run2('U="admin:Admin#123"; E=$(curl -s --digest -u $U "http://localhost:9990/management?operation=attribute&name=server-state" | jq -r .); D=$(curl -s --digest -u $U -d \'{"operation":"read-children-names","child-type":"deployment"}\' http://localhost:9990/management | jq -c .result); jq -n --arg e "$E" --argjson d "$D" \'{estado: $e, despliegues: $d}\' > /tmp/estado.json');
  ok['api-jq'] = check2('api-jq');
  // xmllint
  await run2('cd /opt/jboss/standalone/configuration; xmllint --xpath "//*[local-name()=\'socket-binding\']/@port" standalone.xml > /tmp/puertos.txt; xmllint --xpath "string(//*[local-name()=\'socket-binding\'][@name=\'http\']/@port)" standalone.xml > /tmp/http-port.txt');
  ok['xmllint-puertos'] = check2('xmllint-puertos');
  // análisis de server.log
  await run2('cd /opt/jboss/standalone/log; grep -oE "WFLY[A-Z]+[0-9]{4}" server.log | sort | uniq -c | sort -rn > /tmp/codigos.txt; awk \'$3 ~ /^(INFO|WARN|ERROR)$/ {print $3}\' server.log | sort | uniq -c | column -t > /tmp/niveles.txt');
  ok['analisis-log'] = check2('analisis-log');
  // certificados
  await run2('mkdir -p /root/pki && cd /root/pki && openssl genrsa -out ca.key 4096 2>/dev/null && openssl req -x509 -new -key ca.key -out ca.pem -days 3650 -subj "/O=Lab/CN=Lab CA" && openssl req -new -newkey rsa:2048 -nodes -keyout app.key -out app.csr -subj "/CN=$(hostname -f)" 2>/dev/null && openssl x509 -req -in app.csr -CA ca.pem -CAkey ca.key -out app.pem -days 365 2>/dev/null; openssl verify -CAfile ca.pem app.pem > verify.txt');
  ok['ca-propia'] = check2('ca-propia');
  await run2('cd /root/pki && openssl pkcs12 -export -in app.pem -inkey app.key -name jboss -out app.p12 -passout pass:cambiame && keytool -importcert -alias labca -file ca.pem -keystore truststore.p12 -storepass cambiame -noprompt > /dev/null; keytool -printcert -sslserver localhost:8443 > /tmp/tls.txt');
  ok['keystore'] = check2('keystore');
  // nice / renice
  await run2('nice -n 10 sleep 3600 & PID=$!; renice -n 19 -p $PID > /dev/null; ps -o pid,ni,comm -p $PID > /tmp/prioridad.txt');
  ok['prioridad'] = check2('prioridad');
  ids.push(...ids2);

  const failed = ids.filter(id => !ok[id]);
  console.log('\n' + (ids.length - failed.length) + ' de ' + ids.length + ' ejercicios verificados');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
