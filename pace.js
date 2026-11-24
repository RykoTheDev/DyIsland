// Usage pace: "at this rate you will run out at 16:40". Pure maths, no Electron, tested on its own.
// A limit window has a known length (5 hours, 7 days) and a reset time, so how far into it we are is known.
// Pace = used% / elapsed fraction. If that rate would reach 100% before the window resets, we forecast when.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyPace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const HOUR = 3600 * 1000;
  const WINDOWS = { five: 5 * HOUR, week: 7 * 24 * HOUR };

  // x = { pct (used, 0..100), resetsAt (ISO string) }, windowMs = length of the window.
  // Returns null when there is not enough to say (too early in the window, or nothing used yet), else
  //   { willRunOut, runOutAt (ms), margin (ms before reset it would run out), rate (% per hour) }
  function forecast(x, windowMs, now = Date.now()) {
    if (!x || typeof x.pct !== 'number' || !x.resetsAt) return null;
    const reset = Date.parse(x.resetsAt);
    if (!Number.isFinite(reset) || reset <= now) return null;
    const start = reset - windowMs;
    const elapsed = now - start;
    // Too early: a few minutes of data would exaggerate a short burst into a scary forecast
    if (elapsed < windowMs * 0.06 || elapsed > windowMs) return null;
    const used = Math.max(0, Math.min(100, x.pct));
    if (used < 3) return null;
    const rate = used / elapsed;                                   // % per ms
    const remaining = 100 - used;
    if (remaining <= 0) return { willRunOut: true, runOutAt: now, margin: reset - now, rate: rate * HOUR };
    const runOutAt = now + remaining / rate;
    return { willRunOut: runOutAt < reset, runOutAt, margin: reset - runOutAt, rate: rate * HOUR };
  }

  // Detects that a window reset: the used percentage fell a lot since last time, after it had been high.
  function didReset(prevPct, nowPct) {
    return typeof prevPct === 'number' && typeof nowPct === 'number' && prevPct >= 60 && nowPct <= prevPct - 40;
  }

  return { forecast, didReset, WINDOWS };
});
