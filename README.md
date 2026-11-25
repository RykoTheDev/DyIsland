# DyIsland

A Material 3 Expressive "dynamic island" for Windows. It sits at the top (or left or right) edge of your screen as a small pill, and opens into a clock and calendar, music controls, weather, a timer, Claude Code usage and sessions, clipboard history and more.

## Install

Download the latest installer from **Releases**: `DyIsland-Setup-<version>.exe` (installs to Program Files, asks for administrator approval once). A portable `DyIsland-<version>-win-x64.zip` is there too.

The build is not code-signed, so Windows SmartScreen may warn the first time: **More info > Run anyway**.

DyIsland starts with Windows (switch it off in the tray menu).

## Using it

- **Open:** click the pill (or hover, in Settings > Display). Hover the gear for quick actions.
- **Settings:** the round gear next to the open island, or the tray icon.
- **Claude Code:** Settings > Claude Code > *Copy hooks setup*, paste it into `~/.claude/settings.json`, then start a new Claude Code session. You get working/finished toasts, a sessions list, usage limits with a pace forecast, permission prompts you can answer on the island, and a click on a toast takes you to the window Claude runs in. Needs `node` on your PATH for the hooks.
- **`dyisland` command:** `dyisland notify "Deploy finished" --tone success`, or `dyisland run -- npm test` (add the install folder to PATH).
- **NextDNS switch:** Settings > NextDNS switch > *Set up* (once, asks for administrator approval) adds a tile that turns your NextDNS on and off.

## More things it does

- **Keyboard and mouse:** open it with the shortcut (Ctrl+Alt+Space) and the island takes the keyboard: arrows or 1-9 switch tabs, Space plays and pauses, Up and Down change the volume, Esc closes and gives the focus back to the app you were in. Mouse wheel over the tab bar switches tabs, on the music page it changes the volume. Middle-click the pill to play or pause, right-click to open it with the quick actions.
- **Volume on the island:** change the volume and a small bar appears. The Windows pop-up still shows as well.
- **Cover glow:** the Music tab glows with the colors of the album cover (the rest of the island keeps your theme).
- **Calendar:** paste a secret iCal (.ics) link in Settings > Home page for a Next event card, dots on the calendar and a chip when something starts within 15 minutes (click it to join the meeting).
- **Timers:** timer, repeat, pomodoro and stopwatch, three at once. Click the time to type it ("25", "7:30", "1h15m") or scroll over the ring.
- **Clipboard:** pin items, search, click to paste, and pictures. Everything beyond text in memory is opt-in (Settings > Clipboard extras).
- **Quiet during calls:** Do not disturb switches itself on while an app uses your camera or microphone.
- **Windows notifications on the island** and **Bluetooth / charger toasts** (Settings > Alerts, the notifications one is off by default).
- **Weather:** a city picker that shows the right Springfield, "Use my location", and a 5-day view (click the strip).
- **Updates:** the installed build looks for new releases on GitHub and installs them when you quit. The portable zip does not update itself.

## Develop

```powershell
npm install
npm start          # run the app
npm test           # unit and integration tests (no Electron needed)
npm run test:ui    # starts the page and the main process for real (needs Electron): taps through every tab and feature, saves screenshots to test/.build/shots
npm run pack       # build the app folder in dist/win-unpacked
npm run dist       # build the installer and zip in dist/
npm run icons      # regenerate build/icon.png and icon.ico
npm run build:theme  # rebuild vendor/dycolor.js (Material colour algorithm)
```

## Release

1. Bump `version` in `package.json` and commit.
2. `git tag v<version> && git push origin v<version>`
3. The **Release** workflow tests, builds the installer and zip, and attaches them (with SHA-256 checksums) to a GitHub release.

The **CI** workflow runs the tests and a package build on every push and pull request.

## Notes

- Windows only (it uses the Windows media session, registry and window APIs).
- Fonts: Google Sans Flex, SIL Open Font License 1.1 (`fonts/OFL.txt`).
