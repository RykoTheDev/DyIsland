const assert = require('assert');
const { normalize } = require('../agent-hook.js');
const { parse } = require('../notify.js');

// Gemini / Qwen style (Claude-like hook JSON on stdin)
let n = normalize({ hook_event_name: 'AfterAgent', session_id: 's1', cwd: 'C:\\proj\\site' }, 'gemini');
assert.deepStrictEqual([n.hook_event_name, n.agent, n.session_id], ['Stop', 'gemini', 's1']);
assert.strictEqual(normalize({ hook_event_name: 'BeforeAgent', session_id: 's1' }, 'gemini').hook_event_name, 'UserPromptSubmit');
assert.strictEqual(normalize({ hook_event_name: 'Notification', message: 'needs you' }, 'qwen').hook_event_name, 'Notification');
assert.strictEqual(normalize({ hook_event_name: 'AfterTool' }, 'gemini').hook_event_name, 'PostToolUse', 'tool calls are a heartbeat');
// Codex: one JSON argument with a "type"
n = normalize({ type: 'agent-turn-complete', 'thread-id': 't9', cwd: 'C:\\x', 'last-assistant-message': 'Done!' }, 'codex');
assert.deepStrictEqual([n.hook_event_name, n.session_id, n.message], ['Stop', 't9', 'Done!']);
// OpenCode: events with properties.sessionID
n = normalize({ type: 'session.idle', properties: { sessionID: 'o1' } }, 'opencode');
assert.deepStrictEqual([n.hook_event_name, n.session_id], ['Stop', 'o1']);
assert.strictEqual(normalize({ type: 'permission.asked', properties: { sessionID: 'o1' } }, 'opencode').hook_event_name, 'Notification');
// unknown things and hostile input are ignored / cleaned
assert.strictEqual(normalize({ type: 'something.else' }, 'x'), null);
assert.strictEqual(normalize(null, 'x'), null);
assert.strictEqual(normalize({ type: 'session.idle' }, 'Evil<script>agent-name-that-is-long-long').agent, 'evilscriptagent-name', 'the agent label is plain and short');
// the island words the toast with the agent's name
let r = parse({ hook_event_name: 'Stop', session_id: 'a', cwd: 'C:\\p\\site', agent: 'gemini' });
assert.strictEqual(r.notice.title, 'Gemini finished');
r = parse({ hook_event_name: 'Notification', message: 'ok?', agent: 'codex' }); assert.strictEqual(r.notice.title, 'Codex needs you');
r = parse({ hook_event_name: 'Stop', session_id: 'a' }); assert.strictEqual(r.notice.title, 'Claude finished', 'no agent: Claude, as before');
console.log('PASS agent hook: event names of Gemini, Qwen, Codex, OpenCode mapped; toasts name the agent');
