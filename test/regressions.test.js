const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert'); const P = ROOT + '/';
const { sanitize } = require(P + 'settingsStore.js'); const notify = require(P + 'notify.js');
assert.strictEqual(sanitize({ home: { countdown: { date: '2026-12-25', label: 'Xmas\u0001 day' } } }).home.countdown.date, '2026-12-25'); assert.strictEqual(sanitize({ home: { countdown: { date: '2026-13-99x' } } }).home.countdown.date, ''); assert.strictEqual(sanitize({ home: { countdown: { label: 'a\u0001b' } } }).home.countdown.label, 'a b'); console.log('PASS countdown date saved, junk rejected, control chars cleaned');
const t = sanitize({ tabs: ['clipboard', 'home', 'music', 'weather', 'timer', 'usage', 'agents'], hiddenTabs: ['home', 'music', 'weather', 'timer', 'usage', 'agents'], clipboard: { enabled: false } });
assert.ok(!t.tabs.filter((x) => !t.hiddenTabs.includes(x)).includes('clipboard') && t.tabs.some((x) => !t.hiddenTabs.includes(x))); console.log('PASS clipboard never the only visible tab while off');
assert.strictEqual(notify.describe({ tool_name: 'Edit', tool_input: { file_path: 'C:/proj/' + 'x/'.repeat(160) + 'secret/.ssh/authorized_keys' } }).detail, '.../secret/.ssh/authorized_keys'); console.log('PASS long path shows its real ending');
assert.strictEqual(sanitize({}).agents.quietAlert, false); console.log('PASS quiet alert off by default');
