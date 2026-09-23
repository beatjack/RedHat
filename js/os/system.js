/*
 * Sistema operativo simulado: plantillas de distribución, usuarios/grupos
 * (leídos de /etc/passwd y /etc/group reales dentro del VFS), repositorio de
 * paquetes para dnf/yum y construcción de la imagen base del disco.
 */
(function (L) {
  'use strict';
  const P = L.path;

  // ---------- Distribuciones disponibles ----------
  const OS_TEMPLATES = {
    rhel9: {
      id: 'rhel9', label: 'Red Hat Enterprise Linux 9.4 (simulado)',
      prettyName: 'Red Hat Enterprise Linux 9.4 (Plow)', osId: 'rhel', versionId: '9.4', name: 'Red Hat Enterprise Linux',
      release: 'Red Hat Enterprise Linux release 9.4 (Plow)', kernel: '5.14.0-427.13.1.el9_4.x86_64', pkgMgr: 'dnf', el: 'el9'
    },
    rhel8: {
      id: 'rhel8', label: 'Red Hat Enterprise Linux 8.10 (simulado)',
      prettyName: 'Red Hat Enterprise Linux 8.10 (Ootpa)', osId: 'rhel', versionId: '8.10', name: 'Red Hat Enterprise Linux',
      release: 'Red Hat Enterprise Linux release 8.10 (Ootpa)', kernel: '4.18.0-553.el8_10.x86_64', pkgMgr: 'dnf', el: 'el8'
    },
    rocky9: {
      id: 'rocky9', label: 'Rocky Linux 9.4 (simulado)',
      prettyName: 'Rocky Linux 9.4 (Blue Onyx)', osId: 'rocky', versionId: '9.4', name: 'Rocky Linux',
      release: 'Rocky Linux release 9.4 (Blue Onyx)', kernel: '5.14.0-427.13.1.el9_4.x86_64', pkgMgr: 'dnf', el: 'el9'
    }
  };

  // ---------- Paquetes ----------
  // cmds: comandos que instala en /usr/bin (implementados en JS)
  // files: archivos extra; jvm: instala un JDK con alternatives
  const PACKAGES = {
    'bash': { v: '5.1.8-9', size: 1.7, base: true, desc: 'The GNU Bourne Again shell', cmds: ['bash', 'sh'] },
    'coreutils': {
      v: '8.32-35', size: 6.1, base: true, desc: 'A set of basic GNU tools commonly used in shell scripts',
      cmds: ['ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln', 'pwd', 'echo', 'printf', 'head', 'tail',
        'wc', 'sort', 'uniq', 'cut', 'tr', 'tee', 'basename', 'dirname', 'realpath', 'readlink', 'stat', 'du', 'df', 'date', 'sleep',
        'whoami', 'id', 'groups', 'uname', 'env', 'printenv', 'seq', 'yes', 'true', 'false', 'test', '[', 'nl', 'rev', 'base64',
        'md5sum', 'sha256sum', 'nproc', 'mktemp', 'install', 'timeout', 'nohup', 'stdbuf', 'who', 'tac', 'paste', 'split', 'expr', 'hostid', 'dd']
    },
    'util-linux': { v: '2.37.4-18', size: 4.2, base: true, desc: 'Collection of basic system utilities', cmds: ['lsblk', 'lscpu', 'dmesg', 'more', 'kill', 'su', 'logger', 'cal', 'mount', 'findmnt', 'last', 'script', 'rename', 'col'] },
    'procps-ng': { v: '3.3.17-14', size: 1.0, base: true, desc: 'System and process monitoring utilities', cmds: ['ps', 'top', 'free', 'uptime', 'w', 'vmstat', 'pkill', 'pgrep', 'kill', 'watch', 'pidof'] },
    'psmisc': { v: '23.4-3', size: 0.5, base: true, desc: 'Utilities for managing processes on your system', cmds: ['killall', 'pstree', 'fuser'] },
    'findutils': { v: '4.8.0-6', size: 1.8, base: true, desc: 'The GNU versions of find utilities', cmds: ['find', 'xargs'] },
    'grep': { v: '3.6-5', size: 0.8, base: true, desc: 'Pattern matching utilities', cmds: ['grep', 'egrep', 'fgrep'] },
    'sed': { v: '4.8-9', size: 0.8, base: true, desc: 'A GNU stream text editor', cmds: ['sed'] },
    'gawk': { v: '5.1.0-6', size: 2.6, base: true, desc: 'The GNU version of the AWK text processing utility', cmds: ['awk', 'gawk'] },
    'diffutils': { v: '3.7-12', size: 1.5, base: true, desc: 'File comparison utilities', cmds: ['diff', 'cmp'] },
    'less': { v: '590-4', size: 0.4, base: true, desc: 'A text file browser similar to more, but better', cmds: ['less'] },
    'tar': { v: '1.34-6', size: 3.0, base: true, desc: 'GNU file archiving program', cmds: ['tar'] },
    'gzip': { v: '1.12-1', size: 0.4, base: true, desc: 'The GNU data compression program', cmds: ['gzip', 'gunzip', 'zcat'] },
    'hostname': { v: '3.23-6', size: 0.1, base: true, desc: 'Utility to set/show the host name or domain name', cmds: ['hostname'] },
    'shadow-utils': { v: '4.9-8', size: 3.8, base: true, desc: 'Utilities for managing accounts and shadow password files', cmds: ['useradd', 'userdel', 'usermod', 'groupadd', 'groupdel', 'passwd', 'chage', 'newgrp', 'gpasswd'] },
    'sudo': { v: '1.9.5p2-10', size: 4.6, base: true, desc: 'Allows restricted root access for specified users', cmds: ['sudo', 'visudo'] },
    'systemd': { v: '252-32', size: 25.0, base: true, desc: 'System and Service Manager', cmds: ['systemctl', 'journalctl', 'hostnamectl', 'timedatectl', 'reboot', 'poweroff', 'shutdown', 'halt', 'loginctl'] },
    'iproute': { v: '6.2.0-6', size: 2.2, base: true, desc: 'Advanced IP routing and network device configuration tools', cmds: ['ip', 'ss'] },
    'iputils': { v: '20210202-9', size: 0.4, base: true, desc: 'Network monitoring tools including ping', cmds: ['ping', 'tracepath'] },
    'curl': { v: '7.76.1-29', size: 0.7, base: true, desc: 'A utility for getting files from remote servers (FTP, HTTP, and others)', cmds: ['curl'] },
    'openssh-clients': { v: '8.7p1-38', size: 2.6, base: true, desc: 'An open source SSH client applications', cmds: ['ssh', 'scp', 'ssh-keygen', 'ssh-copy-id'] },
    'openssh-server': { v: '8.7p1-38', size: 1.4, base: true, desc: 'An open source SSH server daemon', cmds: [], service: 'sshd' },
    'firewalld': { v: '1.3.4-1', size: 2.3, base: true, desc: 'A firewall daemon with D-Bus interface providing a dynamic firewall', cmds: ['firewall-cmd'], service: 'firewalld' },
    'chrony': { v: '4.5-1', size: 0.6, base: true, desc: 'An NTP client/server', cmds: ['chronyc'], service: 'chronyd' },
    'cronie': { v: '1.5.7-11', size: 0.3, base: true, desc: 'Cron daemon for executing programs at set times', cmds: ['crontab'], service: 'crond' },
    'dnf': { v: '4.14.0-9', size: 2.2, base: true, desc: 'Package manager', cmds: ['dnf', 'yum'] },
    'rpm': { v: '4.16.1.3-29', size: 3.0, base: true, desc: 'The RPM package management system', cmds: ['rpm'] },
    'vim-minimal': { v: '8.2.2637-20', size: 1.4, base: true, desc: 'A minimal version of the VIM editor', cmds: ['vi'] },
    'which': { v: '2.21-29', size: 0.1, base: true, desc: 'Displays where a particular program in your path is located', cmds: ['which'] },
    'file': { v: '5.39-16', size: 0.1, base: true, desc: 'Utility for determining file types', cmds: ['file'] },
    'man-db': { v: '2.9.3-7', size: 2.8, base: true, desc: 'Tools for searching and reading man pages', cmds: ['man'] },
    'bc': { v: '1.07.1-14', size: 0.2, base: true, desc: 'GNU\'s bc (a numeric processing language) and dc (a calculator)', cmds: ['bc'] },
    'openssl': { v: '3.0.7-27', size: 1.9, base: true, desc: 'Utilities from the general purpose cryptography library with TLS implementation', cmds: ['openssl'] },
    // ----- paquetes opcionales (instalables con dnf) -----
    'nano': { v: '5.6.1-5', size: 2.6, desc: 'A small text editor', cmds: ['nano'] },
    'vim-enhanced': { v: '8.2.2637-20', size: 4.0, desc: 'A version of the VIM editor which includes recent enhancements', cmds: ['vim'] },
    'unzip': { v: '6.0-56', size: 0.4, desc: 'A utility for unpacking zip files', cmds: ['unzip'] },
    'zip': { v: '3.0-35', size: 0.7, desc: 'A file compression and packaging utility compatible with PKZIP', cmds: ['zip'] },
    'wget': { v: '1.21.1-7', size: 3.2, desc: 'A utility for retrieving files using the HTTP or FTP protocols', cmds: ['wget'] },
    'net-tools': { v: '2.0-0.62', size: 0.9, desc: 'Basic networking tools (ifconfig, netstat, route)', cmds: ['ifconfig', 'netstat', 'route', 'arp'] },
    'lsof': { v: '4.94.0-3', size: 0.4, desc: 'A utility which lists open files on a Linux/UNIX system', cmds: ['lsof'] },
    'tree': { v: '1.8.0-10', size: 0.1, desc: 'File system tree viewer', cmds: ['tree'] },
    'htop': { v: '3.3.0-1', size: 0.4, desc: 'Interactive process viewer', cmds: ['htop'] },
    'telnet': { v: '0.17-85', size: 0.1, desc: 'The client program for the Telnet remote login protocol', cmds: ['telnet'] },
    'nmap-ncat': { v: '7.92-1', size: 0.5, desc: 'Nmap\'s Netcat replacement', cmds: ['nc', 'ncat'] },
    'bind-utils': { v: '9.16.23-18', size: 0.9, desc: 'Utilities for querying DNS name servers', cmds: ['nslookup', 'dig', 'host'] },
    'sysstat': { v: '12.5.4-7', size: 1.6, desc: 'Collection of performance monitoring tools for Linux', cmds: ['iostat', 'mpstat', 'sar', 'pidstat'] },
    'git': { v: '2.43.0-1', size: 0.2, desc: 'Fast Version Control System', cmds: [] },
    'java-1.8.0-openjdk': { v: '1.8.0.412.b08-2', size: 42, desc: 'OpenJDK 8 Runtime Environment', jvm: { major: 8, dir: 'java-1.8.0-openjdk', full: '1.8.0_412', build: '1.8.0_412-b08' } },
    'java-11-openjdk': { v: '11.0.23.0.9-3', size: 48, desc: 'OpenJDK 11 Runtime Environment', jvm: { major: 11, dir: 'java-11-openjdk', full: '11.0.23', build: '11.0.23+9-LTS' } },
    'java-17-openjdk': { v: '17.0.11.0.9-3', size: 52, desc: 'OpenJDK 17 Runtime Environment', jvm: { major: 17, dir: 'java-17-openjdk', full: '17.0.11', build: '17.0.11+9-LTS' } },
    'java-21-openjdk': { v: '21.0.3.0.9-1', size: 56, desc: 'OpenJDK 21 Runtime Environment', jvm: { major: 21, dir: 'java-21-openjdk', full: '21.0.3', build: '21.0.3+9-LTS' } }
  };

  // ---------- Usuarios y grupos (leídos del propio VFS) ----------
  function parseColon(text) {
    return text.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.split(':'));
  }
  const users = {
    passwd(vfs) {
      return parseColon(vfs.read('/etc/passwd')).map(f => ({ name: f[0], uid: +f[2], gid: +f[3], gecos: f[4] || '', home: f[5] || '/', shell: f[6] || '/bin/bash' }));
    },
    groups(vfs) {
      return parseColon(vfs.read('/etc/group')).map(f => ({ name: f[0], gid: +f[2], members: (f[3] || '').split(',').filter(Boolean) }));
    },
    byName(vfs, name) { return users.passwd(vfs).find(u => u.name === name) || null; },
    byUid(vfs, uid) { return users.passwd(vfs).find(u => u.uid === uid) || null; },
    group(vfs, nameOrGid) {
      return users.groups(vfs).find(g => g.name === nameOrGid || g.gid === +nameOrGid && String(nameOrGid).match(/^\d+$/)) || null;
    },
    groupName(vfs, gid) { const g = users.groups(vfs).find(g => g.gid === gid); return g ? g.name : String(gid); },
    userName(vfs, uid) { const u = users.byUid(vfs, uid); return u ? u.name : String(uid); },
    // Credencial para el VFS: uid, gid primario y grupos suplementarios
    cred(vfs, name) {
      const u = users.byName(vfs, name);
      if (!u) return null;
      const gids = [u.gid].concat(users.groups(vfs).filter(g => g.members.includes(name)).map(g => g.gid));
      return { uid: u.uid, gid: u.gid, gids: Array.from(new Set(gids)), name: u.name, home: u.home, shell: u.shell };
    },
    hashPassword(pw) { return '$6$jlab$' + L.util.sha256('jlab:' + pw); },
    checkPassword(vfs, name, pw) {
      const line = parseColon(vfs.read('/etc/shadow')).find(f => f[0] === name);
      if (!line) return false;
      if (line[1].startsWith('!') || line[1] === '*' || !line[1]) return false;
      return line[1] === users.hashPassword(pw);
    },
    setPassword(vfs, name, pw) {
      const lines = vfs.read('/etc/shadow').split('\n');
      const days = Math.floor(Date.now() / 86400e3);
      let found = false;
      const out = lines.map(l => {
        const f = l.split(':');
        if (f[0] === name) { found = true; f[1] = users.hashPassword(pw); f[2] = String(days); return f.join(':'); }
        return l;
      });
      if (!found) out.splice(out.length - (out[out.length - 1] === '' ? 1 : 0), 0, [name, users.hashPassword(pw), days, 0, 99999, 7, '', '', ''].join(':'));
      vfs.write('/etc/shadow', out.join('\n'));
    },
    isSudoer(vfs, name) {
      if (name === 'root') return true;
      const g = users.groups(vfs).find(g => g.name === 'wheel');
      if (g && g.members.includes(name)) return true;
      let sudoers = '';
      try { sudoers = vfs.read('/etc/sudoers'); } catch (e) { }
      try { for (const f of vfs.readdir('/etc/sudoers.d')) sudoers += '\n' + vfs.read('/etc/sudoers.d/' + f); } catch (e) { }
      return sudoers.split('\n').some(l => new RegExp('^\\s*' + name + '\\s+ALL').test(l));
    }
  };

  // ---------- Construcción de la imagen base ----------
  function buildBaseImage(vfs, opts) {
    const os = OS_TEMPLATES[opts.os] || OS_TEMPLATES.rhel9;
    const user = opts.user || 'admin';
    const hostname = opts.hostname;
    const dirs = {
      '/boot': { dir: true, mode: 0o555 }, '/dev': { dir: true }, '/etc': { dir: true }, '/home': { dir: true },
      '/media': { dir: true }, '/mnt': { dir: true }, '/opt': { dir: true }, '/proc': { dir: true, mode: 0o555 },
      '/root': { dir: true, mode: 0o550 }, '/run': { dir: true }, '/srv': { dir: true }, '/sys': { dir: true, mode: 0o555 },
      '/tmp': { dir: true, mode: 0o1777 }, '/usr': { dir: true }, '/usr/bin': { dir: true }, '/usr/sbin': { dir: true },
      '/usr/lib': { dir: true }, '/usr/lib64': { dir: true }, '/usr/local': { dir: true }, '/usr/local/bin': { dir: true },
      '/usr/share': { dir: true }, '/usr/share/doc': { dir: true }, '/usr/lib/jvm': { dir: true },
      '/var': { dir: true }, '/var/log': { dir: true }, '/var/tmp': { dir: true, mode: 0o1777 }, '/var/lib': { dir: true },
      '/var/spool': { dir: true }, '/var/spool/cron': { dir: true, mode: 0o700 }, '/var/lib/rpm': { dir: true },
      '/etc/systemd/system': { dir: true }, '/etc/systemd/system/multi-user.target.wants': { dir: true },
      '/usr/lib/systemd/system': { dir: true }, '/etc/sysconfig': { dir: true }, '/etc/yum.repos.d': { dir: true },
      '/etc/sudoers.d': { dir: true, mode: 0o750 }, '/etc/alternatives': { dir: true }, '/etc/profile.d': { dir: true },
      '/etc/firewalld': { dir: true }, '/etc/firewalld/zones': { dir: true }, '/etc/ssh': { dir: true }, '/etc/cron.d': { dir: true },
      '/etc/security': { dir: true }, '/etc/security/limits.d': { dir: true }
    };
    vfs.populate(dirs);
    // Enlaces estilo RHEL (UsrMerge)
    vfs.populate({ '/bin': { link: 'usr/bin' }, '/sbin': { link: 'usr/sbin' }, '/lib': { link: 'usr/lib' }, '/lib64': { link: 'usr/lib64' } });

    const hostsLine = (opts.ip || '10.0.0.10') + '   ' + hostname + ' ' + hostname.split('.')[0];
    const files = {
      '/etc/hostname': hostname + '\n',
      '/etc/os-release': `NAME="${os.name}"\nVERSION="${os.versionId}"\nID="${os.osId}"\nID_LIKE="fedora"\nVERSION_ID="${os.versionId}"\nPLATFORM_ID="platform:${os.el}"\nPRETTY_NAME="${os.prettyName}"\nANSI_COLOR="0;31"\nHOME_URL="https://www.redhat.com/"\n`,
      '/etc/redhat-release': os.release + '\n',
      '/etc/system-release': { link: 'redhat-release' },
      '/etc/passwd': [
        'root:x:0:0:root:/root:/bin/bash', 'bin:x:1:1:bin:/bin:/sbin/nologin', 'daemon:x:2:2:daemon:/sbin:/sbin/nologin',
        'adm:x:3:4:adm:/var/adm:/sbin/nologin', 'nobody:x:65534:65534:Kernel Overflow User:/:/sbin/nologin',
        'sshd:x:74:74:Privilege-separated SSH:/usr/share/empty.sshd:/sbin/nologin', 'chrony:x:996:993:chrony system user:/var/lib/chrony:/sbin/nologin',
        `${user}:x:1000:1000:${user}:/home/${user}:/bin/bash`, ''
      ].join('\n'),
      '/etc/group': [
        'root:x:0:', 'bin:x:1:', 'daemon:x:2:', 'adm:x:4:', 'wheel:x:10:' + user, 'nobody:x:65534:', 'sshd:x:74:', 'chrony:x:993:',
        `${user}:x:1000:`, ''
      ].join('\n'),
      '/etc/shadow': { data: '', mode: 0o000 },
      '/etc/sudoers': { data: '## Sudoers (simulado)\nDefaults   !visiblepw\nroot    ALL=(ALL)       ALL\n## Allows people in group wheel to run all commands\n%wheel  ALL=(ALL)       ALL\n#includedir /etc/sudoers.d\n', mode: 0o440 },
      '/etc/hosts': `127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4\n::1         localhost localhost.localdomain localhost6 localhost6.localdomain6\n${hostsLine}\n`,
      '/etc/resolv.conf': '# Generated by NetworkManager\nsearch lab.local\nnameserver 10.0.0.1\n',
      '/etc/fstab': '#\n# /etc/fstab\n#\n/dev/mapper/rhel-root   /       xfs     defaults        0 0\nUUID=3f1c-lab-boot      /boot   xfs     defaults        0 0\n/dev/mapper/rhel-swap   none    swap    defaults        0 0\n',
      '/etc/motd': '',
      '/etc/issue': '\\S\nKernel \\r on an \\m\n\n',
      '/etc/profile': '# /etc/profile (simulado)\nexport PATH=/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin\nexport HISTSIZE=1000\nfor i in /etc/profile.d/*.sh ; do\n    if [ -r "$i" ]; then\n        . "$i"\n    fi\ndone\n',
      '/etc/bashrc': '# /etc/bashrc (simulado)\nalias ll=\'ls -l --color=auto\'\nalias l.=\'ls -d .* --color=auto\'\nalias grep=\'grep --color=auto\'\n',
      '/etc/profile.d/lab.sh': '# Variables del laboratorio\nexport EDITOR=vi\n',
      '/etc/login.defs': 'PASS_MAX_DAYS\t99999\nPASS_MIN_DAYS\t0\nUID_MIN\t1000\nUID_MAX\t60000\nGID_MIN\t1000\nCREATE_HOME\tyes\nUMASK\t022\n',
      '/etc/ssh/sshd_config': '# sshd_config (simulado)\nPort 22\nPermitRootLogin yes\nPasswordAuthentication yes\n',
      '/etc/security/limits.conf': '# /etc/security/limits.conf\n#<domain>      <type>  <item>         <value>\n#jboss          soft    nofile         4096\n#jboss          hard    nofile         65536\n',
      '/etc/yum.repos.d/lab.repo': `[lab-baseos]\nname=Lab BaseOS (repositorio local simulado)\nbaseurl=file:///var/lab/repo/baseos\nenabled=1\ngpgcheck=0\n\n[lab-appstream]\nname=Lab AppStream (repositorio local simulado)\nbaseurl=file:///var/lab/repo/appstream\nenabled=1\ngpgcheck=0\n`,
      '/etc/firewalld/zones/public.xml': '<?xml version="1.0" encoding="utf-8"?>\n<zone>\n  <short>Public</short>\n  <description>For use in public areas.</description>\n  <service name="ssh"/>\n  <service name="dhcpv6-client"/>\n  <service name="cockpit"/>\n</zone>\n',
      '/etc/crontab': 'SHELL=/bin/bash\nPATH=/sbin:/bin:/usr/sbin:/usr/bin\nMAILTO=root\n\n# .---------------- minute (0 - 59)\n# |  .------------- hour (0 - 23)\n# |  |  .---------- day of month (1 - 31)\n# |  |  |  .------- month (1 - 12)\n# |  |  |  |  .---- day of week (0 - 6)\n# *  *  *  *  * user-name  command to be executed\n',
      '/root/.bashrc': '# .bashrc\nalias rm=\'rm -i\'\nalias cp=\'cp -i\'\nalias mv=\'mv -i\'\n[ -f /etc/bashrc ] && . /etc/bashrc\n',
      '/root/.bash_profile': '# .bash_profile\n[ -f ~/.bashrc ] && . ~/.bashrc\n',
      '/var/log/messages': '', '/var/log/secure': { data: '', mode: 0o600 }, '/var/log/cron': { data: '', mode: 0o600 },
      '/var/log/dnf.log': '', '/var/log/boot.log': { data: '', mode: 0o600 },
      '/dev/null': { data: '', mode: 0o666, dev: 'null' },
      '/dev/zero': { data: '', mode: 0o666, dev: 'zero' },
      '/proc/meminfo': { dyn: 'meminfo', mode: 0o444, ro: true },
      '/proc/cpuinfo': { dyn: 'cpuinfo', mode: 0o444, ro: true },
      '/proc/uptime': { dyn: 'uptime', mode: 0o444, ro: true },
      '/proc/loadavg': { dyn: 'loadavg', mode: 0o444, ro: true },
      '/proc/version': { dyn: 'version', mode: 0o444, ro: true },
      '/proc/mounts': { dyn: 'mounts', mode: 0o444, ro: true },
      ['/boot/vmlinuz-' + os.kernel]: { data: '', vsize: 12 * 1024 * 1024, mode: 0o755, bin: true },
      ['/boot/initramfs-' + os.kernel + '.img']: { data: '', vsize: 34 * 1024 * 1024, mode: 0o600, bin: true }
    };
    vfs.populate(files);
    // Home del usuario
    vfs.populate({
      ['/home/' + user]: { dir: true, mode: 0o700, uid: 1000, gid: 1000 },
      ['/home/' + user + '/.bashrc']: { data: '# .bashrc\n[ -f /etc/bashrc ] && . /etc/bashrc\n\n# Alias de usuario\n', uid: 1000, gid: 1000 },
      ['/home/' + user + '/.bash_profile']: { data: '# .bash_profile\n[ -f ~/.bashrc ] && . ~/.bashrc\n', uid: 1000, gid: 1000 },
      ['/home/' + user + '/LEEME.txt']: {
        data: 'Bienvenido al laboratorio JBoss.\n\n' +
          '  - Instaladores de JBoss:   /opt/installers\n' +
          '  - Aplicaciones de ejemplo: /opt/installers/apps\n' +
          '  - Ayuda de comandos:       help  |  man <comando>\n' +
          '  - Ejercicios guiados:      menú Inicio > Ejercicios\n', uid: 1000, gid: 1000
      }
    });
    users.setPassword(vfs, 'root', opts.rootPassword || 'redhat');
    users.setPassword(vfs, user, opts.userPassword || 'redhat');
    vfs.stat('/etc/shadow').m = 0o000;

    // Servicios systemd base
    const unit = (desc, exec, extra) => `[Unit]\nDescription=${desc}\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=${exec}\n${extra || ''}\n[Install]\nWantedBy=multi-user.target\n`;
    vfs.populate({
      '/usr/lib/systemd/system/sshd.service': unit('OpenSSH server daemon', '/usr/sbin/sshd -D'),
      '/usr/lib/systemd/system/firewalld.service': unit('firewalld - dynamic firewall daemon', '/usr/sbin/firewalld --nofork --nopid'),
      '/usr/lib/systemd/system/crond.service': unit('Command Scheduler', '/usr/sbin/crond -n'),
      '/usr/lib/systemd/system/chronyd.service': unit('NTP client/server', '/usr/sbin/chronyd -n'),
      '/usr/lib/systemd/system/rsyslog.service': unit('System Logging Service', '/usr/sbin/rsyslogd -n')
    });
    for (const s of ['sshd', 'firewalld', 'crond', 'chronyd', 'rsyslog']) {
      vfs.populate({ ['/etc/systemd/system/multi-user.target.wants/' + s + '.service']: { link: '/usr/lib/systemd/system/' + s + '.service' } });
    }
    vfs.populate({ '/usr/sbin/sshd': { data: '', vsize: 900000, mode: 0o755, bin: true } });

    // Paquetes base
    const installed = {};
    for (const [name, pkg] of Object.entries(PACKAGES)) if (pkg.base) installPackageFiles(vfs, name, os);
    for (const [name, pkg] of Object.entries(PACKAGES)) if (pkg.base) installed[name] = pkg.v + '.' + os.el;
    for (const extra of opts.packages || []) { installPackageFiles(vfs, extra, os); installed[extra] = PACKAGES[extra].v + '.' + os.el; }
    vfs.write('/var/lib/rpm/installed.json', JSON.stringify(installed));
    return os;
  }

  // Coloca los archivos de un paquete en el VFS
  function installPackageFiles(vfs, name, os) {
    const pkg = PACKAGES[name];
    if (!pkg) throw new Error('paquete desconocido ' + name);
    const per = Math.max(20000, Math.round(pkg.size * 1024 * 1024 / Math.max(1, (pkg.cmds || []).length || 1)));
    for (const c of pkg.cmds || []) {
      if (L.cmds && Object.keys(L.cmds).length && !L.cmds[c] && !(L.builtins && L.builtins[c])) continue;
      const dir = /^(useradd|userdel|usermod|groupadd|groupdel|visudo|reboot|poweroff|shutdown|halt|ifconfig|route|arp|firewalld)$/.test(c) ? '/usr/sbin' : '/usr/bin';
      const p = dir + '/' + c;
      if (vfs.exists(p)) continue;
      vfs.write(p, '\x7fELF', { mode: c === 'sudo' ? 0o4111 : c === 'passwd' || c === 'su' ? 0o4755 : 0o755, vsize: per, bin: true });
      vfs.stat(p).bi = c;
    }
    if (pkg.jvm) {
      const j = pkg.jvm, base = '/usr/lib/jvm/' + j.dir;
      vfs.mkdir(base + '/bin', { parents: true });
      vfs.mkdir(base + '/lib', { parents: true });
      for (const b of ['java', 'keytool', 'jcmd', 'jstack', 'jmap', 'jps', 'jar', 'javac']) {
        vfs.write(base + '/bin/' + b, '\x7fELF', { mode: 0o755, vsize: 16000, bin: true });
        vfs.stat(base + '/bin/' + b).bi = b;
        vfs.stat(base + '/bin/' + b).jvm = j.major;
      }
      vfs.write(base + '/lib/modules', '', { vsize: Math.round(pkg.size * 1024 * 1024), bin: true });
      vfs.write(base + '/release', `JAVA_VERSION="${j.full}"\nIMPLEMENTOR="Red Hat, Inc."\n`);
      // alternatives: /usr/bin/java -> /etc/alternatives/java -> JDK activo
      const alt = '/etc/alternatives/java';
      const existing = vfs.tryLookup(alt, { follow: false });
      const current = existing ? existing.node.tg : null;
      const curMajor = current ? (Object.values(PACKAGES).find(p => p.jvm && current.includes('/' + p.jvm.dir + '/')) || { jvm: { major: 0 } }).jvm.major : 0;
      if (!existing || j.major > curMajor) {
        if (existing) vfs.unlink(alt);
        vfs.symlink(base + '/bin/java', alt);
      }
      for (const b of ['java', 'keytool', 'jar', 'jps', 'jcmd', 'jstack', 'jmap']) {
        if (!vfs.tryLookup('/usr/bin/' + b, { follow: false })) vfs.symlink(b === 'java' ? alt : base + '/bin/' + b, '/usr/bin/' + b);
      }
    }
    if (pkg.service) {
      // la unidad ya existe en la imagen base
    }
  }

  function removePackageFiles(vfs, name) {
    const pkg = PACKAGES[name];
    for (const c of pkg.cmds || []) {
      for (const d of ['/usr/bin/', '/usr/sbin/']) {
        const other = Object.entries(PACKAGES).some(([n, p]) => n !== name && (p.cmds || []).includes(c) && installedList(vfs)[n]);
        if (!other && vfs.exists(d + c)) vfs.unlink(d + c);
      }
    }
    if (pkg.jvm) {
      const base = '/usr/lib/jvm/' + pkg.jvm.dir;
      if (vfs.exists(base)) vfs.rmrf(base);
      const alt = vfs.tryLookup('/etc/alternatives/java', { follow: false });
      if (alt && alt.node.tg.startsWith(base)) {
        vfs.unlink('/etc/alternatives/java');
        const other = Object.values(PACKAGES).filter(p => p.jvm && vfs.exists('/usr/lib/jvm/' + p.jvm.dir)).sort((a, b) => b.jvm.major - a.jvm.major)[0];
        if (other) vfs.symlink('/usr/lib/jvm/' + other.jvm.dir + '/bin/java', '/etc/alternatives/java');
      }
    }
  }

  function installedList(vfs) {
    try { return JSON.parse(vfs.read('/var/lib/rpm/installed.json')); } catch (e) { return {}; }
  }
  function setInstalled(vfs, list) { vfs.write('/var/lib/rpm/installed.json', JSON.stringify(list)); }

  // Detecta el JDK activo (siguiendo /usr/bin/java o JAVA_HOME)
  function detectJava(vfs, javaHome) {
    let p = javaHome ? javaHome.replace(/\/$/, '') + '/bin/java' : '/usr/bin/java';
    const r = vfs.tryLookup(p);
    if (!r || !r.node.jvm) return null;
    const pkg = Object.values(PACKAGES).find(x => x.jvm && x.jvm.major === r.node.jvm);
    return Object.assign({ path: r.path }, pkg.jvm);
  }

  L.os = { OS_TEMPLATES, PACKAGES, users, buildBaseImage, installPackageFiles, removePackageFiles, installedList, setInstalled, detectJava };
})(globalThis.JLab = globalThis.JLab || {});
