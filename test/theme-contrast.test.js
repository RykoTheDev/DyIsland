const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const P = ROOT + '/';
const C = require(ROOT + '/test/.build/dycolor.cjs');
const { PRESETS, VARIANTS, FIXED } = require(P + 'presets.js');

// Every text-on-background pairing the island and the settings window actually use
const PAIRS = [
  ['on-primary', 'primary'], ['on-primary-container', 'primary-container'],
  ['on-secondary', 'secondary'], ['on-secondary-container', 'secondary-container'],
  ['on-tertiary', 'tertiary'], ['on-tertiary-container', 'tertiary-container'],
  ['on-error', 'error'], ['on-error-container', 'error-container'],
  ['on-surface', 'surface'], ['on-surface', 'surface-container'], ['on-surface', 'surface-container-high'], ['on-surface', 'surface-container-highest'],
  ['on-surface-variant', 'surface-container-high'], ['on-surface-variant', 'surface-container-highest'],
  ['primary', 'surface-container-high'], ['primary', 'surface-container-highest'],     // primary-coloured text/icons on the island body and cards
  ['tertiary', 'surface-container-high'], ['error', 'surface-container-high'],
];
let checked = 0; const fails = []; let worst = { ratio: 99 };
for (const p of PRESETS) for (const v of VARIANTS) for (const dark of [true, false]) {
  const r = C.rolesFromSeed(p.seed, dark, v.id);
  for (const [fg, bg] of PAIRS) {
    const ratio = C.contrastRatio(r[fg], r[bg]); checked++;
    if (ratio < worst.ratio) worst = { ratio: +ratio.toFixed(2), fg, bg, preset: p.id, variant: v.id, dark };
    if (ratio < 4.5) fails.push(`${p.id}/${v.id}/${dark ? 'dark' : 'light'} ${fg} on ${bg} = ${ratio.toFixed(2)}`);
  }
}
// Fixed meaning colours on the island body
for (const dark of [true, false]) for (const p of PRESETS) {
  const r = C.rolesFromSeed(p.seed, dark, 'vibrant');
  for (const k of ['sun', 'warn']) {
    const ratio = C.contrastRatio(FIXED[dark ? 'dark' : 'light'][k], r['surface-container-high']); checked++;
    if (ratio < 3) fails.push(`${p.id}/${dark ? 'dark' : 'light'} fixed ${k} = ${ratio.toFixed(2)} (needs 3 for icons)`);
  }
}
console.log(`${checked} contrast checks over ${PRESETS.length} presets x ${VARIANTS.length} variants x 2 themes`);
console.log('lowest ratio:', JSON.stringify(worst));
if (fails.length) { console.log('BELOW THRESHOLD (' + fails.length + '):'); console.log(fails.slice(0, 25).join('\n')); process.exit(1); }
console.log('PASS: every pairing >= 4.5:1 (fixed sun/warn colours >= 3:1)');
