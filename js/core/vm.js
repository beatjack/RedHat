/*
 * Máquinas virtuales simuladas y el "hipervisor" del laboratorio.
 *  VM:  CPU/RAM/disco asignados, tabla de procesos, puertos en escucha,
 *       systemd (unidades en /etc/systemd), firewalld, journal, arranque.
 *  Lab: inventario de VMs, recursos del host (sin sobreasignar RAM),
 *       red virtual 10.0.0.0/24 entre VMs, snapshots, clonación,
 *       exportar/importar y persistencia (IndexedDB -> localStorage -> memoria).
 */
(function (L) {
  'use strict';
  const U = L.util, P = L.path, X = L.xml;

  const OS_RESERVED_MB = 1650;       // espacio "del sistema" que muestra df
  const KERNEL_MEM_MB = 260;         // memoria usada por kernel + servicios base

  const FW_SERVICES = { ssh: ['22/tcp'], http: ['80/tcp'], https: ['443/tcp'], cockpit: ['9090/tcp'], 'dhcpv6-client': ['546/udp'], 'jboss-http': ['8080/tcp'], 'jboss-management': ['9990/tcp'], postgresql: ['5432/tcp'], mysql: ['3306/tcp'] };
  const BUILTIN_DAEMONS = { sshd: '/usr/sbin/sshd -D', firewalld: '/usr/bin/python3 -s /usr/sbin/firewalld --nofork --nopid', crond: '/usr/sbin/crond -n', chronyd: '/usr/sbin/chronyd -F 2', rsyslog: '/usr/sbin/rsyslogd -n' };

  class VM extends L.Emitter {
    constructor(lab, data) {
      super();
      this.lab = lab;
      this.id = data.id;
      this.name = data.name;
      this.hostname = data.hostname;
      this.os = data.os;
      this.cpu = data.cpu;
      this.ramMB = data.ramMB;
      this.diskMB = data.diskMB;
      this.ip = data.ip;
      this.created = data.created || Date.now();
      this.notes = data.notes || '';
      this.login = data.login || { user: 'admin', pass: 'redhat', root: 'redhat' };
      this.jboss = data.jboss || [];
      this.snapshots = data.snapshots || [];
      this.autoRestore = data.autoRestore || [];
      this.wasRunning = !!data.wasRunning;
      this.journal = data.journal || [];
      this.fs = new L.VFS(data.fs);
      this.fs.limit = this.diskMB * 1048576 - OS_RESERVED_MB * 1048576;
      this.fs.onChange = () => this.lab && this.lab.scheduleSave(this);
      this.state = 'stopped';
      this.procs = new Map();
      this.listeners = [];
      this.nextPid = 1;
      this.bootTime = 0;
      this.servers = [];
      this.units = {};
      this.fw = { running: false, services: [], ports: [] };
      this.dmesg = [];
      this.sessions = new Set();
      this._installDynamic();
    }
    toJSON() {
      return {
        id: this.id, name: this.name, hostname: this.hostname, os: this.os, cpu: this.cpu, ramMB: this.ramMB, diskMB: this.diskMB,
        ip: this.ip, created: this.created, notes: this.notes, login: this.login, jboss: this.jboss, snapshots: this.snapshots,
        autoRestore: this.servers.filter(s => s.state === 'running' || s.state === 'starting').map(s => ({ home: s.home, args: s.opts.rawArgs, user: s.user, config: s.configFile })),
        wasRunning: this.state === 'running', journal: this.journal.slice(-400), fs: this.fs.toJSON()
      };
    }
    get osInfo() { return L.os.OS_TEMPLATES[this.os] || L.os.OS_TEMPLATES.rhel9; }

    // ---------- /proc dinámico ----------
    _installDynamic() {
      const d = this.fs.dynamic;
      d.meminfo = () => {
        const m = this.memStats();
        const kb = (mb) => U.pad(Math.round(mb * 1024), 8) + ' kB';
        return 'MemTotal:       ' + kb(m.total) + '\nMemFree:        ' + kb(m.free) + '\nMemAvailable:   ' + kb(m.available) + '\nBuffers:        ' + kb(12) + '\nCached:         ' + kb(m.cache) + '\nSwapCached:            0 kB\nSwapTotal:      ' + kb(this.swapMB()) + '\nSwapFree:       ' + kb(this.swapMB()) + '\n';
      };
      d.cpuinfo = () => {
        let s = '';
        for (let i = 0; i < this.cpu; i++) s += 'processor\t: ' + i + '\nvendor_id\t: GenuineIntel\ncpu family\t: 6\nmodel\t\t: 85\nmodel name\t: Intel(R) Xeon(R) Gold 6230 CPU @ 2.10GHz (vCPU simulada)\ncpu MHz\t\t: 2095.078\ncache size\t: 28160 KB\ncpu cores\t: ' + this.cpu + '\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx lm constant_tsc hypervisor\n\n';
        return s;
      };
      d.uptime = () => ((Date.now() - this.bootTime) / 1000).toFixed(2) + ' ' + ((Date.now() - this.bootTime) / 1000 * this.cpu * 0.95).toFixed(2) + '\n';
      d.loadavg = () => this.loadAvg().map(x => x.toFixed(2)).join(' ') + ' 1/' + (this.procs.size + 120) + ' ' + this.nextPid + '\n';
      d.version = () => 'Linux version ' + this.osInfo.kernel + ' (mockbuild@lab) (gcc (GCC) 11.4.1) #1 SMP PREEMPT_DYNAMIC\n';
      d.mounts = () => '/dev/mapper/rhel-root / xfs rw,seclabel,relatime 0 0\n/dev/sda1 /boot xfs rw,seclabel,relatime 0 0\nproc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\ntmpfs /tmp tmpfs rw,nosuid,nodev 0 0\n';
    }

    // ---------- recursos ----------
    swapMB() { return Math.min(2048, Math.round(this.ramMB / 2)); }
    memStats() {
      let used = KERNEL_MEM_MB;
      for (const p of this.procs.values()) used += p.memMB || 0;
      const total = this.ramMB - 60;
      used = Math.min(used, total);
      const cache = Math.max(0, Math.min(Math.round((total - used) * 0.25), 600));
      const free = Math.max(0, total - used - cache);
      return { total, used, cache, free, available: Math.max(0, total - used - 20) };
    }
    memAvailableMB() { return this.memStats().available; }
    diskStats() {
      const total = this.diskMB * 1048576;
      const used = OS_RESERVED_MB * 1048576 + this.fs.used;
      return { total, used, avail: Math.max(0, total - used), pct: Math.min(100, Math.ceil(used / total * 100)) };
    }
    loadAvg() {
      let busy = 0.02;
      for (const p of this.procs.values()) busy += (p.cpu || 0) / 100;
      for (const s of this.servers) if (s.state === 'starting') busy += 0.9;
      const l = busy;
      this._la = this._la || [0.05, 0.03, 0.01];
      this._la = [this._la[0] * 0.7 + l * 0.3, this._la[1] * 0.92 + l * 0.08, this._la[2] * 0.97 + l * 0.03];
      return this._la;
    }
    cpuPercent() {
      let c = 0;
      for (const p of this.procs.values()) c += p.cpu || 0;
      for (const s of this.servers) if (s.state === 'starting') c += 85;
      return Math.min(100, c / this.cpu);
    }

    // ---------- procesos ----------
    spawn(o) {
      const pid = this.nextPid++;
      const p = {
        pid, ppid: o.ppid || 1, user: o.user || 'root', cmd: o.cmd, name: o.name || o.cmd.split(/\s+/)[0].split('/').pop(),
        memMB: o.memMB || 1, cpu: o.cpu || 0, ni: o.ni != null ? o.ni : (this.defaultNice || 0), start: Date.now(), tty: o.tty || '?', stat: o.stat || 'S', kind: o.kind || 'proc',
        onSignal: o.onSignal || null, server: o.server || null, unit: o.unit || null
      };
      this.procs.set(pid, p);
      this.emit('procs');
      return p;
    }
    proc(pid) { return this.procs.get(pid); }
    reap(pid) { if (this.procs.delete(pid)) { this.unlistenPid(pid); this.emit('procs'); } }
    kill(pid, sig) {
      const p = this.procs.get(pid);
      if (!p) return false;
      sig = sig || 15;
      if (p.onSignal) p.onSignal(sig);
      else if (sig === 9 || sig === 15 || sig === 2 || sig === 1) {
        this.reap(pid);
        if (p.unit && this.units[p.unit]) { this.units[p.unit].active = false; this.units[p.unit].result = sig === 9 ? 'signal' : 'exit-code'; }
      }
      if (sig === 9 && this.procs.has(pid)) this.reap(pid);
      return true;
    }

    // ---------- puertos ----------
    listenConflict(port, addr) {
      if (addr && !/^\d+\.\d+\.\d+\.\d+$/.test(addr)) { const r = this.lab && this.lab.resolve(this, addr); addr = r ? (r.local ? '127.0.0.1' : r.ip) : '127.0.0.1'; }
      return this.listeners.find(l => l.port === port && (l.addr === addr || l.addr === '0.0.0.0' || addr === '0.0.0.0'));
    }
    listen(o) {
      if (o.addr && !/^\d+\.\d+\.\d+\.\d+$/.test(o.addr)) {
        const r = this.lab ? this.lab.resolve(this, o.addr) : null;
        o.addr = r ? (r.local ? '127.0.0.1' : r.ip) : '127.0.0.1';
      }
      this.listeners.push(o); this.emit('net');
    }
    unlistenPid(pid) { const n = this.listeners.length; this.listeners = this.listeners.filter(l => l.pid !== pid); if (n !== this.listeners.length) this.emit('net'); }

    // ---------- firewall ----------
    fwZoneFile() { return '/etc/firewalld/zones/public.xml'; }
    fwPermanent() {
      const out = { services: [], ports: [] };
      try {
        const doc = X.parse(this.fs.read(this.fwZoneFile()));
        for (const s of X.find(doc, 'service')) out.services.push(X.attr(s, 'name'));
        for (const p of X.find(doc, 'port')) out.ports.push(X.attr(p, 'port') + '/' + X.attr(p, 'protocol'));
      } catch (e) { }
      return out;
    }
    fwSavePermanent(perm) {
      const body = '<?xml version="1.0" encoding="utf-8"?>\n<zone>\n  <short>Public</short>\n  <description>For use in public areas.</description>\n' +
        perm.services.map(s => '  <service name="' + s + '"/>\n').join('') +
        perm.ports.map(p => { const [n, pr] = p.split('/'); return '  <port port="' + n + '" protocol="' + (pr || 'tcp') + '"/>\n'; }).join('') + '</zone>\n';
      this.fs.write(this.fwZoneFile(), body);
    }
    fwReload() { const p = this.fwPermanent(); this.fw.services = p.services; this.fw.ports = p.ports; }
    fwAllows(port) {
      if (!this.fw.running) return true;
      if (this.fw.ports.some(p => { const [range] = p.split('/'); const [a, b] = range.split('-').map(Number); return port >= a && port <= (b || a); })) return true;
      return this.fw.services.some(s => (FW_SERVICES[s] || []).some(p => +p.split('/')[0] === port));
    }

    // ---------- journal / logs ----------
    logSys(unit, msg, file) {
      const t = Date.now();
      this.journal.push({ t, unit, msg });
      if (this.journal.length > 1000) this.journal.splice(0, this.journal.length - 800);
      const d = new Date(t);
      const line = U.MONTHS[d.getMonth()] + ' ' + U.pad(d.getDate(), 2) + ' ' + U.clock(t) + ' ' + this.hostname.split('.')[0] + ' ' + unit + ': ' + msg + '\n';
      try { this.fs.write(file || '/var/log/messages', line, { append: true }); } catch (e) { }
      this.emit('journal');
    }

    // ---------- systemd ----------
    unitPath(name) {
      if (!name.includes('.')) name += '.service';
      for (const d of ['/etc/systemd/system/', '/usr/lib/systemd/system/']) if (this.fs.isFile(d + name)) return d + name;
      return null;
    }
    parseUnit(name) {
      const p = this.unitPath(name);
      if (!p) return null;
      const text = this.fs.read(p);
      const u = { path: p, sections: {} };
      let sec = null;
      for (const raw of text.split('\n')) {
        const l = raw.trim();
        if (!l || l.startsWith('#') || l.startsWith(';')) continue;
        const m = /^\[(.+)\]$/.exec(l);
        if (m) { sec = u.sections[m[1]] = u.sections[m[1]] || {}; continue; }
        const kv = /^([\w-]+)\s*=\s*(.*)$/.exec(l);
        if (kv && sec) { if (sec[kv[1]] !== undefined && kv[1] === 'Environment') sec[kv[1]] += ' ' + kv[2]; else sec[kv[1]] = kv[2]; }
      }
      return u;
    }
    unitEnabled(name) {
      if (!name.includes('.')) name += '.service';
      try { return this.fs.readdir('/etc/systemd/system/multi-user.target.wants').includes(name); } catch (e) { return false; }
    }
    unitNames() {
      const set = new Set();
      for (const d of ['/usr/lib/systemd/system', '/etc/systemd/system']) {
        try { for (const f of this.fs.readdir(d)) if (f.endsWith('.service')) set.add(f); } catch (e) { }
      }
      return Array.from(set).sort();
    }
    unitState(name) {
      const base = name.replace(/\.service$/, '');
      const st = this.units[base];
      if (!st) return { active: false, sub: 'dead', result: null };
      if (st.server) {
        const s = st.server.state;
        if (s === 'running' || s === 'starting' || s === 'reloading') return { active: true, sub: 'running', since: st.since, pid: st.server.pid };
        return { active: false, sub: s === 'failed' ? 'failed' : 'dead', since: st.since, result: s === 'failed' ? 'exit-code' : null };
      }
      return { active: !!st.active, sub: st.active ? 'running' : (st.result === 'failed' ? 'failed' : 'dead'), since: st.since, pid: st.pid, result: st.result };
    }
    async startUnit(name) {
      const base = name.replace(/\.service$/, '');
      const unit = this.parseUnit(base);
      if (!unit) return { ok: false, msg: 'Failed to start ' + base + '.service: Unit ' + base + '.service not found.' };
      const cur = this.unitState(base);
      if (cur.active) return { ok: true };
      if (unit.dirty) { }
      const svc = unit.sections.Service || {};
      if (BUILTIN_DAEMONS[base]) {
        const p = this.spawn({ user: 'root', cmd: BUILTIN_DAEMONS[base], memMB: base === 'firewalld' ? 38 : 4, unit: base });
        this.units[base] = { active: true, pid: p.pid, since: Date.now() };
        if (base === 'firewalld') { this.fw.running = true; this.fwReload(); p.onSignal = () => { this.fw.running = false; this.reap(p.pid); this.units.firewalld.active = false; }; }
        if (base === 'sshd') this.listen({ port: 22, addr: '0.0.0.0', pid: p.pid, proc: 'sshd', kind: 'ssh' });
        if (base === 'chronyd') this.listen({ port: 323, addr: '127.0.0.1', pid: p.pid, proc: 'chronyd', kind: 'udp' });
        this.logSys('systemd[1]', 'Started ' + ((unit.sections.Unit || {}).Description || base) + '.');
        return { ok: true };
      }
      const exec = svc.ExecStart;
      if (!exec) {
        this.units[base] = { active: false, result: 'failed', since: Date.now() };
        return { ok: false, msg: 'Failed to start ' + base + '.service: Unit ' + base + '.service has a bad unit file setting.' };
      }
      const user = svc.User || 'root';
      const env = {};
      for (const m of (svc.Environment || '').matchAll(/"?(\w+)=([^"\s]*)"?/g)) env[m[1]] = m[2];
      if (svc.EnvironmentFile) {
        try { for (const l of this.fs.read(svc.EnvironmentFile.replace(/^-/, '')).split('\n')) { const m = /^(\w+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2].replace(/^"|"$/g, ''); } } catch (e) { }
      }
      this.logSys('systemd[1]', 'Starting ' + ((unit.sections.Unit || {}).Description || base) + '...');
      const r = await this.lab.runService(this, base, exec.replace(/^[-@+!]+/, ''), user, env, svc.WorkingDirectory);
      if (!r.ok) {
        this.units[base] = { active: false, result: 'failed', since: Date.now() };
        this.logSys('systemd[1]', base + '.service: Main process exited, code=exited, status=' + (r.code || 1) + '/FAILURE');
        this.logSys('systemd[1]', base + '.service: Failed with result \'exit-code\'.');
        this.logSys('systemd[1]', 'Failed to start ' + ((unit.sections.Unit || {}).Description || base) + '.');
        return { ok: false, msg: 'Job for ' + base + '.service failed because the control process exited with error code.\nSee "systemctl status ' + base + '.service" and "journalctl -xeu ' + base + '.service" for details.' };
      }
      this.units[base] = { active: true, pid: r.pid, server: r.server || null, since: Date.now() };
      this.logSys('systemd[1]', 'Started ' + ((unit.sections.Unit || {}).Description || base) + '.');
      return { ok: true };
    }
    async stopUnit(name) {
      const base = name.replace(/\.service$/, '');
      const st = this.units[base];
      if (!st) return { ok: true };
      this.logSys('systemd[1]', 'Stopping ' + base + '.service...');
      if (st.server) await st.server.stop();
      else if (st.pid) this.kill(st.pid, 15);
      if (base === 'firewalld') this.fw.running = false;
      st.active = false; st.result = null; st.since = Date.now();
      this.logSys('systemd[1]', base + '.service: Deactivated successfully.');
      this.logSys('systemd[1]', 'Stopped ' + base + '.service.');
      return { ok: true };
    }

    // ---------- ciclo de vida ----------
    async boot(out) {
      if (this.state !== 'stopped') return;
      const check = this.lab.canStart(this);
      if (!check.ok) { out && out('\x1b[31m' + check.msg + '\x1b[0m\r\n'); return false; }
      this.state = 'booting';
      this.emit('state', this.state);
      this.lab.emit('change');
      this.bootTime = Date.now();
      this.nextPid = 1;
      this.procs.clear(); this.listeners = []; this.units = {}; this.servers = [];
      this.dmesg = [];
      const k = this.osInfo.kernel;
      const say = async (s, ms) => { this.dmesg.push('[' + U.pad(((Date.now() - this.bootTime) / 1000).toFixed(6), 12) + '] ' + s); if (out) out(s + '\r\n'); await U.sleep(ms || 40); };
      // repone comandos de paquetes base que falten (VMs creadas con versiones anteriores del laboratorio)
      try { L.os.repairPackages(this.fs, this.osInfo); } catch (e) { console.warn(e); }
      this.spawn({ user: 'root', cmd: '/usr/lib/systemd/systemd --switched-root --system --deserialize 31', name: 'systemd', memMB: 12 });
      this.spawn({ user: 'root', cmd: '[kthreadd]', memMB: 0 });
      this.spawn({ user: 'root', cmd: '/usr/lib/systemd/systemd-journald', memMB: 8 });
      this.spawn({ user: 'root', cmd: '/usr/lib/systemd/systemd-logind', memMB: 3 });
      this.spawn({ user: 'root', cmd: '/usr/sbin/NetworkManager --no-daemon', memMB: 9 });
      await say('\x1b[1mSeaBIOS (simulado)\x1b[0m', 120);
      await say('Booting `' + this.osInfo.prettyName + ' (' + k + ')\'', 150);
      await say('[    0.000000] Linux version ' + k + ' (mockbuild@lab) #1 SMP PREEMPT_DYNAMIC');
      await say('[    0.000000] Command line: BOOT_IMAGE=(hd0,msdos1)/vmlinuz-' + k + ' root=/dev/mapper/rhel-root ro crashkernel=auto rhgb quiet');
      await say('[    0.012000] Memory: ' + (this.ramMB * 1024 - 90000) + 'K/' + (this.ramMB * 1024) + 'K available');
      await say('[    0.031000] smpboot: Allowing ' + this.cpu + ' CPUs, 0 hotplug CPUs');
      await say('[    0.220000] sd 0:0:0:0: [sda] ' + (this.diskMB * 2048) + ' 512-byte logical blocks: (' + (this.diskMB / 1024).toFixed(1) + ' GB)');
      await say('[    1.100000] XFS (dm-0): Mounting V5 Filesystem');
      await say('[    1.400000] systemd[1]: systemd 252 running in system mode');
      await say('[    1.410000] systemd[1]: Hostname set to <' + this.hostname + '>.', 80);
      this.state = 'running';
      // servicios habilitados
      for (const f of this.unitNames()) {
        const base = f.replace(/\.service$/, '');
        if (!this.unitEnabled(f)) continue;
        const r = await this.startUnit(base);
        if (out) out((r.ok ? '[\x1b[32m  OK  \x1b[0m] Started ' : '[\x1b[31mFAILED\x1b[0m] Failed to start ') + ((this.parseUnit(base) || { sections: {} }).sections.Unit || {}).Description + '.\r\n');
        await U.sleep(30);
      }
      this.spawn({ user: 'root', cmd: '/sbin/agetty -o -p -- \\u --noclear - linux', memMB: 1, tty: 'tty1' });
      this.logSys('kernel', 'Linux version ' + k);
      this.logSys('systemd[1]', 'Reached target Multi-User System.');
      if (out) out('\r\n' + this.osInfo.prettyName + '\r\nKernel ' + k + ' on an x86_64\r\n\r\n');
      this.emit('state', this.state);
      this.lab.emit('change');
      this.lab.scheduleSave(this);
      return true;
    }
    async restoreServers() {
      // Restaura JBoss que estaban corriendo antes de recargar la página
      const list = this.autoRestore || [];
      this.autoRestore = [];
      for (const r of list) {
        try { await this.lab.startJBoss(this, r.home, r.args || [], r.user || 'root', null, { background: true }); } catch (e) { console.warn(e); }
      }
    }
    async shutdown(out, reboot) {
      if (this.state !== 'running') return;
      this.state = 'stopping';
      this.emit('state', this.state);
      for (const s of this.servers.slice()) { if (s.state === 'running' || s.state === 'starting') await s.stop(); }
      for (const u of Object.keys(this.units)) if (this.units[u].active) { if (out) out('         Stopping ' + u + '.service...\r\n'); }
      await U.sleep(200);
      this.procs.clear(); this.listeners = []; this.units = {}; this.fw.running = false;
      this.logSys('systemd[1]', reboot ? 'Rebooting.' : 'Powering off.');
      this.state = 'stopped';
      for (const s of Array.from(this.sessions)) s.hangup && s.hangup();
      this.emit('state', this.state);
      this.lab.emit('change');
      await this.lab.saveNow(this);
      if (reboot) await this.boot(out);
    }
    forceOff() {
      for (const s of this.servers) s._cleanup && s._cleanup(), s.state = 'stopped';
      this.procs.clear(); this.listeners = []; this.units = {}; this.fw.running = false;
      this.state = 'stopped';
      for (const s of Array.from(this.sessions)) s.hangup && s.hangup();
      this.emit('state', this.state);
      this.lab.emit('change');
      this.lab.saveNow(this);
    }
  }

  // ================= Persistencia =================
  class Store {
    constructor() { this.kind = 'memory'; this.mem = {}; this.db = null; }
    async init() {
      try {
        if (typeof indexedDB !== 'undefined') {
          this.db = await new Promise((res, rej) => {
            const r = indexedDB.open('jboss-virtual-lab', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('kv');
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          });
          this.kind = 'indexeddb';
          return;
        }
      } catch (e) { console.warn('IndexedDB no disponible', e); }
      try { localStorage.setItem('jlab.test', '1'); localStorage.removeItem('jlab.test'); this.kind = 'localstorage'; } catch (e) { this.kind = 'memory'; }
    }
    async get(k) {
      if (this.kind === 'indexeddb') return new Promise((res) => { const t = this.db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(undefined); });
      if (this.kind === 'localstorage') { const v = localStorage.getItem('jlab.' + k); return v ? JSON.parse(v) : undefined; }
      return this.mem[k];
    }
    async set(k, v) {
      if (this.kind === 'indexeddb') return new Promise((res, rej) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
      if (this.kind === 'localstorage') { localStorage.setItem('jlab.' + k, JSON.stringify(v)); return; }
      this.mem[k] = v;
    }
    async del(k) {
      if (this.kind === 'indexeddb') return new Promise((res) => { const t = this.db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => res(); });
      if (this.kind === 'localstorage') { localStorage.removeItem('jlab.' + k); return; }
      delete this.mem[k];
    }
  }

  // ================= Laboratorio =================
  class Lab extends L.Emitter {
    constructor() {
      super();
      this.vms = new Map();
      this.host = { cpu: 8, ramMB: 16384, diskGB: 200 };
      this.store = new Store();
      this._timers = {};
      this.progress = {};
    }
    async init() {
      await this.store.init();
      const meta = await this.store.get('meta');
      if (meta) {
        this.host = Object.assign(this.host, meta.host || {});
        this.progress = meta.progress || {};
        for (const id of meta.vms || []) {
          const data = await this.store.get('vm:' + id);
          if (data) this.vms.set(id, new VM(this, data));
        }
      }
      this.emit('change');
    }
    async saveMeta() {
      await this.store.set('meta', { host: this.host, vms: Array.from(this.vms.keys()), progress: this.progress, version: 1 });
    }
    scheduleSave(vm) {
      clearTimeout(this._timers[vm.id]);
      this._timers[vm.id] = setTimeout(() => this.saveNow(vm), 800);
    }
    async saveNow(vm) {
      clearTimeout(this._timers[vm.id]);
      try { await this.store.set('vm:' + vm.id, vm.toJSON()); }
      catch (e) { console.error('Error guardando VM', e); this.emit('error', 'No se pudo guardar la VM ' + vm.name + ': ' + e.message); }
    }
    async saveAll() { for (const vm of this.vms.values()) await this.saveNow(vm); await this.saveMeta(); }

    // ---------- recursos del host ----------
    allocated() {
      let cpu = 0, ram = 0, disk = 0, runRam = 0, runCpu = 0;
      for (const v of this.vms.values()) {
        cpu += v.cpu; ram += v.ramMB; disk += v.diskMB;
        if (v.state !== 'stopped') { runRam += v.ramMB; runCpu += v.cpu; }
      }
      return { cpu, ram, disk, runRam, runCpu };
    }
    canStart(vm) {
      const a = this.allocated();
      const need = a.runRam + vm.ramMB;
      if (need > this.host.ramMB) return { ok: false, msg: 'No se puede encender ' + vm.name + ': RAM insuficiente en el host (' + need + ' MB requeridos de ' + this.host.ramMB + ' MB). Apague otra VM o reduzca la RAM asignada.' };
      if (a.runCpu + vm.cpu > this.host.cpu * 4) return { ok: false, msg: 'No se puede encender ' + vm.name + ': se excede la sobreasignación máxima de vCPU (4:1).' };
      return { ok: true };
    }
    validateSpec(spec, exceptId) {
      const errs = [];
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/i.test(spec.name || '')) errs.push('Nombre inválido (letras, números y guiones, máx. 31).');
      if (Array.from(this.vms.values()).some(v => v.id !== exceptId && v.name.toLowerCase() === (spec.name || '').toLowerCase())) errs.push('Ya existe una VM con ese nombre.');
      if (!(spec.cpu >= 1 && spec.cpu <= this.host.cpu)) errs.push('vCPU debe estar entre 1 y ' + this.host.cpu + ' (CPU del host).');
      if (!(spec.ramMB >= 512 && spec.ramMB <= this.host.ramMB)) errs.push('RAM debe estar entre 512 MB y ' + this.host.ramMB + ' MB.');
      if (!(spec.diskMB >= 4096 && spec.diskMB <= 102400)) errs.push('Disco debe estar entre 4 GB y 100 GB.');
      const a = this.allocated();
      const cur = exceptId && this.vms.get(exceptId) ? this.vms.get(exceptId).diskMB : 0;
      if (a.disk - cur + spec.diskMB > this.host.diskGB * 1024) errs.push('Disco del host insuficiente: asignado ' + Math.round((a.disk - cur) / 1024) + ' GB + ' + Math.round(spec.diskMB / 1024) + ' GB > ' + this.host.diskGB + ' GB.');
      return errs;
    }
    nextIp() {
      const used = new Set(Array.from(this.vms.values()).map(v => v.ip));
      for (let i = 11; i < 250; i++) if (!used.has('10.0.0.' + i)) return '10.0.0.' + i;
      return '10.0.0.250';
    }

    // ---------- CRUD de VMs ----------
    async create(spec) {
      const errs = this.validateSpec(spec);
      if (errs.length) throw new Error(errs.join('\n'));
      const id = U.uid('vm-');
      const ip = this.nextIp();
      const hostname = (spec.hostname || spec.name).toLowerCase() + (spec.hostname && spec.hostname.includes('.') ? '' : '.lab.local');
      const fs = new L.VFS();
      fs.limit = spec.diskMB * 1048576 - OS_RESERVED_MB * 1048576;
      L.os.buildBaseImage(fs, { os: spec.os, hostname, user: spec.user || 'admin', userPassword: spec.userPassword || 'redhat', rootPassword: spec.rootPassword || 'redhat', ip, packages: spec.packages || [] });
      // hosts de las demás VMs del laboratorio
      let hosts = fs.read('/etc/hosts');
      for (const v of this.vms.values()) hosts += v.ip + '   ' + v.hostname + ' ' + v.hostname.split('.')[0] + '\n';
      fs.write('/etc/hosts', hosts);
      for (const v of this.vms.values()) { try { v.fs.write('/etc/hosts', ip + '   ' + hostname + ' ' + hostname.split('.')[0] + '\n', { append: true }); this.scheduleSave(v); } catch (e) { } }
      // JBoss
      for (const d of spec.jbossDists || []) L.jboss.writeInstaller(fs, d);
      L.jboss.writeSampleApps(fs);
      fs.mkdir('/opt/installers/drivers', { parents: true });
      fs.write('/opt/installers/drivers/postgresql-42.7.3.jar', 'PK\x03\x04 (driver JDBC simulado org.postgresql.Driver)', { vsize: 1086000, bin: true });
      fs.write('/opt/installers/drivers/mysql-connector-j-8.4.0.jar', 'PK\x03\x04 (driver JDBC simulado com.mysql.cj.jdbc.Driver)', { vsize: 2500000, bin: true });
      if (spec.preinstall && (spec.jbossDists || []).length) {
        // usuario de servicio jboss + Java + instalación en /opt
        const d = L.jboss.DISTS[spec.jbossDists[0]];
        const pw = fs.read('/etc/passwd').replace(/\n$/, '') + '\njboss:x:1001:1001:JBoss service account:/opt/' + d.dir + ':/bin/bash\n';
        fs.write('/etc/passwd', pw);
        fs.write('/etc/group', fs.read('/etc/group').replace(/\n$/, '') + '\njboss:x:1001:\n');
        const jdk = d.javaMin >= 11 ? 'java-17-openjdk' : 'java-11-openjdk';
        L.os.installPackageFiles(fs, jdk, L.os.OS_TEMPLATES[spec.os]);
        L.os.installPackageFiles(fs, 'unzip', L.os.OS_TEMPLATES[spec.os]);
        const inst = L.os.installedList(fs); inst[jdk] = L.os.PACKAGES[jdk].v; inst.unzip = L.os.PACKAGES.unzip.v; L.os.setInstalled(fs, inst);
        L.jboss.installTo(fs, d.id, '/opt', { uid: 1001, gid: 1001 });
        fs.populate({ '/etc/profile.d/jboss.sh': 'export JBOSS_HOME=/opt/' + d.dir + '\n' });
      }
      const vm = new VM(this, {
        id, name: spec.name, hostname, os: spec.os, cpu: spec.cpu, ramMB: spec.ramMB, diskMB: spec.diskMB, ip,
        jboss: spec.jbossDists || [], notes: spec.notes || '', fs: fs.toJSON(),
        login: { user: spec.user || 'admin', pass: spec.userPassword || 'redhat', root: spec.rootPassword || 'redhat' }
      });
      this.vms.set(id, vm);
      await this.saveNow(vm);
      await this.saveMeta();
      this.emit('change');
      return vm;
    }
    async update(vm, spec) {
      if (vm.state !== 'stopped') throw new Error('Apague la VM antes de modificar sus recursos.');
      const errs = this.validateSpec(Object.assign({ name: vm.name }, spec), vm.id);
      if (spec.diskMB < vm.diskMB) errs.push('No se puede reducir el disco (solo ampliar), igual que en un hipervisor real.');
      if (errs.length) throw new Error(errs.join('\n'));
      vm.cpu = spec.cpu; vm.ramMB = spec.ramMB; vm.diskMB = spec.diskMB;
      vm.fs.limit = vm.diskMB * 1048576 - OS_RESERVED_MB * 1048576;
      if (spec.notes !== undefined) vm.notes = spec.notes;
      await this.saveNow(vm);
      this.emit('change');
    }
    async remove(vm) {
      if (vm.state !== 'stopped') vm.forceOff();
      this.vms.delete(vm.id);
      await this.store.del('vm:' + vm.id);
      await this.saveMeta();
      this.emit('change');
    }
    async clone(vm, name) {
      if (vm.state !== 'stopped') throw new Error('Apague la VM para clonarla (clon consistente).');
      const data = JSON.parse(JSON.stringify(vm.toJSON()));
      const spec = { name, cpu: vm.cpu, ramMB: vm.ramMB, diskMB: vm.diskMB };
      const errs = this.validateSpec(spec);
      if (errs.length) throw new Error(errs.join('\n'));
      data.id = U.uid('vm-'); data.name = name; data.ip = this.nextIp();
      data.hostname = name.toLowerCase() + '.lab.local'; data.snapshots = []; data.created = Date.now(); data.autoRestore = []; data.journal = [];
      const c = new VM(this, data);
      c.fs.write('/etc/hostname', c.hostname + '\n');
      c.fs.write('/etc/hosts', c.fs.read('/etc/hosts').split('\n').filter(l => !l.includes(vm.hostname)).join('\n') + c.ip + '   ' + c.hostname + ' ' + name.toLowerCase() + '\n');
      this.vms.set(c.id, c);
      for (const v of this.vms.values()) if (v !== c) { try { v.fs.write('/etc/hosts', c.ip + '   ' + c.hostname + ' ' + name.toLowerCase() + '\n', { append: true }); this.scheduleSave(v); } catch (e) { } }
      await this.saveNow(c); await this.saveMeta();
      this.emit('change');
      return c;
    }
    async snapshot(vm, name) {
      const snap = { id: U.uid('snap-'), name: name || ('snap-' + vm.snapshots.length), created: Date.now(), fs: JSON.parse(JSON.stringify(vm.fs.toJSON())), running: vm.state === 'running' };
      vm.snapshots.push(snap);
      await this.saveNow(vm);
      this.emit('change');
      return snap;
    }
    async revert(vm, snapId) {
      const s = vm.snapshots.find(x => x.id === snapId);
      if (!s) throw new Error('Snapshot no encontrado');
      if (vm.state !== 'stopped') vm.forceOff();
      vm.fs = new L.VFS(JSON.parse(JSON.stringify(s.fs)));
      vm.fs.limit = vm.diskMB * 1048576 - OS_RESERVED_MB * 1048576;
      vm.fs.onChange = () => this.scheduleSave(vm);
      vm._installDynamic();
      await this.saveNow(vm);
      this.emit('change');
    }
    async deleteSnapshot(vm, snapId) {
      vm.snapshots = vm.snapshots.filter(s => s.id !== snapId);
      await this.saveNow(vm);
      this.emit('change');
    }
    exportVm(vm) { const d = vm.toJSON(); d.snapshots = []; return JSON.stringify({ format: 'jboss-virtual-lab-vm', version: 1, vm: d }); }
    async importVm(json) {
      const o = JSON.parse(json);
      if (o.format !== 'jboss-virtual-lab-vm') throw new Error('Archivo no válido (no es una exportación de JBoss Virtual Lab)');
      const d = o.vm;
      let name = d.name, i = 2;
      while (Array.from(this.vms.values()).some(v => v.name === name)) name = d.name + '-' + (i++);
      const errs = this.validateSpec({ name, cpu: d.cpu, ramMB: d.ramMB, diskMB: d.diskMB });
      if (errs.length) throw new Error(errs.join('\n'));
      d.id = U.uid('vm-'); d.name = name; d.ip = this.nextIp(); d.wasRunning = false; d.autoRestore = [];
      const vm = new VM(this, d);
      this.vms.set(vm.id, vm);
      await this.saveNow(vm); await this.saveMeta();
      this.emit('change');
      return vm;
    }
    byName(n) { return Array.from(this.vms.values()).find(v => v.name === n || v.hostname === n || v.hostname.split('.')[0] === n); }

    // ---------- red ----------
    resolve(fromVm, host) {
      host = String(host || '').toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === fromVm.hostname || host === fromVm.hostname.split('.')[0] || host === '0.0.0.0' || host === fromVm.ip || host === 'localhost.localdomain') return { vm: fromVm, ip: host === fromVm.ip ? fromVm.ip : '127.0.0.1', local: host !== fromVm.ip };
      // /etc/hosts de la VM origen
      let hosts = '';
      try { hosts = fromVm.fs.read('/etc/hosts'); } catch (e) { }
      let ip = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : null;
      if (!ip) for (const l of hosts.split('\n')) { const f = l.trim().split(/\s+/); if (f.length > 1 && !f[0].startsWith('#') && f.slice(1).map(x => x.toLowerCase()).includes(host)) { ip = f[0]; break; } }
      if (!ip) { const v = this.byName(host); if (v) ip = v.ip; }
      if (!ip) return null;
      const vm = Array.from(this.vms.values()).find(v => v.ip === ip);
      return { vm: vm || null, ip, local: vm === fromVm };
    }
    // Conexión TCP: {ok, listener, vm} o {error: 'refused'|'noroute'|'unknown'|'timeout'}
    connect(fromVm, host, port) {
      const r = this.resolve(fromVm, host);
      if (!r) return { error: 'unknown' };
      if (!r.vm || r.vm.state !== 'running') return { error: 'noroute-down', ip: r.ip };
      const target = r.vm;
      const remote = target !== fromVm;
      const destIp = remote ? target.ip : (r.local ? '127.0.0.1' : target.ip);
      const l = target.listeners.find(x => x.port === port && (x.addr === '0.0.0.0' || x.addr === destIp));
      if (remote && !target.fwAllows(port)) return { error: 'noroute', ip: r.ip, vm: target };
      if (!l) return { error: 'refused', ip: r.ip, vm: target };
      return { ok: true, listener: l, vm: target, ip: r.ip, remote };
    }
    // Conexión desde el equipo anfitrión (navegador/consola del escritorio)
    hostConnect(host, port) {
      host = String(host || '').toLowerCase();
      const vm = Array.from(this.vms.values()).find(v => v.ip === host || v.hostname === host || v.hostname.split('.')[0] === host || v.name.toLowerCase() === host);
      if (!vm) return { error: host === 'localhost' || host === '127.0.0.1' ? 'refused-host' : 'unknown' };
      if (vm.state !== 'running') return { error: 'timeout', vm };
      if (!vm.fwAllows(port)) return { error: 'unreachable', vm };
      const l = vm.listeners.find(x => x.port === port && (x.addr === '0.0.0.0' || x.addr === vm.ip));
      if (!l) {
        const local = vm.listeners.find(x => x.port === port);
        return { error: 'refused', vm, localOnly: !!local };
      }
      return { ok: true, listener: l, vm, ip: vm.ip };
    }
    hostHttp(url, opts) {
      const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url.trim());
      if (!m) return { error: 'badurl' };
      const port = m[3] ? +m[3] : (m[1] === 'https' ? 443 : 80);
      const c = this.hostConnect(m[2], port);
      if (!c.ok) return Object.assign({ host: m[2], port }, c);
      const req = { method: (opts && opts.method) || 'GET', path: m[4] || '/', auth: opts && opts.auth, host: m[2] };
      if (c.listener.server) return Object.assign({ ok: true, ip: c.ip, port, vm: c.vm }, c.listener.server.handleHttp(req, c.listener.kind));
      return { ok: true, ip: c.ip, port, status: 200, body: '' };
    }
    http(fromVm, url, opts) {
      const m = /^(?:(https?):\/\/)?([^/:]+)(?::(\d+))?(\/.*)?$/.exec(url);
      if (!m) return { error: 'badurl' };
      const scheme = m[1] || 'http';
      const port = m[3] ? +m[3] : (scheme === 'https' ? 443 : 80);
      const c = this.connect(fromVm, m[2], port);
      if (!c.ok) return Object.assign({ host: m[2], port }, c);
      const l = c.listener;
      const req = { method: (opts && opts.method) || 'GET', path: m[4] || '/', auth: opts && opts.auth, host: m[2], body: opts && opts.data, headers: (opts && opts.headers) || {} };
      if (l.server) return Object.assign({ ok: true, ip: c.ip, port }, l.server.handleHttp(req, l.kind));
      if (l.kind === 'ssh') return { ok: true, ip: c.ip, port, raw: 'SSH-2.0-OpenSSH_8.7\r\n' };
      return { ok: true, ip: c.ip, port, status: 200, body: '' };
    }

    // ---------- JBoss ----------
    async startJBoss(vm, home, args, user, ctx, o) {
      const det = L.jboss.detectHome(vm.fs, home + '/bin/standalone.sh');
      if (!det) throw new Error('Instalación de JBoss no válida en ' + home);
      const po = L.jboss.parseArgs(args);
      const cred = L.os.users.cred(vm.fs, user);
      const srv = new L.jboss.JBossServer(vm, home, det.dist, { config: po.config, props: po.props, user, cred, console: ctx && ctx.console, rawArgs: args });
      vm.servers.push(srv);
      srv.on('state', () => { vm.emit('servers'); this.emit('change'); this.scheduleSave(vm); });
      srv.on('exit', () => { vm.servers = vm.servers.filter(s => s !== srv); vm.emit('servers'); this.scheduleSave(vm); });
      const p = srv.start({ env: (ctx && ctx.env) || {}, ppid: ctx && ctx.ppid });
      if (o && o.background) return { server: srv, promise: p };
      return { server: srv, promise: p };
    }
    // Ejecuta el ExecStart de una unidad systemd
    async runService(vm, unit, exec, user, env, wd) {
      const parts = exec.match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
      const cmd = parts[0];
      let node;
      try { node = vm.fs.lookup(cmd).node; } catch (e) {
        vm.logSys(unit, '(' + P.basename(cmd) + ')[' + vm.nextPid + ']: ' + unit + '.service: Failed to locate executable ' + cmd + ': No such file or directory');
        return { ok: false, code: 203 };
      }
      const cred = L.os.users.cred(vm.fs, user);
      if (!cred) { vm.logSys(unit, unit + '.service: Failed to determine user credentials: No such process'); return { ok: false, code: 217 }; }
      if (!vm.fs.can(node, cred, 'x')) { vm.logSys(unit, unit + '.service: Failed to execute ' + cmd + ': Permission denied'); return { ok: false, code: 203 }; }
      // SELinux: systemd (init_t) no puede ejecutar archivos con etiqueta user_home_t/tmp_t...
      if (L.selinux && L.selinux.blocksServiceExec(vm, vm.fs.realpath(cmd))) {
        vm.logSys('(' + P.basename(cmd).slice(0, 13) + ')[' + vm.nextPid + ']', unit + '.service: Failed to locate executable ' + cmd + ': Permission denied');
        vm.logSys('(' + P.basename(cmd).slice(0, 13) + ')[' + vm.nextPid + ']', unit + '.service: Failed at step EXEC spawning ' + cmd + ': Permission denied');
        return { ok: false, code: 203 };
      }
      const data = node.d || '';
      if (data.includes(L.jboss.SCRIPT_MARK + 'standalone') || data.includes(L.jboss.SCRIPT_MARK + 'launch')) {
        const home = P.dirname(P.dirname(vm.fs.realpath(cmd)));
        const lines = [];
        const { server, promise } = await this.startJBoss(vm, home, parts.slice(1), user, { env, console: (s) => { lines.push(s); } });
        // espera a que falle o arranque
        const code = await Promise.race([promise, U.sleep(8000).then(() => 0)]);
        if (server.state === 'failed') {
          for (const l of lines.join('').split('\n').filter(Boolean).slice(-6)) vm.logSys(unit + '.sh[' + (server.pid || vm.nextPid) + ']', l.replace(/\x1b\[[0-9;]*m/g, ''));
          return { ok: false, code: code || 1 };
        }
        return { ok: true, pid: server.pid, server };
      }
      // Script genérico: se ejecuta con el shell en segundo plano
      const p = vm.spawn({ user, cmd: exec, memMB: 3, unit });
      if (L.Shell) {
        const sh = new L.Shell(vm, { user, env, cwd: wd || '/', noTty: true });
        sh.run(exec + ' >/dev/null 2>&1').then(code => { if (vm.units[unit] && vm.units[unit].pid === p.pid) { vm.units[unit].active = false; vm.units[unit].result = code ? 'failed' : null; } vm.reap(p.pid); });
      }
      return { ok: true, pid: p.pid };
    }
  }

  L.VM = VM;
  L.Lab = Lab;
  L.FW_SERVICES = FW_SERVICES;
})(globalThis.JLab = globalThis.JLab || {});
