const { contextBridge, ipcRenderer } = require('electron');

// Named islandAPI (not "island") so it never collides with page-level variables.
const on = (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args));

contextBridge.exposeInMainWorld('islandAPI', {
  // window mechanics
  capture: (v) => ipcRenderer.send('island:capture', !!v),
  input: (v) => ipcRenderer.send('island:input', !!v),
  // settings (the store lives in the main process; every window gets the full object whenever it changes)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),
  onSettings: (cb) => on('settings:changed', cb),
  toggleSettings: () => ipcRenderer.send('settings:toggle'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  onSettingsState: (cb) => on('settings:state', (open) => cb(!!open)),
  reportSize: (sz) => ipcRenderer.send('island:size', { w: Number(sz && sz.w) || 0, h: Number(sz && sz.h) || 0 }),   // the open size of the page on screen (the settings card is placed from it)
  onEvents: (cb) => on('events:list', cb),                           // { list, status } from the calendar link
  googleState: () => ipcRenderer.invoke('google:state'),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleDisconnect: () => ipcRenderer.invoke('google:disconnect'),
  googleOpen: (what) => ipcRenderer.send('google:open', String(what || '')),
  onGoogle: (cb) => on('google:data', cb),                                  // { status, mail: { unread, latest }, error }
  eventsGet: () => ipcRenderer.invoke('events:get'),
  openEvent: (id) => ipcRenderer.send('events:open', String(id || '')),
  onVolume: (cb) => on('system:volume', cb),                          // { pct, mute, init } from the system helper
  setVolume: (pct) => ipcRenderer.send('volume:set', Number(pct) || 0),
  setMute: (m) => ipcRenderer.send('volume:mute', !!m),
  appIcons: () => ipcRenderer.invoke('apps:icons'),                          // data URLs of the icons of the App shortcuts, in order
  openApp: (i) => ipcRenderer.send('apps:open', Number(i)),                  // opens the i-th shortcut from the saved list (the page never sends a path)
  pickApp: () => ipcRenderer.invoke('apps:pick'),                            // the file picker; the chosen program is added to the list
  quick: (k) => ipcRenderer.send('quick:run', String(k || '')),                     // a fixed list of actions (screenshot, lock, night light, calculator): main decides what each one does
  // environment
  onNear: (cb) => on('env:near', (v) => cb(!!v)),                   // pointer is at the top centre (auto-hide)
  mascotWatch: (v) => ipcRenderer.send('mascot:watch', !!v),        // ask for pointer direction updates
  onGaze: (cb) => on('cursor:gaze', cb),
  onHotkey: (cb) => on('hotkey:toggle', (open) => cb(typeof open === 'boolean' ? open : undefined)),
  hotkeyStatus: () => ipcRenderer.invoke('hotkey:status'),
  onHotkeyStatus: (cb) => on('hotkey:status', cb),
  setKeepAwake: (v) => ipcRenderer.invoke('awake:set', !!v),
  // clipboard history
  clipboardList: () => ipcRenderer.invoke('clipboard:list'),
  onClipboard: (cb) => on('clipboard:list', cb),
  clipboardCopy: (id) => ipcRenderer.invoke('clipboard:copy', id),
  clipboardPin: (id) => ipcRenderer.invoke('clipboard:pin', id),
  clipboardPaste: (id) => ipcRenderer.invoke('clipboard:paste', id),
  clipboardClear: () => ipcRenderer.invoke('clipboard:clear'),
  onPrivacy: (cb) => on('privacy:state', cb),                       // { camera, mic } in use right now
  // where the island lives (edge, monitor) and what it knows about its own window
  windowInfo: () => ipcRenderer.invoke('window:info'),
  onWindowInfo: (cb) => on('window:info', cb),
  displays: () => ipcRenderer.invoke('displays:list'),
  onDisplaysChanged: (cb) => on('displays:changed', () => cb()),
  onAwake: (cb) => on('awake:state', (v) => cb(!!v)),
  awakeGet: () => ipcRenderer.invoke('awake:get'),
  timerSync: (st) => ipcRenderer.send('timer:sync', st),
  onTimer: (cb) => on('timer:state', cb),
  // bring Claude's window (terminal, editor, desktop app) to the front
  focusClaude: (session) => ipcRenderer.invoke('claude:focus', typeof session === 'string' ? session : ''),
  // NextDNS on/off (needs the one-time setup in dns/)
  dnsStatus: () => ipcRenderer.invoke('dns:status'),
  dnsToggle: () => ipcRenderer.invoke('dns:toggle'),
  dnsSetup: () => ipcRenderer.invoke('dns:setup'),
  // DNS providers (Cloudflare, Google, AdGuard, your own...): one switch between them, installed once with Windows approval
  dnspPresets: () => ipcRenderer.invoke('dnsp:presets'),
  dnspStatus: () => ipcRenderer.invoke('dnsp:status'),
  dnspUse: (which) => ipcRenderer.invoke('dnsp:use', typeof which === 'string' ? which : 'auto'),
  dnspSetup: () => ipcRenderer.invoke('dnsp:setup'),
  dnspRemove: () => ipcRenderer.invoke('dnsp:remove'),
  dnsRemove: () => ipcRenderer.invoke('dns:remove'),
  // settings tools
  settingsDefaults: () => ipcRenderer.invoke('settings:defaults'),
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  setupStatus: () => ipcRenderer.invoke('status:get'),
  // app control (quick actions)
  pauseIsland: (minutes) => ipcRenderer.send('app:pause', Number(minutes) || 60),
  restartApp: () => ipcRenderer.send('app:restart'),
  quitApp: () => ipcRenderer.send('app:quit'),
  // permission requests from Claude Code
  onApprovals: (cb) => on('approvals:state', cb),
  approvals: () => ipcRenderer.invoke('approve:list'),
  approve: (id, behavior) => ipcRenderer.send('approve:answer', id, behavior),
  agentsList: () => ipcRenderer.invoke('agents:list'),
  agentsCopy: (id) => ipcRenderer.invoke('agents:copy', String(id || '')),
  copyHooks: () => ipcRenderer.invoke('hooks:copy'),
  // media, weather, usage, Claude
  media: (cmd, arg) => ipcRenderer.send('media:cmd', cmd, arg),
  onMedia: (cb) => on('media:update', cb),
  weather: (where) => ipcRenderer.invoke('weather:get', where),             // a place name, or { name, lat, lon }
  weatherSearch: (text) => ipcRenderer.invoke('weather:search', typeof text === 'string' ? text : ''),
  weatherLocate: () => ipcRenderer.invoke('weather:locate'),                // asks the Windows location service, only when you press the button
  usage: () => ipcRenderer.invoke('usage:get'),
  limits: () => ipcRenderer.invoke('limits:get'),
  onNotice: (cb) => on('notice:show', cb),
  onWorking: (cb) => on('working:state', cb),
});
