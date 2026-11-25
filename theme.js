// Applies the colour scheme (mode + seed + variant) to the page. Used by the island and the settings window.
// Needs vendor/dycolor.js (Google's Material colour algorithm) and presets.js loaded first.
(function () {
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let last = null, watching = false;

  // Theme colours are registered as real <color> properties so a change (a new cover colour, a new theme) cross-fades instead of snapping.
  let registered = false, smooth = false;
  function registerRoles(names) {
    if (registered || !window.CSS || !CSS.registerProperty) return;
    registered = true;
    for (const n of names) { try { CSS.registerProperty({ name: '--md-sys-color-' + n, syntax: '<color>', inherits: true, initialValue: '#000000' }); } catch { /* already registered */ } }
  }
  function resolveDark(mode) { return mode === 'dark' ? true : mode === 'light' ? false : dark.matches; }

  function apply(theme) {
    if (!theme || !window.DyColor) return;
    last = theme;
    const isDark = resolveDark(theme.mode);
    let roles;
    try { roles = window.DyColor.rolesFromSeed(theme.seed, isDark, theme.variant); }
    catch { return; }                                                          // bad seed: keep the current look
    const named = window.DyPresets.themeRoles && window.DyPresets.themeRoles(theme.preset, isDark, roles);   // Nord, Catppuccin, ...
    if (named) roles = named;
    registerRoles(Object.keys(roles));
    for (const [name, hex] of Object.entries(roles)) root.style.setProperty('--md-sys-color-' + name, hex);
    // the first paint must not fade in from black: fading starts with the apply after it (and never with animations off)
    if (smooth && root.dataset.motion !== 'off') root.style.transition = Object.keys(roles).map((n) => '--md-sys-color-' + n + ' 650ms ease').join(', ');
    else root.style.transition = '';
    if (!smooth) requestAnimationFrame(() => { smooth = true; });
    const fixed = window.DyPresets.FIXED[isDark ? 'dark' : 'light'];
    root.style.setProperty('--dy-sun', fixed.sun);
    const P = window.DyPresets, card = roles['surface-container-highest'];
    root.style.setProperty('--dy-warn', P.fit && card ? P.fit(fixed.warn, card, isDark) : fixed.warn);        // readable as small text on this theme's cards
    root.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
    root.dataset.theme = isDark ? 'dark' : 'light';
    api.version++;                                                             // anything that cached a colour (the music wave) re-reads it
    if (!watching) {                                                           // "auto" follows Windows when it flips light/dark
      watching = true;
      dark.addEventListener('change', () => { if (last && last.mode === 'auto') apply(last); });
    }
  }

  const api = { apply, resolveDark, version: 0 };
  window.DyTheme = api;
})();
