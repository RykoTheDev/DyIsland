const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const { spawnSync } = require('child_process');
const cases = [['C:\\my dir\\', 'next', 'a"b', 'p!q', '%OS%', 'line1\nline2']];
for (const args of cases) {
  const r = spawnSync(process.execPath, [ROOT + '/dyisland.js', 'run', '--', process.execPath, '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args], { encoding: 'utf8', env: { ...process.env, USERPROFILE: 'C:\\nonexistent-home' } });
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  console.log(JSON.stringify(got) === JSON.stringify(args) ? 'PASS arguments arrive exactly as typed' : 'FAIL ' + JSON.stringify(got));
}
