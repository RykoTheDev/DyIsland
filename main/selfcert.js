// A self-signed certificate for the LocalSend receiver, built with Node's crypto only (no openssl, no PowerShell).
// LocalSend peers do not validate the chain; the device identity is the SHA-256 of the certificate (the "fingerprint").
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const len = (n) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const der = (tag, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); };
const seq = (...p) => der(0x30, ...p);
const oid = (s) => {
  const n = s.split('.').map(Number); const out = [n[0] * 40 + n[1]];
  for (const x of n.slice(2)) { const b = [x & 127]; let v = x >> 7; while (v) { b.unshift((v & 127) | 128); v >>= 7; } out.push(...b); }
  return der(0x06, Buffer.from(out));
};
const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));   // YYMMDDHHMMSSZ (valid until 2049)
const name = (cn) => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), der(0x05, Buffer.alloc(0)));
const pem = (label, buf) => '-----BEGIN ' + label + '-----\n' + buf.toString('base64').replace(/(.{64})/g, '$1\n').trimEnd() + '\n-----END ' + label + '-----\n';

function generate(cn = 'DyIsland', years = 10) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serial = crypto.randomBytes(8); serial[0] &= 0x7f; serial[0] |= 0x01;
  const from = new Date(Date.now() - 24 * 3600 * 1000), to = new Date(from.getTime() + years * 365 * 24 * 3600 * 1000);
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, serial), SHA256_RSA, name(cn),
    seq(utc(from), utc(to)), name(cn), publicKey.export({ type: 'spki', format: 'der' }),
  );
  const sig = crypto.sign('sha256', tbs, privateKey);
  const cert = seq(tbs, SHA256_RSA, der(0x03, Buffer.concat([Buffer.from([0]), sig])));
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', cert), fingerprint: crypto.createHash('sha256').update(cert).digest('hex') };
}

// Loads the saved certificate, or makes and saves one (so the device keeps the same identity between runs)
function load(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (o && typeof o.key === 'string' && typeof o.cert === 'string' && /^[0-9a-f]{64}$/.test(o.fingerprint)) { new crypto.X509Certificate(o.cert); return o; }
  } catch { /* none yet or damaged: make a new one */ }
  const o = generate();
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(o), { mode: 0o600 }); } catch { /* unwritable: a new identity next run */ }
  return o;
}

module.exports = { generate, load };
