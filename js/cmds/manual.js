/*
 * Manual en español: `man <comando>` y `help`.
 * Cada entrada: [sinopsis, descripción, opciones más usadas, ejemplos].
 */
(function (L) {
  'use strict';
  const C = L.cmds;
  const M = {
    ls: ['ls [OPCIÓN]... [ARCHIVO]...', 'Lista el contenido de directorios.', ['-l  formato largo (permisos, dueño, tamaño, fecha)', '-a  incluye archivos ocultos (que empiezan con .)', '-h  tamaños legibles (K, M, G) junto con -l', '-t  ordena por fecha de modificación', '-R  recursivo', '-d  muestra el directorio, no su contenido'], ['ls -lah /opt', 'ls -ltr $JBOSS_HOME/standalone/log']],
    cd: ['cd [DIRECTORIO]', 'Cambia el directorio de trabajo. Sin argumentos va a $HOME; "cd -" vuelve al anterior.', [], ['cd /opt/jboss-eap-7.4', 'cd ..', 'cd ~']],
    pwd: ['pwd', 'Muestra la ruta absoluta del directorio actual.', [], ['pwd']],
    mkdir: ['mkdir [-p] [-m MODO] DIRECTORIO...', 'Crea directorios.', ['-p  crea los padres necesarios y no falla si ya existe', '-m  permisos iniciales (p. ej. 750)'], ['mkdir -p /opt/apps/logs', 'mkdir -m 750 /srv/jboss']],
    rm: ['rm [-rfiv] ARCHIVO...', 'Elimina archivos o directorios (con -r). No hay papelera: cuidado.', ['-r  recursivo', '-f  forzar, sin preguntar ni error si no existe', '-i  pedir confirmación'], ['rm -rf /tmp/prueba', 'rm $JBOSS_HOME/standalone/deployments/app.war']],
    cp: ['cp [-rapv] ORIGEN... DESTINO', 'Copia archivos y directorios.', ['-r  recursivo', '-p  conserva permisos/dueño/fecha', '-a  modo archivo (= -rp)'], ['cp /opt/installers/apps/hello.war $JBOSS_HOME/standalone/deployments/', 'cp -p standalone.xml standalone.xml.bak']],
    mv: ['mv ORIGEN... DESTINO', 'Mueve o renombra archivos.', [], ['mv app.war app-v2.war', 'mv *.log /var/tmp/']],
    touch: ['touch ARCHIVO...', 'Crea un archivo vacío o actualiza su fecha. Útil para marcadores del deployment-scanner.', [], ['touch deployments/hello.war.dodeploy']],
    cat: ['cat [-n] [ARCHIVO]...', 'Concatena y muestra archivos.', ['-n  numera las líneas'], ['cat /etc/os-release', 'cat -n standalone.conf']],
    head: ['head [-n N] [ARCHIVO]...', 'Muestra las primeras N líneas (10 por defecto).', [], ['head -20 server.log']],
    tail: ['tail [-n N] [-f] [ARCHIVO]...', 'Muestra las últimas líneas; con -f sigue el archivo en vivo (Ctrl+C para salir).', ['-f  seguir el archivo (muy usado con server.log)', '-n  número de líneas'], ['tail -f $JBOSS_HOME/standalone/log/server.log', 'tail -n 100 server.log | grep ERROR']],
    less: ['less ARCHIVO', 'Paginador: espacio/b avanzar/retroceder, /texto buscar, n siguiente, g/G inicio/fin, q salir.', [], ['less /var/log/messages']],
    grep: ['grep [OPCIÓN]... PATRÓN [ARCHIVO]...', 'Busca líneas que coinciden con un patrón (expresión regular).', ['-i  ignora mayúsculas', '-v  invierte (líneas que NO coinciden)', '-n  número de línea', '-c  cuenta coincidencias', '-r  recursivo', '-E  regex extendida (a|b, +, ?)', '-A/-B/-C N  contexto después/antes/alrededor', '-o  solo la parte que coincide', '-l  solo nombres de archivo'], ['grep -n ERROR server.log', 'grep -E "WFLYSRV0010|WFLYSRV0025" server.log', 'grep -rl "ExampleDS" $JBOSS_HOME/standalone/configuration', 'ps -ef | grep java']],
    find: ['find [RUTA...] [EXPRESIÓN]', 'Busca archivos en un árbol de directorios.', ['-name PATRÓN   por nombre (con comodines entre comillas)', '-type f|d|l    tipo', '-size +10M     por tamaño', '-mtime -1      modificados hace menos de 1 día', '-user USUARIO  por propietario', '-exec CMD {} \\;  ejecuta un comando por resultado', '-delete        elimina'], ['find / -name "*.war" 2>/dev/null', 'find $JBOSS_HOME/standalone/log -name "*.log" -mtime +7 -delete', 'find /opt -user root -type d']],
    chmod: ['chmod [-R] MODO ARCHIVO...', 'Cambia permisos. Octal: r=4 w=2 x=1 (dueño/grupo/otros). Simbólico: u,g,o,a con +,-,=.', ['-R  recursivo'], ['chmod 750 /opt/apps', 'chmod +x bin/*.sh', 'chmod -R g+w standalone/']],
    chown: ['chown [-R] USUARIO[:GRUPO] ARCHIVO...', 'Cambia el propietario (solo root).', ['-R  recursivo'], ['chown -R jboss:jboss /opt/jboss-eap-7.4']],
    ln: ['ln -s DESTINO NOMBRE_ENLACE', 'Crea enlaces. Con -s crea un enlace simbólico (acceso directo).', [], ['ln -s /opt/jboss-eap-7.4 /opt/jboss']],
    tar: ['tar [-czxtvf] ARCHIVO [RUTAS]', 'Empaqueta/desempaqueta archivos .tar y .tar.gz.', ['-c crear  -x extraer  -t listar', '-z gzip  -v detallado  -f archivo  -C directorio destino'], ['tar -czvf backup-config.tar.gz standalone/configuration', 'tar -xzvf backup.tar.gz -C /tmp']],
    unzip: ['unzip [-l] [-o] [-q] ARCHIVO.zip [-d DESTINO]', 'Extrae archivos .zip (instaladores de JBoss). En instalaciones mínimas NO viene instalado: dnf install unzip.', ['-l listar  -d destino  -q silencioso  -o sobrescribir'], ['unzip -q /opt/installers/jboss-eap-7.4.0.zip -d /opt']],
    zip: ['zip -r ARCHIVO.zip RUTAS', 'Crea archivos .zip.', [], ['zip -r logs.zip standalone/log']],
    jar: ['jar -cvf APP.war -C DIR .', 'Empaqueta aplicaciones Java (.jar/.war). También lista (-tf) y extrae (-xf).', [], ['jar -cvf miapp.war -C miapp .', 'jar -tf hello.war']],
    ps: ['ps [aux | -ef] [-p PID] [-u USUARIO]', 'Lista procesos.', ['aux  todos los procesos, formato BSD', '-ef  todos, formato completo', '-o pid,cmd  columnas personalizadas'], ['ps -ef | grep java', 'ps aux --sort=-%mem | head']],
    kill: ['kill [-SEÑAL] PID...', 'Envía señales a procesos. 15 (TERM) pide apagado ordenado; 9 (KILL) mata inmediatamente.', [], ['kill 1234', 'kill -9 1234', 'kill -l']],
    top: ['top [-b -n N]', 'Monitor de procesos en tiempo real. q salir, M ordenar por memoria, P por CPU.', [], ['top', 'top -b -n 1 | head -15']],
    free: ['free [-h|-m]', 'Muestra la memoria RAM y swap.', ['-h legible  -m en MiB'], ['free -h']],
    df: ['df [-h] [-T]', 'Espacio usado/disponible en los sistemas de archivos.', [], ['df -h']],
    du: ['du [-sh] [--max-depth=N] RUTA...', 'Uso de disco de archivos y directorios.', [], ['du -sh $JBOSS_HOME/standalone/*', 'du -h --max-depth=1 /opt']],
    systemctl: ['systemctl COMANDO [UNIDAD]', 'Gestiona servicios systemd.', ['start|stop|restart|status UNIDAD', 'enable|disable [--now] UNIDAD   arranque automático', 'daemon-reload   recarga unidades tras editarlas', 'list-units --type=service'], ['systemctl status firewalld', 'systemctl daemon-reload && systemctl enable --now jboss', 'systemctl is-active jboss']],
    journalctl: ['journalctl [-u UNIDAD] [-f] [-n N] [-xe]', 'Consulta el registro de systemd.', [], ['journalctl -u jboss -n 50', 'journalctl -xe']],
    useradd: ['useradd [-m] [-d HOME] [-s SHELL] [-G GRUPOS] [-r] USUARIO', 'Crea usuarios (root).', ['-r cuenta de sistema  -s shell (/sbin/nologin para servicios)  -G grupos suplementarios'], ['useradd -r -m -d /opt/jboss -s /bin/bash jboss', 'useradd -G wheel operador']],
    usermod: ['usermod [-aG GRUPOS] [-s SHELL] [-L|-U] USUARIO', 'Modifica usuarios.', [], ['usermod -aG wheel operador']],
    passwd: ['passwd [USUARIO] | echo PASS | passwd --stdin USUARIO', 'Cambia contraseñas.', [], ['passwd', 'echo "Redhat#123" | passwd --stdin jboss']],
    sudo: ['sudo [-u USUARIO] [-i] COMANDO', 'Ejecuta como otro usuario (root por defecto). Requiere pertenecer al grupo wheel o a /etc/sudoers.', [], ['sudo dnf install unzip', 'sudo -u jboss ./standalone.sh', 'sudo -i']],
    su: ['su [-] [USUARIO] [-c COMANDO]', 'Cambia de usuario. "su -" carga el entorno de login.', [], ['su - jboss', 'su - root -c "systemctl restart jboss"']],
    dnf: ['dnf [-y] install|remove|list|search|info|provides PAQUETE', 'Gestor de paquetes (repositorio local simulado).', [], ['sudo dnf install -y java-17-openjdk unzip', 'dnf provides netstat', 'dnf list installed | grep java']],
    alternatives: ['alternatives --config java | --display java', 'Selecciona la versión por defecto de Java cuando hay varias instaladas.', [], ['sudo alternatives --config java', 'java -version']],
    java: ['java -version', 'Máquina virtual Java (OpenJDK). JBoss la necesita para arrancar.', [], ['java -version', 'readlink -f $(which java)']],
    jps: ['jps [-l] [-v]', 'Lista procesos Java.', [], ['jps -v']],
    jstack: ['jstack PID', 'Volcado de hilos (thread dump) de un proceso Java. Útil ante bloqueos.', [], ['jstack $(pgrep -f jboss-modules) > /tmp/threads.txt']],
    jcmd: ['jcmd PID COMANDO', 'Diagnóstico de la JVM: GC.heap_info, VM.flags, Thread.print, GC.run.', [], ['jcmd 1234 GC.heap_info']],
    curl: ['curl [-i|-I|-v] [-s] [-o ARCHIVO] [-u USER:PASS] URL', 'Cliente HTTP. Ideal para probar despliegues.', ['-I solo cabeceras  -i incluye cabeceras  -s silencioso  -L sigue redirecciones  -w "%{http_code}"'], ['curl -I http://localhost:8080/hello/', 'curl -s -o /dev/null -w "%{http_code}\\n" http://jboss02:8080/', 'curl --digest -u admin:Admin#123 http://localhost:9990/management']],
    wget: ['wget [-O ARCHIVO] URL', 'Descarga archivos por HTTP.', [], ['wget http://localhost:8080/hello/index.html']],
    ping: ['ping [-c N] HOST', 'Verifica conectividad (ICMP). Ctrl+C para detener.', [], ['ping -c 3 jboss02']],
    ss: ['ss -tlnp', 'Muestra sockets en escucha (reemplazo moderno de netstat).', ['-t TCP  -l en escucha  -n numérico  -p proceso'], ['ss -tlnp | grep java', 'sudo ss -tlnp']],
    netstat: ['netstat -tlnp', 'Sockets en escucha (paquete net-tools).', [], ['sudo netstat -tlnp']],
    ip: ['ip addr | ip route | ip neigh', 'Configuración de red.', [], ['ip a', 'ip route']],
    ssh: ['ssh [-p PUERTO] [USUARIO@]HOST [COMANDO]', 'Conexión remota a otra VM del laboratorio.', [], ['ssh admin@jboss02', 'ssh jboss02 "systemctl status jboss"']],
    scp: ['scp [-r] ORIGEN [USUARIO@]HOST:DESTINO', 'Copia archivos entre VMs por SSH.', [], ['scp app.war admin@jboss02:/tmp/', 'scp -r admin@jboss02:/opt/jboss-eap-7.4/standalone/log .']],
    'ssh-keygen': ['ssh-keygen', 'Genera un par de claves SSH (~/.ssh/id_rsa y id_rsa.pub).', [], ['ssh-keygen', 'ssh-copy-id admin@jboss02']],
    'firewall-cmd': ['firewall-cmd [--permanent] --add-port=N/tcp | --reload | --list-all', 'Administra firewalld. Sin --permanent el cambio se pierde al recargar/reiniciar; con --permanent no aplica hasta --reload.', [], ['sudo firewall-cmd --permanent --add-port=8080/tcp', 'sudo firewall-cmd --reload', 'sudo firewall-cmd --list-all']],
    sed: ['sed [-n] [-i] [-E] SCRIPT [ARCHIVO]', 'Editor de flujo: sustituciones y filtrado de líneas.', ['s/viejo/nuevo/g  sustituir', '-i  editar el archivo en sitio (¡haga copia antes!)', '-n "10,20p"  imprimir rango', '/patrón/d  borrar líneas'], ['sed -i "s/-Xmx1303m/-Xmx512m/" bin/standalone.conf', 'sed -n "/ERROR/p" server.log']],
    awk: ['awk [-F SEP] \'PROGRAMA\' [ARCHIVO]', 'Procesa texto por columnas ($1, $2... NF, NR).', [], ['awk \'{print $1, $3}\' archivo', 'grep ERROR server.log | awk \'{print $4}\' | sort | uniq -c', 'awk -F: \'$3>=1000 {print $1}\' /etc/passwd']],
    sort: ['sort [-n] [-r] [-k N] [-u]', 'Ordena líneas.', [], ['du -s * | sort -n', 'sort -t: -k3 -n /etc/passwd']],
    uniq: ['uniq [-c] [-d]', 'Filtra líneas repetidas consecutivas (use sort antes).', [], ['sort ips.txt | uniq -c | sort -rn']],
    wc: ['wc [-l|-w|-c] [ARCHIVO]', 'Cuenta líneas, palabras y bytes.', [], ['grep -c ERROR server.log', 'ls | wc -l']],
    cut: ['cut -d SEP -f CAMPOS', 'Extrae columnas.', [], ['cut -d: -f1,7 /etc/passwd']],
    xargs: ['xargs [-n N] [-I{}] COMANDO', 'Construye comandos a partir de la entrada.', [], ['find /tmp -name "*.tmp" | xargs rm -f']],
    tee: ['tee [-a] ARCHIVO', 'Escribe la entrada en pantalla y en un archivo a la vez.', [], ['./standalone.sh | tee /tmp/arranque.log']],
    diff: ['diff [-u] ARCHIVO1 ARCHIVO2', 'Compara archivos línea a línea.', [], ['diff -u standalone.xml.bak standalone.xml']],
    vi: ['vi [ARCHIVO]', 'Editor modal. i=insertar, Esc=modo normal, :w guardar, :q salir, :wq guardar y salir, :q! salir sin guardar, dd borrar línea, yy copiar, p pegar, u deshacer, /texto buscar, :%s/a/b/g reemplazar, :set nu números.', [], ['vi $JBOSS_HOME/bin/standalone.conf']],
    nano: ['nano [ARCHIVO]', 'Editor sencillo. ^O guardar, ^X salir, ^K cortar línea, ^U pegar, ^W buscar. (dnf install nano)', [], ['nano /etc/hosts']],
    nohup: ['nohup COMANDO [ARGS] &', 'Ejecuta un comando inmune al cierre de sesión (salida a nohup.out).', [], ['nohup ./standalone.sh -b 0.0.0.0 > /dev/null 2>&1 &']],
    jq: ['jq [-r] [-c] [-n] [--arg nombre valor] FILTRO [ARCHIVO]', 'Procesador de JSON. Ideal con la API HTTP de gestión de JBoss (puerto 9990). Instalar: sudo dnf install jq.', ['.campo  .a.b  .[0]  .[]  acceso a campos y arreglos', '|  encadena filtros; , emite varios resultados', 'select(expr)  map(f)  keys  length  sort_by(.x)  to_entries  has("k")', '-r  salida sin comillas   -c  compacta   -n  sin entrada   --arg n v  variable $n'], ['curl -s --digest -u admin:Admin#123 http://localhost:9990/management/subsystem/datasources?recursive=true | jq \'.["data-source"] | keys\'', 'curl -s --digest -u admin:Admin#123 "http://localhost:9990/management?operation=attribute&name=server-state" | jq -r .', 'curl -s --digest -u admin:Admin#123 -H "Content-Type: application/json" -d \'{"operation":"read-resource","address":[{"deployment":"*"}]}\' http://localhost:9990/management | jq .outcome']],
    xmllint: ['xmllint [--noout] [--format] [--xpath EXPR] ARCHIVO.xml', 'Valida y consulta XML (libxml2). OJO: standalone.xml usa un espacio de nombres por defecto, así que //socket-binding devuelve "XPath set is empty"; use //*[local-name()=\'socket-binding\'].', ['--noout  solo valida que el XML esté bien formado', '--format  reindenta', '--xpath  evalúa XPath: count(), string(), @atributo, [@a=\'v\'], local-name()'], ['xmllint --noout $JBOSS_HOME/standalone/configuration/standalone.xml && echo OK', "xmllint --xpath \"//*[local-name()='socket-binding'][@name='http']/@port\" standalone.xml", "xmllint --xpath \"count(//*[local-name()='datasource'])\" standalone.xml"]],
    column: ['column [-t] [-s SEP] [ARCHIVO]', 'Formatea texto en columnas alineadas.', ['-t  tabla', '-s  separador de entrada', '-o  separador de salida'], ['mount | column -t', 'cut -d: -f1,3,7 /etc/passwd | column -t -s:']],
    comm: ['comm [-123] ARCHIVO1 ARCHIVO2', 'Compara dos archivos ORDENADOS: col.1 solo en el 1, col.2 solo en el 2, col.3 en ambos.', ['-1 -2 -3  ocultar la columna indicada'], ['comm -3 <(sort paquetes-a.txt) <(sort paquetes-b.txt)', 'comm -12 lista1 lista2']],
    fold: ['fold [-w N] [-s] [ARCHIVO]', 'Corta líneas largas a N columnas.', ['-w  ancho (80)', '-s  corta en espacios'], ['fold -w 80 -s server.log | less']],
    shuf: ['shuf [-n N] [-i MIN-MAX] [-e ARG...]', 'Mezcla líneas al azar.', [], ['shuf -n 1 /etc/passwd', 'shuf -i 8000-8999 -n 1']],
    strings: ['strings [-n MIN] ARCHIVO', 'Muestra las cadenas de texto de un binario. Instalar: dnf install binutils.', [], ['strings /usr/bin/java | head']],
    xxd: ['xxd [-l N] [-p] ARCHIVO', 'Volcado hexadecimal (incluido en vim-enhanced).', [], ['echo -n JBoss | xxd']],
    od: ['od [-c|-x|-b] [-A x|d|o|n] ARCHIVO', 'Volcado octal/hexadecimal/caracteres. Útil para ver caracteres invisibles (\\r de Windows).', [], ['od -c standalone.conf | head', 'head -1 script.sh | od -c   # ¿termina en \\r \\n?']],
    hexdump: ['hexdump [-C] [-n N] ARCHIVO', 'Volcado hexadecimal con columna ASCII (-C).', [], ['hexdump -C archivo | head']],
    envsubst: ['envsubst [\'$VAR1 $VAR2\'] < plantilla', 'Sustituye variables de entorno en una plantilla.', [], ['export PUERTO=8180; envsubst < jboss.service.tpl > jboss.service']],
    zgrep: ['zgrep [OPCIONES] PATRÓN ARCHIVO.gz...', 'grep sobre archivos comprimidos (logs rotados).', [], ['zgrep -c ERROR /var/log/messages-*.gz']],
    zless: ['zless ARCHIVO.gz', 'Paginador para archivos comprimidos.', [], ['zless server.log.1.gz']],
    getenforce: ['getenforce', 'Muestra el modo de SELinux: Enforcing, Permissive o Disabled.', [], ['getenforce']],
    setenforce: ['setenforce 0|1', 'Cambia SELinux a Permissive (0) o Enforcing (1) hasta el próximo reinicio. El modo permanente está en /etc/selinux/config. Úsalo solo para diagnosticar: la solución correcta suele ser restorecon.', [], ['sudo setenforce 0   # diagnosticar', 'sudo setenforce 1']],
    sestatus: ['sestatus', 'Estado detallado de SELinux (modo actual y de configuración, política).', [], ['sestatus']],
    chcon: ['chcon [-R] [-t TIPO] CONTEXTO|--reference=REF ARCHIVO', 'Cambia el contexto SELinux de forma temporal (restorecon lo revierte).', [], ['sudo chcon -t usr_t /opt/app/run.sh']],
    restorecon: ['restorecon [-R] [-v] RUTA', 'Restaura la etiqueta SELinux por defecto según la ruta. Solución típica cuando mueves (mv) archivos desde /home o /tmp: mv conserva la etiqueta de origen.', ['-R  recursivo', '-v  muestra cambios', '-n  no cambia nada (simulación)'], ['ls -Z /opt/jboss/bin/standalone.sh', 'sudo restorecon -Rv /opt/jboss-eap-7.4']],
    ausearch: ['ausearch -m avc [-c COMANDO]', 'Busca eventos de auditoría; -m avc muestra las denegaciones de SELinux.', [], ['sudo ausearch -m avc | tail']],
    sysctl: ['sysctl [-a] [-w clave=valor] [-p ARCHIVO] [--system] [clave]', 'Consulta y ajusta parámetros del kernel. Para que persistan, créalos en /etc/sysctl.d/*.conf.', [], ['sysctl vm.swappiness', 'sudo sysctl -w net.core.somaxconn=4096', "echo 'vm.swappiness = 10' | sudo tee /etc/sysctl.d/90-jboss.conf && sudo sysctl --system"]],
    getent: ['getent passwd|group|hosts|services [CLAVE]', 'Consulta las bases de datos del sistema (NSS).', [], ['getent passwd jboss', 'getent hosts jboss02', 'getent services 8080']],
    nice: ['nice [-n AJUSTE] COMANDO', 'Ejecuta con otra prioridad (-20 mayor, 19 menor). Solo root puede subir la prioridad.', [], ['nice -n 10 tar -czf backup.tar.gz /opt/jboss']],
    renice: ['renice [-n] PRIORIDAD -p PID | -u USUARIO', 'Cambia la prioridad de procesos en ejecución.', [], ['sudo renice -n 5 -p $(pgrep -f jboss-modules)']],
    logrotate: ['logrotate [-d] [-f] [-v] [-s ESTADO] CONFIG', 'Rota, comprime y elimina logs según /etc/logrotate.conf y /etc/logrotate.d/. JBoss rota server.log por fecha él mismo; logrotate se usa para otros logs o console.log.', ['-d  simulación (no cambia nada)', '-f  forzar rotación', '-v  detallado', 'Directivas: daily/weekly, rotate N, compress, delaycompress, copytruncate, size, create, dateext, missingok, notifempty, postrotate'], ['sudo logrotate -d /etc/logrotate.conf', 'sudo logrotate -vf /etc/logrotate.d/jboss']],
    locate: ['locate [-i] [-c] [-b] PATRÓN', 'Busca archivos en la base de datos de updatedb (dnf install plocate).', [], ['sudo updatedb && locate standalone.xml']],
    updatedb: ['updatedb', 'Actualiza la base de datos de locate (como root).', [], ['sudo updatedb']],
    whereis: ['whereis [-b] COMANDO', 'Ubica binarios y páginas de manual de un comando.', [], ['whereis java']],
    truncate: ['truncate -s TAMAÑO ARCHIVO', 'Ajusta el tamaño de un archivo. -s 0 vacía un log sin borrarlo (el proceso sigue escribiendo en él).', [], ['sudo truncate -s 0 /opt/jboss/standalone/log/console.log']],
    nmcli: ['nmcli [general|device|connection] [status|show]', 'Consulta NetworkManager (red de RHEL).', [], ['nmcli device status', 'nmcli connection show enp1s0', 'sudo nmcli general hostname jboss01.lab.local']],
    traceroute: ['traceroute [-n] HOST', 'Muestra los saltos hasta un host (dnf install traceroute).', [], ['traceroute jboss02']],
    time: ['time COMANDO', 'Mide cuánto tarda un comando (real, user, sys).', [], ['time curl -s localhost:8080/hello/ > /dev/null']],
    pushd: ['pushd DIR | pushd +N', 'Cambia de directorio guardando el actual en una pila (popd regresa).', [], ['pushd $JBOSS_HOME/standalone/log; ...; popd']],
    popd: ['popd', 'Regresa al último directorio guardado con pushd.', [], ['popd']],
    dirs: ['dirs [-v] [-c]', 'Muestra la pila de directorios.', [], ['dirs -v']],
    hash: ['hash [-r] [COMANDO]', 'Muestra/limpia la caché de rutas de comandos del shell.', [], ['hash', 'hash -r']],
    type: ['type [-a] [-t] NOMBRE', 'Indica qué es un nombre: alias, builtin, función o archivo. -a muestra todas las coincidencias.', [], ['type -a ls', 'type -t cd']],
    openssl: ['openssl COMANDO [OPCIONES]', 'Herramientas TLS: claves, CSR, certificados y pruebas de conexión.', ['genrsa -out key.pem 2048', 'req -new -key key.pem -out app.csr -subj "/CN=host"', 'req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=host"', 'x509 -in cert.pem -noout -subject -issuer -dates -fingerprint', 'x509 -req -in app.csr -CA ca.pem -CAkey ca.key -out app.pem -days 365', 'verify -CAfile ca.pem app.pem', 's_client -connect host:8443', 'pkcs12 -export -in cert.pem -inkey key.pem -out app.p12 -name app', 'rand -hex 16 | dgst -sha256 archivo | version'], ['openssl s_client -connect localhost:8443 </dev/null | openssl x509 -noout -subject -dates', 'openssl req -x509 -newkey rsa:2048 -nodes -keyout jboss.key -out jboss.crt -days 365 -subj "/CN=jboss01.lab.local" -addext "subjectAltName=DNS:jboss01.lab.local,IP:10.0.0.11"']],
    keytool: ['keytool -COMANDO [-keystore ARCHIVO] [-storepass CLAVE] [-alias ALIAS]', 'Administra keystores de Java (PKCS12/JKS) para SSL en JBoss.', ['-genkeypair -alias a -keyalg RSA -keysize 2048 -validity 365 -dname "CN=host"', '-list [-v] [-rfc]', '-exportcert -alias a -file a.crt -rfc', '-importcert -alias ca -file ca.crt [-noprompt]', '-delete -alias a   -printcert -file x.crt | -sslserver host:puerto'], ['keytool -genkeypair -alias jboss -keyalg RSA -keysize 2048 -validity 365 -keystore jboss.p12 -storepass secreto -dname "CN=jboss01.lab.local"', 'keytool -list -v -keystore jboss.p12 -storepass secreto', 'keytool -printcert -sslserver localhost:8443']],
    jstat: ['jstat -gc|-gcutil|-class PID [INTERVALO [CANTIDAD]]', 'Estadísticas de la JVM en vivo (GC, heap, clases).', [], ['jstat -gcutil $(pgrep -f jboss-modules) 1s 5']],
    jinfo: ['jinfo [-flags|-sysprops|-flag NOMBRE] PID', 'Muestra flags y propiedades del sistema de una JVM en ejecución.', [], ['jinfo -flag MaxHeapSize $(pgrep -f jboss-modules)', 'jinfo -sysprops PID | grep jboss']],
    'standalone.sh': ['$JBOSS_HOME/bin/standalone.sh [-c CONFIG] [-b IP] [-bmanagement IP] [-Dprop=valor]', 'Inicia JBoss en modo standalone. En primer plano se detiene con Ctrl+C.', ['-c standalone-full.xml   perfil de configuración', '-b 0.0.0.0               escuchar en todas las interfaces (acceso remoto)', '-bmanagement 0.0.0.0     consola de administración remota', '-Djboss.socket.binding.port-offset=100   desplaza todos los puertos (+100)', '-Djboss.node.name=nodo1  nombre del nodo'], ['./standalone.sh', 'nohup ./standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0 > /dev/null 2>&1 &', './standalone.sh -c standalone-full.xml -Djboss.socket.binding.port-offset=100']],
    'jboss-cli.sh': ['$JBOSS_HOME/bin/jboss-cli.sh [--connect] [--controller=HOST:PUERTO] [--command=CMD] [--file=ARCHIVO]', 'Interfaz de línea de comandos de administración de JBoss.', ['connect, ls, cd, :read-resource, deploy, undeploy, reload, shutdown, module add, embed-server, batch'], ['./jboss-cli.sh --connect', './jboss-cli.sh -c --command=":read-attribute(name=server-state)"', './jboss-cli.sh -c --command="deploy /opt/installers/apps/hello.war"', '/subsystem=datasources/data-source=AppDS:add(jndi-name=java:jboss/datasources/AppDS,driver-name=h2,connection-url=jdbc:h2:mem:app)']],
    'add-user.sh': ['$JBOSS_HOME/bin/add-user.sh [-u USUARIO -p CLAVE] [-a] [-g GRUPOS]', 'Agrega usuarios de gestión (mgmt-users.properties) o de aplicación (-a).', [], ['./add-user.sh', './add-user.sh -u admin -p "Admin#123"']]
  };

  C.man = async (c) => {
    const name = c.args.filter(a => !a.startsWith('-'))[0];
    if (!name) { c.err('What manual page do you want?\nFor example, try \'man man\'.\n'); return 1; }
    if (c.args.includes('-k')) { for (const [k, v] of Object.entries(M)) if (k.includes(name) || v[1].toLowerCase().includes(name.toLowerCase())) c.println(k + ' (1) - ' + v[1]); return 0; }
    const e = M[name] || M[name + '.sh'];
    if (!e) { c.err('No manual entry for ' + name + '\n(Pruebe: help, o ' + name + ' --help)\n'); return 16; }
    const b = (s) => c.isTTY ? '\x1b[1m' + s + '\x1b[0m' : s;
    let t = b(name.toUpperCase() + '(1)') + '                  Manual del Laboratorio                  ' + b(name.toUpperCase() + '(1)') + '\n\n';
    t += b('NOMBRE') + '\n       ' + name + ' - ' + e[1].split('.')[0] + '\n\n';
    t += b('SINOPSIS') + '\n       ' + e[0] + '\n\n';
    t += b('DESCRIPCIÓN') + '\n       ' + e[1] + '\n\n';
    if (e[2].length) t += b('OPCIONES') + '\n' + e[2].map(o => '       ' + o).join('\n') + '\n\n';
    if (e[3].length) t += b('EJEMPLOS') + '\n' + e[3].map(o => '       $ ' + o).join('\n') + '\n\n';
    t += 'JBoss Virtual Lab                         2026                              ' + name + '(1)\n';
    return L.pager(c, t, 'Manual page ' + name + '(1) (press q to quit)');
  };

  C.__help = (c) => {
    const cat = {
      'Archivos y directorios': 'ls cd pwd mkdir rmdir rm cp mv touch cat less head tail ln find stat file tree du df chmod chown chgrp',
      'Texto y datos': 'grep sed awk sort uniq cut tr wc tee xargs diff nl seq rev base64 md5sum sha256sum column comm fold shuf strings xxd od hexdump envsubst zgrep zless jq xmllint',
      'Editores': 'vi vim nano',
      'Procesos y sistema': 'ps top kill pkill pgrep killall jobs fg bg nohup nice renice sleep free uptime uname hostname lscpu lsblk dmesg vmstat sysctl getent date env export locate updatedb whereis truncate logrotate',
      'SELinux': 'getenforce setenforce sestatus ls -Z stat -c %C chcon restorecon ausearch',
      'Usuarios': 'whoami id groups useradd usermod userdel groupadd passwd su sudo who w last',
      'Servicios': 'systemctl journalctl service crontab',
      'Red': 'ip ss netstat nmcli ping traceroute curl wget ssh scp ssh-keygen ssh-copy-id nc telnet nslookup dig firewall-cmd',
      'Paquetes': 'dnf yum rpm alternatives',
      'Compresión': 'tar zip unzip gzip gunzip jar',
      'Java / JBoss': 'java jps jstack jcmd jmap jstat jinfo keytool openssl  $JBOSS_HOME/bin/{standalone.sh, jboss-cli.sh, add-user.sh, jdr.sh}',
      'Shell': 'alias history source export unset set read test [ [[ time pushd popd dirs hash type if for while case function $(...) $((...)) | > >> 2>&1 &&  ||'
    };
    const b = (s) => c.isTTY ? '\x1b[1m' + s + '\x1b[0m' : s, cy = (s) => c.isTTY ? '\x1b[1;36m' + s + '\x1b[0m' : s;
    c.println(b('JBoss Virtual Lab - comandos disponibles') + '  (man <comando> para ayuda detallada en español)\n');
    for (const [k, v] of Object.entries(cat)) c.println(cy(k) + '\n  ' + v + '\n');
    c.println('Atajos: Tab autocompleta, ↑/↓ historial, Ctrl+C interrumpe, Ctrl+L limpia, Ctrl+R no disponible.\nAlgunos comandos requieren instalar su paquete (p. ej. unzip, tree, nano, net-tools): sudo dnf install <paquete>');
    return 0;
  };
  L.manual = M;
})(globalThis.JLab = globalThis.JLab || {});
