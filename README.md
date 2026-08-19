# The Flying Dutchmen - Multi-Game Lobby & Platform

A modular, real-time multiplayer tabletop gaming platform powered by [boardgame.io](https://boardgame.io/), [Koa](https://koajs.com/), and WebSockets.

The lobby provides a unified matchmaking experience with plug-and-play game modules discovered dynamically at runtime.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [How the Lobby Works](#how-the-lobby-works)
  - [1. Game-First Flow (Quick Match & Catalog)](#1-game-first-flow-quick-match--catalog)
  - [2. Group-First Flow (Party Lounge)](#2-group-first-flow-party-lounge)
  - [3. Dynamic Discovery & Module Loading](#3-dynamic-discovery--module-loading)
  - [4. Real-time Match Lifecycle](#4-real-time-match-lifecycle)
- [Game Module Specification (`game_modules/`)](#game-module-specification-game_modules)
  - [Directory Structure](#directory-structure)
  - [1. `game.json` (Manifest Metadata)](#1-gamejson-manifest-metadata)
  - [2. `game.js` (Server & State Machine Logic)](#2-gamejs-server--state-machine-logic)
  - [3. `client.js` (Frontend UI & Real-Time Sync)](#3-clientjs-frontend-ui--real-time-sync)
  - [4. `style.css` (Game Stylesheet)](#4-stylecss-game-stylesheet)
- [Step-by-Step: Adding a New Game Module](#step-by-step-adding-a-new-game-module)
- [API Reference](#api-reference)
- [Development & Deployment](#development--deployment)

---

## Architecture Overview

```
tfd-lobby/
├── game_modules/          # Self-contained game packages (plug & play)
│   └── tic-tac-toe/       # Example game module
│       ├── game.json      # Metadata manifest (modes, player counts, description)
│       ├── game.js        # boardgame.io Game state definition
│       ├── client.js      # Frontend mount logic & socket event handlers
│       └── style.css      # Scoped styling for the game board
├── lib/
│   ├── game-loader.js     # Auto-discovers and validates modules in game_modules/
│   └── group-manager.js   # Manages Party Lounge rooms, members, and ready states
├── public/                # Static lobby frontend (SPA)
│   ├── css/               # Lobby layout & shared navigation styling
│   ├── js/                # Lobby client script (lobby.js) & SSO navbar script
│   └── index.html         # Main SPA entry point
├── server.js              # Koa HTTP + Socket.IO + boardgame.io server
├── ecosystem.config.js    # PM2 production configuration
└── package.json
```

---

## How the Lobby Works

The lobby provides two distinct matchmaking pathways for players:

### 1. Game-First Flow (Quick Match & Catalog)
- Players browse the catalog of installed games.
- All game options (player count and gameplay modes/variants) are listed and selected directly on each game card.
- When a player clicks **Quick Match**:
  - The system checks for an existing, unfilled table with those exact same selected options.
  - If a matching unfilled table is found, the player is automatically joined into the next open seat.
  - If no matching table exists, a new table is created automatically with the selected options and the player enters seat `0`.
- Open tables are also listed beneath each card with option badges, allowing players to view or join specific open tables manually.
- Tables communicate directly with standard `boardgame.io` match endpoints (`/games/:gameName/create`, `/games/:gameName/:id/join`, `/games/:gameName`).

### 2. Group-First Flow (Party Lounge)
- A player hosts a private lounge and receives a short room code (e.g., `FD-1042`).
- Friends join using the room code.
- The host selects the game to play.
- All members mark themselves **Ready**.
- Once all players are ready, the host clicks **Launch Game**.
- The server automatically provisions a `boardgame.io` match, assigns seat IDs to party members, and triggers all connected clients to load the game board simultaneously.

### 3. Dynamic Discovery & Module Loading
1. **Server Initialization**: `GameLoader` scans `/game_modules/*/game.json`.
2. Active games are registered with `boardgame.io/server` under their module `id`.
3. Game metadata is exposed via `GET /api/games`.
4. **Client-Side Loading**: When a match starts, `lobby.js` dynamically injects:
   - `<link rel="stylesheet" href="/game_modules/<gameId>/style.css">`
   - `<script src="/game_modules/<gameId>/client.js"></script>`
5. It then invokes `window.GameModules[<gameId>].mountClient(container, matchConfig)`.

### 4. Real-time Match Lifecycle & Play Again
- When a game is mounted, `client.js` opens a Socket.IO connection to the game's namespace: `window.location.origin + '/' + gameName`.
- The client emits `'sync'` with `matchID`, `playerID`, and `credentials`.
- State updates sent over Socket.IO (`'sync'` and `'update'`) trigger UI re-renders.
- Moves are sent via standard Socket.IO move emissions or `boardgame.io` client actions.
- **Play Again**: Players can click **Play Again** on the match top bar or post-game banner. When all members currently in the party click it, a new match is provisioned automatically with the same game options and all players transition seamlessly into the new game.

---

## Game Module Specification (`game_modules/`)

### Core Rule: 100% Self-Contained Architecture
> **Above all, games must be completely self-contained.**
> 
> - Every game module must reside entirely within its own folder: `game_modules/<game-id>/`.
> - **Never** place game-specific images, stylesheets, sounds, or data into the lobby's `public/` directory.
> - The lobby server dynamically routes and serves all static assets from within each game's folder at `/game_modules/<game-id>/[path]`.
> - Adding a new game requires zero edits or manual symlinks in the lobby's static directories.

### Directory Structure

```
game_modules/
└── <game-id>/
    ├── game.json       # [Required] Manifest and metadata
    ├── game.js         # [Required] Server-side boardgame.io Game object
    ├── client.js       # [Required] Browser UI mount function & Socket listener
    ├── style.css       # [Recommended] Board UI styling
    └── images/         # [Optional] Self-contained game images, SVGs, textures
        ├── logo.png
        └── board.svg
```

> **Note:** `<game-id>` must match the `id` field in `game.json` (lowercase, alphanumeric, and hyphens only; e.g. `tic-tac-toe`, `kred`, `connect-four`, `chess`).

### 0. Static Asset Loading Convention

Game modules can store any static assets (images, icons, sound effects, fonts) inside their own directory (e.g., `game_modules/<game-id>/images/` or `game_modules/<game-id>/public/images/`).

The lobby server automatically serves these assets at:
```
/game_modules/<game-id>/<asset-path>
```

#### Example Usage in Game Client:
```javascript
// In client.js or UI components:
const LOGO_URL = '/game_modules/kred/images/logo.png';
const TILE_URL = (id) => `/game_modules/kred/images/tiles/${id}.svg`;
```

#### Example Usage in CSS:
```css
/* In style.css: */
.kred-board {
  background-image: url('/game_modules/kred/images/board_background.png');
}
```

---

### 1. `game.json` (Manifest Metadata)

Defines game metadata, supported player counts, and optional gameplay modes.

```json
{
  "id": "tic-tac-toe",
  "name": "Tic Tac Toe",
  "description": "Classic 3x3 grid game and Ultimate 9-grid variant.",
  "playerCounts": [2],
  "minPlayers": 2,
  "maxPlayers": 2,
  "version": "1.0.0",
  "status": "active",
  "author": "The Flying Dutchmen",
  "tags": ["classic", "strategy", "quick"],
  "icon": "bi-grid-3x3",
  "modes": [
    {
      "id": "normal",
      "name": "Normal",
      "description": "Standard 3x3 grid. First to 3-in-a-row wins.",
      "isDefault": true
    },
    {
      "id": "ultimate",
      "name": "Ultimate",
      "description": "9 nested 3x3 grids. Win sub-boards to control the main board."
    }
  ]
}
```

#### Manifest Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | **Required.** Unique slug identifier (e.g. `connect-four`). |
| `name` | `string` | **Required.** Display name shown in lobby catalog & party selector. |
| `description` | `string` | Short description of rules/gameplay. |
| `playerCounts`| `number[]` | Supported player counts (e.g., `[2]`, `[2, 3, 4]`). |
| `minPlayers` | `number` | Minimum players allowed (default: `2`). |
| `maxPlayers` | `number` | Maximum players allowed (default: `2`). |
| `status` | `string` | `"active"` or `"inactive"`. Inactive games are ignored by `GameLoader`. |
| `icon` | `string` | Bootstrap Icons class name (e.g., `bi-dice-5`, `bi-grid-3x3`). |
| `tags` | `string[]` | Categories/tags for filtering. |
| `modes` | `object[]` | *(Optional)* Available game modes/variants. |
| `modes[].id` | `string` | Mode identifier passed to `setupData.mode`. |
| `modes[].name` | `string` | Display name of the mode. |
| `modes[].description` | `string` | Tooltip/subtext explaining the mode. |
| `modes[].isDefault` | `boolean` | Whether this mode is preselected. |

---

### 2. `game.js` (Server & State Machine Logic)

A CommonJS module exporting a standard [boardgame.io Game](https://boardgame.io/documentation/#/api/Game) configuration object.

```javascript
const { INVALID_MOVE } = require('boardgame.io/core');

const MyGame = {
  name: 'my-game', // Matches game.json id

  // Initialize state G. setupData contains options selected in the lobby (e.g. mode)
  setup: (ctx, setupData) => {
    const mode = (setupData && setupData.mode) || 'normal';
    return {
      mode,
      board: Array(9).fill(null),
    };
  },

  turn: {
    minMoves: 1,
    maxMoves: 1,
  },

  moves: {
    clickCell: ({ G, ctx }, cellIndex) => {
      // Validate move
      if (G.board[cellIndex] !== null) {
        return INVALID_MOVE;
      }
      // Mutate state
      G.board[cellIndex] = String(ctx.currentPlayer);
    },
  },

  // Check victory / draw condition after every move
  endIf: ({ G, ctx }) => {
    // Return { winner: '0' } or { draw: true }
  },

  ai: {
    enumerate: (G, ctx) => {
      // Optional: AI move enumeration
      return [];
    },
  },
};

module.exports = MyGame;
```

---

### 3. `client.js` (Frontend UI & Real-Time Sync)

The client script must register itself onto the global `window.GameModules` object:

```javascript
window.GameModules = window.GameModules || {};

window.GameModules['my-game'] = {
  mountClient: function(container, matchConfig) {
    // Render UI and bind Socket.io events
  }
};
```

#### `matchConfig` Object Parameter

When `mountClient(container, matchConfig)` is invoked, `matchConfig` contains:

```javascript
{
  gameName: "my-game",      // Game ID slug
  matchID: "3x9k1p0q",      // boardgame.io Match ID
  playerID: "0",            // Local player's seat index ("0", "1", ..., or null for spectator)
  credentials: "abc...",    // boardgame.io player authentication token
  playerName: "Captain",    // Display name of local player
  mode: "normal",           // Selected game mode
  setupData: { mode: "..."} // Custom setup data passed at table creation
}
```

#### Mounting and Socket Lifecycle Pattern

```javascript
function mountMyGameClient(container, config) {
  const { matchID, playerID, credentials, gameName } = config;
  let gameState = null;
  let matchData = null;

  // 1. Render initial skeleton UI into container
  container.innerHTML = `
    <div class="my-game-container">
      <div id="gameStatusBanner" class="status-banner">Connecting...</div>
      <div id="gameBoard" class="board-grid"></div>
    </div>
  `;

  // 2. Connect to boardgame.io game namespace via Socket.io
  const socket = io(`${window.location.origin}/${gameName}`);

  socket.on('connect', () => {
    // Request initial state synchronization
    socket.emit('sync', matchID, String(playerID), credentials);
  });

  socket.on('sync', (mId, syncData) => {
    if (mId === matchID && syncData && syncData.state) {
      gameState = syncData.state;
      if (syncData.matchData) matchData = syncData.matchData;
      renderBoard(gameState, matchData);
    }
  });

  socket.on('update', (mId, stateData) => {
    if (mId === matchID && stateData) {
      gameState = stateData;
      renderBoard(gameState, matchData);
    }
  });

  // 3. Dispatching moves
  function sendMove(moveName, argsArray = []) {
    socket.emit('makeMove', moveName, argsArray, matchID, String(playerID), credentials);
  }

  // 4. Render Board State Function
  function renderBoard(state, match) {
    const G = state.G;
    const ctx = state.ctx;
    const isMyTurn = String(ctx.currentPlayer) === String(playerID);

    // Update Banner & UI
    const banner = document.getElementById('gameStatusBanner');
    if (ctx.gameover) {
      banner.textContent = ctx.gameover.winner ? `Player ${ctx.gameover.winner} Wins!` : 'Draw Game!';
    } else {
      banner.textContent = isMyTurn ? 'Your Turn!' : "Waiting for opponent's turn...";
    }

    const boardEl = document.getElementById('gameBoard');
    boardEl.innerHTML = G.board.map((cell, idx) => `
      <button class="cell ${cell ? 'filled' : ''}" data-idx="${idx}" ${!isMyTurn || cell !== null ? 'disabled' : ''}>
        ${cell !== null ? cell : ''}
      </button>
    `).join('');

    boardEl.querySelectorAll('.cell').forEach(btn => {
      btn.onclick = () => sendMove('clickCell', [parseInt(btn.dataset.idx, 10)]);
    });
  }
}

// Register with global GameModules
window.GameModules = window.GameModules || {};
window.GameModules['my-game'] = {
  mountClient: mountMyGameClient
};
```

---

### 4. `style.css` (Game Stylesheet)

Custom styles loaded specifically when a match of this game begins.

- **Best Practice**: Prefix all CSS classes with a game-specific prefix (e.g. `.ttt-`, `.c4-`, `.chess-`) to prevent collisions with the lobby shell.
- Use CSS variables defined in the lobby design system when possible:
  - `--bg-primary`, `--bg-card`, `--gold-primary`, `--gold-light`, `--text-primary`, `--text-muted`, `--border-color`, `--radius-md`.

---

## Step-by-Step: Adding a New Game Module

1. **Create the directory**:
   ```bash
   mkdir -p game_modules/connect-four
   ```
2. **Add `game.json`**:
   ```json
   {
     "id": "connect-four",
     "name": "Connect Four",
     "description": "Drop discs to connect 4 in a row horizontally, vertically, or diagonally.",
     "playerCounts": [2],
     "minPlayers": 2,
     "maxPlayers": 2,
     "status": "active",
     "icon": "bi-grid"
   }
   ```
3. **Implement state & rules in `game.js`** using `boardgame.io`.
4. **Implement UI & socket listeners in `client.js`** and register `window.GameModules['connect-four']`.
5. **Add visuals in `style.css`**.
6. **Restart or reload the server**:
   ```bash
   npm start
   # or with PM2:
   pm2 restart tfd-lobby
   ```
7. Refresh your browser; the new game will immediately appear in the **Catalog** and the **Party Lounge** game selection!

---

## API Reference

### System & Discovery
- `GET /api/health` — Service health, active game count, and uptime timestamp.
- `GET /api/games` — Dynamic metadata list of all active games in `game_modules/`.

### Party Lounge & Match Coordination
- `POST /api/groups/create` — Create a new party lounge room `{ hostName, hostUserId, hostAvatar }`.
- `GET /api/groups/:code` — Fetch state and member roster for party code (e.g. `FD-1042`).
- `POST /api/groups/:code/join` — Join party `{ memberName, userId, avatar }`.
- `POST /api/groups/:code/leave` — Leave party `{ memberId }`.
- `POST /api/groups/:code/select-game` — Change selected game (Host only) `{ memberId, gameId }`.
- `POST /api/groups/:code/ready` — Toggle ready state `{ memberId, isReady }`.
- `POST /api/groups/:code/launch` — Launch synchronized match `{ memberId, matchId }`.
- `POST /api/groups/sync-match` — Link active match to party room for Play Again coordination.
- `POST /api/groups/:code/play-again` — Vote to Play Again; auto-provisions a new match when all members agree.

### Static Assets
- `GET /game_modules/:gameId/*` — Dynamically serves any game module asset (`client.js`, `style.css`, `game.json`, images, SVGs, audio, etc.) from `game_modules/<gameId>/`.

---

## Development & Deployment

### Local Development
```bash
# Install dependencies
npm install

# Run with nodemon auto-restart
npm run dev

# Or run directly with Node
npm start
```
Default local port: `http://localhost:4002`

### Production Deployment
The lobby is configured to run via PM2 using `ecosystem.config.js`:
```bash
pm2 start ecosystem.config.js
pm2 logs tfd-lobby
pm2 restart tfd-lobby
```
