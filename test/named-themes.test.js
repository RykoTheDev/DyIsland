const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const P = ROOT + '/';
const C = require(ROOT + '/test/.build/dycolor.cjs');
const { THEMES, themeRoles } = require(P + 'presets.js');
const PAIRS = [['on-primary', 'primary'], ['on-primary-container', 'primary-container'], ['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'], ['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'], ['on-surface', 'surface'], ['on-surface', 'surface-container'], ['on-surface', 'surface-container-high'], ['on-surface', 'surface-container-highest'], ['on-surface-variant', 'surface-container-high'], ['on-surface-variant', 'surface-container-highest'], ['primary', 'surface-container-high'], ['primary', 'surface-container-highest'], ['primary', 'surface'], ['tertiary', 'surface-container-high'], ['secondary', 'surface-container-high'], ['error', 'surface-container-high']];
let n = 0, fails = [], worst = 99;
for (const t of THEMES) for (const dark of [true, false]) {
  const base = C.rolesFromSeed(t.dark.p, dark, 'vibrant'); const r = themeRoles(t.id, dark, base);
  for (const [f, b] of PAIRS) { const x = C.contrastRatio(r[f], r[b]); n++; worst = Math.min(worst, x); if (x < 4.5) fails.push(`${t.id}/${dark ? 'dark' : 'light'} ${f} on ${b}=${x.toFixed(2)}`); }
  for (const k of Object.keys(base)) if (!/^#[0-9A-F]{6}$/i.test(r[k])) fails.push(t.id + ' bad ' + k + ' ' + r[k]);
}
console.log(THEMES.length + ' themes, ' + n + ' checks, lowest ' + worst.toFixed(2));
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('PASS');
