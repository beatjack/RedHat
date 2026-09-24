/*
 * Certificados y JVM: openssl (version, genrsa, rsa, req, x509, verify,
 * s_client, pkcs12, rand, dgst, passwd, base64), keytool, jstat, jinfo.
 * Las claves y certificados se guardan en PEM cuyo cuerpo es JSON en base64
 * (no hay criptografía real), así pueden inspeccionarse con openssl/keytool.
 */
(function (L) {
  'use strict';
  const P = L.path, U = L.util, C = L.cmds, OS = L.os;
  const { getopt, lines } = L.cmdutil;

  // ---------- PEM ----------
  function pem(label, obj) { return '-----BEGIN ' + label + '-----\n' + U.b64encode(JSON.stringify(obj)).match(/.{1,64}/g).join('\n') + '\n-----END ' + label + '-----\n'; }
  function readPem(text, label) {
    const re = new RegExp('-----BEGIN ' + label + '-----([\\s\\S]*?)-----END ' + label + '-----', 'g');
    const out = [];
    let m;
    while ((m = re.exec(text || ''))) { try { out.push(JSON.parse(U.b64decode(m[1].replace(/\s+/g, '')))); } catch (e) { } }
    return out;
  }
  // "/C=MX/O=Lab/CN=host" -> [['C','MX'],...]
  function parseSubj(s) {
    if (!s) return [];
    if (s.startsWith('/')) return s.slice(1).split('/').filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
    return s.split(/\s*,\s*/).filter(Boolean).map(p => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; });
  }
  const dnOpenssl = (dn) => dn.map(([k, v]) => k + ' = ' + v).join(', ');
  const dnJava = (dn) => dn.slice().reverse().map(([k, v]) => k + '=' + v).join(', ');
  const fpHex = (obj, alg) => { const h = alg === 'sha1' ? U.sha256('sha1' + JSON.stringify(obj)).slice(0, 40) : U.sha256(JSON.stringify(obj)); return h.toUpperCase().match(/../g).join(':'); };
  const gmt = (ms) => { const d = new Date(ms); return U.MONTHS[d.getUTCMonth()] + ' ' + U.pad(d.getUTCDate(), 2) + ' ' + U.two(d.getUTCHours()) + ':' + U.two(d.getUTCMinutes()) + ':' + U.two(d.getUTCSeconds()) + ' ' + d.getUTCFullYear() + ' GMT'; };
  function newKey(bits) { return { k: 'key', bits: bits || 2048, id: U.sha256(String(Math.random()) + Date.now()).slice(0, 32) }; }
  function makeCert(o) {
    const now = Date.now();
    return {
      k: 'cert', subject: o.subject, issuer: o.issuer || o.subject, serial: o.serial || U.sha256(String(Math.random())).slice(0, 40),
      notBefore: now, notAfter: now + (o.days || 30) * 864e5, keyId: o.keyId, signerKeyId: o.signerKeyId || o.keyId,
      bits: o.bits || 2048, san: o.san || [], ca: !!o.ca, sigAlg: o.sigAlg || 'sha256WithRSAEncryption'
    };
  }
  function certText(cert) {
    const s = [];
    s.push('Certificate:\n    Data:\n        Version: 3 (0x2)\n        Serial Number:\n            ' + cert.serial.match(/../g).join(':') + '\n        Signature Algorithm: ' + cert.sigAlg);
    s.push('        Issuer: ' + dnOpenssl(cert.issuer) + '\n        Validity\n            Not Before: ' + gmt(cert.notBefore) + '\n            Not After : ' + gmt(cert.notAfter));
    s.push('        Subject: ' + dnOpenssl(cert.subject) + '\n        Subject Public Key Info:\n            Public Key Algorithm: rsaEncryption\n                Public-Key: (' + cert.bits + ' bit)\n                Exponent: 65537 (0x10001)');
    s.push('        X509v3 extensions:\n            X509v3 Subject Key Identifier: \n                ' + cert.keyId.toUpperCase().slice(0, 40).match(/../g).join(':'));
    if (cert.ca) s.push('            X509v3 Basic Constraints: critical\n                CA:TRUE');
    if (cert.san.length) s.push('            X509v3 Subject Alternative Name: \n                ' + cert.san.map(x => /^\d+\.\d+\.\d+\.\d+$/.test(x.v) ? 'IP Address:' + x.v : 'DNS:' + x.v).join(', '));
    s.push('    Signature Algorithm: ' + cert.sigAlg + '\n    Signature Value:\n        ' + U.sha256(cert.serial + cert.signerKeyId).match(/../g).slice(0, 18).join(':'));
    return s.join('\n') + '\n';
  }
  function parseSan(spec) {
    // "subjectAltName=DNS:a,IP:1.2.3.4" o "SAN=dns:a,ip:1.2.3.4"
    const v = spec.replace(/^(subjectAltName|SAN)\s*=\s*/i, '');
    return v.split(',').map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf(':'); return { t: x.slice(0, i).toUpperCase(), v: x.slice(i + 1) }; });
  }
  // Certificado que presenta el https-listener de JBoss (autofirmado, como applicationSSC)
  function serverCert(srv) {
    if (!srv._tlsCert) srv._tlsCert = makeCert({ subject: [['CN', 'localhost']], keyId: U.sha256(srv.id + srv.home).slice(0, 32), days: 90, serial: U.sha256('ssc' + srv.home).slice(0, 16) });
    return srv._tlsCert;
  }

  function optsList(args, valued) {
    // parser de opciones estilo openssl (-opt valor)
    const o = {}, rest = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('-') && a.length > 1) { const k = a.replace(/^-+/, ''); if (valued.includes(k)) o[k] = args[++i]; else o[k] = true; }
      else rest.push(a);
    }
    return { o, rest };
  }
  const readText = (c, f) => c.fs.read(c.resolve(f), c.cred);
  const writeOut = (c, f, data, mode) => { if (f) c.fs.write(c.resolve(f), data, { cred: c.cred, mode: mode || 0o644 }); else c.out(data); };

  // ================= openssl =================
  C.openssl = async (c) => {
    const [sub, ...args] = c.args;
    const E = (msg) => { c.err(msg + '\n'); return 1; };
    switch (sub) {
      case undefined: case 'help': c.println('help:\n\nStandard commands\nbase64            dgst              genrsa            passwd\npkcs12            rand              req               rsa\ns_client          verify            version           x509'); return 0;
      case 'version': c.println('OpenSSL 3.0.7 1 Nov 2022 (Library: OpenSSL 3.0.7 1 Nov 2022)'); if (args.includes('-a')) c.println('built on: Tue Jun 18 00:00:00 2024 UTC\nplatform: linux-x86_64\nOPENSSLDIR: "/etc/pki/tls"\nMODULESDIR: "/usr/lib64/ossl-modules"'); return 0;
      case 'genrsa': {
        const { o, rest } = optsList(args, ['out', 'passout']);
        const bits = +(rest[0] || 2048);
        if (bits < 512) return E('Error: key size ' + bits + ' is too small');
        const key = newKey(bits);
        if (o.aes256 || o.aes128 || o.des3) key.enc = true;
        writeOut(c, o.out, pem('PRIVATE KEY', key), 0o600);
        return 0;
      }
      case 'rsa': {
        const { o } = optsList(args, ['in', 'out', 'passin']);
        let t; try { t = readText(c, o.in); } catch (e) { return E('Could not open file or uri for loading private key from ' + o.in); }
        const k = readPem(t, 'PRIVATE KEY')[0];
        if (!k) return E('Could not read private key from ' + o.in);
        if (o.check) c.println('RSA key ok');
        if (o.text || o.noout) { if (o.text) c.println('Private-Key: (' + k.bits + ' bit, 2 primes)'); }
        if (o.pubout) writeOut(c, o.out, pem('PUBLIC KEY', { k: 'pub', bits: k.bits, id: k.id }));
        else if (!o.noout && !o.check) writeOut(c, o.out, pem('PRIVATE KEY', k), 0o600);
        return 0;
      }
      case 'req': {
        const { o } = optsList(args, ['key', 'newkey', 'keyout', 'out', 'in', 'days', 'subj', 'addext', 'config', 'passout', 'passin']);
        if (o.in && !o.new && !o.x509) {
          let t; try { t = readText(c, o.in); } catch (e) { return E('Could not open file or uri for loading X509 request from ' + o.in); }
          const r = readPem(t, 'CERTIFICATE REQUEST')[0];
          if (!r) return E('Could not read X509 request from ' + o.in);
          if (o.verify) c.err('Certificate request self-signature verify OK\n');
          if (o.subject) c.println('subject=' + dnOpenssl(r.subject));
          if (o.text) c.println('Certificate Request:\n    Data:\n        Version: 1 (0x0)\n        Subject: ' + dnOpenssl(r.subject) + '\n        Subject Public Key Info:\n            Public Key Algorithm: rsaEncryption\n                Public-Key: (' + r.bits + ' bit)' + (r.san.length ? '\n        Requested Extensions:\n            X509v3 Subject Alternative Name: \n                ' + r.san.map(x => (x.t === 'IP' ? 'IP Address:' : 'DNS:') + x.v).join(', ') : ''));
          if (!o.noout && !o.text && !o.subject) c.out(t);
          return 0;
        }
        if (!o.new && !o.x509) return E('req: Use -help for summary.');
        let key;
        if (o.key) { try { key = readPem(readText(c, o.key), 'PRIVATE KEY')[0]; } catch (e) { } if (!key) return E('Could not read private key from ' + o.key); }
        else {
          const bits = o.newkey ? +(/rsa:(\d+)/.exec(o.newkey) || [0, 2048])[1] : 2048;
          key = newKey(bits);
          if (!(o.nodes || o.noenc) && c.term) { await c.prompt('Enter PEM pass phrase:', true); await c.prompt('Verifying - Enter PEM pass phrase:', true); key.enc = true; }
          c.err('.....+++++\n.....+++++\n-----\n');
          writeOut(c, o.keyout || 'privkey.pem', pem('PRIVATE KEY', key), 0o600);
        }
        let subject;
        if (o.subj) subject = parseSubj(o.subj);
        else {
          if (!c.term) return E('req: no subject specified (use -subj)');
          c.println('You are about to be asked to enter information that will be incorporated\ninto your certificate request.\nWhat you are about to enter is what is called a Distinguished Name or a DN.\nThere are quite a few fields but you can leave some blank\nFor some fields there will be a default value,\nIf you enter \'.\', the field will be left blank.\n-----');
          const q = [['C', 'Country Name (2 letter code) [XX]:', 'XX'], ['ST', 'State or Province Name (full name) []:', ''], ['L', 'Locality Name (eg, city) [Default City]:', 'Default City'], ['O', 'Organization Name (eg, company) [Default Company Ltd]:', 'Default Company Ltd'], ['OU', 'Organizational Unit Name (eg, section) []:', ''], ['CN', "Common Name (eg, your name or your server's hostname) []:", ''], ['emailAddress', 'Email Address []:', '']];
          subject = [];
          for (const [k, text, def] of q) { const v = await c.prompt(text); const val = v === '' ? def : v; if (val && val !== '.') subject.push([k, val]); }
          if (!o.x509) { c.println('\nPlease enter the following \'extra\' attributes\nto be sent with your certificate request'); await c.prompt('A challenge password []:'); await c.prompt('An optional company name []:'); }
        }
        const san = o.addext ? parseSan(o.addext) : [];
        if (o.x509) writeOut(c, o.out, pem('CERTIFICATE', makeCert({ subject, keyId: key.id, bits: key.bits, days: +(o.days || 30), san })));
        else writeOut(c, o.out, pem('CERTIFICATE REQUEST', { k: 'csr', subject, keyId: key.id, bits: key.bits, san }));
        return 0;
      }
      case 'x509': {
        const { o } = optsList(args, ['in', 'out', 'days', 'signkey', 'CA', 'CAkey', 'checkend', 'set_serial', 'extfile', 'inform', 'outform', 'CAserial', 'passin']);
        if (o.req) {
          let r; try { r = readPem(readText(c, o.in), 'CERTIFICATE REQUEST')[0]; } catch (e) { }
          if (!r) return E('Could not read X509 request from ' + (o.in || 'stdin'));
          let cert;
          if (o.CA) {
            let ca, cakey;
            try { ca = readPem(readText(c, o.CA), 'CERTIFICATE')[0]; cakey = readPem(readText(c, o.CAkey || o.CA), 'PRIVATE KEY')[0]; } catch (e) { }
            if (!ca) return E('Could not read CA certificate from ' + o.CA);
            if (!cakey) return E('Could not read CA private key from ' + (o.CAkey || o.CA));
            if (cakey.id !== ca.keyId) return E('CA certificate and CA private key do not match');
            cert = makeCert({ subject: r.subject, issuer: ca.subject, keyId: r.keyId, signerKeyId: cakey.id, bits: r.bits, days: +(o.days || 30), san: r.san });
          } else {
            let k; try { k = readPem(readText(c, o.signkey), 'PRIVATE KEY')[0]; } catch (e) { }
            if (!k) return E('Could not read private key from ' + o.signkey);
            cert = makeCert({ subject: r.subject, keyId: r.keyId, signerKeyId: k.id, bits: r.bits, days: +(o.days || 30), san: r.san });
          }
          c.err('Certificate request self-signature ok\nsubject=' + dnOpenssl(r.subject) + '\n');
          writeOut(c, o.out, pem('CERTIFICATE', cert));
          return 0;
        }
        let t;
        try { t = o.in ? readText(c, o.in) : await c.readAll(); } catch (e) { return E('Could not open file or uri for loading certificate from ' + o.in + '\n' + e.message); }
        const cert = readPem(t, 'CERTIFICATE')[0];
        if (!cert) return E('Could not read certificate from ' + (o.in || '<stdin>') + '\nUnable to load certificate');
        if (o.text) c.out(certText(cert));
        if (o.subject) c.println('subject=' + dnOpenssl(cert.subject));
        if (o.issuer) c.println('issuer=' + dnOpenssl(cert.issuer));
        if (o.serial) c.println('serial=' + cert.serial.toUpperCase());
        if (o.dates || o.startdate) c.println('notBefore=' + gmt(cert.notBefore));
        if (o.dates || o.enddate) c.println('notAfter=' + gmt(cert.notAfter));
        if (o.fingerprint) c.println((o.sha1 ? 'sha1' : 'sha256') + ' Fingerprint=' + fpHex(cert, o.sha1 ? 'sha1' : 'sha256'));
        if (o.ext && cert.san.length) c.println('X509v3 Subject Alternative Name: \n    ' + cert.san.map(x => (x.t === 'IP' ? 'IP Address:' : 'DNS:') + x.v).join(', '));
        if (o.checkend !== undefined) { const ok = cert.notAfter > Date.now() + (+o.checkend) * 1000; c.println(ok ? 'Certificate will not expire' : 'Certificate will expire'); return ok ? 0 : 1; }
        if (!o.noout) writeOut(c, o.out, pem('CERTIFICATE', cert));
        return 0;
      }
      case 'verify': {
        const { o, rest } = optsList(args, ['CAfile', 'CApath']);
        let ca = null;
        if (o.CAfile) { try { ca = readPem(readText(c, o.CAfile), 'CERTIFICATE'); } catch (e) { return E('Error loading file ' + o.CAfile); } }
        let st = 0;
        for (const f of rest) {
          let cert; try { cert = readPem(readText(c, f), 'CERTIFICATE')[0]; } catch (e) { }
          if (!cert) { c.err('Could not read certificate from ' + f + '\n'); st = 2; continue; }
          const selfSigned = JSON.stringify(cert.issuer) === JSON.stringify(cert.subject) && cert.signerKeyId === cert.keyId;
          const issuer = (ca || []).find(x => JSON.stringify(x.subject) === JSON.stringify(cert.issuer) && x.keyId === cert.signerKeyId);
          const expired = cert.notAfter < Date.now();
          if (expired) { c.err('C = ' + dnOpenssl(cert.subject) + '\nerror 10 at 0 depth lookup: certificate has expired\nerror ' + f + ': verification failed\n'); st = 2; }
          else if (issuer || (selfSigned && (ca || []).some(x => x.keyId === cert.keyId))) c.println(f + ': OK');
          else { c.err(dnOpenssl(cert.subject) + '\nerror ' + (selfSigned ? '18 at 0 depth lookup: self-signed certificate' : '20 at 0 depth lookup: unable to get local issuer certificate') + '\nerror ' + f + ': verification failed\n'); st = 2; }
        }
        return st;
      }
      case 's_client': {
        const { o } = optsList(args, ['connect', 'servername', 'CAfile', 'verify_return_error']);
        const target = o.connect || 'localhost:443';
        const m = /^([^:]+):(\d+)$/.exec(target);
        if (!m) return E('s_client: -connect: host:port expected');
        const conn = c.vm.lab.connect(c.vm, m[1], +m[2]);
        if (!conn.ok) {
          if (conn.error === 'unknown') return E('BIO_lookup_ex:system lib:crypto/bio/bio_addr.c:738:Name or service not known\nconnect:errno=0');
          c.err('40F7C3A7FF7F0000:error:8000006F:system library:BIO_connect:' + (conn.error === 'refused' ? 'Connection refused' : 'No route to host') + ':crypto/bio/bio_sock2.c:125:calling connect()\nconnect:errno=' + (conn.error === 'refused' ? 111 : 113) + '\n');
          return 1;
        }
        c.println('CONNECTED(00000003)');
        const l = conn.listener;
        if (l.kind !== 'https' || !l.server) {
          c.err('40F7C3A7FF7F0000:error:0A00010B:SSL routines:ssl3_get_record:wrong version number:ssl/record/ssl3_record.c:354:\n');
          c.println('---\nno peer certificate available\n---\nNo client certificate CA names sent\n---\nSSL handshake has read 5 bytes and written 312 bytes\nVerification: OK\n---\nNew, (NONE), Cipher is (NONE)\nSecure Renegotiation IS NOT supported');
          return 1;
        }
        const cert = serverCert(l.server);
        const dn = dnOpenssl(cert.subject);
        c.err('depth=0 ' + dn + '\nverify error:num=18:self-signed certificate\nverify return:1\ndepth=0 ' + dn + '\nverify return:1\n');
        c.println('---\nCertificate chain\n 0 s:' + dn + '\n   i:' + dnOpenssl(cert.issuer) + '\n   a:PKEY: rsaEncryption, ' + cert.bits + ' (bit); sigalg: RSA-SHA256\n   v:NotBefore: ' + gmt(cert.notBefore) + '; NotAfter: ' + gmt(cert.notAfter) + '\n---\nServer certificate\n' + pem('CERTIFICATE', cert) + 'subject=' + dn + '\nissuer=' + dnOpenssl(cert.issuer) + '\n---\nNo client certificate CA names sent\nPeer signing digest: SHA256\nPeer signature type: RSA-PSS\nServer Temp Key: X25519, 253 bits\n---\nSSL handshake has read 1370 bytes and written 373 bytes\nVerification error: self-signed certificate\n---\nNew, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384\nServer public key is ' + cert.bits + ' bit\nSecure Renegotiation IS NOT supported\nCompression: NONE\nExpansion: NONE\nNo ALPN negotiated\nEarly data was not sent\nVerify return code: 18 (self-signed certificate)\n---\nDONE');
        return 0;
      }
      case 'pkcs12': {
        const { o } = optsList(args, ['in', 'inkey', 'out', 'name', 'passout', 'passin', 'certfile']);
        if (o.export) {
          let cert, key;
          try { cert = readPem(readText(c, o.in), 'CERTIFICATE')[0]; key = readPem(readText(c, o.inkey || o.in), 'PRIVATE KEY')[0]; } catch (e) { }
          if (!cert) return E('Could not read certificate from ' + o.in);
          if (!key) return E('Could not read private key from ' + (o.inkey || o.in));
          if (key.id !== cert.keyId) return E('No certificate matches private key');
          let pass = o.passout ? o.passout.replace(/^pass:/, '') : null;
          if (pass === null) { if (!c.term) return E('Error: no -passout specified'); pass = await c.prompt('Enter Export Password:', true); const p2 = await c.prompt('Verifying - Enter Export Password:', true); if (p2 !== pass) return E('Verify failure'); }
          const ks = { type: 'PKCS12', pass: U.sha256('ks:' + pass), entries: [{ alias: (o.name || '1').toLowerCase(), kind: 'PrivateKeyEntry', cert, created: Date.now() }] };
          c.fs.write(c.resolve(o.out || 'keystore.p12'), KS_MAGIC + U.b64encode(JSON.stringify(ks)), { cred: c.cred, mode: 0o600, bin: true });
          return 0;
        }
        let ks; try { ks = readKs(readText(c, o.in)); } catch (e) { }
        if (!ks) return E('Could not read PKCS12 file ' + o.in);
        const pass = o.passin ? o.passin.replace(/^pass:/, '') : (c.term ? await c.prompt('Enter Import Password:', true) : '');
        if (U.sha256('ks:' + pass) !== ks.pass) return E('Mac verify error: invalid password?');
        if (o.info) c.err('MAC: sha256, Iteration 2048\nMAC length: 32, salt length: 8\nPKCS7 Encrypted data: PBES2, PBKDF2, AES-256-CBC, Iteration 2048, PRF hmacWithSHA256\nCertificate bag\n');
        for (const e of ks.entries) c.out('Bag Attributes\n    friendlyName: ' + e.alias + '\nsubject=' + dnOpenssl(e.cert.subject) + '\nissuer=' + dnOpenssl(e.cert.issuer) + '\n' + pem('CERTIFICATE', e.cert));
        return 0;
      }
      case 'rand': {
        const { o, rest } = optsList(args, ['out']);
        const n = +(rest[0] || 16);
        let bytes = '';
        for (let i = 0; i < n; i++) bytes += String.fromCharCode(Math.floor(Math.random() * 256));
        const out = o.hex ? Array.from(bytes).map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '\n' : o.base64 ? btoa(bytes) + '\n' : bytes;
        writeOut(c, o.out, out);
        return 0;
      }
      case 'dgst': case 'sha256': case 'md5': case 'sha1': {
        const { o, rest } = optsList(args, ['out']);
        const alg = sub !== 'dgst' ? sub : o.md5 ? 'md5' : o.sha1 ? 'sha1' : 'sha256';
        const label = { md5: 'MD5', sha1: 'SHA1', sha256: 'SHA2-256' }[alg];
        const h = (d) => alg === 'md5' ? U.md5(d) : alg === 'sha1' ? U.sha256('sha1' + d).slice(0, 40) : U.sha256(d);
        if (!rest.length) { c.println(label + '(stdin)= ' + h(await c.readAll())); return 0; }
        let st = 0;
        for (const f of rest) { try { c.println(label + '(' + f + ')= ' + h(readText(c, f))); } catch (e) { c.err('Could not open ' + f + ': ' + e.message + '\n'); st = 1; } }
        return st;
      }
      case 'passwd': {
        const { o, rest } = optsList(args, ['salt']);
        const pw = rest[0] !== undefined ? rest[0] : (c.term ? await c.prompt('Password:', true) : '');
        const salt = o.salt || Math.random().toString(36).slice(2, 18);
        c.println((o['6'] ? '$6$' : o['5'] ? '$5$' : o['1'] ? '$1$' : '$6$') + salt + '$' + U.b64encode(U.sha256(salt + pw)).replace(/[=+/]/g, '').slice(0, 86));
        return 0;
      }
      case 'base64': case 'enc': {
        const { o } = optsList(args, ['in', 'out']);
        const data = o.in ? readText(c, o.in) : await c.readAll();
        try { writeOut(c, o.out, o.d ? U.b64decode(data) : (U.b64encode(data).match(/.{1,64}/g) || ['']).join('\n') + '\n'); } catch (e) { return E('error reading input'); }
        return 0;
      }
    }
    c.err('Invalid command \'' + sub + '\'; type "help" for a list.\n');
    return 1;
  };

  // ================= keytool =================
  const KS_MAGIC = 'JLAB-KEYSTORE/1\n';
  function readKs(text) {
    if (!text || !text.startsWith(KS_MAGIC)) return null;
    try { return JSON.parse(U.b64decode(text.slice(KS_MAGIC.length))); } catch (e) { return null; }
  }
  const javaDate = (ms) => { const d = new Date(ms); return U.MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); };
  const javaLong = (ms) => { const d = new Date(ms); return U.DAYS[d.getDay()] + ' ' + U.MONTHS[d.getMonth()] + ' ' + U.two(d.getDate()) + ' ' + U.clock(ms) + ' UTC ' + d.getFullYear(); };
  function certVerbose(c, cert, n) {
    c.println('Certificate[' + (n || 1) + ']:\nOwner: ' + dnJava(cert.subject) + '\nIssuer: ' + dnJava(cert.issuer) + '\nSerial number: ' + cert.serial.replace(/^0+/, '').slice(0, 16) + '\nValid from: ' + javaLong(cert.notBefore) + ' until: ' + javaLong(cert.notAfter) + '\nCertificate fingerprints:\n\t SHA1: ' + fpHex(cert, 'sha1') + '\n\t SHA256: ' + fpHex(cert) + '\nSignature algorithm name: ' + (cert.bits >= 3072 ? 'SHA384withRSA' : 'SHA256withRSA') + '\nSubject Public Key Algorithm: ' + cert.bits + '-bit RSA key\nVersion: 3');
    if (cert.san.length) c.println('\nExtensions: \n\n#1: ObjectId: 2.5.29.17 Criticality=false\nSubjectAlternativeName [\n' + cert.san.map(x => '  ' + (x.t === 'IP' ? 'IPAddress: ' : 'DNSName: ') + x.v).join('\n') + '\n]');
  }
  C.keytool = async (c) => {
    const a = c.args;
    const has = (f) => a.includes(f);
    const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
    const E = (msg) => { c.println('keytool error: ' + msg); return 1; };
    const cmd = ['-genkeypair', '-genkey', '-list', '-exportcert', '-export', '-importcert', '-import', '-delete', '-printcert', '-changealias', '-storepasswd', '-help'].find(has);
    if (!cmd || cmd === '-help') { c.println('Key and Certificate Management Tool\n\nCommands:\n\n -certreq            Generates a certificate request\n -changealias        Changes an entry\'s alias\n -delete             Deletes an entry\n -exportcert         Exports certificate\n -genkeypair         Generates a key pair\n -importcert         Imports a certificate or a certificate chain\n -list               Lists entries in a keystore\n -printcert          Prints the content of a certificate\n -storepasswd        Changes the store password of a keystore\n\nUse "keytool -?, -h, or --help" for this help message\nUse "keytool -command_name -help" for usage of command_name.'); return 0; }
    const ksPath = c.resolve(val('-keystore') || (c.sh.cred.home + '/.keystore'));
    const load = () => { let t; try { t = c.fs.read(ksPath, c.cred); } catch (e) { return null; } return readKs(t) || { invalid: true }; };
    const save = (ks) => c.fs.write(ksPath, KS_MAGIC + U.b64encode(JSON.stringify(ks)), { cred: c.cred, mode: 0o600, bin: true });
    const askPass = async (create) => {
      let p = val('-storepass');
      if (p === null) {
        if (!c.term) return null;
        p = await c.prompt(create ? 'Enter keystore password:  ' : 'Enter keystore password:  ', true);
        if (create) {
          if ((p || '').length < 6) { c.println('Keystore password is too short - must be at least 6 characters'); return null; }
          const p2 = await c.prompt('Re-enter new password: ', true);
          if (p2 !== p) { c.println('They don\'t match. Try again'); return null; }
        }
      } else if (create && p.length < 6) { c.println('keytool error: java.lang.Exception: Keystore password must be at least 6 characters'); return null; }
      return p;
    };
    const openExisting = async () => {
      const ks = load();
      if (!ks) { E('java.lang.Exception: Keystore file does not exist: ' + ksPath); return null; }
      if (ks.invalid) { E('java.io.IOException: Invalid keystore format'); return null; }
      const p = await askPass(false);
      if (p === null) return null;
      if (U.sha256('ks:' + p) !== ks.pass) { E('java.io.IOException: keystore password was incorrect'); return null; }
      return ks;
    };
    switch (cmd) {
      case '-genkeypair': case '-genkey': {
        const alias = (val('-alias') || 'mykey').toLowerCase();
        let ks = load();
        if (ks && ks.invalid) return E('java.io.IOException: Invalid keystore format');
        const creating = !ks;
        const p = await askPass(creating);
        if (p === null) return 1;
        if (ks && U.sha256('ks:' + p) !== ks.pass) return E('java.io.IOException: keystore password was incorrect');
        ks = ks || { type: (val('-storetype') || 'PKCS12').toUpperCase(), pass: U.sha256('ks:' + p), entries: [] };
        if (ks.entries.some(e => e.alias === alias)) return E('java.lang.Exception: Key pair not generated, alias <' + alias + '> already exists');
        let dname = val('-dname');
        if (!dname) {
          if (!c.term) return E('java.lang.RuntimeException: -dname requerido sin terminal');
          const f = [['CN', 'What is your first and last name?'], ['OU', 'What is the name of your organizational unit?'], ['O', 'What is the name of your organization?'], ['L', 'What is the name of your City or Locality?'], ['ST', 'What is the name of your State or Province?'], ['C', 'What is the two-letter country code for this unit?']];
          const vals = [];
          for (const [k, q] of f) { const v = await c.prompt(q + '\n  [Unknown]:  '); vals.push([k, v || 'Unknown']); }
          const dn = vals.map(([k, v]) => k + '=' + v).join(', ');
          const ok = await c.prompt('Is ' + dn + ' correct?\n  [no]:  ');
          if (!/^y(es)?$/i.test(ok || '')) return 1;
          dname = dn;
        }
        const bits = +(val('-keysize') || 2048);
        const subject = parseSubj(dname).reverse();
        const ext = val('-ext');
        const cert = makeCert({ subject, keyId: U.sha256(alias + Math.random()).slice(0, 32), bits, days: +(val('-validity') || 90), san: ext && /^SAN=/i.test(ext) ? parseSan(ext) : [] });
        ks.entries.push({ alias, kind: 'PrivateKeyEntry', cert, created: Date.now() });
        save(ks);
        c.println('Generating ' + bits.toLocaleString('en-US') + ' bit RSA key pair and self-signed certificate (' + (bits >= 3072 ? 'SHA384withRSA' : 'SHA256withRSA') + ') with a validity of ' + (val('-validity') || 90) + ' days\n\tfor: ' + dname);
        return 0;
      }
      case '-list': {
        const ks = await openExisting();
        if (!ks) return 1;
        const alias = val('-alias');
        const entries = alias ? ks.entries.filter(e => e.alias === alias.toLowerCase()) : ks.entries;
        if (alias && !entries.length) return E('java.lang.Exception: Alias <' + alias + '> does not exist');
        if (!alias) c.println('Keystore type: ' + ks.type + '\nKeystore provider: SUN\n\nYour keystore contains ' + ks.entries.length + ' entr' + (ks.entries.length === 1 ? 'y' : 'ies') + '\n');
        for (const e of entries) {
          if (has('-v')) {
            c.println('Alias name: ' + e.alias + '\nCreation date: ' + javaDate(e.created) + '\nEntry type: ' + e.kind + (e.kind === 'PrivateKeyEntry' ? '\nCertificate chain length: 1' : ''));
            certVerbose(c, e.cert);
            c.println('\n\n*******************************************\n*******************************************\n\n');
          } else if (has('-rfc')) {
            c.println('Alias name: ' + e.alias + '\nCreation date: ' + javaDate(e.created) + '\nEntry type: ' + e.kind + '\n' + pem('CERTIFICATE', e.cert) + '\n*******************************************\n*******************************************\n');
          } else c.println(e.alias + ', ' + javaDate(e.created) + ', ' + e.kind + ', \nCertificate fingerprint (SHA-256): ' + fpHex(e.cert));
        }
        return 0;
      }
      case '-exportcert': case '-export': {
        const ks = await openExisting();
        if (!ks) return 1;
        const alias = (val('-alias') || 'mykey').toLowerCase();
        const e = ks.entries.find(x => x.alias === alias);
        if (!e) return E('java.lang.Exception: Alias <' + alias + '> does not exist');
        const out = pem('CERTIFICATE', e.cert);
        const f = val('-file');
        if (f) { c.fs.write(c.resolve(f), out, { cred: c.cred }); c.println('Certificate stored in file <' + f + '>'); }
        else c.out(out);
        return 0;
      }
      case '-importcert': case '-import': {
        const f = val('-file');
        let text;
        try { text = f ? c.fs.read(c.resolve(f), c.cred) : await c.readAll(); } catch (e) { return E('java.io.FileNotFoundException: ' + f + ' (No such file or directory)'); }
        const cert = readPem(text, 'CERTIFICATE')[0];
        if (!cert) return E('java.lang.Exception: Input not an X.509 certificate');
        let ks = load();
        if (ks && ks.invalid) return E('java.io.IOException: Invalid keystore format');
        const p = await askPass(!ks);
        if (p === null) return 1;
        if (ks && U.sha256('ks:' + p) !== ks.pass) return E('java.io.IOException: keystore password was incorrect');
        ks = ks || { type: (val('-storetype') || 'PKCS12').toUpperCase(), pass: U.sha256('ks:' + p), entries: [] };
        const alias = (val('-alias') || 'mykey').toLowerCase();
        if (ks.entries.some(e => e.alias === alias)) return E('java.lang.Exception: Certificate not imported, alias <' + alias + '> already exists');
        if (!has('-noprompt')) {
          certVerbose(c, cert);
          const ok = c.term ? await c.prompt('Trust this certificate? [no]:  ') : 'no';
          if (!/^y(es)?$/i.test(ok || '')) { c.println('Certificate was not added to keystore'); return 1; }
        }
        ks.entries.push({ alias, kind: 'trustedCertEntry', cert, created: Date.now() });
        save(ks);
        c.println('Certificate was added to keystore');
        return 0;
      }
      case '-delete': {
        const ks = await openExisting();
        if (!ks) return 1;
        const alias = (val('-alias') || 'mykey').toLowerCase();
        if (!ks.entries.some(e => e.alias === alias)) return E('java.lang.Exception: Alias <' + alias + '> does not exist');
        ks.entries = ks.entries.filter(e => e.alias !== alias);
        save(ks);
        return 0;
      }
      case '-changealias': {
        const ks = await openExisting();
        if (!ks) return 1;
        const from = (val('-alias') || 'mykey').toLowerCase(), to = (val('-destalias') || '').toLowerCase();
        const e = ks.entries.find(x => x.alias === from);
        if (!e) return E('java.lang.Exception: Alias <' + from + '> does not exist');
        if (!to) return E('java.lang.Exception: Must specify destination alias');
        e.alias = to; save(ks); return 0;
      }
      case '-storepasswd': {
        const ks = await openExisting();
        if (!ks) return 1;
        const np = val('-new') || (c.term ? await c.prompt('New keystore password:  ', true) : null);
        if (!np || np.length < 6) return E('java.lang.Exception: New password must be at least 6 characters');
        ks.pass = U.sha256('ks:' + np); save(ks); return 0;
      }
      case '-printcert': {
        const ssl = val('-sslserver');
        let cert;
        if (ssl) {
          const m = /^([^:]+):?(\d+)?$/.exec(ssl);
          const conn = c.vm.lab.connect(c.vm, m[1], +(m[2] || 443));
          if (!conn.ok) return E('java.net.ConnectException: Connection refused');
          if (conn.listener.kind !== 'https') return E('javax.net.ssl.SSLException: Unsupported or unrecognized SSL message');
          cert = serverCert(conn.listener.server);
        } else {
          const f = val('-file');
          let text; try { text = f ? c.fs.read(c.resolve(f), c.cred) : await c.readAll(); } catch (e) { return E('java.io.FileNotFoundException: ' + f + ' (No such file or directory)'); }
          cert = readPem(text, 'CERTIFICATE')[0];
          if (!cert) return E('java.lang.Exception: Input not an X.509 certificate');
        }
        if (has('-rfc')) c.out(pem('CERTIFICATE', cert)); else certVerbose(c, cert);
        return 0;
      }
    }
    return 1;
  };

  // ================= jstat / jinfo =================
  function findJava(c, pid) {
    const p = c.vm.proc(+pid);
    if (!p || p.kind !== 'java') { c.println(pid + ' not found'); return null; }
    if (c.cred.uid !== 0 && p.user !== c.user) { c.println(pid + ' not found'); return null; }
    return p;
  }
  C.jstat = async (c) => {
    const [opt, pid, interval, count] = c.args;
    if (!opt || opt === '-help' || opt === '-options') { c.println(opt === '-options' ? '-class\n-compiler\n-gc\n-gccapacity\n-gcutil\n-printcompilation' : 'Usage: jstat --help|-options\n       jstat -<option> [-t] [-h<lines>] <vmid> [<interval> [<count>]]'); return opt ? 0 : 1; }
    const p = findJava(c, pid);
    if (!p) return 1;
    const srv = p.server;
    const n = count ? +count : 1;
    const ms = interval ? parseInt(interval, 10) * (/s$/.test(interval) ? 1000 : 1) : 0;
    let ygc = 12 + Math.floor((Date.now() - srv.startedAt) / 30000), fgc = 0;
    const row = () => {
      const heap = srv.xmx * 1024, young = heap / 3, old = heap - young;
      const used = (srv.heapUsed || 90) * 1024;
      const eu = Math.min(young * 0.9, used * 0.4 + Math.random() * young * 0.3), ou = Math.min(old, used * 0.6);
      ygc += Math.random() < 0.3 ? 1 : 0;
      const ygct = (ygc * 0.0071).toFixed(3), gct = (ygc * 0.0071 + fgc * 0.08).toFixed(3);
      if (opt === '-gcutil') return U.pad('0.00', 6) + U.pad((Math.random() * 90).toFixed(2), 7) + U.pad((eu / young * 100).toFixed(2), 7) + U.pad((ou / old * 100).toFixed(2), 7) + U.pad('97.12', 7) + U.pad('93.44', 7) + U.pad(ygc, 7) + U.pad(ygct, 9) + U.pad(fgc, 7) + U.pad('0.000', 8) + U.pad(4, 7) + U.pad('0.013', 8) + U.pad(gct, 10);
      if (opt === '-class') return U.pad(18240 + ygc * 3, 6) + U.pad('36712.4', 9) + U.pad(0, 7) + U.pad('0.0', 7) + U.pad('7.36', 9);
      const f = (x) => U.pad(x.toFixed(1), 11);
      return f(0) + ' ' + f(4096) + ' ' + f(0) + ' ' + f(4096 * Math.random()) + ' ' + f(young) + ' ' + f(eu) + ' ' + f(old) + ' ' + f(ou) + ' ' + f(102400) + ' ' + f(98765.3) + U.pad('12544.0', 9) + U.pad('11720.7', 9) + U.pad(ygc, 8) + U.pad(ygct, 9) + U.pad(fgc, 6) + U.pad('0.000', 8) + U.pad(4, 6) + U.pad('0.013', 8) + U.pad(gct, 10);
    };
    const head = { '-gcutil': '  S0     S1     E      O      M     CCS    YGC     YGCT     FGC    FGCT     CGC    CGCT       GCT   ', '-class': 'Loaded  Bytes  Unloaded  Bytes     Time   ', '-gc': '    S0C         S1C         S0U         S1U          EC           EU           OC           OU          MC         MU       CCSC      CCSU     YGC     YGCT     FGC    FGCT     CGC    CGCT       GCT   ' }[opt];
    if (!head) { c.println('Unknown option: ' + opt); return 1; }
    c.println(head);
    for (let i = 0; i < n; i++) { c.println(row()); if (i < n - 1 && ms) await c.sleep(ms); }
    return 0;
  };
  C.jinfo = (c) => {
    const pid = c.args.filter(a => /^\d+$/.test(a)).pop();
    if (!pid) { c.println('Usage:\n    jinfo <option> <pid>\n       (to connect to a running process)\n\nwhere <option> is one of:\n    -flag <name>         to print the value of the named VM flag\n    -flags               to print VM flags\n    -sysprops            to print Java system properties\n    <no option>          to print both VM flags and system properties'); return 1; }
    const p = findJava(c, pid);
    if (!p) return 1;
    const srv = p.server;
    const heapMax = srv.xmx * 1048576, heapInit = srv.xms * 1048576;
    const flags = '-XX:CICompilerCount=' + Math.min(4, c.vm.cpu + 1) + ' -XX:ConcGCThreads=1 -XX:G1ConcRefinementThreads=' + c.vm.cpu + ' -XX:InitialHeapSize=' + heapInit + ' -XX:MaxHeapSize=' + heapMax + ' -XX:MaxMetaspaceSize=268435456 -XX:MetaspaceSize=100663296 -XX:+UseCompressedClassPointers -XX:+UseCompressedOops -XX:+UseG1GC';
    const flagIdx = c.args.indexOf('-flag');
    if (flagIdx >= 0) {
      const name = c.args[flagIdx + 1] || '';
      const m = new RegExp('-XX:[+-]?' + name.replace(/^[+-]/, '') + '(=\\S+)?').exec(flags);
      if (!m) { c.println('Exception in thread "main" com.sun.tools.attach.AttachOperationFailedException: flag \'' + name + '\' cannot be changed'); return 1; }
      c.println(m[0]); return 0;
    }
    const props = Object.assign({ 'java.version': srv.java ? srv.java.full : '', 'java.vendor': 'Red Hat, Inc.', 'java.home': '/usr/lib/jvm/' + (srv.java ? srv.java.dir : ''), 'user.name': srv.user, 'os.name': 'Linux', 'file.encoding': 'UTF-8' }, srv.props);
    if (!c.args.includes('-flags')) { c.println('Java System Properties:\n#' + U.dateStr(Date.now())); for (const k of Object.keys(props).sort()) c.println(k + '=' + String(props[k]).replace(/:/g, '\\:')); }
    if (!c.args.includes('-sysprops')) c.println((c.args.includes('-flags') ? '' : '\n') + 'VM Flags:\n' + flags + '\n\nVM Arguments:\njvm_args: -D[Standalone] ' + srv.javaOpts + '\njava_command: ' + srv.home + '/jboss-modules.jar -mp ' + srv.home + '/modules org.jboss.as.standalone -Djboss.home.dir=' + srv.home + '\njava_class_path (initial): ' + srv.home + '/jboss-modules.jar\nLauncher Type: SUN_STANDARD');
    return 0;
  };

  L.certs = { pem, readPem, readKs, makeCert, serverCert, KS_MAGIC };
})(globalThis.JLab = globalThis.JLab || {});
