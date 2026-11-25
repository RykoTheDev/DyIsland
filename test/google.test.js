// Google integration: the parts that do not need Google (PKCE, the sign-in URL, mapping what the APIs return) and the whole refresh with a FAKE network.
const assert = require('assert');
const crypto = require('crypto');
const G = require('../main/google.js');

// PKCE: the challenge is the SHA-256 of the verifier
const { verifier, challenge } = G.pkcePair();
assert(verifier.length >= 43 && /^[A-Za-z0-9_-]+$/.test(verifier));
assert.strictEqual(challenge, crypto.createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
// the sign-in URL: read-only scopes, loopback redirect, PKCE
const u = new URL(G.authUrl({ clientId: 'id.apps.googleusercontent.com', redirect: 'http://127.0.0.1:5555', challenge, state: 'st' }));
assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256'); assert.strictEqual(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:5555');
for (const sc of u.searchParams.get('scope').split(' ')) assert(/\.readonly$/.test(sc), 'only read-only scopes: ' + sc);

// mapping
const ev = G.mapEvent({ id: 'e1', summary: 'Design review', start: { dateTime: '2026-11-26T10:00:00Z' }, end: { dateTime: '2026-11-26T10:30:00Z' }, hangoutLink: 'https://meet.google.com/abc-defg-hij' });
assert.deepStrictEqual([ev.title, ev.allDay, ev.end - ev.start, ev.link, ev.kind], ['Design review', false, 1800000, 'https://meet.google.com/abc-defg-hij', 'event']);
const ad = G.mapEvent({ id: 'e2', summary: 'Holiday', start: { date: '2026-11-27' }, end: { date: '2026-11-28' } });
assert(ad.allDay && new Date(ad.start).getDate() === 27 && new Date(ad.start).getHours() === 0, 'an all-day event starts at local midnight of its date');
assert.strictEqual(G.mapEvent({ id: 'x', status: 'cancelled', start: { date: '2026-11-27' } }), null);
assert.strictEqual(G.mapEvent({ id: 'x', summary: 'x', start: {}, end: {} }), null);
assert.strictEqual(G.mapEvent({ id: 'x', summary: 'x', start: { date: '2026-11-27' }, end: { date: '2026-11-28' }, hangoutLink: 'http://evil.example/' }).link, '', 'only https links');
const t = G.mapTask({ id: 't1', title: 'File report', due: '2026-11-30T00:00:00.000Z', status: 'needsAction' }, 'My tasks');
assert(t.kind === 'task' && t.allDay && new Date(t.start).getDate() === 30);
assert.strictEqual(G.mapTask({ id: 't', title: 'x', due: '2026-11-30T00:00:00.000Z', status: 'completed' }), null);
assert.strictEqual(G.mapTask({ id: 't', title: 'no date' }), null, 'a task without a date is not on the calendar');
const mail = G.mapMail({ id: 'm1', payload: { headers: [{ name: 'From', value: '"Sam Lee" <sam@example.com>' }, { name: 'Subject', value: 'Lunch‮?' }] } });
assert.deepStrictEqual([mail.from, mail.subject], ['Sam Lee', 'Lunch ?'], 'names are cleaned, direction tricks removed');

// a whole refresh against a fake Google
(async () => {
  const calls = [];
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const fake = async (url, o) => {
    calls.push(String(url).split('?')[0]);
    const json = (b, ok = true) => ({ ok, status: ok ? 200 : 401, json: async () => b });
    if (/oauth2.googleapis.com\/token/.test(url)) return json({ access_token: 'AT', expires_in: 3600 });
    if (/calendarList/.test(url)) return json({ items: [{ id: 'primary', selected: true }, { id: 'hidden', selected: false }] });
    if (/calendars\/primary\/events/.test(url)) return json({ items: [{ id: 'a', summary: 'Standup', start: { dateTime: new Date(Date.now() + 3600e3).toISOString() }, end: { dateTime: new Date(Date.now() + 5400e3).toISOString() } }] });
    if (/tasks\/v1\/users\/@me\/lists/.test(url)) return json({ items: [{ id: 'L', title: 'My tasks' }] });
    if (/lists\/L\/tasks/.test(url)) return json({ items: [{ id: 't', title: 'Pay rent', due: day(3) + 'T00:00:00.000Z', status: 'needsAction' }] });
    if (/labels\/INBOX/.test(url)) return json({ messagesUnread: 7 });
    if (/messages\?q=/.test(url)) return json({ messages: [{ id: 'm1' }] });
    if (/messages\/m1/.test(url)) return json({ id: 'm1', payload: { headers: [{ name: 'From', value: 'Sam <s@x.com>' }, { name: 'Subject', value: 'Hi' }] } });
    return json({}, false);
  };
  let extra = [], sent = [];
  const store = { get: () => ({ google: { clientId: 'cid', clientSecret: 'sec', calendar: true, tasks: true, mail: true, mailToast: true } }) };
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyi-g-'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => String(b).replace(/^enc:/, '') };
  fs.writeFileSync(path.join(dir, 'google-token.bin'), safeStorage.encryptString(JSON.stringify({ refresh: 'RT' })));
  const g = G.create({ app: { getPath: () => dir }, safeStorage, shell: {}, net: {}, store, broadcast: (c, v) => sent.push([c, v]), logEvent: () => {}, setExtraEvents: (l) => { extra = l; }, fetchFn: fake });
  g.sync(); await new Promise((r) => setTimeout(r, 300));
  assert.deepStrictEqual(extra.map((x) => [x.kind, x.title]), [['event', 'Standup'], ['task', 'Pay rent']], 'events and tasks arrive (the unselected calendar is skipped)');
  assert(!calls.some((c) => /calendars\/hidden/.test(c)));
  const d = sent.filter((s) => s[0] === 'google:data').pop()[1];
  assert.deepStrictEqual([d.status, d.mail.unread, d.mail.latest[0].subject], ['ok', 7, 'Hi']);
  assert(!sent.some((s) => s[0] === 'notice:show'), 'the first read is not "new mail"');
  await g.disconnect();
  assert(!fs.existsSync(path.join(dir, 'google-token.bin')), 'Disconnect deletes the stored sign-in');
  assert.strictEqual(g.state().status, 'off');
  console.log('PASS google: PKCE, read-only scopes, mapping, full refresh with a fake Google, disconnect');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
