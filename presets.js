// Colour presets offered in Settings (seed colours: Google's algorithm turns each into a full light + dark scheme),
// plus named editor themes (Nord, Catppuccin, ...) that supply their own palette.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const PRESETS = [
    { id: 'teal', name: 'Teal', seed: '#1FB5A5' },
    { id: 'blue', name: 'Blue', seed: '#3D6BFF' },
    { id: 'violet', name: 'Violet', seed: '#7C4DFF' },
    { id: 'rose', name: 'Rose', seed: '#E8457C' },
    { id: 'orange', name: 'Orange', seed: '#FF8A1F' },
    { id: 'green', name: 'Green', seed: '#3DBA5D' },
    { id: 'gold', name: 'Gold', seed: '#F2B705' },
    { id: 'slate', name: 'Slate', seed: '#6B7B8C' },
  ];

  // Named themes. Each has a dark and a light palette: bg, surf (cards), fg (text) and three accents (p, s, t).
  // themeRoles() turns a palette into the same Material role names the seed schemes produce, and nudges any accent that
  // would be hard to read on the cards (under 4.5:1) toward the text colour. Error roles are kept from the base scheme.
  const THEMES = [
    { id: 'catppuccin', name: 'Catppuccin',
      dark:  { bg: '#1E1E2E', surf: '#313244', fg: '#CDD6F4', p: '#CBA6F7', s: '#89B4FA', t: '#F5C2E7' },
      light: { bg: '#EFF1F5', surf: '#E6E9EF', fg: '#4C4F69', p: '#8839EF', s: '#1E66F5', t: '#EA76CB' } },
    { id: 'nord', name: 'Nord',
      dark:  { bg: '#2E3440', surf: '#3B4252', fg: '#ECEFF4', p: '#88C0D0', s: '#81A1C1', t: '#B48EAD' },
      light: { bg: '#ECEFF4', surf: '#E5E9F0', fg: '#2E3440', p: '#5E81AC', s: '#81A1C1', t: '#B48EAD' } },
    { id: 'atomone', name: 'Atom One',
      dark:  { bg: '#282C34', surf: '#2C313A', fg: '#ABB2BF', p: '#61AFEF', s: '#C678DD', t: '#98C379' },
      light: { bg: '#FAFAFA', surf: '#F0F0F1', fg: '#383A42', p: '#4078F2', s: '#A626A4', t: '#50A14F' } },
    { id: 'dracula', name: 'Dracula',
      dark:  { bg: '#282A36', surf: '#343746', fg: '#F8F8F2', p: '#BD93F9', s: '#FF79C6', t: '#8BE9FD' },
      light: { bg: '#FFFBEB', surf: '#F5EFD6', fg: '#1F1F1F', p: '#644AC9', s: '#A3144D', t: '#036A96' } },
    { id: 'gruvbox', name: 'Gruvbox',
      dark:  { bg: '#282828', surf: '#3C3836', fg: '#EBDBB2', p: '#FABD2F', s: '#83A598', t: '#D3869B' },
      light: { bg: '#FBF1C7', surf: '#EBDBB2', fg: '#3C3836', p: '#B57614', s: '#076678', t: '#8F3F71' } },
    { id: 'tokyonight', name: 'Tokyo Night',
      dark:  { bg: '#1A1B26', surf: '#24283B', fg: '#C0CAF5', p: '#7AA2F7', s: '#BB9AF7', t: '#7DCFFF' },
      light: { bg: '#E1E2E7', surf: '#D5D6DB', fg: '#3760BF', p: '#2E7DE9', s: '#9854F1', t: '#007197' } },
    { id: 'rosepine', name: 'Rosé Pine',
      dark:  { bg: '#191724', surf: '#1F1D2E', fg: '#E0DEF4', p: '#C4A7E7', s: '#EBBCBA', t: '#9CCFD8' },
      light: { bg: '#FAF4ED', surf: '#F2E9E1', fg: '#575279', p: '#907AA9', s: '#D7827E', t: '#56949F' } },
    { id: 'solarized', name: 'Solarized',
      dark:  { bg: '#002B36', surf: '#073642', fg: '#93A1A1', p: '#268BD2', s: '#2AA198', t: '#B58900' },
      light: { bg: '#FDF6E3', surf: '#EEE8D5', fg: '#586E75', p: '#268BD2', s: '#2AA198', t: '#B58900' } },
    { id: 'everforest', name: 'Everforest',
      dark:  { bg: '#2D353B', surf: '#343F44', fg: '#D3C6AA', p: '#A7C080', s: '#7FBBB3', t: '#E69875' },
      light: { bg: '#FDF6E3', surf: '#F4F0D9', fg: '#5C6A72', p: '#8DA101', s: '#35A77C', t: '#F57D26' } },
    { id: 'monokai', name: 'Monokai',
      dark:  { bg: '#272822', surf: '#3E3D32', fg: '#F8F8F2', p: '#A6E22E', s: '#66D9EF', t: '#F92672' },
      light: { bg: '#FAFAF5', surf: '#EEEEE4', fg: '#272822', p: '#4D8F00', s: '#0B7BA0', t: '#C2185B' } },
  ];

  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };      // t = 0 -> a, 1 -> b
  const lum = (h) => { const c = rgb(h).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  // the first candidate that reads at 4.5:1 on bg, else the best one
  const readable = (bg, cands) => cands.find((c) => ratio(c, bg) >= 4.5) || cands.reduce((m, c) => (ratio(c, bg) > ratio(m, bg) ? c : m));
  const ensure = (c, bg, toward) => { for (let i = 0; i < 40 && ratio(c, bg) < 4.5; i++) c = mix(c, toward, 0.08); return c; };

  function themeRoles(id, dark, base) {
    const th = THEMES.find((x) => x.id === id); if (!th) return null;
    const pal = dark ? th.dark : th.light, out = { ...(base || {}) };
    const { bg, surf } = pal;
    const edge = dark ? '#FFFFFF' : '#000000';                              // accents and text are pushed toward this when they are too faint
    const fg0 = pal.fg;
    const high = mix(surf, fg0, 0.04), highest = mix(surf, fg0, 0.08);
    const fg = ensure(fg0, highest, edge);                                  // some themes (Solarized) have body text below 4.5:1: lift it
    Object.assign(out, {
      'surface': bg, 'surface-container-lowest': bg, 'surface-container-low': mix(bg, surf, 0.5), 'surface-container': surf,
      'surface-container-high': high, 'surface-container-highest': highest,
      'on-surface': fg,
      'on-surface-variant': ensure(mix(fg, bg, 0.25), highest, edge),
      'error': ensure(out.error || edge, highest, edge),
      'outline': mix(fg, bg, 0.55), 'outline-variant': mix(fg, bg, 0.8),
      'inverse-surface': fg, 'inverse-on-surface': bg,
    });
    for (const [name, c] of [['primary', pal.p], ['secondary', pal.s], ['tertiary', pal.t]]) {
      const text = ensure(c, highest, edge);                                   // used as text/icons on the cards, so it must read there
      const cont = mix(bg, text, dark ? 0.30 : 0.22);
      out[name] = text;
      out['on-' + name] = readable(text, [bg, fg, '#000000', '#FFFFFF']);
      out[name + '-container'] = cont;
      out['on-' + name + '-container'] = readable(cont, [fg, bg, '#FFFFFF', '#000000']);
    }
    out['on-error'] = readable(out.error, [bg, fg, '#000000', '#FFFFFF']);
    out['inverse-primary'] = ensure(pal.p, fg, bg);
    return out;
  }

  const VARIANTS = [
    { id: 'tonal', name: 'Calm' },
    { id: 'vibrant', name: 'Vibrant' },
    { id: 'expressive', name: 'Playful' },
    { id: 'neutral', name: 'Muted' },
  ];
  // Fixed meaning colours that must not follow the seed: the sun, the "limit about to run out" amber
  const FIXED = {
    dark:  { sun: '#F2C14E', warn: '#F2C14E' },
    light: { sun: '#B07A00', warn: '#8A5F00' },
  };
  // a fixed colour nudged just enough to read at 4.5:1 on bg (toward white on dark surfaces, black on light ones)
  const fit = (c, bg, dark) => ensure(c, bg, dark ? '#FFFFFF' : '#000000');
  return { PRESETS, THEMES, VARIANTS, FIXED, themeRoles, fit };
});
