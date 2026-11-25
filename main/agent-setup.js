// The lines to add to each coding agent's own config so it reports to the island (built from the tool's documented hook / notify / plugin interface;
// they are text for YOU to paste: DyIsland never edits another program's config). Pure, so it can be tested.
const AGENTS = [
  { id: 'gemini', name: 'Gemini CLI', where: '~/.gemini/settings.json', note: 'Merge the "hooks" block into your settings.json' },
  { id: 'qwen', name: 'Qwen Code', where: '~/.qwen/settings.json', note: 'Same hook format as Gemini CLI: merge the "hooks" block' },
  { id: 'codex', name: 'Codex CLI', where: '~/.codex/config.toml', note: 'Add this line near the top, above any [table]' },
  { id: 'opencode', name: 'OpenCode', where: '~/.config/opencode/plugin/dyisland.js', note: 'Save this as a plugin file' },
  { id: 'any', name: 'Any other agent (Kimi, Aider, Goose...)', where: 'your terminal', note: 'Start the agent through dyisland: you get a toast when it ends' },
];

const q = (p) => p.replace(/\\/g, '/');                      // forward slashes work in every one of these formats on Windows

// hookPath: full path of agent-hook.js; cliPath: full path of dyisland.cmd
function snippet(id, hookPath, cliPath) {
  const hp = q(hookPath), cmd = (agent) => `node "${hp}" --agent ${agent}`;
  const hooks = (agent) => {
    const h = (event) => [{ matcher: '*', hooks: [{ name: 'dyisland', type: 'command', command: cmd(agent), timeout: 5000 }] }];
    return JSON.stringify({ hooks: { BeforeAgent: h(), AfterAgent: h(), Notification: h(), AfterTool: h() } }, null, 2);
  };
  if (id === 'gemini' || id === 'qwen') return hooks(id);
  if (id === 'codex') return `notify = ["node", "${hp}", "--agent", "codex"]`;
  if (id === 'opencode') {
    return `// DyIsland: tells the island when OpenCode is working, finished or needs you.
import { spawn } from "node:child_process";
const HOOK = ${JSON.stringify(hp)};
const send = (payload) => {
  try { const p = spawn("node", [HOOK, "--agent", "opencode"], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }); p.stdin.end(JSON.stringify(payload)); } catch {}
};
export const DyIsland = async ({ directory }) => ({
  event: async ({ event }) => {
    if (["session.idle", "session.busy", "permission.asked", "session.deleted"].includes(event.type)) send({ type: event.type, cwd: directory, properties: event.properties });
  },
});
`;
  }
  return `# Run any agent through dyisland and the island tells you when it ends:\n"${q(cliPath)}" run -- <your agent command>`;
}

module.exports = { AGENTS, snippet };
