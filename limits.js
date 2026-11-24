// Real 5-hour and weekly limits, using the sign-in Claude Code already keeps on this PC.
//
// Read-only on purpose:
//  - the credentials file is only READ, never written. We do NOT refresh the token ourselves: refreshing rotates the
//    refresh token and could sign Claude Code out. If the access token has expired, we say so and wait for Claude Code
//    to refresh it the next time it runs.
//  - the token is used only in memory, only sent to api.anthropic.com (hard-coded host, redirects refused), never logged.
// The endpoint is undocumented (known from third-party tools), so every failure is handled as a normal state.
const { net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
let last = { at: 0, data: null, good: null };

function credsPath() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
}

function readToken() {
  let o;
  try { o = JSON.parse(fs.readFileSync(credsPath(), 'utf8')).claudeAiOauth; } catch { return { reason: 'nocreds' }; }
  if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return { reason: 'nocreds' };
  if (typeof o.expiresAt === 'number' && o.expiresAt < Date.now() + 30000) return { reason: 'expired' };
  return { token: o.accessToken, plan: typeof o.subscriptionType === 'string' ? o.subscriptionType : null };
}

const pick = (x) => (x && typeof x.utilization === 'number'
  ? { pct: Math.max(0, Math.min(100, x.utilization)), resetsAt: x.resets_at || null }
  : null);

async function getLimits() {
  if (last.data && Date.now() - last.at < 60000) return last.data;      // be gentle with the endpoint
  const done = (data) => { last = { at: Date.now(), data, good: data.ok ? data : last.good }; return data; };

  const t = readToken();
  if (!t.token) return done({ ok: false, reason: t.reason });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await net.fetch(URL_USAGE, {
      headers: { authorization: 'Bearer ' + t.token, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
      redirect: 'error', signal: ctl.signal,
    });
    if (r.status === 401 || r.status === 403) return done({ ok: false, reason: 'expired' });
    if (r.status === 429 && last.good) {                                        // rate limited: keep showing the last good numbers,
      const stale = { ...last.good, stale: true };                              // and remember that so we do not retry for a minute
      last = { at: Date.now(), data: stale, good: last.good };
      return stale;
    }
    if (!r.ok) return done({ ok: false, reason: 'unavailable' });
    const u = await r.json();
    const out = { ok: true, plan: t.plan, five: pick(u.five_hour), week: pick(u.seven_day), opus: pick(u.seven_day_opus), sonnet: pick(u.seven_day_sonnet) };
    if (!out.five && !out.week) return done({ ok: false, reason: 'unavailable' });
    return done(out);
  } catch {
    return done({ ok: false, reason: 'unavailable' });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getLimits };
