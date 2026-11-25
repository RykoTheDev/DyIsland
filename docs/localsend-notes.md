# LocalSend integration notes (research, checked 2026-11-25)

Sources (all read directly, not via blogs):
- SPEC: https://github.com/localsend/protocol/blob/main/README.md (titled "Protocol v2.2", last commit 2026-08-07, sha 62bd340). CHANGELOG.md in the same repo.
- APP SOURCE (what real peers actually enforce): https://github.com/localsend/localsend (main; latest release v1.19.0, 2026-11-24)
  - packages/core/src/http/server/v2.rs, server/mod.rs, server/common/client_cert_verifier.rs
  - packages/core/src/http/client/server_cert_verifier.rs, crypto/cert.rs, util/filename.rs
  - app/lib/provider/network/send_provider.dart, app/lib/provider/selection/selected_sending_files_provider.dart
- ELECTRON: docs/api/browser-window.md, docs/api/web-utils.md, docs/breaking-changes.md (electron/electron main)

## 0. What the spec does NOT tell you (important)
The README says fingerprint = SHA-256 of the cert and is "ignored in HTTPS mode". The current official app is stricter:
- Its HTTPS server REQUIRES a client certificate (mTLS) unless the "receive via link" web page is on (server/mod.rs line 386: mandatory_client_auth = web share disabled). So our SENDER must present a self-signed client cert, or official receivers drop the handshake.
- prepare-upload and register: payload `info.fingerprint` must equal the SHA-256 of the client cert we presented (case-insensitive), else 403 "Fingerprint does not match the client certificate" (v2.rs prepare_upload). A register with a mismatching fingerprint is ignored.
- upload: the server also checks the request IP equals the IP that did prepare-upload, else 403 "Invalid token or IP address".
=> Generate ONE self-signed cert/key at first run, persist it, use it as both our HTTPS server cert and our HTTPS client cert, and use fingerprint = uppercase hex SHA-256 of the DER bytes everywhere.
Cert details the official app generates (cert.rs): RSA-2048, CN "LocalSend User", no SANs, validity 1975 to 4096. The verifier only checks time validity and self-consistency, no hostname. Not verified: whether EC keys are accepted. Safest is RSA-2048 like the app.
In Node: https.createServer({key, cert, requestCert: true, rejectUnauthorized: false}) so we accept official clients (they send a cert) and older ones (they don't). Read the peer cert with req.socket.getPeerCertificate().raw (DER), sha256 it, compare to the claimed fingerprint. fingerprint = crypto.createHash('sha256').update(der).digest('hex').toUpperCase().

## 1. Discovery
Defaults (README sec 1): multicast UDP group 224.0.0.167, port 53317; HTTP(S) TCP port 53317.
Announce (UDP multicast, sent at app start), fields exactly:
`alias, version ("2.0"), deviceModel (nullable), deviceType (mobile|desktop|web|headless|server, nullable), fingerprint, port (53317), protocol ("http"|"https"), download (bool, optional, default false), announce (true)`
Reply: on an announce with announce:true, the receiver does `POST <protocol>://<origin-ip>:<port>/api/localsend/v2/register` with the same fields minus `announce`. Fallback reply is a UDP multicast with `announce:false`. A response is only triggered when announce is true. Ignore messages carrying our own fingerprint (that is what fingerprint is for in the spec).
Register response body: alias, version, deviceModel, deviceType, fingerprint, download.
Legacy HTTP scan (sec 3.2): POST /register to every local IP when multicast fails. GET /api/localsend/v2/info is debug only (alias, version, deviceModel, deviceType, fingerprint, download).
Not in the spec, from v2.rs: the official server only trusts a register whose claimed fingerprint matches its mTLS client cert, so our register POST must also be made with our client cert.
Unverified: protocol v3 exists in the app source (client/v3.rs, server/v3.rs), but the protocol repo only has diagrams under /v3 and no text spec. v2 is still served (require_v2 in v2.rs). Stay on v2.

## 2. Sending (we are the client)
POST /api/localsend/v2/prepare-upload[?pin=123456]
Body: `{ info: {alias, version, deviceModel, deviceType, fingerprint, port, protocol, download}, files: { "<id>": {id, fileName, size, fileType, sha256 (nullable), preview (nullable), metadata (nullable): {modified, accessed as ISO-8601}} } }`
The official sender uses a fresh uuid v4 per file as id (send_provider.dart). fileType is a MIME string. files must be non-empty (400 "No files provided").
Response 200: `{ sessionId, files: { "<fileId>": "<token>" } }`
Status codes (README 4.1): 204 finished / no transfer needed (do not upload), 400 invalid body, 401 PIN required or invalid, 403 rejected, 409 blocked by another session, 429 too many requests, 500 receiver error.
prepare-upload blocks until the person on the other side accepts or declines, so use a long (minutes) timeout or none on that request. The receiver may accept only some files: files missing from the response map are skipped.
Upload: POST /api/localsend/v2/upload?sessionId=<sid>&fileId=<fid>&token=<tok>, body = raw bytes (stream it, do not buffer), response has no body. Can run in parallel. 400 missing params, 403 invalid token/IP, 409 blocked, 422 sha256 mismatch (added in 2.2), 500.
Cancel: POST /api/localsend/v2/cancel?sessionId=<sid>, no body. The official server also accepts a cancel without sessionId from the same IP while a prepare-upload is still pending (v2.rs cancel). Closing the socket during the pending prepare also frees the slot.
Cert pinning on our side: connect with rejectUnauthorized:false and a checkServerIdentity that compares sha256(DER of server cert) with the fingerprint learned in discovery. The official client does this and ignores the hostname (peers addressed by IP, no SAN). It does the check during the handshake, before any body is sent.

## 3. Folders
No separate folder API. The official app walks the directory recursively and sends each file with a RELATIVE PATH in `fileName`, forward slashes, prefixed by the folder name: `<dirName>/<sub>/<file>` (selected_sending_files_provider.dart, AddDirectoryAction: p.relative(...).replaceAll('\\','/') then '$directoryName/$innerRelative'). It also honours .sendignore files. Only files are sent, so empty dirs are not.
The receiver recreates the subfolders. The official receiver NFC-normalizes names and sanitizes (illegal chars, reserved names like CON/NUL, max 255 bytes per name; util/filename.rs).

## 4. Receiving (we are the server): minimum surface
Listen TCP 53317 HTTPS (fall back to another port if taken and announce that port). Routes:
- POST /api/localsend/v2/register -> 200 with our info (alias, version, deviceModel, deviceType, fingerprint, download:false)
- GET /api/localsend/v2/info (optional)
- POST /api/localsend/v2/prepare-upload
- POST /api/localsend/v2/upload
- POST /api/localsend/v2/cancel
Behaviour copied from the official server:
- One session at a time. A second prepare-upload while one is open gets 409 "Blocked by another session".
- prepare-upload: parse and validate (400), verify claimed fingerprint vs client cert (403), ask the user, then answer. Accepted: 200 {sessionId (uuid), files:{id: token}} with a random token per file. Declined: 403. Nothing selected: 204 and no session. If the sender drops the connection while we wait, free the slot.
- upload: require sessionId, fileId and token (400 if missing); token must match, file still pending, same source IP (else 403); stream to disk; verify sha256 if provided (422 on mismatch); 200 with empty body.
- Sanitize every fileName: split on '/', reject '..' and absolute/drive paths, strip illegal Windows chars and reserved names, path.join under the target dir and confirm the result still starts with the target dir. Create parent dirs.
- PIN is optional. If none is set, skip it. 401 for missing/invalid pin, 429 after repeated failures.
Suggested default for DyIsland: show an accept/decline prompt on the island (reuse the existing approvals flow) instead of auto-accepting.

## 5. Drag detection over a click-through island
Verified:
- Electron docs: setIgnoreMouseEvents(true, {forward:true}) "forwards mouse move messages to Chromium, enabling mouse related events such as mouseleave" (macOS and Windows). It forwards MOVE messages only. The docs say nothing about drag and drop, and I found no doc, issue or source saying HTML5 dragenter/drop fires on an ignored window. Could not verify either way.
- Electron docs: on Windows forward:true stops working temporarily while an elevated window (Task Manager, installers) is the active window (UIPI).
- Our code today: main.js line 127 and 647-648 use setIgnoreMouseEvents(true,{forward:true}); pollCursor() (main.js ~line 499) already polls screen.getCursorScreenPoint() and has a 240px hot zone (HOT_W) at the docked edge.
My reasoning, NOT sourced:
- Windows OLE drag-drop needs a real hit-testable window under the cursor. A click-through window is skipped by hit-testing, so it probably will not get dragenter. Forwarded mouse moves also likely stop during an OLE drag loop, so the current mouseenter-driven capture (api.capture in app.js) will not fire mid-drag.
- Cursor polling alone only says the pointer is in the hot zone, not that a drag is happening. Electron has no API for mouse button state, so you would need a native call (GetAsyncKeyState(VK_LBUTTON) via koffi or a helper process), and even then it cannot tell a file drag from a text selection or window drag.

RECOMMENDATION (single approach): edge hot-zone window.
Create a small second frameless, transparent, alwaysOnTop BrowserWindow at the docked edge, about HOT_W (240) x 6-8 px, focusable:false, skipTaskbar, with setIgnoreMouseEvents(false) so it is a real drop target. Give it a near-invisible fill (e.g. rgba(0,0,0,0.01)) in case fully transparent pixels still hit-test through. In its page handle dragenter/dragover (preventDefault) and on dragenter send IPC to main: expand the island, switch the main island window to capture (setIgnoreMouseEvents(false)), and shrink or hide the strip so the user drops on the island itself, whose `drop` handler calls webUtils.getPathForFile. On dragleave/drop collapse and restore click-through. Cost: that thin strip steals clicks from whatever sits under it (top pixels of window title bars and tab strips), so keep it thin and add a settings toggle. No native dependency and no button-state polling. Needs testing on the real machine; I could not run it here.
Rejected: forward:true alone (no evidence it receives drops), cursor polling plus native button state (native dependency, cannot tell file drags apart), global low-level mouse hooks (heavy, antivirus noise).

## 6. webUtils.getPathForFile (we run Electron ^45.4.1)
- File.path was removed in Electron 32 (breaking-changes.md), so file.path is undefined for us.
- Call webUtils.getPathForFile(file) in the PRELOAD (docs: with context isolation on, put the call in the preload and expose it via contextBridge). Expose something like `getPathForFile: (f) => webUtils.getPathForFile(f)` in preload.js and call it from the drop handler in app.js. Whether a File passed through contextBridge still resolves is how the docs example is written, but I did not run it.
- Returns the absolute path string; throws if the argument is not a File; returns '' if the File was built in JS and is not backed by a file on disk (pasted image blob, drag from a web page). Handle '' as "no path".
- Dropped folders come back as a File with size 0 and empty type but still have a path. Detect directories in main with fs.statSync(p).isDirectory() and walk them there.
- Items with no real file on disk (zip contents in Explorer, MTP phones) give no usable path.
