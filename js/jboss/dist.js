/*
 * Distribuciones de JBoss simuladas: EAP 7.4, EAP 8.0 y WildFly 30.
 * Genera el árbol de instalación ($JBOSS_HOME) con la misma estructura que
 * el producto real: bin/, standalone/{configuration,deployments,log,data,tmp},
 * domain/, modules/, docs/ ... y los .zip instaladores en /opt/installers.
 *
 * Nota de fidelidad: los valores de WildFly 30.0.1.Final (WildFly Core
 * 22.0.2.Final, -Xms64m -Xmx512m) están verificados contra el código fuente
 * oficial. Los números de versión de esquemas XML y algunos valores de EAP
 * son representativos (ver docs/FIDELIDAD.md).
 */
(function (L) {
  'use strict';

  const DISTS = {
    eap74: {
      id: 'eap74', product: 'JBoss EAP', label: 'JBoss EAP 7.4', version: '7.4.0.GA',
      core: 'WildFly Core 15.0.2.Final-redhat-00001', dir: 'jboss-eap-7.4', zip: 'jboss-eap-7.4.0.zip',
      javaMin: 8, javaMax: 11, domainNs: '16.0', elytronMgmt: false, jakarta: false,
      sizing: '-Xms1303m -Xmx1303m -XX:MetaspaceSize=96M -XX:MaxMetaspaceSize=256m',
      startLine: 'JBoss EAP 7.4.0.GA (WildFly Core 15.0.2.Final-redhat-00001)', consoleName: 'Red Hat JBoss Enterprise Application Platform'
    },
    eap80: {
      id: 'eap80', product: 'JBoss EAP', label: 'JBoss EAP 8.0', version: '8.0.0.GA',
      core: 'WildFly Core 21.0.5.Final-redhat-00001', dir: 'jboss-eap-8.0', zip: 'jboss-eap-8.0.0.zip',
      javaMin: 11, javaMax: 17, domainNs: '20.0', elytronMgmt: true, jakarta: true,
      sizing: '-Xms1303m -Xmx1303m -XX:MetaspaceSize=96M -XX:MaxMetaspaceSize=256m',
      startLine: 'JBoss EAP 8.0.0.GA (WildFly Core 21.0.5.Final-redhat-00001)', consoleName: 'Red Hat JBoss Enterprise Application Platform'
    },
    wf30: {
      id: 'wf30', product: 'WildFly', label: 'WildFly 30', version: '30.0.1.Final',
      core: 'WildFly Core 22.0.2.Final', dir: 'wildfly-30.0.1.Final', zip: 'wildfly-30.0.1.Final.zip',
      javaMin: 11, javaMax: 21, domainNs: '22.0', elytronMgmt: true, jakarta: true,
      sizing: '-Xms64m -Xmx512m -XX:MetaspaceSize=96M -XX:MaxMetaspaceSize=256m',
      startLine: 'WildFly Full 30.0.1.Final (WildFly Core 22.0.2.Final)', consoleName: 'HAL Management Console'
    }
  };

  // ---------- standalone*.xml ----------
  function standaloneXml(d, profile) {
    const full = profile === 'full' || profile === 'full-ha';
    const ha = profile === 'ha' || profile === 'full-ha';
    const mgmt = d.elytronMgmt
      ? `        <management-interfaces>
            <http-interface http-authentication-factory="management-http-authentication">
                <http-upgrade enabled="true" sasl-authentication-factory="management-sasl-authentication"/>
                <socket-binding http="management-http"/>
            </http-interface>
        </management-interfaces>`
      : `        <management-interfaces>
            <http-interface security-realm="ManagementRealm">
                <http-upgrade enabled="true"/>
                <socket-binding http="management-http"/>
            </http-interface>
        </management-interfaces>`;
    const realms = d.elytronMgmt ? '' : `        <security-realms>
            <security-realm name="ManagementRealm">
                <authentication>
                    <local default-user="$local" skip-group-loading="true"/>
                    <properties path="mgmt-users.properties" relative-to="jboss.server.config.dir"/>
                </authentication>
                <authorization map-groups-to-roles="false">
                    <properties path="mgmt-groups.properties" relative-to="jboss.server.config.dir"/>
                </authorization>
            </security-realm>
            <security-realm name="ApplicationRealm">
                <authentication>
                    <local default-user="$local" allowed-users="*" skip-group-loading="true"/>
                    <properties path="application-users.properties" relative-to="jboss.server.config.dir"/>
                </authentication>
                <authorization>
                    <properties path="application-roles.properties" relative-to="jboss.server.config.dir"/>
                </authorization>
            </security-realm>
        </security-realms>
`;
    const ext = ['org.jboss.as.clustering.infinispan', 'org.jboss.as.connector', 'org.jboss.as.deployment-scanner', 'org.jboss.as.ee',
      'org.jboss.as.ejb3', 'org.jboss.as.jaxrs', 'org.jboss.as.jmx', 'org.jboss.as.jpa', 'org.jboss.as.logging', 'org.jboss.as.naming',
      'org.jboss.as.transactions', 'org.wildfly.extension.elytron', 'org.wildfly.extension.io', 'org.wildfly.extension.undertow']
      .concat(full ? ['org.wildfly.extension.messaging-activemq'] : [])
      .concat(ha ? ['org.jboss.as.clustering.jgroups', 'org.wildfly.extension.clustering.web'] : []);
    return `<?xml version='1.0' encoding='UTF-8'?>

<server xmlns="urn:jboss:domain:${d.domainNs}">
    <extensions>
${ext.map(e => '        <extension module="' + e + '"/>').join('\n')}
    </extensions>
    <system-properties>
    </system-properties>
    <management>
${realms}        <audit-log>
            <formatters>
                <json-formatter name="json-formatter"/>
            </formatters>
            <handlers>
                <file-handler name="file" formatter="json-formatter" path="audit-log.log" relative-to="jboss.server.data.dir"/>
            </handlers>
            <logger log-boot="true" log-read-only="false" enabled="false">
                <handlers>
                    <handler name="file"/>
                </handlers>
            </logger>
        </audit-log>
${mgmt}
        <access-control provider="simple">
            <role-mapping>
                <role name="SuperUser">
                    <include>
                        <user name="$local"/>
                    </include>
                </role>
            </role-mapping>
        </access-control>
    </management>
    <profile>
        <subsystem xmlns="urn:jboss:domain:logging:8.0">
            <console-handler name="CONSOLE">
                <level name="INFO"/>
                <formatter>
                    <named-formatter name="COLOR-PATTERN"/>
                </formatter>
            </console-handler>
            <periodic-rotating-file-handler name="FILE" autoflush="true">
                <formatter>
                    <named-formatter name="PATTERN"/>
                </formatter>
                <file relative-to="jboss.server.log.dir" path="server.log"/>
                <suffix value=".yyyy-MM-dd"/>
                <append value="true"/>
            </periodic-rotating-file-handler>
            <logger category="com.arjuna">
                <level name="WARN"/>
            </logger>
            <logger category="io.jaegertracing.Configuration">
                <level name="WARN"/>
            </logger>
            <logger category="org.jboss.as.config">
                <level name="DEBUG"/>
            </logger>
            <logger category="sun.rmi">
                <level name="WARN"/>
            </logger>
            <root-logger>
                <level name="INFO"/>
                <handlers>
                    <handler name="CONSOLE"/>
                    <handler name="FILE"/>
                </handlers>
            </root-logger>
            <formatter name="PATTERN">
                <pattern-formatter pattern="%d{yyyy-MM-dd HH:mm:ss,SSS} %-5p [%c] (%t) %s%e%n"/>
            </formatter>
            <formatter name="COLOR-PATTERN">
                <pattern-formatter pattern="%K{level}%d{HH:mm:ss,SSS} %-5p [%c] (%t) %s%e%n"/>
            </formatter>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:datasources:6.0">
            <datasources>
                <datasource jndi-name="java:jboss/datasources/ExampleDS" pool-name="ExampleDS" enabled="true" use-java-context="true" statistics-enabled="\${wildfly.datasources.statistics-enabled:\${wildfly.statistics-enabled:false}}">
                    <connection-url>jdbc:h2:mem:test;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE</connection-url>
                    <driver>h2</driver>
                    <security user-name="sa" password="sa"/>
                </datasource>
                <drivers>
                    <driver name="h2" module="com.h2database.h2">
                        <xa-datasource-class>org.h2.jdbcx.JdbcDataSource</xa-datasource-class>
                    </driver>
                </drivers>
            </datasources>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:deployment-scanner:2.0">
            <deployment-scanner path="deployments" relative-to="jboss.server.base.dir" scan-interval="5000" runtime-failure-causes-rollback="\${jboss.deployment.scanner.rollback.on.failure:false}"/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:ee:6.0">
            <spec-descriptor-property-replacement>false</spec-descriptor-property-replacement>
            <default-bindings context-service="java:jboss/ee/concurrency/context/default" datasource="java:jboss/datasources/ExampleDS" managed-executor-service="java:jboss/ee/concurrency/executor/default"/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:ejb3:9.0">
            <default-security-domain value="other"/>
        </subsystem>
        <subsystem xmlns="urn:wildfly:elytron:15.0" final-providers="combined-providers" disallowed-providers="OracleUcrypto">
            <security-domains>
                <security-domain name="ApplicationDomain" default-realm="ApplicationRealm" permission-mapper="default-permission-mapper"/>
                <security-domain name="ManagementDomain" default-realm="ManagementRealm" permission-mapper="default-permission-mapper"/>
            </security-domains>
            <security-realms>
                <properties-realm name="ApplicationRealm">
                    <users-properties path="application-users.properties" relative-to="jboss.server.config.dir" digest-realm-name="ApplicationRealm"/>
                    <groups-properties path="application-roles.properties" relative-to="jboss.server.config.dir"/>
                </properties-realm>
                <properties-realm name="ManagementRealm">
                    <users-properties path="mgmt-users.properties" relative-to="jboss.server.config.dir" digest-realm-name="ManagementRealm"/>
                    <groups-properties path="mgmt-groups.properties" relative-to="jboss.server.config.dir"/>
                </properties-realm>
            </security-realms>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:io:3.0">
            <worker name="default"/>
            <buffer-pool name="default"/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:jca:6.0">
            <archive-validation enabled="true" fail-on-error="true" fail-on-warn="false"/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:jmx:1.3">
            <expose-resolved-model/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:naming:2.0">
            <remote-naming/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:transactions:6.0">
            <core-environment node-identifier="\${jboss.tx.node.id:1}">
                <process-id>
                    <uuid/>
                </process-id>
            </core-environment>
            <recovery-environment socket-binding="txn-recovery-environment" status-socket-binding="txn-status-manager"/>
        </subsystem>
        <subsystem xmlns="urn:jboss:domain:undertow:12.0" default-server="default-server" default-virtual-host="default-host" default-servlet-container="default">
            <buffer-cache name="default"/>
            <server name="default-server">
                <http-listener name="default" socket-binding="http" redirect-socket="https" enable-http2="true"/>
                <https-listener name="https" socket-binding="https" ssl-context="applicationSSC" enable-http2="true"/>
                <host name="default-host" alias="localhost">
                    <location name="/" handler="welcome-content"/>
                    <http-invoker http-authentication-factory="application-http-authentication"/>
                </host>
            </server>
            <servlet-container name="default">
                <jsp-config/>
                <websockets/>
            </servlet-container>
            <handlers>
                <file name="welcome-content" path="\${jboss.home.dir}/welcome-content"/>
            </handlers>
        </subsystem>
${full ? `        <subsystem xmlns="urn:jboss:domain:messaging-activemq:13.0">
            <server name="default">
                <jms-queue name="ExpiryQueue" entries="java:/jms/queue/ExpiryQueue"/>
                <jms-queue name="DLQ" entries="java:/jms/queue/DLQ"/>
            </server>
        </subsystem>
` : ''}${ha ? `        <subsystem xmlns="urn:jboss:domain:jgroups:8.0">
            <channels default="ee">
                <channel name="ee" stack="udp" cluster="ejb"/>
            </channels>
        </subsystem>
` : ''}    </profile>
    <interfaces>
        <interface name="management">
            <inet-address value="\${jboss.bind.address.management:127.0.0.1}"/>
        </interface>
        <interface name="public">
            <inet-address value="\${jboss.bind.address:127.0.0.1}"/>
        </interface>
    </interfaces>
    <socket-binding-group name="standard-sockets" default-interface="public" port-offset="\${jboss.socket.binding.port-offset:0}">
        <socket-binding name="ajp" port="\${jboss.ajp.port:8009}"/>
        <socket-binding name="http" port="\${jboss.http.port:8080}"/>
        <socket-binding name="https" port="\${jboss.https.port:8443}"/>
        <socket-binding name="management-http" interface="management" port="\${jboss.management.http.port:9990}"/>
        <socket-binding name="management-https" interface="management" port="\${jboss.management.https.port:9993}"/>
        <socket-binding name="txn-recovery-environment" port="4712"/>
        <socket-binding name="txn-status-manager" port="4713"/>
${ha ? '        <socket-binding name="jgroups-udp" interface="private" port="55200"/>\n' : ''}        <outbound-socket-binding name="mail-smtp">
            <remote-destination host="\${jboss.mail.server.host:localhost}" port="\${jboss.mail.server.port:25}"/>
        </outbound-socket-binding>
    </socket-binding-group>
</server>
`;
  }

  function standaloneConf(d) {
    const name = d.product === 'WildFly' ? 'WildFly' : 'JBoss EAP';
    return `## -*- shell-script -*- ######################################################
##                                                                          ##
##  ${name} Bootstrap Script Configuration${' '.repeat(Math.max(1, 38 - name.length))}##
##                                                                          ##
##############################################################################

#
# This file is optional; it may be removed if not needed.
#

#
# Specify the maximum file descriptor limit, use "max" or "maximum" to use
# the default, as queried by the system.
#
# Defaults to "maximum"
#
#MAX_FD="maximum"

#
# Specify the location of the Java home directory.  If set then $JAVA will
# be defined to $JAVA_HOME/bin/java, else $JAVA will be "java".
#
#JAVA_HOME="/opt/java/jdk"

#
# Specify the exact Java VM executable to use.
#
#JAVA=""

if [ "x$JBOSS_MODULES_SYSTEM_PKGS" = "x" ]; then
   JBOSS_MODULES_SYSTEM_PKGS="org.jboss.byteman"
fi

#
# Specify options to pass to the Java VM.
#
if [ "x$JBOSS_JAVA_SIZING" = "x" ]; then
   JBOSS_JAVA_SIZING="${d.sizing}"
fi
if [ "x$JAVA_OPTS" = "x" ]; then
   JAVA_OPTS="$JBOSS_JAVA_SIZING -Djava.net.preferIPv4Stack=true"
   JAVA_OPTS="$JAVA_OPTS -Djboss.modules.system.pkgs=$JBOSS_MODULES_SYSTEM_PKGS -Djava.awt.headless=true"
else
   echo "JAVA_OPTS already set in environment; overriding default settings with values: $JAVA_OPTS"
fi

# Sample JPDA settings for remote socket debugging
#JAVA_OPTS="$JAVA_OPTS -agentlib:jdwp=transport=dt_socket,address=8787,server=y,suspend=n"

# Uncomment this out to control garbage collection logging
# GC_LOG="true"
`;
  }

  const SCRIPT_MARK = '#JLAB-SCRIPT:';
  function script(kind, d) {
    const title = d.product === 'WildFly' ? 'WildFly' : 'JBoss EAP';
    const bodies = {
      'standalone.sh': `#!/bin/sh\n\n# Use --debug to activate debug mode with an optional argument to specify the port.\n# Usage : standalone.sh --debug\n#         standalone.sh --debug 9797\n\n# ${title} bootstrap script (simulado por el laboratorio)\n${SCRIPT_MARK}standalone\n`,
      'domain.sh': `#!/bin/sh\n# ${title} domain bootstrap script\n${SCRIPT_MARK}domain\n`,
      'jboss-cli.sh': `#!/bin/sh\n# ${title} Command Line Interface\n${SCRIPT_MARK}cli\n`,
      'add-user.sh': `#!/bin/sh\n# Add User Utility\n#\n# A simple utility for adding new users to the properties file used\n# for domain management authentication out of the box.\n${SCRIPT_MARK}add-user\n`,
      'elytron-tool.sh': `#!/bin/sh\n${SCRIPT_MARK}elytron-tool\n`,
      'jdr.sh': `#!/bin/sh\n# JBoss Diagnostic Reporter\n${SCRIPT_MARK}jdr\n`,
      'vault.sh': `#!/bin/sh\n${SCRIPT_MARK}vault\n`
    };
    return bodies[kind];
  }

  const WEB_XML = (name, extra) => `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="https://jakarta.ee/xml/ns/jakartaee" version="5.0">
    <display-name>${name}</display-name>
    <welcome-file-list>
        <welcome-file>index.html</welcome-file>
    </welcome-file-list>
${extra || ''}</web-app>
`;

  // ---------- Aplicaciones de ejemplo (contenido de los .war) ----------
  function sampleApps() {
    const page = (title, body) => `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${title}</title>\n<style>body{font-family:sans-serif;background:#f4f4f4;padding:40px}h1{color:#c00}.box{background:#fff;padding:20px;border-radius:6px;box-shadow:0 1px 4px #0002}</style></head>\n<body><div class="box"><h1>${title}</h1>${body}</div></body></html>\n`;
    return {
      'hello.war': {
        'index.html': page('Hello JBoss!', '<p>Aplicación <b>hello.war</b> desplegada correctamente.</p><p>Context root: <code>/hello</code></p>'),
        'WEB-INF/web.xml': WEB_XML('hello')
      },
      'inventario.war': {
        'index.html': page('Inventario', '<p>API REST de inventario.</p><p>Requiere el datasource <code>java:jboss/datasources/InventarioDS</code>.</p>'),
        'api/items.json': '[{"id":1,"nombre":"Servidor","stock":4},{"id":2,"nombre":"Switch","stock":12}]\n',
        'WEB-INF/web.xml': WEB_XML('inventario', `    <resource-ref>
        <res-ref-name>jdbc/InventarioDS</res-ref-name>
        <res-type>javax.sql.DataSource</res-type>
        <lookup-name>java:jboss/datasources/InventarioDS</lookup-name>
    </resource-ref>
`),
        'WEB-INF/jboss-web.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<jboss-web>\n    <context-root>/inventario</context-root>\n</jboss-web>\n'
      },
      'portal.war': {
        'index.html': page('Portal Corporativo', '<p>Portal desplegado con context-root personalizado <code>/portal-web</code>.</p>'),
        'WEB-INF/web.xml': WEB_XML('portal'),
        'WEB-INF/jboss-web.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<jboss-web>\n    <context-root>/portal-web</context-root>\n</jboss-web>\n'
      },
      'roto.war': {
        'index.html': page('Roto', '<p>Esta app nunca debería verse.</p>'),
        'WEB-INF/web.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<web-app version="5.0">\n    <display-name>roto</display-name>\n    <servlet>\n        <servlet-name>Main</servlet-name>\n    </web-app>\n'
      }
    };
  }

  function appArchive(files) {
    const entries = [];
    const dirs = new Set();
    for (const p of Object.keys(files)) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    for (const dd of Array.from(dirs).sort()) entries.push({ p: dd, t: 'd', m: 0o755, mt: Date.now() });
    for (const [p, d] of Object.entries(files)) entries.push({ p, t: 'f', m: 0o644, d, mt: Date.now() });
    entries.push({ p: 'META-INF', t: 'd', m: 0o755 }, { p: 'META-INF/MANIFEST.MF', t: 'f', m: 0o644, d: 'Manifest-Version: 1.0\nCreated-By: JBoss Lab\n' });
    return entries;
  }

  // Entradas del árbol completo de instalación (relativas a JBOSS_HOME)
  function installEntries(d) {
    const files = {};
    const add = (p, data, mode, vs) => { files[p] = { data: data || '', mode: mode || 0o644, vs }; };
    for (const s of ['standalone.sh', 'domain.sh', 'jboss-cli.sh', 'add-user.sh', 'elytron-tool.sh', 'jdr.sh']) add('bin/' + s, script(s, d), 0o755);
    add('bin/standalone.conf', standaloneConf(d));
    add('bin/domain.conf', standaloneConf(d).replace(/Bootstrap Script/, 'Domain Bootstrap Script'));
    add('bin/jboss-cli.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<jboss-cli xmlns="urn:jboss:cli:4.0">\n    <default-protocol use-legacy-override="true">remote+http</default-protocol>\n    <default-controller>\n        <protocol>remote+http</protocol>\n        <host>localhost</host>\n        <port>9990</port>\n    </default-controller>\n</jboss-cli>\n');
    add('bin/add-user.properties', '# Configuration for the add-user.sh utility\n');
    add('bin/standalone.bat', '@echo off\nrem Windows script (no se ejecuta en Linux)\n');
    add('bin/client/jboss-cli-client.jar', '', 0o644, 28 * 1024 * 1024);
    add('jboss-modules.jar', '', 0o644, 520 * 1024);
    add('version.txt', d.product === 'WildFly' ? `WildFly - Version ${d.version}\n` : `Red Hat JBoss Enterprise Application Platform - Version ${d.version}\n`);
    add('LICENSE.txt', 'Apache License, Version 2.0 / LGPL (ver licencias del producto real)\n');
    add('copyright.txt', 'Copyright The WildFly Authors / Red Hat, Inc.\n');
    add('README.txt', `${d.label} (instalación simulada por JBoss Virtual Lab)\n\nPara iniciar en modo standalone:\n   ./bin/standalone.sh\n\nConsola de administración: http://localhost:9990\n`);
    add('welcome-content/index.html', `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Welcome to ${d.product}</title><style>body{font-family:sans-serif;margin:0;background:#1a1a1a;color:#eee}header{background:${d.product === 'WildFly' ? '#1c3653' : '#cc0000'};padding:30px}main{padding:30px}a{color:#6cf}</style></head><body><header><h1>Welcome to ${d.product} ${d.version.split('.').slice(0, 2).join('.')}</h1><p>Your ${d.product} is running.</p></header><main><p><a href="/console">Administration Console</a> | <a href="/documentation">Documentation</a></p></main></body></html>\n`);
    // standalone/
    const cfg = 'standalone/configuration/';
    add(cfg + 'standalone.xml', standaloneXml(d, 'default'));
    add(cfg + 'standalone-full.xml', standaloneXml(d, 'full'));
    add(cfg + 'standalone-ha.xml', standaloneXml(d, 'ha'));
    add(cfg + 'standalone-full-ha.xml', standaloneXml(d, 'full-ha'));
    add(cfg + 'standalone-load-balancer.xml', standaloneXml(d, 'default'));
    const hdr = (realm) => `#\n# Properties declaration of users for the realm '${realm}' which is the default realm\n# for new installations. Further authentication mechanism can be configured\n# as part of the <management /> in standalone.xml.\n#\n# Users can be added to this properties file at any time, updates after the server has started\n# will be automatically detected.\n#\n# By default the properties realm expects the entries to be in the format: -\n# username=HEX( MD5( username ':' realm ':' password))\n#\n# A utility script is provided which can be executed from the bin folder to add the users: -\n# - Linux\n#  bin/add-user.sh\n#\n#$REALM_NAME=${realm}$ This line is used by the add-user utility to identify the realm name already used in this file.\n#\n`;
    add(cfg + 'mgmt-users.properties', hdr('ManagementRealm'), 0o600);
    add(cfg + 'mgmt-groups.properties', '#\n# Properties declaration of users groups for the realm \'ManagementRealm\'.\n#\n# username=group1,group2\n#\n', 0o600);
    add(cfg + 'application-users.properties', hdr('ApplicationRealm'), 0o600);
    add(cfg + 'application-roles.properties', '#\n# Properties declaration of users roles for the realm \'ApplicationRealm\'.\n#\n', 0o600);
    add(cfg + 'logging.properties', '# Note this file has been generated and will be overwritten if a\n# logging subsystem has been defined in the XML configuration.\nloggers=sun.rmi,com.arjuna\nlogger.level=INFO\nlogger.handlers=CONSOLE,FILE\n');
    add(cfg + 'application.keystore', '', 0o644, 2300);
    add('standalone/deployments/README.txt', `If the deployment scanner is enabled, deployments placed in this directory are
automatically deployed.

Marker files (la extensión se agrega al nombre del archivo desplegado):

 .dodeploy     -- Placed by the user to indicate that the given content should
                  be deployed into the runtime (or redeployed if already deployed).
 .skipdeploy   -- Disables auto-deploy of the content for as long as the file
                  is present.
 .isdeploying  -- Placed by the deployment scanner service to indicate that it
                  has noticed a .dodeploy file or new or updated auto-deploy mode
                  content and is in the process of deploying the content.
 .deployed     -- Placed by the deployment scanner service to indicate that the
                  given content has been deployed. If you delete this file, the
                  content will be undeployed.
 .failed       -- Placed by the deployment scanner service to indicate that the
                  given content failed to deploy. The content of the file will
                  include some information about the cause of the failure.
 .isundeploying-- Placed by the deployment scanner service to indicate that it
                  has noticed a .deployed file has been deleted and the
                  content is being undeployed.
 .undeployed   -- Placed by the deployment scanner service to indicate that the
                  given content has been undeployed. If you delete this file,
                  it has no impact.
 .pending      -- Placed by the deployment scanner service to indicate that it
                  has noticed the need to deploy content but has not yet
                  instructed the server to deploy it.
`);
    // domain/
    add('domain/configuration/domain.xml', `<?xml version='1.0' encoding='UTF-8'?>\n<domain xmlns="urn:jboss:domain:${d.domainNs}">\n    <!-- Modo dominio: no simulado en este laboratorio (solo standalone) -->\n</domain>\n`);
    add('domain/configuration/host.xml', `<?xml version='1.0' encoding='UTF-8'?>\n<host xmlns="urn:jboss:domain:${d.domainNs}" name="primary">\n</host>\n`);
    // modules/
    const mod = (m, main, jar, size) => {
      const p = 'modules/system/layers/base/' + m.replace(/\./g, '/') + '/main/';
      add(p + 'module.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<module name="${m}" xmlns="urn:jboss:module:1.9">\n    <resources>\n        <resource-root path="${jar}"/>\n    </resources>\n    <dependencies>\n        <module name="javax.api"/>\n        <module name="javax.transaction.api"/>\n    </dependencies>\n</module>\n`);
      add(p + jar, '', 0o644, size);
    };
    mod('com.h2database.h2', 'h2', 'h2-2.2.224.jar', 2600000);
    mod('org.jboss.as.server', 'server', 'wildfly-server.jar', 1800000);
    mod('io.undertow.core', 'undertow', 'undertow-core.jar', 2400000);
    mod('org.jboss.logmanager', 'logmanager', 'jboss-logmanager.jar', 400000);
    add('modules/system/layers/base/.overlays/.overlays', '');
    add('docs/schema/README.txt', 'XML schemas\n');
    add('docs/contrib/scripts/systemd/README', `Ejemplo de servicio systemd para ${d.label}.\n\n1. Copie launch.sh a $JBOSS_HOME/bin\n2. Copie ${d.product === 'WildFly' ? 'wildfly' : 'jboss-eap'}.service a /etc/systemd/system/\n3. Cree el usuario de servicio y ajuste permisos: chown -R jboss:jboss $JBOSS_HOME\n4. systemctl daemon-reload && systemctl enable --now ${d.product === 'WildFly' ? 'wildfly' : 'jboss-eap'}\n`);
    const svc = d.product === 'WildFly' ? 'wildfly' : 'jboss-eap';
    add(`docs/contrib/scripts/systemd/${svc}.service`, `[Unit]\nDescription=${d.label} Application Server\nAfter=syslog.target network.target\nBefore=httpd.service\n\n[Service]\nEnvironment=LAUNCH_JBOSS_IN_BACKGROUND=1\nUser=jboss\nGroup=jboss\nLimitNOFILE=102642\nPIDFile=/run/${svc}/${svc}.pid\nExecStart=/opt/${d.dir}/bin/standalone.sh -c standalone.xml -b 0.0.0.0\nStandardOutput=null\n\n[Install]\nWantedBy=multi-user.target\n`);
    add('docs/contrib/scripts/systemd/launch.sh', '#!/bin/bash\n# Script de lanzamiento de ejemplo\n' + SCRIPT_MARK + 'launch\n', 0o755);
    add('.installation/README', 'installation metadata\n');
    // árbol → entradas de archivo
    const entries = [];
    const dirs = new Set(['standalone/deployments', 'standalone/log', 'standalone/data', 'standalone/tmp', 'standalone/lib/ext', 'domain/data', 'domain/log', 'domain/tmp']);
    for (const p of Object.keys(files)) {
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    for (const dd of Array.from(dirs).sort()) {
      const parts = dd.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        if (!entries.find(e => e.p === d.dir + '/' + sub)) entries.push({ p: d.dir + '/' + sub, t: 'd', m: 0o755 });
      }
    }
    entries.unshift({ p: d.dir, t: 'd', m: 0o755 });
    for (const [p, f] of Object.entries(files)) {
      const e = { p: d.dir + '/' + p, t: 'f', m: f.mode, d: f.data };
      if (f.vs) e.vs = f.vs;
      entries.push(e);
    }
    // relleno de modules/ para que el tamaño sea realista (~200MB instalado)
    entries.push({ p: d.dir + '/modules/system/layers/base/.jlab-bulk', t: 'f', m: 0o644, d: '', vs: 190 * 1024 * 1024 });
    return entries;
  }

  // Escribe el .zip instalador en /opt/installers
  function writeInstaller(vfs, distId) {
    const d = DISTS[distId];
    const entries = installEntries(d);
    const data = L.archive.encode('zip', entries, { product: d.product, version: d.version, dist: d.id });
    const p = '/opt/installers/' + d.zip;
    vfs.mkdir('/opt/installers', { parents: true });
    vfs.write(p, data, { vsize: Math.max(data.length, 210 * 1024 * 1024), bin: true });
    return p;
  }

  function writeSampleApps(vfs) {
    vfs.mkdir('/opt/installers/apps', { parents: true });
    for (const [name, files] of Object.entries(sampleApps())) {
      const entries = appArchive(files);
      const data = L.archive.encode('war', entries);
      vfs.write('/opt/installers/apps/' + name, data, { bin: true });
    }
    vfs.write('/opt/installers/apps/LEEME.txt',
      'Aplicaciones de ejemplo para practicar despliegues:\n\n' +
      '  hello.war       - aplicación simple (context-root /hello)\n' +
      '  portal.war      - context-root personalizado en jboss-web.xml (/portal-web)\n' +
      '  inventario.war  - requiere el datasource java:jboss/datasources/InventarioDS\n' +
      '  roto.war        - web.xml mal formado: el despliegue FALLA (práctica de diagnóstico)\n\n' +
      'Puedes crear tus propias apps:  mkdir -p miapp/WEB-INF && ... && jar -cvf miapp.war -C miapp .\n');
  }

  // Instala directamente (VM creada con "JBoss preinstalado")
  function installTo(vfs, distId, baseDir, owner) {
    const d = DISTS[distId];
    const arch = { format: 'zip', entries: installEntries(d) };
    L.archive.extract(vfs, baseDir, arch, null, { owner });
    return baseDir + '/' + d.dir;
  }

  // Detecta una instalación a partir de la ruta de un script (…/bin/standalone.sh)
  function detectHome(vfs, scriptPath) {
    const home = L.path.dirname(L.path.dirname(scriptPath));
    let ver = '';
    try { ver = vfs.read(home + '/version.txt'); } catch (e) { return null; }
    const dist = Object.values(DISTS).find(d => ver.includes(d.version)) || DISTS.eap74;
    return { home, dist };
  }

  L.jboss = L.jboss || {};
  Object.assign(L.jboss, { DISTS, standaloneXml, standaloneConf, SCRIPT_MARK, installEntries, writeInstaller, writeSampleApps, installTo, detectHome, sampleApps, appArchive });
})(globalThis.JLab = globalThis.JLab || {});
