const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { checkHooks, scriptPathOf } = require(ROOT + '/setupcheck.js');
const cmd = (f) => 'node "S:\\Projects\\SoftwareDev\\DyIsland\\' + f + '"';
const one = (f) => [{ hooks: [{ type: 'command', command: cmd(f) }] }];
const good = { hooks: { UserPromptSubmit: one('hook.js'), Stop: one('hook.js'), Notification: one('hook.js'), SessionEnd: one('hook.js'), PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('hook.js') }] }], PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('approve-hook.js') }] }] } };
const st = (rows, id) => rows.find((r) => r.id === id).state;
const ok = (m) => console.log('PASS ' + m);

let r = checkHooks(good); assert.deepStrictEqual(r.map((x) => x.state), ['ok', 'ok', 'ok']); ok('good setup: all ok');
// the exact mistake from the user's file: a whole hooks block pasted inside the UserPromptSubmit entry
const nested = JSON.parse(JSON.stringify(good)); nested.hooks.UserPromptSubmit = [{ hooks: good.hooks }];
r = checkHooks(nested); assert.strictEqual(st(r, 'hooks'), 'ok' === 'x' ? '' : st(r, 'hooks'));
// entry {hooks: <object>} is malformed (hooks must be an array)
const nested2 = JSON.parse(JSON.stringify(good)); nested2.hooks.UserPromptSubmit = [{ hooks: { UserPromptSubmit: one('hook.js') } }];
r = checkHooks(nested2); assert.strictEqual(st(r, 'hooks'), 'bad'); assert.ok(/UserPromptSubmit/.test(r[0].detail) && /wrong shape/i.test(r[0].detail)); ok('nested hooks block is flagged as the wrong shape, naming the event');
const missing = JSON.parse(JSON.stringify(good)); delete missing.hooks.Stop; delete missing.hooks.SessionEnd;
r = checkHooks(missing); assert.strictEqual(st(r, 'hooks'), 'bad'); assert.ok(/Missing: Stop, SessionEnd/.test(r[0].detail)); ok('missing events are listed');
const noBeat = JSON.parse(JSON.stringify(good)); delete noBeat.hooks.PostToolUse; assert.strictEqual(st(checkHooks(noBeat), 'heartbeat'), 'warn'); ok('missing heartbeat is only a warning');
const noAp = JSON.parse(JSON.stringify(good)); delete noAp.hooks.PermissionRequest;
assert.strictEqual(st(checkHooks(noAp, { approvalsEnabled: true }), 'approvals'), 'warn'); assert.strictEqual(st(checkHooks(noAp, { approvalsEnabled: false }), 'approvals'), 'off'); ok('approval hook: warn when wanted, off when switched off');
assert.strictEqual(st(checkHooks(good, { approvalsEnabled: false }), 'approvals'), 'off'); ok('hook installed but approvals off: off');
assert.strictEqual(st(checkHooks(good, { exists: () => false }), 'hooks'), 'bad'); assert.ok(/not found/.test(checkHooks(good, { exists: () => false })[0].detail)); ok('hook script path that does not exist is flagged');
assert.strictEqual(checkHooks(null)[0].state, 'bad'); assert.strictEqual(checkHooks({ __error: 1 })[0].state, 'bad'); assert.strictEqual(checkHooks([])[0].state, 'bad'); assert.strictEqual(checkHooks({ disableAllHooks: true, hooks: good.hooks })[0].state, 'bad'); ok('missing file, bad JSON, wrong shape, disableAllHooks: all bad');
assert.strictEqual(checkHooks({})[0].state, 'bad'); ok('no hooks at all: bad');
assert.strictEqual(scriptPathOf(cmd('hook.js')), 'S:\\Projects\\SoftwareDev\\DyIsland\\hook.js'); assert.strictEqual(scriptPathOf('node C:/x/hook.js'), 'C:/x/hook.js'); ok('script path extraction');
const weird = { hooks: { UserPromptSubmit: 'x', Stop: [null, 5, { hooks: [null, { type: 'command', command: 7 }] }], Notification: one('hook.js'), SessionEnd: one('hook.js') } };
assert.doesNotThrow(() => checkHooks(weird)); assert.strictEqual(st(checkHooks(weird), 'hooks'), 'bad'); ok('hostile / odd shapes never throw');
// another tool's hook script must not count as ours
{ const other = { hooks: { UserPromptSubmit: one('git-precommit-hook.js'), Stop: one('git-precommit-hook.js'), Notification: one('x-hook.js'), SessionEnd: one('my-approve-hook.js') } };
  const r2 = checkHooks(other); assert.strictEqual(r2.find((x) => x.id === 'hooks').state, 'bad'); console.log('PASS a different tool\'s *hook.js is not mistaken for ours'); }
