// Test-only preload: report prefers-reduced-motion as "no-preference" so the UI tests do not depend on the OS animation setting
const real = window.matchMedia.bind(window);
window.matchMedia = (q) => {
  const m = real(q);
  if (!/prefers-reduced-motion:\s*reduce/.test(q)) return m;
  return new Proxy(m, { get: (t, k) => (k === 'matches' ? false : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
};
