/*
 * Comandos de sistema: procesos (ps, kill, top vía editors.js), usuarios
 * (useradd, passwd, su, sudo, id), systemd (systemctl, journalctl),
 * información (uname, free, uptime, lscpu, lsblk, dmesg, vmstat), etc.
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, OS = L.os;
  const { getopt, lines } = L.cmdutil;

  const requireRoot = (c) => { if (c.cred.uid !== 0) { c.err(c.name + ': Permission denied.\n'); return false; } return true; };

  C.whoami = (c) => { c.println(c.user); return 0; };
  C.id = (c) => {
    const name = c.args.filter(a => !a.startsWith('-'))[0] || c.user;
    const cr = OS.users.cred(c.fs, name);
    if (!cr) return c.fail("'" + name + "': no such user");
    if (c.args.includes('-u')) { c.println(c.args.includes('-n') ? cr.name : cr.uid); return 0; }
    if (c.args.includes('-g')) { c.println(c.args.includes('-n') ? c.groupName(cr.gid) : cr.gid); return 0; }
    if (c.args.includes('-Z')) { c.println('unconfined_u:unconfined_r:unconfined_t:s0-s0:c0.c1023'); return 0; }
    if (c.args.includes('-G')) { c.println(cr.gids.map(g => c.args.includes('-n') ? c.groupName(g) : g).join(' ')); return 0; }
    c.println('uid=' + cr.uid + '(' + cr.name + ') gid=' + cr.gid + '(' + c.groupName(cr.gid) + ') groups=' + cr.gids.map(g => g + '(' + c.groupName(g) + ')').join(',') + (name === c.user ? ' context=unconfined_u:unconfined_r:unconfined_t:s0-s0:c0.c1023' : ''));
    return 0;
  };
  C.groups = (c) => { const name = c.args[0] || c.user; const cr = OS.users.cred(c.fs, name); if (!cr) return c.fail("'" + name + "': no such user"); c.println((c.args[0] ? name + ' : ' : '') + cr.gids.map(g => c.groupName(g)).join(' ')); return 0; };
  C.hostname = (c) => {
    if (c.args.includes('-I') || c.args.includes('-i')) { c.println(c.args.includes('-I') ? c.vm.ip + ' ' : c.vm.ip); return 0; }
    if (c.args.includes('-s')) { c.println(c.vm.hostname.split('.')[0]); return 0; }
    if (c.args.includes('-f')) { c.println(c.vm.hostname); return 0; }
    const n = c.args.filter(a => !a.startsWith('-'))[0];
    if (n) { if (!requireRoot(c)) return 1; c.vm.hostname = n; c.sh.env.HOSTNAME = n; return 0; }
    c.println(c.vm.hostname); return 0;
  };
  C.hostnamectl = (c) => {
    if (c.args[0] === 'set-hostname' && c.args[1]) {
      if (!requireRoot(c)) return 1;
      c.vm.hostname = c.args[1]; c.fs.write('/etc/hostname', c.args[1] + '\n'); c.sh.env.HOSTNAME = c.args[1];
      c.vm.lab.scheduleSave(c.vm); c.vm.lab.emit('change'); return 0;
    }
    const os = c.vm.osInfo;
    c.println(' Static hostname: ' + c.vm.hostname + '\n       Icon name: computer-vm\n         Chassis: vm 🖴\n      Machine ID: ' + U.md5(c.vm.id).slice(0, 32) + '\n  Virtualization: kvm\nOperating System: ' + os.prettyName + '\n     CPE OS Name: cpe:/o:redhat:enterprise_linux:' + os.versionId.split('.')[0] + '::baseos\n          Kernel: Linux ' + os.kernel + '\n    Architecture: x86-64\n Hardware Vendor: JBoss Virtual Lab\n  Hardware Model: KVM (simulado)');
    return 0;
  };
  C.uname = (c) => {
    const os = c.vm.osInfo;
    const a = c.args.join('');
    const parts = { s: 'Linux', n: c.vm.hostname, r: os.kernel, v: '#1 SMP PREEMPT_DYNAMIC', m: 'x86_64', p: 'x86_64', i: 'x86_64', o: 'GNU/Linux' };
    if (!a) { c.println('Linux'); return 0; }
    if (a.includes('a')) { c.println([parts.s, parts.n, parts.r, parts.v, parts.m, parts.p, parts.i, parts.o].join(' ')); return 0; }
    c.println('snrvmpio'.split('').filter(k => a.includes(k)).map(k => parts[k]).join(' '));
    return 0;
  };
  const uptimeLine = (vm) => {
    const sec = Math.floor((Date.now() - vm.bootTime) / 1000);
    const la = vm.loadAvg();
    const users = Array.from(vm.sessions).length || 1;
    return ' ' + U.clock() + ' up ' + U.uptimeStr(sec) + ',  ' + users + ' user' + (users > 1 ? 's' : '') + ',  load average: ' + la.map(x => x.toFixed(2)).join(', ');
  };
  C.uptime = (c) => { if (c.args.includes('-p')) { c.println('up ' + Math.floor((Date.now() - c.vm.bootTime) / 60000) + ' minutes'); return 0; } c.println(uptimeLine(c.vm)); return 0; };
  C.date = (c) => {
    const f = c.args.find(a => a.startsWith('+'));
    const d = new Date();
    if (f) {
      c.println(f.slice(1).replace(/%([a-zA-Z%])/g, (m, k) => ({ Y: d.getFullYear(), m: U.two(d.getMonth() + 1), d: U.two(d.getDate()), H: U.two(d.getHours()), M: U.two(d.getMinutes()), S: U.two(d.getSeconds()), s: Math.floor(d / 1000), F: d.getFullYear() + '-' + U.two(d.getMonth() + 1) + '-' + U.two(d.getDate()), T: U.clock(), y: String(d.getFullYear()).slice(2), b: U.MONTHS[d.getMonth()], a: U.DAYS[d.getDay()], Z: 'UTC', z: '+0000', '%': '%', N: '000000000', j: String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5)).padStart(3, '0') }[k] ?? m)));
      return 0;
    }
    c.println(U.dateStr(Date.now()));
    return 0;
  };
  C.cal = (c) => {
    const d = new Date(); const y = d.getFullYear(), m = d.getMonth();
    const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const title = names[m] + ' ' + y;
    c.println(' '.repeat(Math.floor((20 - title.length) / 2)) + title + '\nSu Mo Tu We Th Fr Sa');
    let line = '   '.repeat(new Date(y, m, 1).getDay());
    const days = new Date(y, m + 1, 0).getDate();
    for (let i = 1; i <= days; i++) {
      line += (i === d.getDate() && c.isTTY ? '\x1b[7m' + U.pad(i, 2) + '\x1b[0m' : U.pad(i, 2)) + ' ';
      if (new Date(y, m, i).getDay() === 6) { c.println(line.trimEnd()); line = ''; }
    }
    if (line) c.println(line.trimEnd());
    return 0;
  };
  C.free = (c) => {
    const { opts } = getopt(c.args, { flags: 'mghbkwlt', long: { human: 'h', mega: 'm', giga: 'g' } });
    const m = c.vm.memStats();
    const sw = c.vm.swapMB();
    const f = (mb) => opts.h ? (mb >= 1024 ? (mb / 1024).toFixed(1) + 'Gi' : Math.round(mb) + 'Mi') : opts.g ? String(Math.floor(mb / 1024)) : opts.m ? String(Math.round(mb)) : String(Math.round(mb * 1024));
    const rows = [['', 'total', 'used', 'free', 'shared', 'buff/cache', 'available'],
    ['Mem:', f(m.total), f(m.used), f(m.free), f(8), f(m.cache), f(m.available)],
    ['Swap:', f(sw), f(0), f(sw)]];
    if (opts.t) rows.push(['Total:', f(m.total + sw), f(m.used), f(m.free + sw)]);
    const w = [6, 12, 11, 11, 11, 11, 11];
    for (const r of rows) c.println(r.map((x, i) => i === 0 ? U.pad(x, w[i], true) : U.pad(x, w[i])).join(''));
    return 0;
  };
  C.nproc = (c) => { c.println(c.vm.cpu); return 0; };
  C.lscpu = (c) => {
    c.println('Architecture:            x86_64\n  CPU op-mode(s):        32-bit, 64-bit\n  Byte Order:            Little Endian\nCPU(s):                  ' + c.vm.cpu + '\n  On-line CPU(s) list:   0-' + (c.vm.cpu - 1) + '\nVendor ID:               GenuineIntel\n  Model name:            Intel(R) Xeon(R) Gold 6230 CPU @ 2.10GHz\n    Thread(s) per core:  1\n    Core(s) per socket:  ' + c.vm.cpu + '\n    Socket(s):           1\nVirtualization features:\n  Hypervisor vendor:     KVM\n  Virtualization type:   full\nCaches (sum of all):\n  L1d:                   ' + (32 * c.vm.cpu) + ' KiB (' + c.vm.cpu + ' instances)\n  L2:                    ' + c.vm.cpu + ' MiB (' + c.vm.cpu + ' instances)\n  L3:                    27.5 MiB (1 instance)');
    return 0;
  };
  C.lsblk = (c) => {
    const g = (c.vm.diskMB / 1024);
    c.println('NAME          MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nsda             8:0    0 ' + U.pad(g.toFixed(0) + 'G', 4) + '  0 disk \n├─sda1          8:1    0    1G  0 part /boot\n└─sda2          8:2    0 ' + U.pad((g - 1).toFixed(0) + 'G', 4) + '  0 part \n  ├─rhel-root 253:0    0 ' + U.pad((g - 1 - c.vm.swapMB() / 1024).toFixed(1) + 'G', 4) + '  0 lvm  /\n  └─rhel-swap 253:1    0 ' + U.pad((c.vm.swapMB() / 1024).toFixed(1) + 'G', 4) + '  0 lvm  [SWAP]\nsr0            11:0    1 1024M  0 rom  ');
    return 0;
  };
  C.findmnt = (c) => { c.println('TARGET   SOURCE                FSTYPE OPTIONS\n/        /dev/mapper/rhel-root xfs    rw,relatime,seclabel\n├─/boot  /dev/sda1             xfs    rw,relatime,seclabel\n├─/proc  proc                  proc   rw,nosuid,nodev,noexec\n└─/tmp   tmpfs                 tmpfs  rw,nosuid,nodev'); return 0; };
  C.mount = (c) => { if (c.args.length) return c.fail('only root can do that (simulado: montajes no soportados)', 32); c.out(c.fs.read('/proc/mounts')); return 0; };
  C.dmesg = (c) => { if (c.cred.uid !== 0) return c.fail('read kernel buffer failed: Operation not permitted'); c.out(c.vm.dmesg.map(l => l.replace(/\x1b\[[0-9;]*m/g, '') + '\n').join('')); return 0; };
  C.vmstat = async (c) => {
    const [delay, count] = c.args.filter(a => /^\d+$/.test(a)).map(Number);
    const row = () => { const m = c.vm.memStats(); const cpu = c.vm.cpuPercent(); return U.pad(Math.round(c.vm.loadAvg()[0]), 2) + '  0      0 ' + U.pad(m.free * 1024, 6) + '   2104 ' + U.pad(m.cache * 1024, 6) + '    0    0     3    12  110  190 ' + U.pad(Math.round(cpu * 0.7), 2) + ' ' + U.pad(Math.round(cpu * 0.3), 2) + ' ' + U.pad(Math.max(0, 100 - Math.round(cpu)), 2) + '  0  0'; };
    c.println('procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----\n r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st');
    c.println(row());
    for (let i = 1; delay && (count ? i < count : true); i++) { await c.sleep(delay * 1000); c.println(row()); }
    return 0;
  };
  C.iostat = (c) => { c.println('Linux ' + c.vm.osInfo.kernel + ' (' + c.vm.hostname + ') \t' + new Date().toLocaleDateString() + ' \t_x86_64_\t(' + c.vm.cpu + ' CPU)\n\navg-cpu:  %user   %nice %system %iowait  %steal   %idle\n           ' + (c.vm.cpuPercent() * 0.7).toFixed(2) + '    0.00    ' + (c.vm.cpuPercent() * 0.3).toFixed(2) + '    0.05    0.00   ' + (100 - c.vm.cpuPercent()).toFixed(2) + '\n\nDevice             tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn\nsda               2.10        21.33        14.02     120331      79123\ndm-0              2.02        20.11        14.00     113400      79000'); return 0; };
  C.mpstat = C.iostat; C.sar = C.iostat; C.pidstat = C.iostat;

  // ---------------- procesos ----------------
  function procList(vm) {
    return Array.from(vm.procs.values()).sort((a, b) => a.pid - b.pid);
  }
  function etime(ms) { const s = Math.floor(ms / 1000); return U.two(Math.floor(s / 60)) + ':' + U.two(s % 60); }
  C.ps = (c) => {
    const a = c.args.join(' ');
    const list = procList(c.vm);
    const bsd = /(^|\s)a?u?x/.test(a) && !a.includes('-');
    const full = /-\w*f/.test(a) || bsd;
    const all = /-\w*[eA]/.test(a) || /x/.test(a);
    const fmt = /-o\s*(\S+)/.exec(a);
    const pfilter = /-p\s*(\d+)/.exec(a);
    const ufilter = /-u\s*(\S+)/.exec(a);
    const cfilter = /-C\s*(\S+)/.exec(a);
    let rows = all ? list : list.filter(p => p.user === c.user && p.tty !== '?');
    if (pfilter) rows = list.filter(p => p.pid === +pfilter[1]);
    if (ufilter) rows = list.filter(p => p.user === ufilter[1]);
    if (cfilter) rows = list.filter(p => p.name === cfilter[1]);
    const totalMem = c.vm.ramMB;
    if (fmt) {
      const cols = fmt[1].split(',');
      const val = (p, k) => ({ pid: p.pid, ppid: p.ppid, user: p.user, cmd: p.cmd, args: p.cmd, comm: p.name, '%mem': (p.memMB / totalMem * 100).toFixed(1), '%cpu': (p.cpu || 0).toFixed(1), rss: Math.round(p.memMB * 1024), etime: etime(Date.now() - p.start), stat: p.stat, tty: p.tty, ni: p.ni || 0, nice: p.ni || 0, pri: 20 + (p.ni || 0), label: 'system_u:system_r:unconfined_service_t:s0' }[k.toLowerCase()] ?? '');
      c.println(cols.map(k => k.toUpperCase()).join(' '));
      for (const p of rows) c.println(cols.map(k => val(p, k)).join(' '));
      return pfilter && !rows.length ? 1 : 0;
    }
    if (bsd) {
      c.println('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
      for (const p of rows) c.println(U.pad(p.user, 10, true) + U.pad(p.pid, 7) + U.pad((p.cpu || 0).toFixed(1), 5) + U.pad((p.memMB / totalMem * 100).toFixed(1), 5) + U.pad(Math.round(p.memMB * 1024 * 1.6), 7) + U.pad(Math.round(p.memMB * 1024), 6) + ' ' + U.pad(p.tty, 8, true) + ' ' + U.pad(p.stat + (p.pid === 1 ? 's' : ''), 4, true) + ' ' + U.clock(p.start).slice(0, 5) + '   0:' + U.two(Math.floor((p.cpu || 0) * (Date.now() - p.start) / 100000) % 60) + ' ' + p.cmd);
      return 0;
    }
    if (full) {
      c.println('UID          PID    PPID  C STIME TTY          TIME CMD');
      for (const p of rows) c.println(U.pad(p.user, 8, true) + U.pad(p.pid, 8) + U.pad(p.ppid, 8) + '  ' + Math.round(p.cpu || 0) + ' ' + U.clock(p.start).slice(0, 5) + ' ' + U.pad(p.tty, 8, true) + '  00:00:0' + (p.pid % 10) + ' ' + p.cmd);
      return pfilter && !rows.length ? 1 : 0;
    }
    c.println('    PID TTY          TIME CMD');
    for (const p of rows) c.println(U.pad(p.pid, 7) + ' ' + U.pad(p.tty, 8, true) + '     00:00:00 ' + p.name);
    return pfilter && !rows.length ? 1 : 0;
  };
  const SIGS = { HUP: 1, INT: 2, QUIT: 3, KILL: 9, USR1: 10, USR2: 12, TERM: 15, CONT: 18, STOP: 19 };
  function parseSig(s) { if (!s) return 15; s = s.replace(/^-/, '').replace(/^SIG/i, '').toUpperCase(); if (/^\d+$/.test(s)) return +s; if (s === 's') return 15; return SIGS[s] || null; }
  function canSignal(c, p) { return c.cred.uid === 0 || p.user === c.user; }
  C.kill = (c) => {
    let sig = 15; const targets = [];
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === '-l' || a === '-L') { c.println(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 9) SIGKILL\n10) SIGUSR1\t12) SIGUSR2\t15) SIGTERM\t18) SIGCONT\t19) SIGSTOP'); return 0; }
      if (a === '-s') { sig = parseSig(c.args[++i]); continue; }
      if (/^-\w+$/.test(a) && !targets.length) { sig = parseSig(a); if (sig === null) return c.fail(a.slice(1) + ': invalid signal specification'); continue; }
      targets.push(a);
    }
    if (!targets.length) return c.fail('usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]', 2);
    let st = 0;
    for (const t of targets) {
      if (t.startsWith('%')) {
        const j = c.sh.jobs.find(j => j.id === +t.slice(1));
        if (!j) { c.err('-bash: kill: ' + t + ': no such job\n'); st = 1; continue; }
        j.fg.aborted = true; (j.fg.waiters || []).forEach(w => w()); continue;
      }
      const p = c.vm.proc(+t);
      if (!p) { c.err('-bash: kill: (' + t + ') - No such process\n'); st = 1; continue; }
      if (!canSignal(c, p)) { c.err('-bash: kill: (' + t + ') - Operation not permitted\n'); st = 1; continue; }
      if (sig === 0) continue;
      if (p.pid === c.sh.pid) { c.err('kill: no se permite matar el shell actual en el laboratorio (use exit)\n'); st = 1; continue; }
      c.vm.kill(p.pid, sig);
    }
    return st;
  };
  const matchProcs = (c, pat, full, exact, user) => {
    const re = exact ? new RegExp('^' + pat + '$') : new RegExp(pat);
    return procList(c.vm).filter(p => (full ? re.test(p.cmd) : re.test(p.name)) && (!user || p.user === user) && p.pid !== c.sh.pid);
  };
  C.pgrep = (c) => {
    const { opts, rest } = getopt(c.args, { flags: 'flax', values: 'u' });
    if (!rest.length) return c.fail('no matching criteria specified\nTry `pgrep --help\' for more information.', 2);
    const ps = matchProcs(c, rest[0], opts.f, opts.x, opts.u);
    for (const p of ps) c.println(p.pid + (opts.l ? ' ' + p.name : opts.a ? ' ' + p.cmd : ''));
    return ps.length ? 0 : 1;
  };
  C.pkill = (c) => {
    const sigArg = c.args.find(a => /^-(\d+|[A-Z]+)$/.test(a));
    const { opts, rest } = getopt(c.args.filter(a => a !== sigArg), { flags: 'fx', values: 'u' });
    if (!rest.length) return c.fail('no matching criteria specified', 2);
    const ps = matchProcs(c, rest[0], opts.f, opts.x, opts.u);
    let st = ps.length ? 0 : 1;
    for (const p of ps) { if (!canSignal(c, p)) { c.err('pkill: killing pid ' + p.pid + ' failed: Operation not permitted\n'); st = 1; continue; } c.vm.kill(p.pid, parseSig(sigArg)); }
    return st;
  };
  C.killall = (c) => {
    const sigArg = c.args.find(a => /^-(\d+|[A-Z]+)$/.test(a));
    const names = c.args.filter(a => a !== sigArg && !a.startsWith('-'));
    let st = 0;
    for (const n of names) {
      const ps = procList(c.vm).filter(p => p.name === n);
      if (!ps.length) { c.err(n + ': no process found\n'); st = 1; }
      for (const p of ps) if (canSignal(c, p)) c.vm.kill(p.pid, parseSig(sigArg));
    }
    return st;
  };
  C.pidof = (c) => { const ps = procList(c.vm).filter(p => c.args.includes(p.name)); if (!ps.length) return 1; c.println(ps.map(p => p.pid).reverse().join(' ')); return 0; };
  C.pstree = (c) => {
    const list = procList(c.vm);
    const kids = (pid) => list.filter(p => p.ppid === pid && p.pid !== pid);
    const rec = (p, pre, last, first) => {
      c.println((first ? '' : pre + (last ? '└─' : '├─')) + p.name + (c.args.includes('-p') ? '(' + p.pid + ')' : ''));
      const k = kids(p.pid);
      k.forEach((x, i) => rec(x, first ? '' : pre + (last ? '  ' : '│ '), i === k.length - 1, false));
    };
    const root = list.find(p => p.pid === 1);
    if (root) rec(root, '', true, true);
    for (const p of list.filter(p => p.pid !== 1 && !list.some(q => q.pid === p.ppid))) rec(p, '', true, true);
    return 0;
  };
  C.fuser = (c) => {
    const m = /^(\d+)\/tcp$/.exec(c.args.filter(a => !a.startsWith('-'))[0] || '');
    if (!m) return c.fail('solo se soporta: fuser PUERTO/tcp');
    const l = c.vm.listeners.filter(x => x.port === +m[1]);
    if (!l.length) return 1;
    c.println(m[1] + '/tcp:' + l.map(x => '  ' + x.pid).join(''));
    if (c.args.includes('-k')) for (const x of l) c.vm.kill(x.pid, 9);
    return 0;
  };
  C.lsof = (c) => {
    const im = /-i\s*:?(\d+)?/.exec(c.args.join(' '));
    if (im) {
      const ls = c.vm.listeners.filter(l => !im[1] || l.port === +im[1]);
      if (!ls.length) return 1;
      c.println('COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME');
      for (const l of ls) { const p = c.vm.proc(l.pid) || { name: l.proc, user: 'root' }; c.println(U.pad(p.name, 9, true) + U.pad(l.pid, 5) + ' ' + U.pad(p.user, 6, true) + ' ' + U.pad((400 + l.port % 100) + 'u', 4) + '  IPv4 ' + U.pad(20000 + l.port, 6) + '      0t0  TCP ' + (l.addr === '0.0.0.0' ? '*' : l.addr) + ':' + l.port + ' (LISTEN)'); }
      return 0;
    }
    c.println('COMMAND   PID   USER   FD   TYPE DEVICE SIZE/OFF NODE NAME');
    for (const p of procList(c.vm).slice(0, 40)) c.println(U.pad(p.name, 9, true) + U.pad(p.pid, 5) + ' ' + U.pad(p.user, 6, true) + '  cwd    DIR  253,0     4096  128 /');
    return 0;
  };
  C.sleep = async (c) => {
    if (!c.args.length) return c.fail('missing operand');
    let ms = 0;
    for (const a of c.args) { const m = /^(\d*\.?\d+)([smhd]?)$/.exec(a); if (!m) return c.fail("invalid time interval '" + a + "'"); ms += parseFloat(m[1]) * { '': 1000, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2]]; }
    const p = c.vm.spawn({ user: c.user, cmd: 'sleep ' + c.args.join(' '), memMB: 0.5, tty: c.sh.tty, ppid: c.sh.pid });
    try { await c.sleep(ms); } finally { c.vm.reap(p.pid); }
    return 0;
  };
  C.env = async (c) => {
    const envs = {}; let i = 0;
    const clean = c.args[0] === '-i';
    if (clean) i++;
    while (i < c.args.length && /^[A-Za-z_]\w*=/.test(c.args[i])) { const [k, ...v] = c.args[i].split('='); envs[k] = v.join('='); i++; }
    if (i < c.args.length) return c.sh.execCommand(c.args.slice(i), c.io, envs);
    const all = Object.assign(clean ? {} : c.sh.exportedEnv(), envs);
    for (const k of Object.keys(all)) c.println(k + '=' + all[k]);
    return 0;
  };
  C.printenv = (c) => {
    const e = c.sh.exportedEnv();
    if (c.args.length) { let st = 0; for (const k of c.args) { if (e[k] !== undefined) c.println(e[k]); else st = 1; } return st; }
    for (const k of Object.keys(e)) c.println(k + '=' + e[k]);
    return 0;
  };
  C.nohup = async (c) => {
    if (!c.args.length) return c.fail('missing operand');
    let io = c.io;
    if (c.io.stdout.isTTY) {
      try {
        const out = new L.shio.FileSink(c.sh, c.sh.resolve('nohup.out'), true);
        c.err('nohup: ignoring input and appending output to \'nohup.out\'\n');
        io = Object.assign({}, c.io, { stdout: out, stderr: c.io.stderr.isTTY ? out : c.io.stderr });
      } catch (e) { }
    } else if (c.io.stderr.isTTY) { c.err('nohup: ignoring input\n'); io = Object.assign({}, c.io, { stderr: c.io.stdout }); }
    return c.sh.execCommand(c.args, io);
  };
  C.timeout = async (c) => {
    const secs = parseFloat(c.args[0]);
    if (isNaN(secs)) return c.fail("invalid time interval '" + c.args[0] + "'", 125);
    const fg = c.sh.fg;
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; if (fg) { fg.aborted = true; (fg.waiters || []).forEach(w => w()); } }, secs * 1000);
    try { return await c.sh.execCommand(c.args.slice(1), c.io); }
    catch (e) { if (timedOut && e.aborted) { if (fg) { fg.aborted = false; fg.waiters = []; } return 124; } throw e; }
    finally { clearTimeout(t); }
  };
  C.stdbuf = (c) => c.sh.execCommand(c.args.filter(a => !/^-[ioe]/.test(a)), c.io);
  C.watch = async (c) => {
    const { opts, rest } = getopt(c.args, { values: 'n', flags: 'dt', stopAtFirst: true });
    const n = parseFloat(opts.n || 2);
    const cmd = rest.join(' ');
    if (!c.term || !c.isTTY) return c.fail('watch requiere una terminal');
    while (true) {
      const buf = new L.shio.BufferSink();
      await c.sh.run(cmd, { stdin: new L.shio.NullSource(), stdout: buf, stderr: buf });
      c.out('\x1b[2J\x1b[H' + (opts.t ? '' : 'Every ' + n.toFixed(1) + 's: ' + cmd + ' '.repeat(Math.max(1, c.term.cols - cmd.length - 40)) + c.vm.hostname.split('.')[0] + ': ' + U.dateStr(Date.now()) + '\n\n') + buf.data);
      await c.sleep(n * 1000);
    }
  };
  C.logger = (c) => {
    const { opts, rest } = getopt(c.args, { values: 'tp' });
    c.vm.logSys(opts.t || c.user, rest.join(' '));
    return 0;
  };
  C.who = (c) => {
    if (c.args.join('') === '-b') { c.println('         system boot  ' + new Date(c.vm.bootTime).toISOString().slice(0, 16).replace('T', ' ')); return 0; }
    const seen = new Set();
    for (const s of c.vm.sessions) { const k = s.user + s.tty; if (seen.has(k)) continue; seen.add(k); c.println(U.pad(s.user, 8, true) + ' ' + U.pad(s.tty, 12, true) + ' ' + new Date(s.since).toISOString().slice(0, 16).replace('T', ' ') + (s.from ? ' (' + s.from + ')' : '')); }
    return 0;
  };
  C.w = (c) => {
    c.println(uptimeLine(c.vm));
    c.println('USER     TTY        LOGIN@   IDLE   JCPU   PCPU WHAT');
    for (const s of c.vm.sessions) c.println(U.pad(s.user, 8, true) + ' ' + U.pad(s.tty, 10, true) + ' ' + U.clock(s.since).slice(0, 5) + '    0.00s  0.02s  0.00s -bash');
    return 0;
  };
  C.last = (c) => {
    for (const s of c.vm.sessions) c.println(U.pad(s.user, 8, true) + ' ' + U.pad(s.tty, 12, true) + ' ' + U.pad(s.from || '', 16, true) + ' ' + U.dateStr(s.since).slice(0, 16) + '   still logged in');
    c.println('reboot   system boot  ' + c.vm.osInfo.kernel.slice(0, 16) + ' ' + U.dateStr(c.vm.bootTime).slice(0, 16) + '   still running\n\nwtmp begins ' + U.dateStr(c.vm.created));
    return 0;
  };
  C.script = (c) => c.fail('no soportado en el laboratorio');
  C.rename = (c) => { const [from, to, ...files] = c.args; for (const f of files) { const nf = f.replace(from, to); if (nf !== f) c.fs.rename(c.resolve(f), c.resolve(nf), c.cred); } return 0; };
  C.col = async (c) => { c.out((await c.readAll()).replace(/.\x08/g, '')); return 0; };
  C.hostid = (c) => { c.println(U.md5(c.vm.id).slice(0, 8)); return 0; };

  // ---------------- usuarios ----------------
  function writeLines(c, file, fn) {
    const ls = c.fs.read(file).split('\n').filter((l, i, a) => l || i < a.length - 1);
    const out = fn(ls.filter(Boolean));
    c.fs.write(file, out.join('\n') + '\n');
  }
  C.useradd = (c) => {
    if (!requireRoot(c)) return 1;
    const { opts, rest } = getopt(c.args, { flags: 'mMrUN', values: 'dsuGgcek', long: { home: 'd=', shell: 's=', uid: 'u=', groups: 'G=', gid: 'g=', comment: 'c=', system: 'r', 'create-home': 'm', 'no-create-home': 'M' } });
    const name = rest[0];
    if (!name) return c.fail('Usage: useradd [options] LOGIN', 2);
    if (!/^[a-z_][a-z0-9_-]*\$?$/.test(name)) return c.fail("invalid user name '" + name + "'", 3);
    if (OS.users.byName(c.fs, name)) return c.fail("user '" + name + "' already exists", 9);
    const pw = OS.users.passwd(c.fs);
    const grs = OS.users.groups(c.fs);
    let uid = opts.u ? +opts.u : null;
    if (uid === null) { const min = opts.r ? 900 : 1000; const used = new Set(pw.map(u => u.uid)); uid = opts.r ? 999 : min; while (used.has(uid)) uid += opts.r ? -1 : 1; }
    let gid;
    if (opts.g) { const g = grs.find(x => x.name === opts.g || String(x.gid) === opts.g); if (!g) return c.fail("group '" + opts.g + "' does not exist", 6); gid = g.gid; }
    else if (grs.find(g => g.name === name)) return c.fail('group ' + name + ' exists - if you want to add this user to that group, use -g.', 9);
    else {
      gid = uid; const usedG = new Set(grs.map(g => g.gid)); while (usedG.has(gid)) gid++;
      writeLines(c, '/etc/group', ls => ls.concat([name + ':x:' + gid + ':']));
    }
    const home = opts.d || '/home/' + name;
    const shell = opts.s || '/bin/bash';
    writeLines(c, '/etc/passwd', ls => ls.concat([name + ':x:' + uid + ':' + gid + ':' + (opts.c || '') + ':' + home + ':' + shell]));
    writeLines(c, '/etc/shadow', ls => ls.concat([name + ':!!:' + Math.floor(Date.now() / 864e5) + ':0:99999:7:::']));
    c.fs.stat('/etc/shadow').m = 0;
    if (opts.G) for (const g of opts.G.split(',')) {
      if (!grs.find(x => x.name === g)) return c.fail("group '" + g + "' does not exist", 6);
      writeLines(c, '/etc/group', ls => ls.map(l => { const f = l.split(':'); if (f[0] === g) { const m = (f[3] || '').split(',').filter(Boolean); m.push(name); f[3] = m.join(','); } return f.join(':'); }));
    }
    const createHome = opts.M ? false : (opts.m || !opts.r);
    if (createHome && !c.fs.exists(home)) {
      c.fs.mkdir(home, { parents: true, mode: 0o700, uid, gid });
      c.fs.write(home + '/.bashrc', '# .bashrc\n[ -f /etc/bashrc ] && . /etc/bashrc\n', { uid, gid });
      c.fs.write(home + '/.bash_profile', '# .bash_profile\n[ -f ~/.bashrc ] && . ~/.bashrc\n', { uid, gid });
    }
    c.vm.logSys('useradd[' + c.vm.nextPid + ']', 'new user: name=' + name + ', UID=' + uid + ', GID=' + gid + ', home=' + home + ', shell=' + shell, '/var/log/secure');
    return 0;
  };
  C.adduser = C.useradd;
  C.userdel = (c) => {
    if (!requireRoot(c)) return 1;
    const { opts, rest } = getopt(c.args, { flags: 'rf' });
    const name = rest[0];
    const u = OS.users.byName(c.fs, name);
    if (!u) return c.fail("user '" + name + "' does not exist", 6);
    if (Array.from(c.vm.procs.values()).some(p => p.user === name && p.kind !== 'java') && !opts.f) return c.fail('user ' + name + ' is currently used by process ' + Array.from(c.vm.procs.values()).find(p => p.user === name).pid, 8);
    for (const f of ['/etc/passwd', '/etc/shadow']) writeLines(c, f, ls => ls.filter(l => l.split(':')[0] !== name));
    writeLines(c, '/etc/group', ls => ls.filter(l => l.split(':')[0] !== name).map(l => { const f = l.split(':'); f[3] = (f[3] || '').split(',').filter(m => m && m !== name).join(','); return f.join(':'); }));
    c.fs.stat('/etc/shadow').m = 0;
    if (opts.r && c.fs.exists(u.home)) c.fs.rmrf(u.home);
    return 0;
  };
  C.usermod = (c) => {
    if (!requireRoot(c)) return 1;
    const { opts, rest } = getopt(c.args, { flags: 'aLU', values: 'Ggsdlc', long: { append: 'a', groups: 'G=', shell: 's=', home: 'd=', lock: 'L', unlock: 'U' } });
    const name = rest[0];
    if (!OS.users.byName(c.fs, name)) return c.fail("user '" + name + "' does not exist", 6);
    if (opts.G) {
      const want = opts.G.split(',');
      for (const g of want) if (!OS.users.groups(c.fs).find(x => x.name === g)) return c.fail("group '" + g + "' does not exist", 6);
      writeLines(c, '/etc/group', ls => ls.map(l => {
        const f = l.split(':'); let m = (f[3] || '').split(',').filter(Boolean);
        if (want.includes(f[0])) { if (!m.includes(name)) m.push(name); }
        else if (!opts.a) m = m.filter(x => x !== name);
        f[3] = m.join(','); return f.join(':');
      }));
    }
    if (opts.g) { const g = OS.users.groups(c.fs).find(x => x.name === opts.g || String(x.gid) === opts.g); if (!g) return c.fail("group '" + opts.g + "' does not exist", 6); writeLines(c, '/etc/passwd', ls => ls.map(l => { const f = l.split(':'); if (f[0] === name) f[3] = g.gid; return f.join(':'); })); }
    if (opts.s || opts.d || opts.c) writeLines(c, '/etc/passwd', ls => ls.map(l => { const f = l.split(':'); if (f[0] === name) { if (opts.s) f[6] = opts.s; if (opts.d) f[5] = opts.d; if (opts.c) f[4] = opts.c; } return f.join(':'); }));
    if (opts.L || opts.U) { writeLines(c, '/etc/shadow', ls => ls.map(l => { const f = l.split(':'); if (f[0] === name) f[1] = opts.L ? '!' + f[1].replace(/^!/, '') : f[1].replace(/^!/, ''); return f.join(':'); })); c.fs.stat('/etc/shadow').m = 0; }
    return 0;
  };
  C.groupadd = (c) => {
    if (!requireRoot(c)) return 1;
    const { opts, rest } = getopt(c.args, { flags: 'rf', values: 'g' });
    const name = rest[0];
    if (!name) return c.fail('Usage: groupadd [options] GROUP', 2);
    const grs = OS.users.groups(c.fs);
    if (grs.find(g => g.name === name)) { if (opts.f) return 0; return c.fail("group '" + name + "' already exists", 9); }
    let gid = opts.g ? +opts.g : (opts.r ? 999 : 1000);
    const used = new Set(grs.map(g => g.gid));
    while (used.has(gid)) gid += opts.r ? -1 : 1;
    writeLines(c, '/etc/group', ls => ls.concat([name + ':x:' + gid + ':']));
    return 0;
  };
  C.groupdel = (c) => { if (!requireRoot(c)) return 1; const n = c.args[0]; if (!OS.users.groups(c.fs).find(g => g.name === n)) return c.fail("group '" + n + "' does not exist", 6); writeLines(c, '/etc/group', ls => ls.filter(l => l.split(':')[0] !== n)); return 0; };
  C.gpasswd = (c) => {
    if (!requireRoot(c)) return 1;
    const [flag, user, group] = c.args;
    if (!['-a', '-d'].includes(flag)) return c.fail('uso: gpasswd -a|-d USUARIO GRUPO', 2);
    writeLines(c, '/etc/group', ls => ls.map(l => { const f = l.split(':'); if (f[0] === group) { let m = (f[3] || '').split(',').filter(Boolean); m = flag === '-a' ? Array.from(new Set(m.concat(user))) : m.filter(x => x !== user); f[3] = m.join(','); } return f.join(':'); }));
    c.println((flag === '-a' ? 'Adding user ' + user + ' to' : 'Removing user ' + user + ' from') + ' group ' + group);
    return 0;
  };
  C.passwd = async (c) => {
    const target = c.args.filter(a => !a.startsWith('-'))[0] || c.user;
    if (target !== c.user && c.cred.uid !== 0) return c.fail('Only root can specify a user name.');
    if (!OS.users.byName(c.fs, target)) return c.fail("user '" + target + "' does not exist");
    if (c.args.includes('--stdin')) {
      if (c.cred.uid !== 0) return c.fail('Only root can do that.');
      const pw = (await c.readAll()).split('\n')[0];
      OS.users.setPassword(c.fs, target, pw); c.fs.stat('/etc/shadow').m = 0;
      c.println('Changing password for user ' + target + '.\npasswd: all authentication tokens updated successfully.');
      return 0;
    }
    if (!c.term) return c.fail('se requiere una terminal (o use --stdin)');
    c.println('Changing password for user ' + target + '.');
    if (c.cred.uid !== 0) {
      const cur = await c.prompt('Current password: ', true);
      if (!OS.users.checkPassword(c.fs, target, cur)) { c.println('passwd: Authentication token manipulation error'); return 1; }
    }
    const a = await c.prompt('New password: ', true);
    if ((a || '').length < 4) { c.println('BAD PASSWORD: The password is shorter than 8 characters'); }
    const b = await c.prompt('Retype new password: ', true);
    if (a !== b) { c.println('Sorry, passwords do not match.\npasswd: Authentication token manipulation error'); return 1; }
    OS.users.setPassword(c.fs, target, a); c.fs.stat('/etc/shadow').m = 0;
    c.println('passwd: all authentication tokens updated successfully.');
    return 0;
  };
  C.chage = (c) => {
    const u = c.args.filter(a => !a.startsWith('-'))[0];
    if (!u) return c.fail('Usage: chage [options] LOGIN');
    c.println('Last password change\t\t\t\t\t: ' + new Date().toDateString() + '\nPassword expires\t\t\t\t\t: never\nPassword inactive\t\t\t\t\t: never\nAccount expires\t\t\t\t\t\t: never\nMinimum number of days between password change\t\t: 0\nMaximum number of days between password change\t\t: 99999\nNumber of days of warning before password expires\t: 7');
    return 0;
  };
  C.newgrp = (c) => c.fail('no soportado; cierre sesión y vuelva a entrar para aplicar grupos');

  // su: abre un shell anidado como otro usuario
  C.su = async (c) => {
    let login = false, cmd = null, target = 'root';
    for (let i = 0; i < c.args.length; i++) {
      const a = c.args[i];
      if (a === '-' || a === '-l' || a === '--login') login = true;
      else if (a === '-c') cmd = c.args[++i];
      else if (a === '-s') i++;
      else target = a;
    }
    const u = OS.users.byName(c.fs, target);
    if (!u) return c.fail("user " + target + " does not exist or the user entry does not contain all the required fields");
    if (c.cred.uid !== 0) {
      if (!c.term) return c.fail('must be run from a terminal');
      const pw = await c.prompt('Password: ', true);
      if (!OS.users.checkPassword(c.fs, target, pw || '')) { await c.sleep(1200); c.vm.logSys('su[' + c.vm.nextPid + ']', 'FAILED SU (to ' + target + ') ' + c.user + ' on ' + c.sh.tty, '/var/log/secure'); return c.fail('Authentication failure'); }
    }
    if (/nologin|false/.test(u.shell) && !cmd) { c.println('This account is currently not available.'); return 1; }
    c.vm.logSys('su[' + c.vm.nextPid + ']', '(to ' + target + ') ' + c.user + ' on ' + c.sh.tty, '/var/log/secure');
    const sub = new L.Shell(c.vm, { user: target, login, cwd: login ? u.home : c.sh.cwd, env: login ? { TERM: 'xterm-256color' } : Object.assign(c.sh.exportedEnv(), { USER: target, LOGNAME: target, HOME: u.home }), term: c.term, tty: c.sh.tty, ppid: c.sh.pid });
    if (!login && c.cred.uid === 0 && target !== 'root') { }
    if (cmd) { sub.fg = c.sh.fg; sub.io = c.io; try { return await sub.run(cmd, c.io); } catch (e) { if (e.exitCode !== undefined) return e.exitCode; throw e; } finally { c.vm.reap(sub.pid); } }
    const session = { user: target, tty: c.sh.tty, since: Date.now() };
    c.vm.sessions.add(session);
    try { return await sub.interactive(c.term); }
    finally { c.vm.sessions.delete(session); c.sh.term = c.term; }
  };
  C.sudo = async (c) => {
    const args = c.args.slice();
    let user = 'root', login = false, shell = false, list = false, preserve = false, stdinPw = false;
    while (args.length && args[0].startsWith('-')) {
      const a = args.shift();
      if (a === '-u') user = args.shift();
      else if (a === '-i') login = true;
      else if (a === '-s') shell = true;
      else if (a === '-l') list = true;
      else if (a === '-E') preserve = true;
      else if (a === '-S') stdinPw = true;
      else if (a === '-k') { c.sh.sudoUntil = 0; return 0; }
      else if (a === '--') break;
    }
    if (!args.length && !login && !shell && !list) return c.fail('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] command', 1);
    if (c.cred.uid !== 0) {
      if (!OS.users.isSudoer(c.fs, c.user)) {
        if (Date.now() > c.sh.sudoUntil && c.term) await c.prompt('[sudo] password for ' + c.user + ': ', true);
        c.err(c.user + ' is not in the sudoers file.  This incident will be reported.\n');
        c.vm.logSys('sudo[' + c.vm.nextPid + ']', c.user + ' : user NOT in sudoers ; TTY=' + c.sh.tty + ' ; PWD=' + c.sh.cwd + ' ; USER=root ; COMMAND=' + args.join(' '), '/var/log/secure');
        return 1;
      }
      if (Date.now() > c.sh.sudoUntil) {
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          let pw;
          if (stdinPw) pw = (await c.readAll()).split('\n')[0];
          else if (c.term) pw = await c.prompt('[sudo] password for ' + c.user + ': ', true);
          else return c.fail('a terminal is required to read the password');
          if (pw === null) return 1;
          ok = OS.users.checkPassword(c.fs, c.user, pw);
          if (!ok) { await c.sleep(800); c.err('Sorry, try again.\n'); if (stdinPw) break; }
        }
        if (!ok) { c.err('sudo: 3 incorrect password attempts\n'); return 1; }
        c.sh.sudoUntil = Date.now() + 5 * 60000;
        if (c.sh.parent) c.sh.parent.sudoUntil = c.sh.sudoUntil;
      }
    }
    if (list) { c.println('User ' + c.user + ' may run the following commands on ' + c.vm.hostname.split('.')[0] + ':\n    (ALL) ALL'); return 0; }
    c.vm.logSys('sudo[' + c.vm.nextPid + ']', c.user + ' : TTY=' + c.sh.tty + ' ; PWD=' + c.sh.cwd + ' ; USER=' + user + ' ; COMMAND=' + (args.join(' ') || '/bin/bash'), '/var/log/secure');
    const u = OS.users.byName(c.fs, user);
    if (!u) return c.fail('unknown user ' + user);
    const sub = new L.Shell(c.vm, { user, login, cwd: login ? u.home : c.sh.cwd, env: preserve ? Object.assign(c.sh.exportedEnv(), { USER: user, HOME: u.home }) : { TERM: 'xterm-256color', HOME: u.home, USER: user, LOGNAME: user, SUDO_USER: c.user }, term: c.term, tty: c.sh.tty, ppid: c.sh.pid });
    if (!args.length) {
      const session = { user, tty: c.sh.tty, since: Date.now() };
      c.vm.sessions.add(session);
      try { return await sub.interactive(c.term); } finally { c.vm.sessions.delete(session); }
    }
    sub.fg = c.sh.fg; sub.io = c.io; sub.aliases = {};
    try { return await sub.execCommand(args, c.io); }
    catch (e) { if (e.exitCode !== undefined) return e.exitCode; throw e; }
    finally { c.vm.reap(sub.pid); }
  };
  C.visudo = (c) => c.sh.execCommand(['vi', '/etc/sudoers'], c.io);
  C.loginctl = (c) => { c.println('SESSION  UID USER  SEAT TTY\n      1 1000 ' + c.user + '       ' + c.sh.tty + '\n\n1 sessions listed.'); return 0; };
  C.timedatectl = (c) => { c.println('               Local time: ' + U.dateStr(Date.now()) + '\n           Universal time: ' + new Date().toUTCString() + '\n                Time zone: UTC (UTC, +0000)\nSystem clock synchronized: yes\n              NTP service: active\n          RTC in local TZ: no'); return 0; };
  C.chronyc = (c) => { c.println('MS Name/IP address         Stratum Poll Reach LastRx Last sample\n===============================================================================\n^* ntp.lab.local                 2   6   377    34   +112us[ +140us] +/-   18ms'); return 0; };
  C.crontab = async (c) => {
    const file = '/var/spool/cron/' + c.user;
    if (c.args.includes('-l')) { try { c.out(c.fs.read(file)); return 0; } catch (e) { c.err('no crontab for ' + c.user + '\n'); return 1; } }
    if (c.args.includes('-r')) { try { c.fs.unlink(file); } catch (e) { } return 0; }
    if (c.args.includes('-e')) {
      if (!c.fs.exists(file)) c.fs.write(file, '# m h dom mon dow command\n', { mode: 0o600, uid: c.cred.uid, gid: c.cred.gid });
      const tmp = '/tmp/crontab.' + Math.random().toString(36).slice(2, 8);
      c.fs.write(tmp, c.fs.read(file), { cred: c.cred });
      await c.sh.execCommand([c.sh.getVar('EDITOR') || 'vi', tmp], c.io);
      c.fs.write(file, c.fs.read(tmp), { mode: 0o600, uid: c.cred.uid, gid: c.cred.gid });
      c.fs.unlink(tmp);
      c.println('crontab: installing new crontab');
      return 0;
    }
    const f = c.args[0];
    if (f) { c.fs.write(file, c.fs.read(c.resolve(f), c.cred), { mode: 0o600, uid: c.cred.uid, gid: c.cred.gid }); return 0; }
    return c.fail('usage: crontab [-u user] [-l | -r | -e] [file]');
  };

  // ---------------- systemd ----------------
  const dot = (active, failed, color) => color ? (active ? '\x1b[1;32m●\x1b[0m' : failed ? '\x1b[1;31m×\x1b[0m' : '○') : (active ? '●' : failed ? '×' : '○');
  C.systemctl = async (c) => {
    const args = c.args.filter(a => a !== '--no-pager' && a !== '-l' && a !== '--full' && a !== '--now' && a !== '-q' && a !== '--quiet');
    const now = c.args.includes('--now');
    const sub = args[0] || 'list-units';
    const units = args.slice(1).map(u => u.replace(/\.service$/, ''));
    const vm = c.vm;
    const mutating = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'daemon-reload', 'mask', 'unmask', 'reboot', 'poweroff', 'set-default', 'kill', 'try-restart', 'reload-or-restart'];
    if (mutating.includes(sub) && c.cred.uid !== 0) {
      c.err('==== AUTHENTICATING FOR org.freedesktop.systemd1.manage-units ====\nAuthentication is required to manage system services or units.\nFailed to ' + sub + ' ' + (units[0] || '') + '.service: Access denied\n');
      return 1;
    }
    const exists = (u) => !!vm.unitPath(u);
    const notFound = (u) => { c.err('Failed to ' + sub + ' ' + u + '.service: Unit ' + u + '.service not found.\n'); return 5; };
    switch (sub) {
      case 'start': case 'restart': case 'try-restart': case 'reload': case 'reload-or-restart': {
        let st = 0;
        for (const u of units) {
          if (!exists(u)) { st = notFound(u); continue; }
          if (sub !== 'start') await vm.stopUnit(u);
          if (u === 'firewalld' && sub === 'reload') { vm.fwReload(); continue; }
          const r = await vm.startUnit(u);
          if (!r.ok) { c.err(r.msg + '\n'); st = 1; }
        }
        return st;
      }
      case 'stop': { for (const u of units) { if (!exists(u)) { notFound(u); continue; } await vm.stopUnit(u); } return 0; }
      case 'enable': case 'disable': {
        let st = 0;
        for (const u of units) {
          const p = vm.unitPath(u);
          if (!p) { c.err('Failed to ' + sub + ' unit: Unit file ' + u + '.service does not exist.\n'); st = 1; continue; }
          const link = '/etc/systemd/system/multi-user.target.wants/' + u + '.service';
          const unit = vm.parseUnit(u);
          if (sub === 'enable') {
            if (!((unit.sections.Install || {}).WantedBy)) { c.err('The unit files have no installation config (WantedBy=, RequiredBy=, Also=,\nAlias= settings in the [Install] section, and DefaultInstance= for template\nunits). This means they are not meant to be enabled or disabled using systemctl.\n'); continue; }
            if (!c.fs.tryLookup(link, { follow: false })) { c.fs.symlink(p, link); c.println('Created symlink ' + link + ' → ' + p + '.'); }
            if (now) { const r = await vm.startUnit(u); if (!r.ok) { c.err(r.msg + '\n'); st = 1; } }
          } else {
            if (c.fs.tryLookup(link, { follow: false })) { c.fs.unlink(link); c.println('Removed "' + link + '".'); }
            if (now) await vm.stopUnit(u);
          }
        }
        return st;
      }
      case 'daemon-reload': vm.logSys('systemd[1]', 'Reloading.'); return 0;
      case 'is-active': { const s = vm.unitState(units[0] || ''); c.println(s.active ? 'active' : s.sub === 'failed' ? 'failed' : 'inactive'); return s.active ? 0 : 3; }
      case 'is-enabled': { if (!exists(units[0])) { c.err('Failed to get unit file state for ' + units[0] + '.service: No such file or directory\n'); return 1; } const e = vm.unitEnabled(units[0]); c.println(e ? 'enabled' : 'disabled'); return e ? 0 : 1; }
      case 'is-failed': { const s = vm.unitState(units[0] || ''); c.println(s.sub === 'failed' ? 'failed' : s.active ? 'active' : 'inactive'); return s.sub === 'failed' ? 0 : 1; }
      case 'status': {
        if (!units.length) { c.println(dot(true, false, c.isTTY) + ' ' + vm.hostname + '\n    State: running\n    Units: ' + vm.unitNames().length + ' loaded (incl. loaded aliases)\n     Jobs: 0 queued\n   Failed: 0 units\n    Since: ' + U.dateStr(vm.bootTime)); return 0; }
        let st = 0;
        for (const u of units) {
          const unit = vm.parseUnit(u);
          if (!unit) { c.err('Unit ' + u + '.service could not be found.\n'); st = 4; continue; }
          const s = vm.unitState(u);
          const desc = (unit.sections.Unit || {}).Description || u;
          c.println(dot(s.active, s.sub === 'failed', c.isTTY) + ' ' + u + '.service - ' + desc);
          c.println('     Loaded: loaded (' + unit.path + '; ' + (vm.unitEnabled(u) ? 'enabled' : 'disabled') + '; preset: disabled)');
          const since = s.since ? U.dateStr(s.since) : '';
          if (s.active) c.println('     Active: ' + (c.isTTY ? '\x1b[1;32m' : '') + 'active (running)' + (c.isTTY ? '\x1b[0m' : '') + ' since ' + since + '; ' + Math.max(0, Math.floor((Date.now() - s.since) / 1000)) + 's ago');
          else if (s.sub === 'failed') c.println('     Active: ' + (c.isTTY ? '\x1b[1;31m' : '') + 'failed (Result: exit-code)' + (c.isTTY ? '\x1b[0m' : '') + ' since ' + since);
          else c.println('     Active: inactive (dead)');
          if (s.active && s.pid) {
            const p = vm.proc(s.pid);
            c.println('   Main PID: ' + s.pid + ' (' + (p ? p.name : u) + ')');
            if (p) {
              const kids = Array.from(vm.procs.values()).filter(x => x.ppid === p.pid);
              c.println('      Tasks: ' + (kids.length + 1) + ' (limit: 23136)\n     Memory: ' + Math.round(p.memMB + kids.reduce((a, k) => a + k.memMB, 0)) + '.0M\n        CPU: ' + (1 + p.pid % 7) + '.' + (p.pid % 90) + 's\n     CGroup: /system.slice/' + u + '.service\n             └─' + s.pid + ' ' + p.cmd.slice(0, 110));
            }
          }
          c.println('');
          for (const j of vm.journal.filter(j => j.unit.startsWith(u) || j.msg.includes(u + '.service') || (j.unit === 'systemd[1]' && j.msg.includes(desc))).slice(-8)) {
            const d = new Date(j.t);
            c.println(U.MONTHS[d.getMonth()] + ' ' + U.two(d.getDate()) + ' ' + U.clock(j.t) + ' ' + vm.hostname.split('.')[0] + ' ' + j.unit + ': ' + j.msg);
          }
          if (!s.active) st = 3;
        }
        return st;
      }
      case 'list-units': case 'list-unit-files': {
        const all = vm.unitNames();
        const typeF = c.args.find(a => a.startsWith('--type'));
        const stateF = (c.args.find(a => a.startsWith('--state=')) || '').split('=')[1];
        if (sub === 'list-unit-files') {
          c.println('UNIT FILE                          STATE    PRESET');
          for (const f of all) c.println(U.pad(f, 34, true) + ' ' + U.pad(vm.unitEnabled(f) ? 'enabled' : 'disabled', 8, true) + ' disabled');
          c.println('\n' + all.length + ' unit files listed.');
          return 0;
        }
        c.println('  UNIT                               LOAD   ACTIVE SUB     DESCRIPTION');
        let n = 0;
        for (const f of all) {
          const s = vm.unitState(f);
          const st = s.active ? 'active' : s.sub === 'failed' ? 'failed' : 'inactive';
          if (stateF && stateF !== st && stateF !== s.sub) continue;
          if (!stateF && !s.active && s.sub !== 'failed' && !c.args.includes('--all') && !c.args.includes('-a')) continue;
          n++;
          const u = vm.parseUnit(f);
          c.println((s.sub === 'failed' ? dot(false, true, c.isTTY) : ' ') + ' ' + U.pad(f, 34, true) + ' loaded ' + U.pad(st, 6, true) + ' ' + U.pad(s.sub, 7, true) + ' ' + ((u.sections.Unit || {}).Description || ''));
        }
        c.println('\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n' + n + ' loaded units listed.');
        return 0;
      }
      case 'cat': { for (const u of units) { const p = vm.unitPath(u); if (!p) { c.err('No files found for ' + u + '.service.\n'); return 1; } c.println('# ' + p); c.out(c.fs.read(p)); } return 0; }
      case 'kill': { const s = vm.unitState(units[0]); if (s.pid) vm.kill(s.pid, 15); return 0; }
      case 'get-default': c.println('multi-user.target'); return 0;
      case 'reboot': case 'poweroff': return C[sub](c);
      case 'list-timers': c.println('NEXT                        LEFT          LAST                        PASSED  UNIT                         ACTIVATES\n' + U.dateStr(Date.now() + 3600e3) + ' 59min left    n/a                         n/a     dnf-makecache.timer          dnf-makecache.service\n\n1 timers listed.'); return 0;
      default: c.err('Unknown command verb ' + sub + '.\n'); return 1;
    }
  };
  C.service = (c) => { const [u, action] = c.args; if (!u || !action) return c.fail('Usage: service < option > | --status-all | [ service_name [ command | --full-restart ] ]'); c.println('Redirecting to /bin/systemctl ' + action + ' ' + u + '.service'); return C.systemctl(Object.assign({}, c, { args: [action, u] })); };
  C.journalctl = async (c) => {
    const { opts } = getopt(c.args, { flags: 'fxerk', values: 'unp', long: { unit: 'u=', lines: 'n=', follow: 'f', 'no-pager': 'np', since: 'since=', boot: 'b' } });
    if (c.cred.uid !== 0 && !OS.users.groups(c.fs).some(g => (g.name === 'wheel' || g.name === 'adm' || g.name === 'systemd-journal') && g.members.includes(c.user))) {
      c.println('Hint: You are currently not seeing messages from other users and the system.\n      Users in groups \'adm\', \'systemd-journal\', \'wheel\' can see all messages.');
      return 0;
    }
    const unit = opts.u ? opts.u.replace(/\.service$/, '') : null;
    const filt = (j) => !unit || j.unit.startsWith(unit) || j.msg.includes(unit + '.service') || (j.unit === 'systemd[1]' && (() => { const u = c.vm.parseUnit(unit); const d = u && (u.sections.Unit || {}).Description; return d && j.msg.includes(d); })());
    const fmt = (j) => { const d = new Date(j.t); return U.MONTHS[d.getMonth()] + ' ' + U.two(d.getDate()) + ' ' + U.clock(j.t) + ' ' + c.vm.hostname.split('.')[0] + ' ' + j.unit + ': ' + j.msg; };
    let list = c.vm.journal.filter(filt);
    if (opts.k) list = list.filter(j => j.unit === 'kernel');
    const n = opts.n ? +opts.n : (opts.e || opts.f ? (opts.e ? 1000 : 10) : Infinity);
    list = list.slice(-n);
    if (!list.length) c.println('-- No entries --');
    else c.println('-- Logs begin at ' + U.dateStr(c.vm.journal[0] ? c.vm.journal[0].t : Date.now()) + '. --');
    for (const j of list) c.println(fmt(j));
    if (!opts.f) return 0;
    return followFrom(c, filt, fmt, c.vm.journal[c.vm.journal.length - 1]);
  };
  async function followFrom(c, filt, fmt, last) {
    while (true) {
      await c.sleep(500);
      const idx = last ? c.vm.journal.lastIndexOf(last) : -1;
      const fresh = c.vm.journal.slice(idx + 1);
      for (const j of fresh.filter(filt)) c.println(fmt(j));
      if (fresh.length) last = fresh[fresh.length - 1];
    }
  }
  const powerCmd = (reboot) => async (c) => {
    if (c.cred.uid !== 0) { c.err('Call to ' + (reboot ? 'Reboot' : 'PowerOff') + ' failed: Interactive authentication required.\n'); return 1; }
    if (c.name === 'shutdown' && c.args.includes('-c')) return 0;
    const out = (s) => c.term && c.term.write(s);
    out('\r\n\x1b[1mBroadcast message from root@' + c.vm.hostname + ':\x1b[0m\r\n\r\nThe system will ' + (reboot ? 'reboot' : 'power off') + ' now!\r\n\r\n');
    setTimeout(() => c.vm.shutdown(out, reboot), 50);
    await c.sleep(100000).catch(() => { });
    return 0;
  };
  C.reboot = powerCmd(true);
  C.poweroff = powerCmd(false);
  C.halt = powerCmd(false);
  C.shutdown = async (c) => powerCmd(c.args.includes('-r'))(c);

  // bash / sh: -c, script o shell anidado
  C.bash = async (c) => {
    const a = c.args.slice();
    let x = false;
    while (a.length && /^-[xeul]+$/.test(a[0])) { if (a[0].includes('x')) x = true; a.shift(); }
    if (a[0] === '-c') {
      const sub = c.sh.subshell();
      sub.positional = a.slice(3); sub.argv0 = a[2] || 'bash'; sub.xtrace = x;
      try { return await sub.run(a[1] || '', c.io); } catch (e) { if (e.exitCode !== undefined) return e.exitCode; throw e; }
    }
    if (a.length) {
      const p = c.resolve(a[0]);
      if (!c.fs.exists(p)) { c.err(c.name + ': ' + a[0] + ': No such file or directory\n'); return 127; }
      c.sh._xtraceNext = x;
      return c.sh.runScript(p, a.slice(1), c.io, a[0]);
    }
    if (!c.stdinTTY || !c.term) {
      const src = await c.readAll();
      const sub = c.sh.subshell();
      try { return await sub.run(src, c.io); } catch (e) { if (e.exitCode !== undefined) return e.exitCode; throw e; }
    }
    const sub = new L.Shell(c.vm, { user: c.user, env: c.sh.exportedEnv(), cwd: c.sh.cwd, term: c.term, tty: c.sh.tty, ppid: c.sh.pid, parent: c.sh });
    sub.cred = c.cred;
    return sub.interactive(c.term);
  };
  C.sh = C.bash;

  // which / man / help
  C.which = (c) => {
    let st = 0;
    for (const a of c.args.filter(x => !x.startsWith('-'))) {
      if (c.sh.aliases[a] !== undefined) { c.println('alias ' + a + "='" + c.sh.aliases[a] + "'"); const p = c.sh.which(c.sh.aliases[a].split(' ')[0]); if (p) c.println('\t' + p); continue; }
      const p = c.sh.which(a);
      if (p) c.println(p); else { c.err('/usr/bin/which: no ' + a + ' in (' + c.sh.getVar('PATH') + ')\n'); st = 1; }
    }
    return st;
  };
})(globalThis.JLab = globalThis.JLab || {});
