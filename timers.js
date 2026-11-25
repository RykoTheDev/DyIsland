// The timer page's brain, with no DOM so it can be tested: a timer slot is a plain object, and these functions move it forward.
//   modes:  timer (counts down once)  |  repeat (counts down and starts over)  |  pomodoro (25 / 5 minutes x 4, then 15)  |  stopwatch (counts up)
// Times are absolute (endAt / since) so every island window, and a page that reloads, agrees on where a timer is.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyTimers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = ['timer', 'repeat', 'pomodoro', 'stopwatch'];
  const POMO = { focus: 25 * 60, short: 5 * 60, long: 15 * 60, rounds: 4 };
  const MAX = 24 * 3600;
  const finite = (n, d) => (Number.isFinite(Number(n)) ? Number(n) : d);

  // "25" = minutes, "25:30" = 25 min 30 s, "1:30:00" = 1 h 30 min, "90s", "45m", "1h", "1h30m", "1.5h". Returns seconds (1 .. 24 h) or null.
  function parseDuration(text) {
    const t = String(text == null ? '' : text).trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let sec = null, m;
    if ((m = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/.exec(t))) sec = m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
    else if (/^\d+(\.\d+)?$/.test(t)) sec = Number(t) * 60;
    else if ((m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?:in)?)?(?:(\d+(?:\.\d+)?)s(?:ec)?)?$/.exec(t)) && (m[1] || m[2] || m[3])) sec = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
    if (sec === null || !Number.isFinite(sec)) return null;
    sec = Math.round(sec);
    return sec >= 1 && sec <= MAX ? sec : null;
  }

  function create(total) {
    const tot = Math.max(1, Math.min(MAX, Math.round(finite(total, 300))));
    return { mode: 'timer', total: tot, left: tot, running: false, endAt: 0, since: 0, base: 0, phase: 'focus', round: 1 };
  }
  const phaseLength = (s) => POMO[s.phase] || POMO.focus;
  // the length the ring is measured against
  const span = (s) => (s.mode === 'pomodoro' ? phaseLength(s) : s.total);

  function setMode(s, mode) {
    if (!MODES.includes(mode)) return s;
    s.mode = mode; s.running = false; s.endAt = 0; s.since = 0; s.base = 0; s.phase = 'focus'; s.round = 1;
    s.left = span(s);
    return s;
  }
  function setTotal(s, sec) { s.total = Math.max(1, Math.min(MAX, Math.round(sec))); s.left = s.total; s.running = false; s.endAt = 0; return s; }
  function start(s, now) {
    if (s.running) return s;
    if (s.mode === 'stopwatch') { s.since = now; s.running = true; return s; }
    if (!(s.left > 0)) s.left = span(s);
    s.endAt = now + s.left * 1000; s.running = true; return s;
  }
  function pause(s, now) {
    if (!s.running) return s;
    if (s.mode === 'stopwatch') s.base += (now - s.since) / 1000;
    else s.left = Math.max(0, (s.endAt - now) / 1000);
    s.running = false; return s;
  }
  function reset(s) {
    s.running = false; s.endAt = 0; s.since = 0; s.base = 0;
    if (s.mode === 'pomodoro') { s.phase = 'focus'; s.round = 1; }
    s.left = span(s); return s;
  }
  // Moves the slot to `now`. Returns null, 'done' (a timer ended, or the whole pomodoro cycle did) or 'phase' (a pomodoro focus / break ended and the next began).
  // Phases chain from the previous end time, not from "now", so two windows ticking a little apart still agree.
  function tick(s, now) {
    if (!s.running || s.mode === 'stopwatch') return null;
    let ev = null, guard = 0;
    while (s.running && s.endAt <= now && guard++ < 50) {
      if (s.mode === 'repeat') { const per = s.total * 1000; s.endAt += (Math.floor((now - s.endAt) / per) + 1) * per; ev = 'done'; continue; }       // however many periods were missed (the PC slept): one event
      if (s.mode === 'pomodoro') {
        if (s.phase === 'focus') s.phase = s.round >= POMO.rounds ? 'long' : 'short';
        else if (s.phase === 'long') { s.phase = 'focus'; s.round = 1; s.running = false; s.left = POMO.focus; s.endAt = 0; return 'done'; }
        else { s.phase = 'focus'; s.round++; }
        s.endAt += phaseLength(s) * 1000; ev = 'phase'; continue;
      }
      s.running = false; s.left = 0; s.endAt = 0; return 'done';
    }
    if (s.running) s.left = Math.max(0, (s.endAt - now) / 1000);
    return ev;
  }
  // The number the page shows (seconds): what is left, or for a stopwatch what has passed
  const seconds = (s, now) => (s.mode === 'stopwatch' ? s.base + (s.running ? (now - s.since) / 1000 : 0) : (s.running ? Math.max(0, (s.endAt - now) / 1000) : s.left));
  // 0..1: how full the ring is
  function fraction(s, now) {
    if (s.mode === 'stopwatch') return (seconds(s, now) % 60) / 60;
    const sp = span(s); return sp > 0 ? Math.max(0, Math.min(1, seconds(s, now) / sp)) : 0;
  }
  // A slot that came from storage or from another window: every number is checked, and a timer that already ran out is finished quietly
  function normalize(raw, now, fallbackTotal) {
    const s = create(finite(fallbackTotal, 300));
    if (!raw || typeof raw !== 'object') return s;
    if (MODES.includes(raw.mode)) s.mode = raw.mode;
    s.total = Math.max(1, Math.min(MAX, Math.round(finite(raw.total, s.total))));
    s.phase = ['focus', 'short', 'long'].includes(raw.phase) ? raw.phase : 'focus';
    s.round = Math.max(1, Math.min(POMO.rounds, Math.round(finite(raw.round, 1))));
    s.base = Math.max(0, Math.min(MAX * 4, finite(raw.base, 0)));
    s.left = Math.max(0, Math.min(MAX, finite(raw.left, span(s))));
    if (raw.running) {
      if (s.mode === 'stopwatch') { s.since = finite(raw.since, 0); s.running = s.since > 0 && s.since <= now + 5000; }
      else { s.endAt = finite(raw.endAt, 0); s.running = s.endAt > 0; if (s.running) tick(s, now); }                       // an overdue timer settles itself here
    }
    return s;
  }
  const clock = (sec) => {                                   // 04:32, or 1:04:32 past an hour
    sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    const p = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(x) : p(m) + ':' + p(x);
  };
  return { MODES, POMO, parseDuration, create, setMode, setTotal, start, pause, reset, tick, seconds, fraction, normalize, span, clock };
});
