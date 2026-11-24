// Setup check: is everything DyIsland needs actually in place? Pure functions (no Electron), so they can be tested.
// Each row is { id, label, state: 'ok' | 'warn' | 'bad' | 'off', detail }.
const path = require('path');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Looks at one event of ~/.claude/settings.json "hooks" and says whether it runs `script` (hook.js / approve-hook.js).
//   found:     an entry runs the script       malformed: an entry is not { hooks: [ { type, command } ] }
function inspectEvent(hooks, event, script) {
  const v = isObj(hooks) ? hooks[event] : undefined;
  if (v === undefined) return { found: false, malformed: false, missing: true, commands: [] };
  if (!Array.isArray(v)) return { found: false, malformed: true, missing: false, commands: [] };
  let found = false, malformed = false; const commands = [];
  for (const entry of v) {
    if (!isObj(entry) || !Array.isArray(entry.hooks)) { malformed = true; continue; }      // e.g. a whole "hooks" block pasted inside an entry
    for (const h of entry.hooks) {
      if (isObj(h) && h.type === 'command' && typeof h.command === 'string' && path.basename(scriptPathOf(h.command).split('\\').join('/')).toLowerCase() === script) { found = true; commands.push(h.command); }   // exactly hook.js / approve-hook.js, not git-precommit-hook.js
    }
  }
  return { found, malformed: malformed && !found, missing: !found && !malformed, commands };
}

// The script path inside a hook command:  node "S:\DyIsland\hook.js"  ->  S:\DyIsland\hook.js
function scriptPathOf(command) {
  const m = /"([^"]*\.js)"/i.exec(command) || /(\S+\.js)/i.exec(command);
  return m ? m[1] : '';
}

// settingsJson: parsed contents of ~/.claude/settings.json, or null if the file is missing, or { __error } if it would not parse.
function checkHooks(settingsJson, { approvalsEnabled = true, exists = () => true } = {}) {
  const rows = [];
  if (settingsJson === null) {
    return [{ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'No ~/.claude/settings.json found. Use "Copy hooks setup" and paste it there' }];
  }
  if (isObj(settingsJson) && settingsJson.__error) {
    return [{ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'Your Claude settings file is not valid JSON, so Claude Code ignores it' }];
  }
  if (!isObj(settingsJson)) return [{ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'Your Claude settings file has an unexpected shape' }];
  if (settingsJson.disableAllHooks === true) {
    return [{ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: '"disableAllHooks" is on in your Claude settings' }];
  }
  const hooks = settingsJson.hooks;
  const required = ['UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd'];
  const missing = [], malformed = [], badPath = [];
  for (const ev of required) {
    const r = inspectEvent(hooks, ev, 'hook.js');
    if (r.malformed) malformed.push(ev); else if (r.missing) missing.push(ev);
    for (const c of r.commands) { const p = scriptPathOf(c); if (p && !exists(p)) badPath.push(path.basename(p)); }
  }
  if (malformed.length) rows.push({ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'Wrong shape for ' + malformed.join(', ') + ' (a hooks block pasted inside an entry?). Claude Code ignores it' });
  else if (missing.length) rows.push({ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'Missing: ' + missing.join(', ') });
  else if (badPath.length) rows.push({ id: 'hooks', label: 'Claude Code hooks', state: 'bad', detail: 'The hook script was not found: ' + [...new Set(badPath)].join(', ') });
  else rows.push({ id: 'hooks', label: 'Claude Code hooks', state: 'ok', detail: 'Prompt, stop, notification and session-end hooks are in place' });

  const beat = inspectEvent(hooks, 'PostToolUse', 'hook.js');
  rows.push(beat.found
    ? { id: 'heartbeat', label: 'Long-task heartbeat', state: 'ok', detail: 'Tasks over 10 minutes stay on the island' }
    : { id: 'heartbeat', label: 'Long-task heartbeat', state: 'warn', detail: beat.malformed ? 'PostToolUse hook has the wrong shape' : 'Optional PostToolUse hook missing: a task longer than 10 minutes drops off' });

  const ap = inspectEvent(hooks, 'PermissionRequest', 'approve-hook.js');
  if (ap.found) {
    const bad = ap.commands.map(scriptPathOf).filter((p) => p && !exists(p));
    rows.push(bad.length
      ? { id: 'approvals', label: 'Approve from the island', state: 'bad', detail: 'The approval hook script was not found' }
      : { id: 'approvals', label: 'Approve from the island', state: approvalsEnabled ? 'ok' : 'off', detail: approvalsEnabled ? 'Permission prompts can be answered on the island' : 'Hook installed, but approvals are switched off in Settings' });
  } else if (ap.malformed) rows.push({ id: 'approvals', label: 'Approve from the island', state: 'bad', detail: 'PermissionRequest hook has the wrong shape' });
  else rows.push({ id: 'approvals', label: 'Approve from the island', state: approvalsEnabled ? 'warn' : 'off', detail: approvalsEnabled ? 'PermissionRequest hook missing: Claude asks in the terminal only' : 'Off' });
  return rows;
}

module.exports = { checkHooks, inspectEvent, scriptPathOf };
