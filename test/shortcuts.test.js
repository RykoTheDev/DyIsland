// App shortcuts in the settings: only absolute Windows paths to a program / shortcut / link survive.
const assert = require('assert');
const { sanitize } = require('../settingsStore.js');
const apps = (list) => sanitize({ shortcuts: { apps: list } }).shortcuts.apps;

const ok = apps([{ name: 'Notepad', path: 'C:\\Windows\\notepad.exe' }, { path: 'D:\\Games\\Steam\\steam.exe' }, { name: 'Docs', path: 'C:\\Users\\me\\Desktop\\Docs.lnk' }]);
assert.deepStrictEqual(ok.map((a) => a.name), ['Notepad', 'steam', 'Docs'], 'a missing name comes from the file name');
// refused: not a program type, relative, network share, a different drive syntax, control characters, doubles, wrong types
assert.strictEqual(apps([{ path: 'C:\\x\\evil.dll' }]).length, 0, 'a dll is not a program shortcut');
assert.strictEqual(apps([{ path: '\\\\server\\share\\a.exe' }]).length, 0, 'network paths are refused');
assert.strictEqual(apps([{ path: 'notepad.exe' }]).length, 0, 'relative paths are refused');
assert.strictEqual(apps([{ path: 'C:\\a\\b.exe\u0000.txt' }]).length, 0);
assert.strictEqual(apps([{ path: 'C:\\a\\b?.exe' }]).length, 0);
assert.strictEqual(apps([{ path: 'C:\\Windows\\notepad.exe' }, { path: 'c:\\windows\\NOTEPAD.EXE' }]).length, 1, 'the same program twice is listed once');
assert.strictEqual(apps([{ path: 42 }, null, 'x', {}]).length, 0);
assert.strictEqual(apps(Array.from({ length: 20 }, (_, i) => ({ path: 'C:\\p\\a' + i + '.exe' }))).length, 8, 'at most 8');
assert.deepStrictEqual(sanitize({}).shortcuts, { apps: [] });
assert.strictEqual(sanitize({ home: { first: 'apps', second: 'weather' } }).home.first, 'apps', 'the App shortcuts card can be chosen');
console.log('PASS shortcuts: paths, types, duplicates, limit');
