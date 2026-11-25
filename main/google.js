// Google Calendar, Tasks and Gmail (read-only) for the island: events and tasks on the calendar and the Next event card, unread mail on the Mail card.
//
// How you sign in: Google only lets an app use your account through a "client" that belongs to a Google Cloud project. You create one (a free "Desktop app" OAuth client,
// see Settings > Apps > Google) and paste its client ID and secret into Settings. DyIsland then opens Google's own sign-in page in your browser and receives the answer on a
// one-time local address (127.0.0.1, a random port, PKCE). It asks for READ-ONLY access (calendar, tasks, mail). The refresh token is stored encrypted with Windows (safeStorage)
// in DyIsland's data folder; Disconnect revokes it at Google and deletes it. Nothing is sent anywhere except to Google.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/tasks.readonly', 'https://www.googleapis.com/auth/gmail.readonly'];
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const clip = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, ' ').trim().slice(0, n);

// ---- pure helpers (tested without a network)
function pkcePair(rand = crypto.randomBytes) { const verifier = b64url(rand(48)); return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) }; }
function authUrl({ clientId, redirect, challenge, state }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
const localMidnight = (ymd) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN; };
// one Calendar API event -> the island's event shape (or null)
function mapEvent(e) {
  if (!e || e.status === 'cancelled') return null;
  const s = e.start || {}, en = e.end || {};
  const allDay = !!s.date && !s.dateTime;
  const start = allDay ? localMidnight(s.date) : Date.parse(s.dateTime), end = allDay ? localMidnight(en.date || s.date) : Date.parse(en.dateTime || s.dateTime);
  if (!Number.isFinite(start)) return null;
  const link = typeof e.hangoutLink === 'string' ? e.hangoutLink : (((e.conferenceData || {}).entryPoints || []).find((p) => p && p.entryPointType === 'video') || {}).uri || '';
  return { id: 'g:' + clip(e.id, 80) + '@' + start, title: clip(e.summary, 80) || 'Busy', start, end: Number.isFinite(end) && end > start ? end : start, allDay, location: clip(e.location, 80), link: /^https:\/\//.test(String(link)) ? String(link).slice(0, 500) : '', kind: 'event' };
}
// one Tasks API task -> an all-day item on its due date (tasks without a due date are not shown on the calendar)
function mapTask(t, listTitle) {
  if (!t || t.status === 'completed' || t.deleted || !t.due) return null;
  const start = localMidnight(String(t.due).slice(0, 10));
  if (!Number.isFinite(start)) return null;
  return { id: 'gt:' + clip(t.id, 80), title: clip(t.title, 80) || 'Task', start, end: start, allDay: true, location: clip(listTitle, 40), link: '', kind: 'task' };
}
function mapMail(m) {
  const h = {}; for (const x of ((m && m.payload && m.payload.headers) || [])) if (x && x.name) h[String(x.name).toLowerCase()] = x.value;
  const from = clip(String(h.from || '').replace(/<[^>]*>/g, '').replace(/["']/g, ''), 40) || clip(h.from, 40);
  return { id: clip(m && m.id, 40), from, subject: clip(h.subject, 90) || '(no subject)' };
}

function create({ app, safeStorage, shell, net, store, broadcast, logEvent, setExtraEvents, fetchFn }) {
  const doFetch = fetchFn || ((u, o) => net.fetch(u, o));
  const tokenFile = () => path.join(app.getPath('userData'), 'google-token.bin');
  let tok = null;                                              // { refresh, access, exp }
  let state = { status: 'off', mail: { unread: 0, latest: [] }, events: [], tasks: [], error: '' };
  let timer = null, mailSeen = new Set(), mailFirst = true, authServer = null, refreshing = false, lastKey = '';
  const cfg = () => store.get().google;
  const emit = () => { setExtraEvents([...state.events, ...state.tasks]); broadcast('google:data', { status: state.status, mail: state.mail, error: state.error }); };

  function saveTok() { try { if (!safeStorage.isEncryptionAvailable()) return false; fs.writeFileSync(tokenFile(), safeStorage.encryptString(JSON.stringify({ refresh: tok.refresh }))); return true; } catch { return false; } }
  function loadTok() { try { const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(tokenFile()))); if (raw && typeof raw.refresh === 'string') tok = { refresh: raw.refresh, access: '', exp: 0 }; } catch { /* not connected */ } }
  const dropTok = () => { tok = null; try { fs.rmSync(tokenFile(), { force: true }); } catch { /* none */ } };

  async function form(url, body) {
    const r = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(clip(j.error_description || j.error || 'sign-in failed', 120)); return j;
  }
  async function access() {
    if (!tok) throw new Error('not connected');
    if (tok.access && Date.now() < tok.exp - 60000) return tok.access;
    const c = cfg(); const j = await form('https://oauth2.googleapis.com/token', { client_id: c.clientId, client_secret: c.clientSecret, refresh_token: tok.refresh, grant_type: 'refresh_token' });
    tok.access = j.access_token; tok.exp = Date.now() + (Number(j.expires_in) || 3000) * 1000; return tok.access;
  }
  async function api(url) {
    const r = await doFetch(url, { headers: { authorization: 'Bearer ' + (await access()) } });
    if (r.status === 401 || r.status === 403) { const j = await r.json().catch(() => ({})); throw new Error(clip((j.error && j.error.message) || 'Google refused (' + r.status + ')', 120)); }
    if (!r.ok) throw new Error('Google answered ' + r.status);
    return r.json();
  }

  async function refresh() {
    if (refreshing) return;                                    // never two at once (a slider drag must not start a flood of requests)
    refreshing = true;
    try { await refresh1(); } finally { refreshing = false; }
  }
  async function refresh1() {
    const c = cfg();
    if (!tok || !c.clientId) { state = { ...state, status: tok ? 'needs-id' : 'off' }; return emit(); }
    try {
      const now = Date.now(), min = new Date(now - 86400000).toISOString(), max = new Date(now + 31 * 86400000).toISOString();
      const events = [], tasks = [];
      if (c.calendar) {
        const cals = (await api('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=20')).items || [];
        for (const cal of cals.filter((x) => x.selected !== false).slice(0, 8)) {
          const q = new URLSearchParams({ timeMin: min, timeMax: max, singleEvents: 'true', orderBy: 'startTime', maxResults: '60' });
          const j = await api('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) + '/events?' + q);
          for (const e of j.items || []) { const m = mapEvent(e); if (m && m.end >= now - 3600000) events.push(m); }
        }
      }
      if (c.tasks) {
        const lists = (await api('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20')).items || [];
        for (const l of lists.slice(0, 8)) {
          const j = await api('https://tasks.googleapis.com/tasks/v1/lists/' + encodeURIComponent(l.id) + '/tasks?showCompleted=false&showHidden=false&maxResults=100');
          for (const t of j.items || []) { const m = mapTask(t, l.title); if (m && m.start < now + 31 * 86400000) tasks.push(m); }
        }
      }
      let mail = state.mail;
      if (c.mail) {
        const lab = await api('https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX');
        const ids = ((await api('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=' + encodeURIComponent('is:unread in:inbox') + '&maxResults=5')).messages || []).slice(0, 5);
        const latest = [];
        for (const m of ids) latest.push(mapMail(await api('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(m.id) + '?format=metadata&metadataHeaders=Subject&metadataHeaders=From')));
        mail = { unread: Number(lab.messagesUnread) || 0, latest };
        const fresh = latest.filter((x) => !mailSeen.has(x.id)); latest.forEach((x) => mailSeen.add(x.id));
        if (!mailFirst && c.mailToast && fresh.length) broadcast('notice:show', { kind: 'done', tone: 'info', duration: 5, title: fresh.length > 1 ? fresh.length + ' new emails' : fresh[0].from || 'New email', sub: fresh.length > 1 ? fresh.map((x) => x.subject).join(' · ').slice(0, 120) : fresh[0].subject, mail: true });
        mailFirst = false;
      }
      events.sort((a, b) => a.start - b.start); tasks.sort((a, b) => a.start - b.start);
      state = { status: 'ok', events, tasks, mail, error: '' };
    } catch (e) { state = { ...state, status: 'error', error: clip(e && e.message, 120) }; logEvent('google refresh failed: ' + state.error); }
    emit();
  }

  // ---- connect: browser + loopback + PKCE
  async function connect() {
    const c = cfg();
    if (!c.clientId || !c.clientSecret) return { ok: false, error: 'Paste your client ID and secret first' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows cannot encrypt the sign-in here' };
    if (authServer) try { authServer.close(); } catch { /* old one */ }
    const { verifier, challenge } = pkcePair(), st = b64url(crypto.randomBytes(16));
    return new Promise((resolve) => {
      let finished = false;
      const done = (r) => { if (finished) return; finished = true; try { server.close(); } catch { /* closed */ } authServer = null; clearTimeout(to); resolve(r); };
      const server = http.createServer(async (req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1'); if (u.pathname !== '/') { res.statusCode = 404; return res.end(); }
        const page = (t) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><title>DyIsland</title><body style="font:16px system-ui;padding:48px;text-align:center">' + t + '</body>'); };
        if (u.searchParams.get('state') !== st) { res.statusCode = 400; return res.end(); }            // some other program poking the port: ignored, the real answer can still come
        if (!u.searchParams.get('code')) { page('Sign-in was cancelled. You can close this tab.'); return done({ ok: false, error: 'Sign-in was cancelled' }); }
        try {
          const j = await form('https://oauth2.googleapis.com/token', { code: u.searchParams.get('code'), client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: 'http://127.0.0.1:' + server.address().port, grant_type: 'authorization_code', code_verifier: verifier });
          if (!j.refresh_token) throw new Error('Google sent no refresh token');
          tok = { refresh: j.refresh_token, access: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
          if (!saveTok()) throw new Error('could not save the sign-in');
          page('DyIsland is connected to Google. You can close this tab.'); done({ ok: true }); mailFirst = true; refresh();
        } catch (e) { page('Sign-in failed: ' + clip(e && e.message, 100).replace(/[<>&"']/g, ' ')); done({ ok: false, error: clip(e && e.message, 120) }); }
      });
      const to = setTimeout(() => done({ ok: false, error: 'Timed out waiting for the browser' }), 5 * 60000);
      server.listen(0, '127.0.0.1', () => { authServer = server; shell.openExternal(authUrl({ clientId: c.clientId, redirect: 'http://127.0.0.1:' + server.address().port, challenge, state: st })); });
      server.on('error', () => done({ ok: false, error: 'Could not listen for the sign-in' }));
    });
  }
  async function disconnect() {
    const t = tok && tok.refresh; dropTok(); state = { status: 'off', mail: { unread: 0, latest: [] }, events: [], tasks: [], error: '' }; mailSeen = new Set(); mailFirst = true; emit();
    if (t) { try { await doFetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }); } catch { /* offline: the token is gone locally anyway */ } }
    return { ok: true };
  }
  function sync() {
    const c = cfg(), key = [c.clientId, c.clientSecret, c.calendar, c.tasks, c.mail].join('|');
    if (key === lastKey && (timer || !tok)) return;            // nothing Google depends on changed
    lastKey = key;
    clearInterval(timer); timer = null;
    if (!tok) loadTok();
    if (tok) { timer = setInterval(refresh, 4 * 60000); refresh(); } else { state = { ...state, status: 'off' }; emit(); }
  }
  return { sync, connect, disconnect, state: () => ({ status: state.status, mail: state.mail, error: state.error }), refresh };
}

module.exports = { create, pkcePair, authUrl, mapEvent, mapTask, mapMail, SCOPES };
