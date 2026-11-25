// Actions on a copied link. The page sends a URL string; main re-checks it (http/https only, one line, bounded) before opening or shortening.
// Shortening is the only thing here that talks to another service (is.gd, a plain GET that carries the link) and is off unless you switch it on.
function cleanUrl(v) {
  if (typeof v !== 'string' || v.length > 2000 || /[\u0000- \u007f]/.test(v.trim())) return '';
  try { const u = new URL(v.trim()); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}

async function shorten(url, fetchFn) {
  const u = cleanUrl(url);
  if (!u) return { ok: false, error: 'Not a web link' };
  try {
    const res = await fetchFn('https://is.gd/create.php?format=simple&url=' + encodeURIComponent(u), { signal: AbortSignal.timeout(8000) });
    const text = String(await res.text()).trim();
    if (res.ok && /^https:\/\/is\.gd\/[A-Za-z0-9_-]{1,40}$/.test(text)) return { ok: true, url: text };
    return { ok: false, error: /^Error:/.test(text) ? text.slice(0, 120) : 'The shortener did not answer' };
  } catch { return { ok: false, error: 'Could not reach the shortener' }; }
}

module.exports = { cleanUrl, shorten };
