// Cross-checks: api.* calls vs preload vs mock, ipc channels main<->preload, require() targets, element ids, class collisions.
const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const fs = require('fs');
const path = require('path');
const P = ROOT + '/';
const read = (f) => fs.readFileSync(P + f, 'utf8');
const problems = [];

// 1) every api.NAME used by app.js / settings.js is exposed by preload.js and implemented by bridge-mock.js
const preload = read('preload.js');
const exposed = new Set([...preload.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]));
const mock = read('bridge-mock.js');
const mocked = new Set([...mock.matchAll(/^\s{4}(?:async\s+)?(\w+)\s*(?:\(|:)/gm)].map((m) => m[1]));
for (const f of ['app.js', 'settings.js']) {
  const used = new Set([...read(f).matchAll(/\bapi\.(\w+)/g)].map((m) => m[1]));
  for (const n of used) {
    if (!exposed.has(n)) problems.push(`${f}: api.${n} is not exposed by preload.js`);
    // defined anywhere in the mock as `name(` or `name:` (several members share a line)
    if (!new RegExp('(?:^|[\\s,{])(?:async\\s+)?' + n + '\\s*(?:\\(|:)').test(mock)) problems.push(`${f}: api.${n} is missing from bridge-mock.js`);
  }
}

// 2) ipc channels: every invoke/send in preload has a handler/listener in main, every send from main has a listener in preload
const mainParts = ['main.js', ...fs.readdirSync(P + 'main').filter((f) => f.endsWith('.js')).map((f) => 'main/' + f)];   // the main process lives in main.js and the modules beside it
const main = mainParts.map(read).join('\n');
const handled = new Set([...main.matchAll(/ipcMain\.(?:handle|on)\('([\w:]+)'/g)].map((m) => m[1]));
for (const m of preload.matchAll(/ipcRenderer\.(?:invoke|send)\('([\w:]+)'/g)) if (!handled.has(m[1])) problems.push(`preload sends '${m[1]}' but main has no handler`);
const listened = new Set([...preload.matchAll(/\bon\('([\w:]+)'/g)].map((m) => m[1]));
for (const m of main.matchAll(/send\((?:win|settings), '([\w:]+)'/g)) if (!listened.has(m[1])) problems.push(`main sends '${m[1]}' but preload does not listen`);
for (const m of main.matchAll(/webContents\.send\('([\w:]+)'/g)) if (!listened.has(m[1])) problems.push(`main sends '${m[1]}' but preload does not listen`);

// 3) require() targets exist
for (const f of [...mainParts, 'usage.js', 'limits.js', 'notify.js', 'hook.js', 'settingsStore.js', 'sessions.js']) {
  for (const m of read(f).matchAll(/require\('(\.[^']+)'\)/g)) { const t = path.resolve(path.dirname(P + f), m[1]); if (!fs.existsSync(t + (t.endsWith('.js') ? '' : '.js'))) problems.push(`${f}: require('${m[1]}') does not resolve`); }
}

// 4) scripts/styles referenced by the html files exist
for (const f of ['index.html', 'settings.html']) for (const m of read(f).matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) if (!fs.existsSync(P + m[1])) problems.push(`${f}: ${m[1]} does not exist`);

// 5) every static $('#id') in app.js exists in index.html; settings.js ids exist in settings.html
const idsIn = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const indexIds = idsIn(read('index.html')), settingsIds = idsIn(read('settings.html'));
for (const m of read('app.js').matchAll(/\$\('#([\w-]+)'\)/g)) if (!indexIds.has(m[1])) problems.push(`app.js: #${m[1]} is not in index.html`);
for (const m of read('settings.js').matchAll(/\$\('#([\w-]+)'\)/g)) if (!settingsIds.has(m[1])) problems.push(`settings.js: #${m[1]} is not in settings.html`);

// 6) class-name collisions: a selector class defined for two different purposes is hard to detect; flag the known risky short names
const css = read('styles.css');
for (const cls of ['chip', 'notice', 'tile', 'art', 'spin', 'stat']) {
  const re = new RegExp('^\\.' + cls + '\\s*\\{', 'gm');
  const n = (css.match(re) || []).length; if (n > 1) problems.push(`styles.css: .${cls} is defined ${n} times at top level`);
}

// 7) stale names from removed features
for (const f of ['app.js', 'index.html', 'styles.css', ...mainParts, 'preload.js']) for (const w of ['account.js', 'onAccountChanged', '#sat', 'sat-txt', 'shortTime(']) if (read(f).includes(w)) problems.push(`${f}: stale reference ${w}`);

console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'PASS: preload/mock/main channels, requires, ids and stale names all consistent');
console.log(`(${exposed.size} preload methods, ${mocked.size} mock members, ${handled.size} ipc handlers)`);
process.exit(problems.length ? 1 : 0);
