// Turns the text of an .ics calendar into the next few days of events. Pure (no Electron, no network), so it can be tested on its own.
// Recurring events are expanded by ical.js (RRULE, EXDATE, time zones, RECURRENCE-ID overrides): nothing here re-implements a recurrence rule.
const ICAL = require('ical.js');

// A link is a meeting link when its HOST is (or is under) one of these. Calendar invites are written by other people: a path or a sub-domain that merely
// contains "zoom.us" (https://evil.example/zoom.us, https://zoom.us.evil.example) must not pass.
const MEETING_HOSTS = ['zoom.us', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'webex.com', 'whereby.com', 'meet.jit.si'];
function isMeetingLink(u) {
  try {
    const x = new URL(String(u));
    if (x.protocol !== 'https:' || x.username || x.password || x.port) return false;
    const h = x.hostname.toLowerCase();
    return MEETING_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch { return false; }
}
function findMeetingLink(text) {
  for (const m of String(text || '').matchAll(/https:\/\/[^\s<>"'\\)]+/gi)) if (isMeetingLink(m[0])) return m[0].slice(0, 500);
  return '';
}
const clip = (s, n) => String(s || '').replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, n);

// events that have not ended yet and start before now + days; at most `max`, soonest first
function parseEvents(text, { now = Date.now(), days = 14, max = 60 } = {}) {
  const horizon = now + days * 86400000;
  let root;
  try { root = new ICAL.Component(ICAL.parse(String(text))); } catch { return []; }
  for (const vtz of root.getAllSubcomponents('vtimezone')) { try { ICAL.TimezoneService.register(vtz); } catch { /* a broken zone: events fall back to floating time */ } }
  const masters = new Map(), overrides = [];
  for (const vev of root.getAllSubcomponents('vevent')) {
    let ev; try { ev = new ICAL.Event(vev); } catch { continue; }
    if (ev.isRecurrenceException()) overrides.push(ev); else masters.set(ev.uid + '|' + masters.size, ev);
  }
  for (const ex of overrides) for (const m of masters.values()) if (m.uid === ex.uid) { try { m.relateException(ex); } catch { /* ignore */ } }
  const out = [];
  const add = (ev, start, end, d) => {
    const s = start.toJSDate().getTime(), e = (end || start).toJSDate().getTime();
    if (e < now || s > horizon) return;
    const status = String(ev.component.getFirstPropertyValue('status') || '').toUpperCase();
    if (status === 'CANCELLED') return;
    const hay = [d && d.description, d && d.location, ev.component.getFirstPropertyValue('url')].filter(Boolean).join(' ');
    out.push({ id: ev.uid + '@' + s, title: clip(d && d.summary, 80) || 'Event', start: s, end: e > s ? e : s, allDay: !!start.isDate, location: clip(d && d.location, 80), link: findMeetingLink(hay) });
  };
  for (const ev of masters.values()) {
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator(); let next, n = 0; const deadline = Date.now() + 400;               // a rule that started years ago needs many steps to reach today: allow them, but not forever
        while ((next = it.next()) && n++ < 200000 && (n % 500 !== 0 || Date.now() < deadline)) {
          if (next.toJSDate().getTime() > horizon) break;
          const d = ev.getOccurrenceDetails(next);
          add(d.item, d.startDate, d.endDate, d.item);
        }
      } else add(ev, ev.startDate, ev.endDate, ev);
    } catch { /* one odd event must not hide the others */ }
  }
  out.sort((a, b) => a.start - b.start);
  const seen = new Set();
  return out.filter((e) => (seen.has(e.id) ? false : seen.add(e.id))).slice(0, max);
}

// Only https links (webcal:// is https underneath). Anything else is refused: the URL is fetched by the app.
function cleanUrl(u) {
  u = String(u || '').trim();
  if (/^webcal:\/\//i.test(u)) u = 'https://' + u.slice(9);
  if (u.length > 600 || !/^https:\/\/[^\s]+$/i.test(u)) return '';
  try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
}

module.exports = { parseEvents, cleanUrl, isMeetingLink };
