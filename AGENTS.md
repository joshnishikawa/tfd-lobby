# Agent & Developer Guide — TFD Game Lobby (`tfd-lobby`)

This document outlines the architecture and conventions for AI agents and developers working on the lobby shell or building game modules under `game_modules/<game-id>/`.

## 1. Self-Contained Game Modules
- Every game lives inside `game_modules/<game-id>/` with `game.json`, `game.js` (or `game.cjs`), `client.js`, and `style.css`.
- Static assets (images, SVGs, `rules.html`, audio) are served automatically at `/game_modules/<game-id>/<path>`. Never put game assets in `public/`.
- Games mount inside an isolated **Shadow DOM** (`mountRoot`). Always scope DOM queries to `container.querySelector(...)` — never use `document.getElementById` for game elements.
- Clean up sockets, timers, and listeners in `unmountClient()`.

## 2. In-Game Toolbar (`game.json` & `matchConfig.toolbar`)
Do **not** build duplicate top bars for game logos, rulebooks/manuals, zoom sliders, Save / Load State modals, or admin/dev menus. Use the lobby's shared **toolbar** (`public/js/modules/match-toolbar.js`):

- **3-Zone Layout:**
  - **Left:** `← Lobby`, `Play Again` (on game over), `#GameCode` (click-to-copy), and optional **Zoom Slider**
  - **Center:** **Game Logo** only (zero padding/margin)
  - **Right:** Optional extra **Links**, **Manual / Rules** button (opens full-screen modal with `New Tab` + `Close`), built-in **Volume / Mute** (controls `<audio>`/`AudioContext` and dispatches `tfd-audio-change`), **Language** selector (`EN`/`日本語`/`ES`, dispatches `tfd-language-change`), and far-right icon-only gear (`⚙`) **Developer Tools** dropdown (admin-only)
- **Declarative config in `game.json`:**
  ```json
  "toolbar": {
    "logo": { "src": "images/logo.png", "alt": "My Game", "invert": true },
    "manual": { "label": "Rules", "url": "rules.html", "modal": true },
    "zoom": { "min": 0.5, "max": 2, "default": 1 },
    "audio": false,
    "language": false,
    "saveLoad": false,
    "newGame": false,
    "links": []
  }
  ```
  - Always create a standalone `rules.html` (or link to an external manual URL) instead of embedding inline HTML strings in `game.json` or `client.js`.
  - Relative paths in `game.json` automatically resolve to `/game_modules/<game-id>/...`.
  - `toolbar.zoom` defaults to a working `50%–200%` slider (`min: 0.5`, `max: 2`, `step: 0.01`, `default: 1`); customize bounds or set `"zoom": false` to hide it (e.g. for 3D games with their own camera zoom like Meiji Town).
  - `toolbar.audio` (or `volume`), `toolbar.language`, `toolbar.saveLoad`, and `toolbar.newGame` are opt-in booleans (default `false`) controlling the volume/mute slider, language selector, Save / Load State modal, and New Game button.
- **Runtime API (`config.toolbar` / `window.tfdMatchToolbar`):**
  - `toolbar.configure({ logo?, manual?, links?, zoom?, saveLoad?, devTools?, forceDevTools? })` — merges with `game.json` defaults (pass `null` to hide a default).
  - `toolbar.updateZoom(value)` — syncs slider & `%` readout without rebuilding DOM.
  - `toolbar.reset()` — called automatically by `match-manager.js` on unmount.
- **Shared Save / Load Game State (`saveLoad`):**
  - Pass `saveLoad: { getState, loadState, storageKey? }` to `toolbar.configure(...)` to automatically add **Save / Load State** to the far-right gear menu.
  - The lobby provides browser-saved states, JSON Copy/Paste, and an anti-cheat hidden-state notice in `#matchStateModal` so games don't need their own Save/Load UI.
  - On the server, ensure your `loadSaveState` move sanitizes any `'HIDDEN'` fields (hands, draft packs, pending plays) if your game uses `playerView` filtering.
- **Shared Arrange Components (`arrange`):**
  - Pass `arrange: { active, title?, onToggle, spots, selectedKeys, onSelect, groups?, toggles?, onSaveDraft?, onResetDraft?, onCopyJson?, onImportJson?, onNudge?, onRotate?, onSetAngle?, onScale?, onSetScale?, onGroupRotate?, view? }` to `toolbar.configure(...)` to automatically add **Arrange Components** to the admin gear menu and render the lobby's shared floating layout toolbar (`public/js/modules/arrange-tool.js`).
  - Use `toolbar.updateArrange(nextArrange)` to push live selection/coordinate updates without rebuilding the top toolbar.

## 3. Scrollable Board / Zoom Rule (Universal)
- `.game-mount-root` is `overflow: auto`.
- Never lock a game's root container to `height: 100%; overflow: hidden;` when zoom is enabled.
- Use `min-height: 100%; height: auto; flex: 1 0 auto; overflow: visible;` and layout-aware CSS `zoom` (rather than `transform: scale()` on non-panning boards) so users can always scroll to the very bottom of the board at any zoom level.

## 4. Lobby Conventions
- **Display names:** Always resolve player names through `getActivePlayerName()` / `promptForName()` in `public/js/modules/state.js` so both guest and logged-in users can set a custom display name.
- **Orphaned match cleanup:** `cleanOrphanedMatches()` in `server.js` excludes bots (`data.isBot` or `(Bot)` suffix) when counting human players so bot-only matches are wiped automatically.
- **Deployment note:** `/usr/local/bin/tfdupdate` excludes `game_modules` on the main lobby `rsync`; built-in modules (`tic-tac-toe`, `sandbox-runner`) must be synced separately if modified in `dev.tfd/lobby`.
