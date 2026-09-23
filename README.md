# JBoss Virtual Lab

Laboratorio **100 % local** en el navegador para practicar administración de **Linux (RHEL/Rocky)** y **JBoss EAP / WildFly**: crea máquinas virtuales, entra por terminal, edita archivos, instala JBoss, despliega aplicaciones, usa `jboss-cli.sh`, la consola web, firewalld, systemd, SSH entre VMs… sin servidores ni nube.

Inspirado en [JSLinux](https://bellard.org/jslinux/) de Fabrice Bellard: además del motor simulado, incluye un **emulador x86 real (v86)** que arranca un kernel Linux verdadero desde una ISO de tu equipo.

## Cómo ejecutarlo

1. Descarga o clona el repositorio.
2. Haz **doble clic en `index.html`** (Chrome, Edge o Firefox recientes).

No requiere instalar nada ni conexión a Internet: todas las dependencias están en `vendor/`.

> Opcional: si tu navegador bloquea el almacenamiento en `file://` (p. ej. en modo privado), sirve la carpeta con `python3 -m http.server 8000` y abre `http://localhost:8000`.

## ¿Qué incluye?

| Aplicación | Para qué sirve |
|---|---|
| **Gestor de VMs** | Crear VMs (SO, vCPU, RAM, disco, usuario), encender/apagar/forzar, editar recursos, **snapshots**, **clonar**, **exportar/importar** (.json) y definir la capacidad del **host** |
| **Terminal** | xterm.js con login, bash con historial, Tab, Ctrl+C, tuberías, redirecciones, heredocs, `if/for/while/case`, funciones, `$(…)`, `$((…))`, `{a,b}` |
| **Archivos / Editor** | Explorador con permisos reales (actúa como el usuario elegido) y editor con **validación XML** (útil para `standalone.xml`) |
| **Consola JBoss** | Consola web estilo HAL: despliegues, datasources, propiedades, socket bindings, interfaces, logging, JVM, logs en vivo |
| **Navegador** | Ver las apps desplegadas en `http://<IP-VM>:8080/…` respetando bind address y firewall |
| **Monitor** | Gráficas de CPU/RAM por VM, procesos y puertos |
| **Ejercicios** | 20 retos progresivos (básico → avanzado) con **verificación automática**, pistas y solución |
| **Linux real (v86)** | Emulador x86 con kernel Linux verdadero desde una ISO/bzImage de tu equipo |
| **Guía** | Arquitectura, primeros pasos y atajos |

### Comandos disponibles (≈180)

`ls cd cp mv rm mkdir find grep sed awk sort uniq cut tr wc tee xargs diff tar zip unzip gzip jar chmod chown ln stat du df tree vi nano less ps top kill pkill pgrep free uptime uname lscpu lsblk dmesg vmstat useradd usermod groupadd passwd su sudo systemctl journalctl crontab ip ss netstat ping curl wget ssh scp ssh-keygen ssh-copy-id nc telnet nslookup dig firewall-cmd dnf yum rpm alternatives java jps jstack jcmd jmap keytool man help …`

JBoss: `standalone.sh` (con `-c`, `-b`, `-bmanagement`, `-D…`, `port-offset`, `jboss.server.base.dir`), `jboss-cli.sh` (interactivo y `--command`/`--file`; `cd`, `ls`, operaciones DMR, `deploy`, `undeploy`, `deployment-info`, `module add`, `reload`, `shutdown`, `embed-server`, `batch`), `add-user.sh`, `jdr.sh`.

## Ejemplo aplicado (de cero a app publicada)

```bash
sudo dnf install -y java-17-openjdk unzip
sudo groupadd -r jboss && sudo useradd -r -g jboss -d /opt/jboss -s /bin/bash jboss
sudo unzip -q /opt/installers/jboss-eap-7.4.0.zip -d /opt
sudo ln -s /opt/jboss-eap-7.4 /opt/jboss && sudo chown -R jboss:jboss /opt/jboss-eap-7.4
free -m      # EAP trae -Xms1303m -Xmx1303m: ¿cabe en tu VM?
sudo sed -i "s/-Xms1303m -Xmx1303m/-Xms512m -Xmx1024m/" /opt/jboss/bin/standalone.conf
sudo -u jboss nohup /opt/jboss/bin/standalone.sh -b 0.0.0.0 -bmanagement 0.0.0.0 > /dev/null 2>&1 &
tail -f /opt/jboss/standalone/log/server.log          # espera WFLYSRV0025, luego Ctrl+C
sudo -u jboss cp /opt/installers/apps/hello.war /opt/jboss/standalone/deployments/
curl http://localhost:8080/hello/
sudo firewall-cmd --permanent --add-port=8080/tcp --add-port=9990/tcp && sudo firewall-cmd --reload
```

Después abre el **Navegador** del escritorio en `http://10.0.0.11:8080/hello/`.

## Qué se simula (y cómo se comporta como en la vida real)

- **Recursos**: el host tiene CPU/RAM/disco configurables; una VM no enciende si no hay RAM libre (sin sobreasignación; vCPU hasta 4:1). Cada disco tiene cuota real (`No space left on device`). Si `-Xms` no cabe en la RAM libre, la JVM falla al iniciar.
- **Permisos**: rwx, dueño/grupo, sticky bit, `sudo` solo para `wheel`, `/etc/passwd`, `/etc/group` y `/etc/shadow` reales dentro de la VM.
- **Red**: 10.0.0.0/24 entre VMs; `-b 127.0.0.1` (por defecto) impide el acceso remoto; firewalld distingue reglas *runtime* y *--permanent*.
- **JBoss**: lee `standalone.conf` y `standalone*.xml` (si el XML está mal formado, falla con `WFLYCTL0085`), abre los puertos de `socket-binding-group` + `port-offset`, detecta conflictos (`Address already in use`), escribe `server.log`, maneja el *deployment-scanner* con marcadores `.deployed/.failed/.dodeploy`, datasources, drivers/módulos y despliegues administrados; la CLI y la consola modifican el XML como el controlador real (con `reload-required` cuando corresponde).
- **Persistencia**: los discos de las VMs se guardan en IndexedDB de tu navegador. Al recargar, las VMs que estaban encendidas se “reinician” y JBoss se restaura.

Consulta [`docs/FIDELIDAD.md`](docs/FIDELIDAD.md) para ver qué datos están verificados contra fuentes oficiales y cuáles son aproximados.

## Linux real (v86)

La aplicación **Linux real** carga el emulador [v86](https://github.com/copy/v86) (WebAssembly) y arranca una imagen x86 de **32 bits** que elijas de tu disco (ISO, bzImage, disco o disquete). Funciona también desde `file://`. Imágenes sugeridas: Buildroot `linux4.iso` del proyecto v86, Alpine Linux *virt* x86, Tiny Core Linux. No es apto para JBoss (sería extremadamente lento).

## Estructura

```
index.html              escritorio (abre con doble clic)
css/lab.css             estilos
js/core/                util, XML, sistema de archivos virtual, archivos empaquetados, VM + laboratorio
js/os/system.js         distribuciones, usuarios, paquetes dnf, imagen base
js/jboss/               distribuciones EAP/WildFly, runtime del servidor, modelo de gestión (DMR)
js/shell/               lexer/parser bash, intérprete, terminal/readline
js/cmds/                comandos (archivos, texto, sistema, red, paquetes, JBoss, editores, manual)
js/exercises/           catálogo de ejercicios y verificaciones
js/ui/                  gestor de ventanas y aplicaciones del escritorio
vendor/                 xterm.js (MIT), v86 (BSD-2-Clause) con wasm y BIOS embebidos
test/run-tests.js       pruebas automatizadas del motor (node test/run-tests.js)
docs/                   notas de fidelidad y licencias
```

## Pruebas

```bash
node test/run-tests.js
```

Ejecuta 13 grupos de pruebas sin navegador: VFS y permisos, shell, herramientas de texto, dnf, ciclo de vida de JBoss (memoria insuficiente, arranque, scanner, CLI, reload), red y firewall entre VMs, systemd, ejercicios y exportación.

## Licencias de terceros

Ver [`docs/TERCEROS.md`](docs/TERCEROS.md). JBoss, EAP, WildFly y Red Hat Enterprise Linux son marcas de sus respectivos dueños; este laboratorio es una **simulación educativa** y no contiene software de esos productos.

---

_Repositorio RedHat: desarrollos de Claude/redhat web._
