# DyIsland 3.0.0 IPC contract (main <-> renderer)

Owner: Island Engine (main process). Renderer: Island Design. All calls go through `window.islandAPI` (preload.js).
Every new feature is OFF by default except where noted, and every feature has a settings key (see "Settings keys").
Settings are read and written with the existing `getSettings` / `setSettings`; main reacts to changes at once.
Paths are never trusted from the page except where a file was dropped (`pathForFile`) or picked by main's own dialog.

## preload API (islandAPI.*)

| API | Kind | Channel | Args | Returns / payload |
| --- | --- | --- | --- | --- |
| `pathForFile(file)` | sync | (webUtils) | a `File` from a drop | absolute path string, '' if none |
| `localsendDevices()` | invoke | `localsend:devices` | none | `[{id, alias, deviceModel, deviceType, ip, port}]` |
| `onLocalsendDevices(cb)` | event | `localsend:devices` | | `cb(list)` same shape |
| `localsendSend(deviceId, paths)` | invoke | `localsend:send` | id, string[] (files or folders) | `{ok, error?, sessionId?}` |
| `onLocalsendProgress(cb)` | event | `localsend:progress` | | `{sessionId, deviceId, sentBytes, totalBytes, state}` state: `waiting` `sending` `done` `declined` `error` (+ `error` text on error) |
| `localsendCancel(sessionId)` | send | `localsend:cancel` | sessionId | |
| `onLocalsendIncoming(cb)` | event | `localsend:incoming` | | `{id, alias, files:[{name,size}]}`. With `localsend.autoAccept` on there is no prompt, only `localsend:received` |
| `onLocalsendIncomingClosed(cb)` | event | `localsend:incoming-closed` | | `cb(id)`: the request with that id is gone (sender cancelled, 60 s timeout, or answered elsewhere). Hide its Accept/Decline UI |
| `localsendRespond(id, accept)` | send | `localsend:respond` | id, bool | |
| `onLocalsendReceived(cb)` | event | `localsend:received` | | `{id, alias, dir, files, state:'receiving'|'done'|'error', receivedBytes, totalBytes}` (progress of an accepted incoming transfer) |
| `localsendStatus()` | invoke | `localsend:status` | none | `{enabled, receiving, port, alias, saveDir, error?}` |
| `localsendOpenFolder()` | send | `localsend:open-folder` | none | opens the save folder |
| `onDropArmed(cb)` | event | `drop:armed` | | `cb(bool)`: a drag is near the island. While true main has switched the island window to capture mouse events so the renderer gets dragenter/dragover/drop. |
| `shelfList()` | invoke | `shelf:list` | | `[{id, name, path, size, isDir, addedAt, missing}]` |
| `shelfAdd(paths)` | invoke | `shelf:add` | string[] | the new list |
| `shelfRemove(id)` | invoke | `shelf:remove` | id | the new list |
| `shelfClear()` | invoke | `shelf:clear` | | `[]` |
| `shelfDragOut(id)` | send | `shelf:dragout` | id | main calls `webContents.startDrag`. Send it from a `dragstart` handler (call `preventDefault()` first) |
| `onShelf(cb)` | event | `shelf:list` | | list pushed on every change |
| `capturesList()` | invoke | `captures:list` | | `[{id, kind:'image'|'video', name, path, size, at, thumb?}]` newest first, 8 max |
| `onCaptures(cb)` | event | `captures:list` | | list; also fires a `captures:new` with the new item |
| `onCaptureNew(cb)` | event | `captures:new` | | the new item |
| `captureDragOut(id)` | send | `captures:dragout` | id | startDrag, same rule as shelf |
| `captureToShelf(id)` | invoke | `captures:to-shelf` | id | the shelf list |
| `captureDismiss(id)` | invoke | `captures:dismiss` | id | the list (file stays on disk) |
| `onDownloads(cb)` | event | `downloads:update` | | `[{id, name, bytes, state:'downloading'|'done', app?}]` active + just-finished (done items stay 6 s). Empty list = nothing running |
| `downloadsList()` | invoke | `downloads:list` | | same list |
| `networkStatus()` | invoke | `network:status` | | `{online, ip, vpn, vpnName, pingMs, host}`; `pingMs` null when unreachable |
| `onNetwork(cb)` | event | `network:status` | | same shape, on change or every ping round (10 s) |
| `onNoteOpen(cb)` | event | `note:open` | | the quick-note hotkey fired: show the input and call `islandAPI.input(true)` as for other text fields |
| `noteAdd(text)` | invoke | `note:add` | string (max 2000) | `{ok, file?, error?}` appends a timestamped line to the notes file |
| `noteOpenFile()` | send | `note:open-file` | | opens the notes file |
| `urlOpen(url)` | invoke | `url:open` | http/https url | `{ok}` |
| `urlShorten(url)` | invoke | `url:shorten` | http/https url | `{ok, url?, error?}` only works when `urltools.shorten` is true (it calls is.gd, an external service) |
| `mixerList()` | invoke | `mixer:list` | | `[{pid, name, volume:0-100, mute}]` apps with an audio session on the default output |
| `mixerSet(pid, volume, mute)` | invoke | `mixer:set` | pid, 0-100, bool\|undefined | `{ok}` |
| `onFocusMode(cb)` | event | `focus:state` | | `{system:bool}` the Windows "Do not disturb" state when `focus.sync` is on. Main also writes it to `quiet.dnd` (you get `settings:changed`) |
| `clipboardSearch(q)` | invoke | `clipboard:search` | string | the clipboard view filtered by text (case-insensitive, pinned first) |

Notes for Design:
- Existing clipboard channels already cover pin (`clipboard:pin`), clear, copy, paste and the pin persistence (`clipboard.persistPins`, limit `clipboard.max`). The only addition is `clipboard:search`; filtering client-side works too. URL detection is a regex in the renderer; use `urlOpen` / `urlShorten` for the actions.
- `drop:armed(true)` can fire for any drag (even a text selection). Show the drop UI only when `dragenter` carries `dataTransfer.types.includes('Files')`. Main disarms (`drop:armed(false)`) when the button is released or the pointer leaves the zone, and a drop does not need any renderer reply.
- Charger toasts, Bluetooth toasts and download-complete / VPN alerts reuse the existing `notice:show` event: `{kind, tone, duration, title, sub}`. A mirrored Windows notification also carries `act` (an opaque id like `n3`); a click sends it back on `notice:open` (renderer -> main, one string) and main opens the app that sent the notification (Snipping Tool: the matching screenshot).
- `quick:run` now only handles `'lock'`; `snip`, `night` and `calc` were removed. Privacy dot and fullscreen auto-hide were already implemented and are not touched.

## Settings keys (new, all validated in settingsStore.js)

| Key | Default |
| --- | --- |
| `localsend.enabled` | false (discovery + sending; opens UDP 53317) |
| `localsend.receive` | false (HTTPS receiver on 53317; needs `enabled`) |
| `localsend.alias` | '' (empty = computer name) |
| `localsend.saveDir` | '' (empty = `Downloads\LocalSend`) |
| `localsend.autoAccept` | false |
| `drop.enabled` | true (drag detection; only acts when `localsend.enabled` or `shelf.enabled`) |
| `shelf.enabled` | false, `shelf.max` 12 (3-40). Shelf and LocalSend share ONE tab, id `localsend` (label "Share"). There is no `shelf` tab id. The tab is visible while `localsend.enabled` OR `shelf.enabled` is on; with both off sanitize forces it hidden (default `hiddenTabs` is `['clipboard','localsend']`). Migration: a stored `shelf` id in `tabs`/`hiddenTabs` is dropped silently, and a user who had the Shelf tab visible with shelf on gets the Share tab visible. All `shelf:*` and `localsend:*` channels are unchanged |
| `captures.enabled` | false (watches Pictures\Screenshots and Videos\Captures) |
| `devices.charger` | true (charger plugged/unplugged toast; `devices.toasts` is the master switch), `devices.battery` true (low battery toast from main at `devices.lowAt`, default 15, 5-50). The old `battery.warn` setting was removed (nothing read it); sanitize drops it from stored settings. The low battery toast comes only from main |
| `downloads.enabled` | false |
| `network.enabled` | false, `network.host` '1.1.1.1', `network.vpnAlerts` true |
| `focus.sync` | false |
| `notes.enabled` | false, `notes.hotkey` 'Control+Alt+N' (one of '', Control+Alt+N, Control+Alt+J, Control+Alt+K), `notes.file` '' (empty = Documents\DyIsland\notes.md) |
| `urltools.enabled` | true, `urltools.shorten` false |
| `mixer.enabled` | false |

## How drag detection works (and its limits)
- system.ps1 (`-Mouse`) reports the left button (`LMB 1|0`). main/dropwatch.js arms when the button went down outside the island zone, the pointer is now inside it (open island size + 40 px) and it has been held 150 ms. Only runs when `drop.enabled` and (`localsend.enabled` or `shelf.enabled`).
- Armed = the click-through window becomes a normal window until 400 ms after release (or 700 ms after the pointer leaves the zone). This replaces the thin edge-strip window idea: a strip would permanently swallow clicks at the screen edge.
- Not tested with a real drag yet. Whether Windows delivers the OLE drop to the island while it flips from click-through is the thing to try first.
- Dragging OUT (shelf, captures) uses startDrag with the file's shell icon; also untested in a real window.

## Not done / limits (kept honest)
- LocalSend discovery over real multicast between two devices is untested (the test sends between two instances on loopback). Firewall prompt on first enable is expected.
- Charger toast needs a battery; the dev machine has none, so only the helper's no-battery path was run.
- Google Tasks: the google module is read-only (scope readonly), so quick notes only go to the file.
- Windows Focus Assist state is read from the notification-banner switch the Win11 "Do not disturb" toggle flips; Windows has no public API for it, so older Focus Assist modes may not show.

## Settings changes requested (from the renderer, Island Design)
- `tabs` / `hiddenTabs` ids: the renderer now uses one `localsend` tab labelled Share (it follows `localsend.enabled` OR `shelf.enabled`). `settingsStore.js` TAB_IDS must include `localsend` and drop `shelf`.
- `battery.warn` is no longer read by the renderer (main shows the low-battery toast). The key is unused.
- Line about the renderer battery toast earlier in this file is stale: the renderer shows no charger or low-battery toast.

## Main channels the renderer no longer calls
Removed in the cleanup: `quick:run` with snip, night or calc, `captures:start` (preload `captureStart`) and the Snipping Tool launch code. Kept: `quick:run` `'lock'`, `app:restart` and `app:quit` (the settings window's Restart and Quit buttons use them), and the screenshot/recording folder watcher (`captures:*` list, new, dragout, to-shelf, dismiss).
