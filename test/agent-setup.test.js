const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const S = require('../main/agent-setup.js');
const hook = 'C:\\Program Files\\DyIsland\\resources\\app.asar.unpacked\\agent-hook.js', cli = 'C:\\Program Files\\DyIsland\\resources\\app.asar.unpacked\\dyisland.cmd';

const g = JSON.parse(S.snippet('gemini', hook, cli));
assert.deepStrictEqual(Object.keys(g.hooks).sort(), ['AfterAgent', 'AfterTool', 'BeforeAgent', 'Notification']);
assert(g.hooks.AfterAgent[0].hooks[0].command.includes('--agent gemini') && g.hooks.AfterAgent[0].hooks[0].command.includes('C:/Program Files/DyIsland'), 'paths use forward slashes and are quoted');
assert(JSON.parse(S.snippet('qwen', hook, cli)).hooks.AfterAgent[0].hooks[0].command.includes('--agent qwen'));
assert.strictEqual(S.snippet('codex', hook, cli), 'notify = ["node", "C:/Program Files/DyIsland/resources/app.asar.unpacked/agent-hook.js", "--agent", "codex"]');
assert(S.snippet('any', hook, cli).includes('run -- <your agent command>'));
// the OpenCode plugin is valid JavaScript (an ES module)
const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dyi-')), 'dyisland.mjs'); fs.writeFileSync(f, S.snippet('opencode', hook, cli));
const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); assert.strictEqual(r.status, 0, 'the OpenCode plugin parses: ' + r.stderr);
assert(S.AGENTS.every((a) => S.snippet(a.id, hook, cli).length > 20));
console.log('PASS agent setup snippets: Gemini, Qwen, Codex, OpenCode, generic');
