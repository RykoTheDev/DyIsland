// Runs every test in this folder, one at a time, each with its own empty home folder (so nothing touches the real
// ~/.dyisland) and each in its own process. Exit code 1 if any test fails.
//   npm test                    run everything
//   npm test -- hook            only tests whose file name contains "hook"
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const build = path.join(__dirname, '.build');
const filter = process.argv[2];

// The colour tests need the Material colour library as a plain CommonJS file: build it once.
fs.mkdirSync(build, { recursive: true });
const cjs = path.join(build, 'dycolor.cjs');
if (!fs.existsSync(cjs)) {
  const r = spawnSync(process.execPath, [path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild'), path.join(root, 'theme-src.js'), '--bundle', '--format=cjs', '--outfile=' + cjs, '--log-level=error'], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('could not build the colour library for the tests'); process.exit(1); }
}

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && (!filter || f.includes(filter))).sort();
let failed = 0;
for (const f of files) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dyisland-test-'));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8', timeout: 180000 });
  const ok = r.status === 0;
  console.log((ok ? 'PASS ' : 'FAIL ') + f + '  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
  if (!ok) { failed++; console.log(String(r.stdout || '').split('\n').slice(-12).join('\n')); console.log(String(r.stderr || '').split('\n').slice(0, 20).join('\n')); }
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* temp folder */ }
}
console.log('\n' + (files.length - failed) + ' of ' + files.length + ' test files passed');
process.exit(failed ? 1 : 0);
