# Fidelidad de la simulación

El motor simulado busca que lo que practiques se comporte como en un servidor real. Este documento distingue lo **verificado contra fuentes oficiales** de lo **representativo o aproximado**.

## Verificado

| Dato | Valor en el laboratorio | Fuente |
|---|---|---|
| WildFly 30.0.1.Final usa WildFly Core | 22.0.2.Final | `pom.xml` del tag `30.0.1.Final` en github.com/wildfly/wildfly (`version.org.wildfly.core`) |
| Heap por defecto de WildFly 30 | `JBOSS_JAVA_SIZING="-Xms64m -Xmx512m -XX:MetaspaceSize=96M -XX:MaxMetaspaceSize=256m"` | `core-feature-pack/common/src/main/resources/content/bin/standalone.conf`, tag `22.0.2.Final` de wildfly-core |
| Estructura de `standalone.conf` (`JBOSS_JAVA_SIZING`, `JAVA_OPTS`, `JBOSS_MODULES_SYSTEM_PKGS`) | Igual que el archivo original | Mismo archivo de wildfly-core |
| Código de arranque | `WFLYSRV0049 … starting` | Mensaje conocido del arranque de WildFly/EAP |
| Formato de `mgmt-users.properties` | `usuario=HEX(MD5(usuario:realm:clave))` | Comentario de cabecera del propio archivo en WildFly/EAP |
| Puertos por defecto | http 8080, https 8443, management-http 9990, management-https 9993, ajp 8009, txn 4712/4713 | `socket-binding-group standard-sockets` de `standalone.xml` |
| Marcadores del deployment-scanner | `.dodeploy .skipdeploy .isdeploying .deployed .failed .isundeploying .undeployed .pending` | `standalone/deployments/README.txt` de WildFly/EAP |
| XPath sin prefijo sobre un XML con namespace por defecto | `xmllint --xpath "//socket-binding"` → `XPath set is empty`; se usa `//*[local-name()='…']` | Comportamiento de XPath 1.0 (W3C, sección 2.3: un nombre sin prefijo no usa el namespace por defecto), implementado así por libxml2 |
| API HTTP de gestión | `GET /management/...?operation=attribute&name=…` y `POST /management` con JSON `{"operation":…,"address":[…]}`, autenticación Digest en el puerto 9990 | WildFly Admin Guide, sección *HTTP Management API* |
| Contexto SELinux de `/opt` y de `/root` | `usr_t` y `admin_home_t`; `mv` conserva la etiqueta y `cp` hereda la del destino | Red Hat, *Using SELinux* (RHEL 9), capítulo sobre etiquetado y `restorecon` |
| Fallo de systemd al ejecutar un binario mal etiquetado | `status=203/EXEC` + AVC `denied { execute }` en `audit.log` | Códigos de salida de systemd (`systemd.exec(5)`, `EXIT_EXEC` = 203) |
| Error de `openssl s_client` con autofirmado | `Verify return code: 18 (self-signed certificate)` | `openssl-verification-options(1)`, OpenSSL 3.x (`X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT`) |
| Emulador v86 | 32 bits, licencia BSD-2-Clause | github.com/copy/v86 (paquete npm `v86` 0.5.462) |

## Representativo o aproximado

- **Heap por defecto de EAP (1303m)**: EAP usa `-Xms1303m -Xmx1303m` desde la versión 6.1 (dato documentado en foros de la comunidad JBoss). Para EAP 8.0 se usa el mismo valor, pero **no se verificó** contra el archivo del producto.
- **Versiones de Core de EAP** (15.0.2 para 7.4, 21.0.5 para 8.0) y **números de versión de los esquemas XML** (`urn:jboss:domain:16.0`, `datasources:6.0`, `undertow:12.0`, …): representativos. El laboratorio no valida el esquema, solo que el XML esté bien formado y la estructura necesaria.
- **Mensajes de error**: se usan los códigos reales más comunes (WFLYCTL0013, WFLYCTL0085, WFLYCTL0212, WFLYCTL0216, WFLYCTL0412, WFLYSRV0010, WFLYSRV0025, WFLYSRV0026, WFLYSRV0050, WFLYSRV0153, WFLYUT0006, WFLYUT0021, WFLYJCA0001, WFLYPRT0053…). El texto que los acompaña está simplificado.
- **Versiones de Java mínimas**: EAP 7.4 ≥ 8, EAP 8.0 ≥ 11, WildFly 30 ≥ 11. Si la versión de Java es menor, se reproduce el error `UnsupportedClassVersionError`.
- **Kernel y versiones de paquetes** de RHEL 9.4 / 8.10 / Rocky 9.4: representativos.
- **Modo dominio** (`domain.sh`) no está simulado.
- **Aplicaciones**: los `.war` son archivos empaquetados del laboratorio (texto JSON). No se ejecuta Java real: el servidor sirve el contenido estático e interpreta `web.xml` y `jboss-web.xml` (context-root y resource-ref).
- **Rendimiento, GC, hilos**: simulados de forma aproximada (sirven para practicar comandos como `top`, `jstack`, `jcmd`).
- **Criptografía**: `openssl` y `keytool` usan claves y firmas **simuladas**. El contenido PEM/PKCS12 es un formato interno del laboratorio. Los encabezados (`-----BEGIN CERTIFICATE-----`), los flujos y los mensajes imitan a los reales, pero los archivos no sirven fuera del laboratorio (ni al revés).
- **SELinux**: solo se aplica la regla de ejecución de servicios de systemd y el etiquetado por ruta. No hay política completa, booleanos ni `semanage`.
- **`jq`**: implementa un subconjunto (rutas, `select`, `map`, `keys`, `to_entries`, `sort_by`, `group_by`, `test`, `split/join`, `if`, construcción de objetos y arreglos, `--arg`, `-r -c -n -s -e`). Filtros más avanzados (`reduce`, `path`, `@csv`…) responden con error de compilación.
- **`sysctl`, `nmcli`, `traceroute`, `jstat`, `jinfo`**: los valores son representativos. Por ejemplo, `vm.swappiness = 30` corresponde al perfil `virtual-guest` de tuned; el kernel usa 60 por defecto.

Si encuentras una diferencia con el producto real, las definiciones están en `js/jboss/dist.js` (plantillas), `js/jboss/server.js` (arranque, scanner y logs) y `js/jboss/model.js` (operaciones de gestión).
