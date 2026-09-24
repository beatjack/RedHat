/*
 * Red: ip, ifconfig, ss, netstat, ping, curl, wget, ssh, scp, ssh-keygen,
 * ssh-copy-id, nc, telnet, nslookup/dig/host, firewall-cmd.
 * La red del laboratorio es 10.0.0.0/24; cada VM tiene su IP y hostname.
 * No hay salida a Internet (entorno aislado y 100% local).
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, OS = L.os;
  const { getopt, lines } = L.cmdutil;

  function mac(vm) { const h = U.md5(vm.id); return '52:54:00:' + h.slice(0, 2) + ':' + h.slice(2, 4) + ':' + h.slice(4, 6); }
  C.ip = (c) => {
    const [obj = 'addr', ...rest] = c.args.filter(a => !a.startsWith('-'));
    const vm = c.vm;
    if (/^a(d(d(r(e(s(s)?)?)?)?)?)?$/.test(obj)) {
      if (rest[0] && rest[0] !== 'show') return c.fail('RTNETLINK answers: Operation not permitted (simulado)', 2);
      c.println('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n    inet6 ::1/128 scope host\n       valid_lft forever preferred_lft forever');
      c.println('2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether ' + mac(vm) + ' brd ff:ff:ff:ff:ff:ff\n    inet ' + vm.ip + '/24 brd 10.0.0.255 scope global noprefixroute enp1s0\n       valid_lft forever preferred_lft forever');
      return 0;
    }
    if (/^r(o(u(t(e)?)?)?)?$/.test(obj)) { c.println('default via 10.0.0.1 dev enp1s0 proto static metric 100\n10.0.0.0/24 dev enp1s0 proto kernel scope link src ' + vm.ip + ' metric 100'); return 0; }
    if (/^l(i(n(k)?)?)?$/.test(obj)) { c.println('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n2: enp1s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000\n    link/ether ' + mac(vm) + ' brd ff:ff:ff:ff:ff:ff'); return 0; }
    if (/^n(e(i(g(h)?)?)?)?$/.test(obj)) { for (const v of vm.lab.vms.values()) if (v !== vm && v.state === 'running') c.println(v.ip + ' dev enp1s0 lladdr ' + mac(v) + ' REACHABLE'); return 0; }
    return c.fail('Object "' + obj + '" is unknown, try "ip help".', 255);
  };
  C.ifconfig = (c) => {
    const vm = c.vm;
    c.println('enp1s0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet ' + vm.ip + '  netmask 255.255.255.0  broadcast 10.0.0.255\n        ether ' + mac(vm) + '  txqueuelen 1000  (Ethernet)\n        RX packets 18231  bytes 22671201 (21.6 MiB)\n        TX packets 9120  bytes 1024831 (1000.8 KiB)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)\n');
    return 0;
  };
  C.route = (c) => { c.println('Kernel IP routing table\nDestination     Gateway         Genmask         Flags Metric Ref    Use Iface\n0.0.0.0         10.0.0.1        0.0.0.0         UG    100    0        0 enp1s0\n10.0.0.0        0.0.0.0         255.255.255.0   U     100    0        0 enp1s0'); return 0; };
  C.arp = (c) => { c.println('Address                  HWtype  HWaddress           Flags Mask            Iface'); for (const v of c.vm.lab.vms.values()) if (v !== c.vm && v.state === 'running') c.println(U.pad(v.hostname, 24, true) + ' ether   ' + mac(v) + '   C                     enp1s0'); return 0; };

  function sockets(c, flags) {
    const vm = c.vm;
    const rows = [];
    for (const l of vm.listeners) {
      const p = vm.proc(l.pid);
      const visible = c.cred.uid === 0 || (p && p.user === c.user);
      rows.push({ proto: l.kind === 'udp' ? 'udp' : 'tcp', local: (l.addr === '0.0.0.0' ? (flags.n ? '0.0.0.0' : '*') : l.addr) + ':' + l.port, port: l.port, proc: visible && p ? p : null, l });
    }
    return rows.sort((a, b) => a.port - b.port);
  }
  C.ss = (c) => {
    const flags = {};
    for (const a of c.args) if (a.startsWith('-') && !a.startsWith('--')) for (const ch of a.slice(1)) flags[ch] = true;
    const rows = sockets(c, { n: true }).filter(r => (!flags.t && !flags.u) || (flags.t && r.proto === 'tcp') || (flags.u && r.proto === 'udp'));
    c.println('Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process');
    for (const r of rows) c.println(U.pad(r.proto, 5, true) + ' LISTEN 0      ' + U.pad(r.l.kind === 'http' || r.l.kind === 'management' ? 128 : 50, 6, true) + ' ' + U.pad(r.local, 19) + '      0.0.0.0:*    ' + (flags.p && r.proc ? 'users:(("' + r.proc.name + '",pid=' + r.proc.pid + ',fd=' + (400 + r.port % 97) + '))' : ''));
    return 0;
  };
  C.netstat = (c) => {
    const flags = {};
    for (const a of c.args) if (a.startsWith('-')) for (const ch of a.slice(1)) flags[ch] = true;
    if (flags.r) return C.route(c);
    c.println('Active Internet connections (only servers)\nProto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name');
    for (const r of sockets(c, flags)) c.println(U.pad(r.proto, 5, true) + '      0      0 ' + U.pad(r.local.replace('*', '0.0.0.0'), 23, true) + ' 0.0.0.0:*               LISTEN      ' + (flags.p ? (r.proc ? r.proc.pid + '/' + r.proc.name : '-') : ''));
    return 0;
  };

  C.ping = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'qn', values: 'ciWw' });
    const host = rest[0];
    if (!host) return c.fail('usage error: Destination address required', 2);
    const r = c.vm.lab.resolve(c.vm, host);
    if (!r) { c.err('ping: ' + host + ': Name or service not known\n'); return 2; }
    const target = r.vm, name = r.local ? (host === 'localhost' ? 'localhost' : c.vm.hostname) : (target ? target.hostname : host);
    const ip = r.local ? (host === c.vm.ip ? c.vm.ip : '127.0.0.1') : r.ip;
    const count = opts.c ? +opts.c : Infinity;
    const interval = opts.i ? parseFloat(opts.i) * 1000 : 1000;
    c.println('PING ' + (/^\d/.test(host) ? host : name) + ' (' + ip + ') 56(84) bytes of data.');
    const times = [];
    let sent = 0, recv = 0;
    const start = Date.now();
    try {
      while (sent < count) {
        sent++;
        const up = r.local || (target && target.state === 'running');
        if (up) {
          const t = r.local ? 0.03 + Math.random() * 0.03 : 0.25 + Math.random() * 0.6;
          times.push(t); recv++;
          if (!opts.q) c.println('64 bytes from ' + (/^\d/.test(host) ? ip : name + ' (' + ip + ')') + ': icmp_seq=' + sent + ' ttl=64 time=' + t.toFixed(3) + ' ms');
        } else if (!opts.q && sent % 3 === 0) {
          for (let k = sent - 2; k <= sent; k++) c.println('From ' + c.vm.ip + ' icmp_seq=' + k + ' Destination Host Unreachable');
        }
        if (sent < count) await c.sleep(interval);
      }
    } catch (e) { if (!e.aborted) throw e; c.out('^C'); c.println(''); }
    c.println('\n--- ' + (/^\d/.test(host) ? host : name) + ' ping statistics ---');
    c.println(sent + ' packets transmitted, ' + recv + ' received, ' + (recv < sent ? '+' + (sent - recv) + ' errors, ' : '') + Math.round((sent - recv) / sent * 100) + '% packet loss, time ' + (Date.now() - start) + 'ms');
    if (times.length) { const mn = Math.min(...times), mx = Math.max(...times), av = times.reduce((a, b) => a + b) / times.length; c.println('rtt min/avg/max/mdev = ' + mn.toFixed(3) + '/' + av.toFixed(3) + '/' + mx.toFixed(3) + '/' + ((mx - mn) / 2).toFixed(3) + ' ms'); }
    return recv ? 0 : 1;
  };
  C.tracepath = (c) => { const r = c.vm.lab.resolve(c.vm, c.args[0]); if (!r) return c.fail(c.args[0] + ': Name or service not known'); c.println(' 1?: [LOCALHOST]                      pmtu 1500\n 1:  ' + (r.ip || c.args[0]) + '                                          0.412ms reached\n     Resume: pmtu 1500 hops 1 back 1'); return 0; };

  function connErr(c, prog, host, port, r) {
    const ip = r.ip || host;
    if (r.error === 'unknown') return prog === 'curl' ? 'curl: (6) Could not resolve host: ' + host : prog + ': unable to resolve host address ‘' + host + '’';
    const why = r.error === 'refused' ? 'Connection refused' : 'No route to host';
    if (prog === 'curl') return 'curl: (7) Failed to connect to ' + host + ' port ' + port + ': ' + why;
    return 'Connecting to ' + host + ' (' + host + ')|' + ip + '|:' + port + '... failed: ' + why + '.';
  }
  function statusText(s) { return { 200: 'OK', 302: 'Found', 401: 'Unauthorized', 404: 'Not Found', 500: 'Internal Server Error', 503: 'Service Unavailable' }[s] || ''; }
  C.curl = async (c) => {
    const { opts, rest } = getopt(c.args, {
      flags: 'sSiIvLkfO#', values: 'oXuwHdm',
      long: { silent: 's', include: 'i', head: 'I', verbose: 'v', location: 'L', insecure: 'k', fail: 'f', output: 'o=', request: 'X=', user: 'u=', 'write-out': 'w=', header: 'H=', data: 'd=', digest: 'digest', 'connect-timeout': 'ct=', 'max-time': 'm=', 'remote-name': 'O', 'show-error': 'S' }
    });
    const url = rest[0];
    if (!url) { c.err('curl: try \'curl --help\' or \'curl --manual\' for more information\n'); return 2; }
    let auth = null;
    if (opts.u) { const [u, ...p] = opts.u.split(':'); auth = { user: u, pass: p.join(':') }; }
    const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
    if (!m) { c.err('curl: (3) URL using bad/illegal format or missing URL\n'); return 3; }
    let target = url;
    let res;
    for (let hops = 0; hops < 5; hops++) {
      res = c.vm.lab.http(c.vm, target, { method: opts.X || (opts.I ? 'HEAD' : opts.d ? 'POST' : 'GET'), auth, data: opts.d && opts.d.startsWith('@') ? c.fs.read(c.resolve(opts.d.slice(1)), c.cred) : opts.d });
      if (opts.v) { c.err('*   Trying ' + (res.ip || m[2]) + ':' + (m[3] || 80) + '...\n'); }
      if (!res.ok) {
        if (!opts.s || opts.S) c.err(connErr(c, 'curl', m[2], +(m[3] || (m[1] === 'https' ? 443 : 80)), res) + '\n');
        if (opts.w) c.out(opts.w.replace(/%\{http_code\}/g, '000').replace(/\\n/g, '\n'));
        return res.error === 'unknown' ? 6 : 7;
      }
      if (m[1] === 'https' && !opts.k) { if (!opts.s || opts.S) c.err('curl: (60) SSL certificate problem: self-signed certificate\nMore details here: https://curl.se/docs/sslcerts.html\n'); return 60; }
      if (res.raw) { c.err('curl: (1) Received HTTP/0.9 when not allowed\n'); return 1; }
      if (opts.v) c.err('* Connected to ' + m[2] + ' (' + res.ip + ') port ' + res.port + ' (#0)\n> ' + (opts.X || 'GET') + ' ' + (m[4] || '/') + ' HTTP/1.1\n> Host: ' + m[2] + ':' + res.port + '\n> User-Agent: curl/7.76.1\n> Accept: */*\n>\n< HTTP/1.1 ' + res.status + ' ' + statusText(res.status) + '\n< Connection: keep-alive\n< Content-Type: ' + (res.type || 'text/html') + '\n< Content-Length: ' + (res.body || '').length + '\n<\n');
      if (opts.L && res.status === 302 && res.headers && res.headers.Location) { target = (m[1] || 'http') + '://' + m[2] + ':' + res.port + res.headers.Location; continue; }
      break;
    }
    if (opts.f && res.status >= 400) { if (!opts.s || opts.S) c.err('curl: (22) The requested URL returned error: ' + res.status + '\n'); return 22; }
    let head = '';
    if (opts.i || opts.I) {
      head = 'HTTP/1.1 ' + res.status + ' ' + statusText(res.status) + '\r\nConnection: keep-alive\r\n' + Object.entries(res.headers || {}).map(([k, v]) => k + ': ' + v + '\r\n').join('') + 'Content-Type: ' + (res.type || 'text/html') + '\r\nContent-Length: ' + (res.body || '').length + '\r\nDate: ' + new Date().toUTCString() + '\r\n\r\n';
    }
    const body = opts.I ? '' : (res.body || '');
    const outFile = opts.o || (opts.O ? P.basename((m[4] || '/').split('?')[0]) || 'index.html' : null);
    if (outFile) {
      try { c.fs.write(c.resolve(outFile), head + body, { cred: c.cred }); } catch (e) { c.err('curl: (23) Failure writing output to destination\n'); return 23; }
      if (!opts.s && c.io.stderr.isTTY) c.err('  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ' + U.pad(body.length, 5) + '  100 ' + U.pad(body.length, 5) + '    0     0   ' + U.pad(Math.round(body.length * 12), 6) + '      0 --:--:-- --:--:-- --:--:-- ' + U.pad(Math.round(body.length * 12), 6) + '\n');
    } else c.out(head + body);
    if (opts.w) c.out(opts.w.replace(/%\{http_code\}/g, String(res.status)).replace(/%\{size_download\}/g, String(body.length)).replace(/%\{time_total\}/g, '0.0' + (Math.floor(Math.random() * 90) + 10)).replace(/\\n/g, '\n'));
    return 0;
  };
  C.wget = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'qcS', values: 'OP', long: { quiet: 'q', 'output-document': 'O=' } });
    const url = rest[0];
    if (!url) return c.fail('missing URL\nUsage: wget [OPTION]... [URL]...');
    const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
    const port = +(m[3] || 80);
    const say = (s) => { if (!opts.q) c.err(s); };
    say('--' + new Date().toISOString().slice(0, 19).replace('T', ' ') + '--  ' + url + '\n');
    const r = c.vm.lab.resolve(c.vm, m[2]);
    if (!r) { say('Resolving ' + m[2] + ' (' + m[2] + ')... failed: Name or service not known.\nwget: unable to resolve host address ‘' + m[2] + '’\n'); return 4; }
    say('Resolving ' + m[2] + ' (' + m[2] + ')... ' + (r.local ? '127.0.0.1' : r.ip) + '\n');
    const res = c.vm.lab.http(c.vm, url, {});
    if (!res.ok) { say('Connecting to ' + m[2] + ' (' + m[2] + ')|' + (r.local ? '127.0.0.1' : r.ip) + '|:' + port + '... failed: ' + (res.error === 'refused' ? 'Connection refused' : 'No route to host') + '.\n'); return 4; }
    say('Connecting to ' + m[2] + ' (' + m[2] + ')|' + res.ip + '|:' + port + '... connected.\nHTTP request sent, awaiting response... ' + res.status + ' ' + statusText(res.status) + '\n');
    if (res.status >= 400) { say(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ERROR ' + res.status + ': ' + statusText(res.status) + '.\n\n'); return 8; }
    const name = opts.O || P.basename((m[4] || '/').split('?')[0]) || 'index.html';
    say('Length: ' + (res.body || '').length + ' [' + (res.type || 'text/html') + ']\nSaving to: ‘' + name + '’\n\n' + U.pad(name, 20, true) + ' 100%[===================>]   ' + U.human((res.body || '').length) + '  --.-KB/s    in 0s\n\n');
    try {
      if (name === '-') c.out(res.body || '');
      else c.fs.write(c.resolve(name), res.body || '', { cred: c.cred });
    } catch (e) { say(name + ': ' + e.message + '\n'); return 3; }
    say(new Date().toISOString().slice(0, 19).replace('T', ' ') + ' (1.2 MB/s) - ‘' + name + '’ saved [' + (res.body || '').length + '/' + (res.body || '').length + ']\n');
    return 0;
  };
  C.nc = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'zvlnu', values: 'w' });
    const [host, portSpec] = rest;
    if (!host || !portSpec) return c.fail('Ncat: You must specify a host to connect to. QUITTING.', 2);
    const r = c.vm.lab.connect(c.vm, host, +portSpec);
    if (!r.ok) { c.err('Ncat: ' + (r.error === 'unknown' ? 'Could not resolve hostname "' + host + '": Name or service not known' : r.error === 'refused' ? 'Connection refused' : 'No route to host') + '.\n'); return 1; }
    if (opts.v || opts.z) c.err('Ncat: Version 7.92 ( https://nmap.org/ncat )\nNcat: Connected to ' + r.ip + ':' + portSpec + '.\n' + (opts.z ? 'Ncat: 0 bytes sent, 0 bytes received in 0.01 seconds.\n' : ''));
    return 0;
  };
  C.ncat = C.nc;
  C.telnet = async (c) => {
    const [host, port = '23'] = c.args;
    if (!host) return c.fail('usage: telnet host [port]');
    const r = c.vm.lab.connect(c.vm, host, +port);
    c.println('Trying ' + (r.ip || host) + '...');
    if (!r.ok) { c.err('telnet: connect to address ' + (r.ip || host) + ': ' + (r.error === 'refused' ? 'Connection refused' : r.error === 'unknown' ? 'Name or service not known' : 'No route to host') + '\n'); return 1; }
    c.println('Connected to ' + host + '.\nEscape character is \'^]\'.');
    await c.sleep(600).catch(() => { });
    c.println('Connection closed by foreign host.');
    return 0;
  };
  function lookup(c, name) {
    const r = c.vm.lab.resolve(c.vm, name);
    return r ? (r.local ? (name === 'localhost' ? '127.0.0.1' : c.vm.ip) : r.ip) : null;
  }
  C.nslookup = (c) => {
    const n = c.args[0];
    if (!n) return c.fail('usage: nslookup name');
    const ip = lookup(c, n);
    c.println('Server:\t\t10.0.0.1\nAddress:\t10.0.0.1#53\n');
    if (!ip) { c.println('** server can\'t find ' + n + ': NXDOMAIN\n'); return 1; }
    c.println('Name:\t' + (n.includes('.') ? n : n + '.lab.local') + '\nAddress: ' + ip + '\n');
    return 0;
  };
  C.host = (c) => { const n = c.args[0]; const ip = lookup(c, n); if (!ip) { c.println('Host ' + n + ' not found: 3(NXDOMAIN)'); return 1; } c.println(n + ' has address ' + ip); return 0; };
  C.dig = (c) => {
    const n = c.args.filter(a => !a.startsWith('+') && !a.startsWith('-'))[0];
    const ip = n ? lookup(c, n) : null;
    if (c.args.includes('+short')) { if (ip) c.println(ip); return 0; }
    c.println('\n; <<>> DiG 9.16.23-RH <<>> ' + (n || '') + '\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ' + (ip ? 'NOERROR' : 'NXDOMAIN') + ', id: 4242\n\n;; QUESTION SECTION:\n;' + n + '.\t\t\tIN\tA\n' + (ip ? '\n;; ANSWER SECTION:\n' + n + '.\t\t300\tIN\tA\t' + ip + '\n' : '') + '\n;; Query time: 1 msec\n;; SERVER: 10.0.0.1#53(10.0.0.1)\n');
    return 0;
  };

  // ---------------- SSH ----------------
  function parseTarget(s, defUser) {
    const m = /^(?:([^@]+)@)?([^:]+)(?::(.*))?$/.exec(s);
    return m ? { user: m[1] || defUser, host: m[2], path: m[3] } : null;
  }
  // Autentica contra la VM destino (clave pública o contraseña). Devuelve {ok, target}
  async function sshAuth(c, spec, port) {
    const lab = c.vm.lab;
    const conn = lab.connect(c.vm, spec.host, port || 22);
    if (!conn.ok) {
      c.err('ssh: connect to host ' + spec.host + ' port ' + (port || 22) + ': ' + (conn.error === 'unknown' ? 'Could not resolve hostname ' + spec.host + ': Name or service not known' : conn.error === 'refused' ? 'Connection refused' : 'No route to host') + '\n');
      return null;
    }
    const target = conn.vm;
    const hostKey = 'SHA256:' + U.b64encode(U.sha256(target.id)).slice(0, 43);
    const kh = c.sh.cred.home + '/.ssh/known_hosts';
    let known = '';
    try { known = c.fs.read(kh, c.cred); } catch (e) { }
    const khName = spec.host + (/^\d/.test(spec.host) ? '' : ',' + conn.ip);
    if (!known.split('\n').some(l => l.split(' ')[0].split(',').includes(spec.host))) {
      c.println("The authenticity of host '" + spec.host + ' (' + conn.ip + ")' can't be established.\nED25519 key fingerprint is " + hostKey + '.\nThis key is not known by any other names');
      const ans = await c.prompt('Are you sure you want to continue connecting (yes/no/[fingerprint])? ');
      if (ans !== 'yes') { c.err('Host key verification failed.\n'); return null; }
      c.println("Warning: Permanently added '" + spec.host + "' (ED25519) to the list of known hosts.");
      try {
        if (!c.fs.exists(c.sh.cred.home + '/.ssh')) c.fs.mkdir(c.sh.cred.home + '/.ssh', { cred: c.cred, mode: 0o700 });
        c.fs.write(kh, khName + ' ssh-ed25519 AAAAC3NzaC1lZDI1NTE5' + U.sha256(target.id).slice(0, 40) + '\n', { cred: c.cred, append: true, mode: 0o644 });
      } catch (e) { }
    }
    const tu = OS.users.byName(target.fs, spec.user);
    // clave pública
    let pub = null;
    try { pub = c.fs.read(c.sh.cred.home + '/.ssh/id_rsa.pub', c.cred).trim(); } catch (e) { }
    if (tu && pub) {
      try {
        const ak = target.fs.read(tu.home + '/.ssh/authorized_keys');
        if (ak.split('\n').map(x => x.trim()).includes(pub)) return { target, user: spec.user, ip: conn.ip };
      } catch (e) { }
    }
    for (let i = 0; i < 3; i++) {
      const pw = await c.prompt(spec.user + '@' + spec.host + "'s password: ", true);
      if (pw === null) return null;
      if (tu && OS.users.checkPassword(target.fs, spec.user, pw) && !/nologin/.test(tu.shell)) {
        target.logSys('sshd[' + target.nextPid + ']', 'Accepted password for ' + spec.user + ' from ' + c.vm.ip + ' port ' + (40000 + Math.floor(Math.random() * 20000)) + ' ssh2', '/var/log/secure');
        return { target, user: spec.user, ip: conn.ip };
      }
      target.logSys('sshd[' + target.nextPid + ']', 'Failed password for ' + (tu ? '' : 'invalid user ') + spec.user + ' from ' + c.vm.ip + ' port 51234 ssh2', '/var/log/secure');
      c.println('Permission denied, please try again.');
    }
    c.err(spec.user + '@' + spec.host + ': Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password).\n');
    return null;
  }
  C.ssh = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'tvqNT', values: 'plio', stopAtFirst: true });
    if (!rest.length) return c.fail('usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-p port] [-l login_name] destination [command]', 255);
    const spec = parseTarget(rest[0], opts.l || c.user);
    if (!c.term) return c.fail('se requiere terminal', 255);
    const a = await sshAuth(c, spec, opts.p ? +opts.p : 22);
    if (!a) return 255;
    const tu = OS.users.byName(a.target.fs, a.user);
    const cmd = rest.slice(1).join(' ');
    const remote = new L.Shell(a.target, { user: a.user, login: true, cwd: tu.home, term: c.term, tty: 'pts/' + (a.target.sessions.size + 1) });
    if (cmd) {
      remote.fg = c.sh.fg; remote.io = c.io;
      try { return await remote.run(cmd, c.io); } catch (e) { if (e.exitCode !== undefined) return e.exitCode; throw e; } finally { a.target.reap(remote.pid); }
    }
    const motd = (() => { try { return a.target.fs.read('/etc/motd'); } catch (e) { return ''; } })();
    c.println('Last login: ' + U.dateStr(Date.now() - 3600e3) + ' from ' + c.vm.ip);
    if (motd) c.out(motd);
    const session = { user: a.user, tty: remote.tty, since: Date.now(), from: c.vm.ip };
    a.target.sessions.add(session);
    let code = 0;
    const off = a.target.on('state', () => { if (a.target.state !== 'running') { c.term.write('\r\nConnection to ' + spec.host + ' closed by remote host.\r\n'); } });
    try { code = await remote.interactive(c.term); }
    finally { a.target.sessions.delete(session); off(); }
    c.println('Connection to ' + spec.host + ' closed.');
    return code;
  };
  C.scp = async (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'rpqv', values: 'P' });
    if (rest.length < 2) return c.fail('usage: scp [-rp] [-P port] source ... target', 1);
    const dst = rest[rest.length - 1];
    const srcs = rest.slice(0, -1);
    const dspec = /^[^/]*:/.test(dst) ? parseTarget(dst, c.user) : null;
    let st = 0;
    for (const s of srcs) {
      const sspec = /^[^/]*:/.test(s) ? parseTarget(s, c.user) : null;
      if (sspec && dspec) return c.fail('copia remota-a-remota no soportada');
      const remote = sspec || dspec;
      if (!remote) { await c.sh.execCommand(['cp'].concat(opts.r ? ['-r'] : [], [s, dst]), c.io); continue; }
      const a = await sshAuth(c, remote, opts.P ? +opts.P : 22);
      if (!a) return 1;
      const rcred = OS.users.cred(a.target.fs, a.user);
      const rhome = rcred.home;
      try {
        if (dspec) {
          const sp = c.resolve(s);
          const rp = P.resolve(rhome, dspec.path || '.');
          const entries = L.archive.collect(c.fs, P.dirname(sp), [P.basename(sp)], c.cred);
          if (!opts.r && entries.some(e => e.t === 'd')) { c.err('scp: ' + s + ': not a regular file\n'); st = 1; continue; }
          const destDir = a.target.fs.isDir(rp) ? rp : P.dirname(rp);
          const renamed = a.target.fs.isDir(rp) ? entries : entries.map(e => Object.assign({}, e, { p: P.basename(rp) + e.p.slice(P.basename(sp).length) }));
          L.archive.extract(a.target.fs, destDir, { entries: renamed }, rcred, { owner: rcred });
          const size = entries.reduce((x, e) => x + (e.vs || (e.d || '').length), 0);
          c.println(U.pad(P.basename(sp), 40, true) + ' 100% ' + U.pad(U.human(size), 6) + '  ' + U.human(size * 4) + '/s   00:00');
        } else {
          const rp = P.resolve(rhome, sspec.path || '.');
          const entries = L.archive.collect(a.target.fs, P.dirname(rp), [P.basename(rp)], rcred);
          if (!opts.r && entries.some(e => e.t === 'd')) { c.err('scp: ' + sspec.path + ': not a regular file\n'); st = 1; continue; }
          const dp = c.resolve(dst);
          const destDir = c.fs.isDir(dp) ? dp : P.dirname(dp);
          const renamed = c.fs.isDir(dp) ? entries : entries.map(e => Object.assign({}, e, { p: P.basename(dp) + e.p.slice(P.basename(rp).length) }));
          L.archive.extract(c.fs, destDir, { entries: renamed }, c.cred, { owner: c.cred });
          const size = entries.reduce((x, e) => x + (e.vs || (e.d || '').length), 0);
          c.println(U.pad(P.basename(rp), 40, true) + ' 100% ' + U.pad(U.human(size), 6) + '  ' + U.human(size * 4) + '/s   00:00');
        }
        a.target.lab.scheduleSave(a.target);
      } catch (e) { c.err('scp: ' + (e.path || '') + ': ' + e.message + '\n'); st = 1; }
    }
    return st;
  };
  C['ssh-keygen'] = async (c) => {
    const dir = c.sh.cred.home + '/.ssh';
    if (!c.fs.exists(dir)) c.fs.mkdir(dir, { cred: c.cred, mode: 0o700 });
    const key = dir + '/id_rsa';
    c.println('Generating public/private rsa key pair.');
    if (c.fs.exists(key)) { const a = await c.prompt(key + ' already exists.\nOverwrite (y/n)? '); if (!/^y/.test(a || '')) return 1; }
    if (!c.args.includes('-N') && c.term) { await c.prompt('Enter passphrase (empty for no passphrase): ', true); await c.prompt('Enter same passphrase again: ', true); }
    const rnd = U.sha256(c.vm.id + c.user + Date.now());
    c.fs.write(key, '-----BEGIN OPENSSH PRIVATE KEY-----\n' + U.b64encode(rnd + rnd).match(/.{1,70}/g).join('\n') + '\n-----END OPENSSH PRIVATE KEY-----\n', { cred: c.cred, mode: 0o600 });
    c.fs.write(key + '.pub', 'ssh-rsa AAAAB3NzaC1yc2E' + U.b64encode(rnd).replace(/=/g, '') + ' ' + c.user + '@' + c.vm.hostname + '\n', { cred: c.cred, mode: 0o644 });
    c.println('Your identification has been saved in ' + key + '\nYour public key has been saved in ' + key + '.pub\nThe key fingerprint is:\nSHA256:' + U.b64encode(rnd).slice(0, 43) + ' ' + c.user + '@' + c.vm.hostname);
    return 0;
  };
  C['ssh-copy-id'] = async (c) => {
    const rest = c.args.filter(a => !a.startsWith('-'));
    if (!rest.length) return c.fail('Usage: ssh-copy-id [-i [identity_file]] [user@]hostname');
    let pub;
    try { pub = c.fs.read(c.sh.cred.home + '/.ssh/id_rsa.pub', c.cred).trim(); } catch (e) { return c.fail('ERROR: No identities found (ejecute ssh-keygen primero)'); }
    const spec = parseTarget(rest[rest.length - 1], c.user);
    c.err('/usr/bin/ssh-copy-id: INFO: Source of key(s) to be installed: "' + c.sh.cred.home + '/.ssh/id_rsa.pub"\n/usr/bin/ssh-copy-id: INFO: attempting to log in with the new key(s), to filter out any that are already installed\n');
    const a = await sshAuth(c, spec, 22);
    if (!a) return 1;
    const tc = OS.users.cred(a.target.fs, a.user);
    const d = tc.home + '/.ssh';
    if (!a.target.fs.exists(d)) a.target.fs.mkdir(d, { mode: 0o700, uid: tc.uid, gid: tc.gid });
    let ak = '';
    try { ak = a.target.fs.read(d + '/authorized_keys'); } catch (e) { }
    if (!ak.includes(pub)) a.target.fs.write(d + '/authorized_keys', pub + '\n', { append: true, mode: 0o600, uid: tc.uid, gid: tc.gid });
    c.println('\nNumber of key(s) added: 1\n\nNow try logging into the machine, with:   "ssh \'' + spec.user + '@' + spec.host + '\'"\nand check to make sure that only the key(s) you wanted were added.');
    return 0;
  };

  // ---------------- firewalld ----------------
  C['firewall-cmd'] = (c) => {
    const vm = c.vm;
    const args = c.args;
    const has = (f) => args.includes(f);
    const val = (f) => { const a = args.find(x => x.startsWith(f + '=')); return a ? a.slice(f.length + 1) : null; };
    if (has('--state')) { c.println(vm.fw.running ? 'running' : 'not running'); return vm.fw.running ? 0 : 252; }
    if (c.cred.uid !== 0 && !args.every(a => /^--(list|get|query|state|zone)/.test(a))) { c.err('Authorization failed.\n    Make sure polkit agent is running or run the application as superuser.\n'); return 11; }
    if (!vm.fw.running) { c.println('FirewallD is not running'); return 252; }
    const perm = has('--permanent');
    const cfg = perm ? vm.fwPermanent() : { services: vm.fw.services.slice(), ports: vm.fw.ports.slice() };
    const save = () => { if (perm) vm.fwSavePermanent(cfg); else { vm.fw.services = cfg.services; vm.fw.ports = cfg.ports; } };
    if (has('--reload') || has('--complete-reload')) { vm.fwReload(); c.println('success'); return 0; }
    if (has('--runtime-to-permanent')) { vm.fwSavePermanent({ services: vm.fw.services, ports: vm.fw.ports }); c.println('success'); return 0; }
    if (has('--get-default-zone')) { c.println('public'); return 0; }
    if (has('--get-active-zones')) { c.println('public\n  interfaces: enp1s0'); return 0; }
    if (has('--get-zones')) { c.println('block dmz drop external home internal nm-shared public trusted work'); return 0; }
    if (has('--get-services')) { c.println(Object.keys(L.FW_SERVICES).join(' ')); return 0; }
    if (has('--list-ports')) { c.println(cfg.ports.join(' ')); return 0; }
    if (has('--list-services')) { c.println(cfg.services.join(' ')); return 0; }
    if (has('--list-all')) {
      c.println('public (active)\n  target: default\n  icmp-block-inversion: no\n  interfaces: enp1s0\n  sources: \n  services: ' + cfg.services.join(' ') + '\n  ports: ' + cfg.ports.join(' ') + '\n  protocols: \n  forward: yes\n  masquerade: no\n  forward-ports: \n  source-ports: \n  icmp-blocks: \n  rich rules: ');
      return 0;
    }
    let did = false;
    for (const a of args) {
      let m;
      if ((m = /^--add-port=(\d+(?:-\d+)?)\/(tcp|udp)$/.exec(a))) { const k = m[1] + '/' + m[2]; if (cfg.ports.includes(k)) c.err('Warning: ALREADY_ENABLED: ' + k + '\n'); else cfg.ports.push(k); did = true; }
      else if ((m = /^--remove-port=(\d+(?:-\d+)?)\/(tcp|udp)$/.exec(a))) { const k = m[1] + '/' + m[2]; if (!cfg.ports.includes(k)) c.err('Warning: NOT_ENABLED: ' + k + '\n'); cfg.ports = cfg.ports.filter(x => x !== k); did = true; }
      else if ((m = /^--add-service=(.+)$/.exec(a))) { if (!L.FW_SERVICES[m[1]]) { c.err('Error: INVALID_SERVICE: ' + m[1] + '\n'); return 101; } if (cfg.services.includes(m[1])) c.err('Warning: ALREADY_ENABLED: ' + m[1] + '\n'); else cfg.services.push(m[1]); did = true; }
      else if ((m = /^--remove-service=(.+)$/.exec(a))) { cfg.services = cfg.services.filter(x => x !== m[1]); did = true; }
      else if ((m = /^--query-port=(.+)$/.exec(a))) { const y = cfg.ports.includes(m[1]); c.println(y ? 'yes' : 'no'); return y ? 0 : 1; }
      else if ((m = /^--query-service=(.+)$/.exec(a))) { const y = cfg.services.includes(m[1]); c.println(y ? 'yes' : 'no'); return y ? 0 : 1; }
      else if (/^--add-port=|^--remove-port=/.test(a)) { c.err("Error: INVALID_PORT: '" + a.split('=')[1] + "' (formato: 8080/tcp)\n"); return 102; }
      else if (a.startsWith('--') && !['--permanent', '--zone=public'].includes(a) && !a.startsWith('--zone=')) { c.err('firewall-cmd: error: unrecognized arguments: ' + a + '\n'); return 2; }
    }
    if (did) { save(); c.println('success'); return 0; }
    return c.fail('usage: see firewall-cmd man page', 2);
  };
})(globalThis.JLab = globalThis.JLab || {});
