// Calendar events for the Home card, the calendar dots and the "starting soon" chip. Reads ONE iCalendar (.ics) link you paste in Settings
// (Google / Outlook / iCloud all give you a "secret address in iCal format"). Fetched over https only, read-only, nothing is sent except the request itself.
const { net, shell } = require('electron');
const { parseEvents, cleanUrl, isMeetingLink } = require('./ics');

function create({ ipcMain, store, broadcast, logEvent }) {
  let list = [], extra = [], status = 'off', timer = null, lastUrl = '', busy = false;     // extra: Google Calendar events and tasks (main/google.js)
  const merged = () => [...list, ...extra].sort((a, b) => a.start - b.start);
  const state = () => ({ list: merged(), status: status === 'off' && extra.length ? 'ok' : status });
  async function refresh() {
    const url = cleanUrl(store.get().events.url);
    if (!url) { list = []; status = 'off'; broadcast('events:list', state()); return; }
    if (busy) return;
    busy = true;
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await net.fetch(url, { signal: ctl.signal });
      if (!r.ok || !String(r.url || url).startsWith('https://')) throw new Error('bad response');
      if (Number(r.headers.get('content-length') || 0) > 4e6) throw new Error('too big');
      const text = await r.text();
      if (text.length > 4e6) throw new Error('too big');
      list = parseEvents(text); status = 'ok';
    } catch (e) { status = 'error'; logEvent('calendar link could not be read (' + (e && e.message || 'error') + ')'); }
    finally { clearTimeout(tm); busy = false; }
    broadcast('events:list', state());
  }
  // Called whenever settings change: a new link is read at once, no link stops everything
  function sync() {
    const url = cleanUrl(store.get().events.url);
    if (url !== lastUrl) { lastUrl = url; clearInterval(timer); timer = null; list = []; status = url ? 'loading' : 'off'; broadcast('events:list', state()); if (url) refresh(); }
    if (url && !timer) timer = setInterval(refresh, 15 * 60 * 1000);
  }
  function setExtra(l) { extra = Array.isArray(l) ? l.slice(0, 300) : []; broadcast('events:list', state()); }
  ipcMain.handle('events:get', () => state());
  // The renderer sends only an id; the link opened is the one WE parsed for that event, and only if it is https
  ipcMain.on('events:open', (_e, id) => { const ev = merged().find((x) => x.id === String(id)); if (ev && isMeetingLink(ev.link)) shell.openExternal(ev.link); });
  return { sync, refresh, setExtra };
}

module.exports = { create };
