/**
 * The Flying Dutchmen - Match Lifecycle, Game Mounting & Rematch Manager
 */

import { state, el, escapeHtml, showToast } from './state.js';
import { t } from './i18n.js';

let switchFlowHandler = null;
let leaveGroupHandler = null;
let partyPollingHandler = null;

const trackedAudioContexts = new Set();
const trackedAudioElements = new Set();
const gameWindowListeners = [];
const gameIntervals = new Set();
let hasMountedGame = false;

const origWindowAddEventListener = window.addEventListener.bind(window);
const origWindowRemoveEventListener = window.removeEventListener.bind(window);
const origSetInterval = window.setInterval.bind(window);
const origClearInterval = window.clearInterval.bind(window);

(function installGameSandboxHooks() {
  // 1. Intercept Web Audio API (AudioContext / webkitAudioContext)
  ['AudioContext', 'webkitAudioContext'].forEach((ctxName) => {
    const OrigAudioContext = window[ctxName];
    if (!OrigAudioContext || OrigAudioContext.__tfdWrapped) return;

    const WrappedAudioContext = function (...args) {
      const ctx = new OrigAudioContext(...args);
      trackedAudioContexts.add(ctx);

      const origSuspend = ctx.suspend.bind(ctx);
      const origResume = ctx.resume.bind(ctx);
      ctx.__tfdOrigSuspend = origSuspend;
      ctx.__tfdOrigResume = origResume;

      ctx.resume = function () {
        if (!document.body.classList.contains('in-game')) {
          return origSuspend().catch(() => {});
        }
        return origResume();
      };

      ['createOscillator', 'createBufferSource'].forEach((method) => {
        if (typeof ctx[method] !== 'function') return;
        const origCreate = ctx[method].bind(ctx);
        ctx[method] = function (...createArgs) {
          const node = origCreate(...createArgs);
          const origStart = node.start.bind(node);
          node.start = function (...startArgs) {
            if (!document.body.classList.contains('in-game')) {
              origSuspend().catch(() => {});
              return;
            }
            return origStart(...startArgs);
          };
          return node;
        };
      });

      if (!document.body.classList.contains('in-game')) {
        origSuspend().catch(() => {});
      }
      return ctx;
    };

    WrappedAudioContext.prototype = OrigAudioContext.prototype;
    Object.setPrototypeOf(WrappedAudioContext, OrigAudioContext);
    WrappedAudioContext.__tfdWrapped = true;
    window[ctxName] = WrappedAudioContext;
  });

  // 2. Intercept HTMLMediaElement.prototype.play (<audio>, <video>, new Audio())
  if (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && !HTMLMediaElement.prototype.__tfdWrapped) {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      trackedAudioElements.add(this);
      if (!document.body.classList.contains('in-game')) {
        try { this.pause(); } catch (e) {}
        return Promise.resolve();
      }
      return origPlay.apply(this, args);
    };
    HTMLMediaElement.prototype.__tfdWrapped = true;
  }

  // 3. Track & guard window event listeners registered by game modules
  if (!window.addEventListener.__tfdWrapped) {
    const lobbyEventTypes = new Set(['tfd-language-change', 'languageChanged', 'tfd-auth-change', 'DOMContentLoaded']);
    window.addEventListener = function (type, listener, options) {
      if (!hasMountedGame || lobbyEventTypes.has(type) || typeof listener !== 'function') {
        return origWindowAddEventListener(type, listener, options);
      }
      const wrappedListener = function (event, ...rest) {
        if (!document.body.classList.contains('in-game')) return;
        if (event && event.target && typeof event.target.closest === 'function' && event.target.closest('.match-nav-actions')) {
          return;
        }
        return listener.call(this, event, ...rest);
      };
      gameWindowListeners.push({ type, listener: wrappedListener, origListener: listener, options });
      return origWindowAddEventListener(type, wrappedListener, options);
    };
    window.addEventListener.__tfdWrapped = true;

    window.removeEventListener = function (type, listener, options) {
      for (let i = gameWindowListeners.length - 1; i >= 0; i--) {
        const entry = gameWindowListeners[i];
        if (entry.type === type && (entry.origListener === listener || entry.listener === listener)) {
          gameWindowListeners.splice(i, 1);
          return origWindowRemoveEventListener(type, entry.listener, entry.options);
        }
      }
      return origWindowRemoveEventListener(type, listener, options);
    };
  }

  // 4. Track & guard setInterval timers created by game modules
  if (!window.setInterval.__tfdWrapped) {
    window.setInterval = function (fn, delay, ...args) {
      if (!hasMountedGame || typeof fn !== 'function') {
        return origSetInterval(fn, delay, ...args);
      }
      const id = origSetInterval((...cbArgs) => {
        if (id === state.partyPollTimer || id === state.tablesPollTimer) {
          return fn(...cbArgs);
        }
        if (!document.body.classList.contains('in-game')) {
          origClearInterval(id);
          gameIntervals.delete(id);
          return;
        }
        return fn(...cbArgs);
      }, delay, ...args);
      gameIntervals.add(id);
      return id;
    };
    window.setInterval.__tfdWrapped = true;

    window.clearInterval = function (id) {
      gameIntervals.delete(id);
      return origClearInterval(id);
    };
  }
})();

/**
 * Stop all active game audio, timers, sockets, and unmount game client UI
 */
export function unmountGameClient() {
  // 1. Pause/stop any active game simulation before calling module unmount
  if (window.game) {
    try {
      if (window.game.simulation) {
        if (typeof window.game.simulation.pause === 'function') window.game.simulation.pause();
        if (typeof window.game.simulation.stop === 'function') window.game.simulation.stop();
        if (window.game.simulation.time && typeof window.game.simulation.time.pause === 'function') {
          window.game.simulation.time.pause();
        }
      }
      if (typeof window.game.pauseSimulation === 'function') window.game.pauseSimulation();
    } catch (e) {}
  }

  // 2. Invoke unmountClient on registered game modules
  if (window.GameModules && typeof window.GameModules === 'object') {
    const seen = new Set();
    Object.values(window.GameModules).forEach((mod) => {
      if (mod && !seen.has(mod) && typeof mod.unmountClient === 'function') {
        seen.add(mod);
        try { mod.unmountClient(); } catch (e) {}
      }
    });
  }

  // 3. Stop boardgame.io client, sockets, and polling timers
  if (state.boardgameClient) {
    try { state.boardgameClient.stop(); } catch (e) {}
    state.boardgameClient = null;
  }
  ['__currentTTTSocket', '__currentMeijiSocket'].forEach((key) => {
    if (window[key]) {
      try { window[key].disconnect(); } catch (e) {}
      window[key] = null;
    }
  });
  ['__currentTTTPoll', '__meijiAutoSaveTimer'].forEach((key) => {
    if (window[key]) {
      origClearInterval(window[key]);
      window[key] = null;
    }
  });

  // 4. Clear any remaining game intervals (preserving lobby pollers)
  gameIntervals.forEach((id) => {
    if (id !== state.partyPollTimer && id !== state.tablesPollTimer) {
      origClearInterval(id);
      gameIntervals.delete(id);
    }
  });

  // 5. Remove window event listeners registered by the game
  while (gameWindowListeners.length > 0) {
    const entry = gameWindowListeners.pop();
    try { origWindowRemoveEventListener(entry.type, entry.listener, entry.options); } catch (e) {}
  }

  // 6. Pause and reset all HTML5 audio/video elements (including inside Shadow DOM)
  const container = el('boardMountContainer');
  if (container) {
    const shadowHost = container.querySelector('.game-shadow-host');
    const roots = [container, shadowHost && shadowHost.shadowRoot].filter(Boolean);
    roots.forEach((root) => {
      try {
        root.querySelectorAll('audio, video').forEach((media) => trackedAudioElements.add(media));
      } catch (e) {}
    });
  }
  trackedAudioElements.forEach((media) => {
    try {
      media.pause();
      media.currentTime = 0;
    } catch (e) {}
  });

  // 7. Suspend all Web Audio contexts and cancel any speech synthesis
  trackedAudioContexts.forEach((ctx) => {
    if (ctx && ctx.state !== 'closed') {
      const suspendFn = ctx.__tfdOrigSuspend || ctx.suspend.bind(ctx);
      try { suspendFn().catch(() => {}); } catch (e) {}
    }
  });
  if (typeof window.speechSynthesis !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  // 8. Clear board mount container DOM
  if (container) {
    container.innerHTML = '';
  }
}

/**
 * Register callbacks to avoid circular dependencies
 */
export function registerMatchCallbacks({ switchFlow, leaveGroup, startPartyPolling }) {
  if (switchFlow) switchFlowHandler = switchFlow;
  if (leaveGroup) leaveGroupHandler = leaveGroup;
  if (startPartyPolling) partyPollingHandler = startPartyPolling;
}

/**
 * Enter active match and mount the game board
 * @param {object} matchConfig 
 */
export function enterMatch(matchConfig) {
  unmountGameClient();
  state.activeMatch = matchConfig;
  state.isMatchOver = false;
  const matchIdStr = matchConfig.matchID || matchConfig.matchId || '';
  try {
    localStorage.setItem('tfd_active_match', JSON.stringify(matchConfig));
    if (matchIdStr) {
      localStorage.setItem(`tfd_creds_${matchIdStr}`, JSON.stringify(matchConfig));
    }
  } catch (e) {}

  document.body.classList.add('in-game');
  trackedAudioContexts.forEach((ctx) => {
    if (ctx && ctx.state === 'suspended') {
      try { ctx.resume().catch(() => {}); } catch (e) {}
    }
  });
  const viewGame = el('viewGameFirst');
  const viewGroup = el('viewGroupFirst');
  const viewBoard = el('viewMatchBoard');

  if (viewGame) {
    viewGame.classList.remove('active');
    viewGame.classList.add('hidden');
  }
  if (viewGroup) {
    viewGroup.classList.remove('active');
    viewGroup.classList.add('hidden');
  }
  if (viewBoard) {
    viewBoard.classList.remove('hidden');
  }
  console.log(`[Match] Active match loaded: game="${matchConfig.gameName}", matchID="${matchIdStr}", playerID="${matchConfig.playerID}"`);

  // Sync match party & update Play Again button
  syncMatchParty(matchConfig);
  updatePlayAgainButton();

  checkActiveMatchBanner();
  mountGameClient(matchConfig);
}

/**
 * Exit full-screen match board and return to lobby
 */
export function exitToLobby() {
  document.body.classList.remove('in-game');
  unmountGameClient();
  if (state.currentParty && state.currentParty.code && state.currentParty.code.startsWith('M-')) {
    if (typeof leaveGroupHandler === 'function') {
      leaveGroupHandler();
    }
  }
  updatePlayAgainButton();
  const viewBoard = el('viewMatchBoard');
  if (viewBoard) viewBoard.classList.add('hidden');

  const targetFlow = state.currentParty && !state.currentParty.code.startsWith('M-') ? 'group' : (state.activeFlow || 'game');
  if (typeof switchFlowHandler === 'function') {
    switchFlowHandler(targetFlow);
  }
  checkActiveMatchBanner();
  if (typeof window.refreshTables === 'function') {
    window.refreshTables();
  }
}

/**
 * Check if there is a saved active match and display resume banner
 */
export function checkActiveMatchBanner() {
  const banner = el('activeMatchBanner');
  if (!banner) return;

  let activeMatch = state.activeMatch;
  if (!activeMatch) {
    try {
      const saved = localStorage.getItem('tfd_active_match');
      if (saved) activeMatch = JSON.parse(saved);
    } catch (e) {}
  }

  if (activeMatch && !document.body.classList.contains('in-game')) {
    const game = state.games.find(g => g.id === activeMatch.gameName);
    const gameTitle = game ? game.name : activeMatch.gameName;
    const matchIdVal = activeMatch.matchID || activeMatch.matchId || '';
    const matchShortId = matchIdVal ? matchIdVal.substring(0, 8) : '000';

    banner.innerHTML = `
      <div class="active-match-info">
        <span class="active-match-pulse"></span>
        <span>${escapeHtml(t('match.activeMatchBanner', { game: gameTitle, matchId: matchShortId }))}</span>
      </div>
      <div class="active-match-actions">
        <button class="btn-gold btn-sm active-banner-btn" onclick="resumeActiveMatch()">
          <i class="bi bi-play-fill"></i> ${escapeHtml(t('match.resumeMatch'))}
        </button>
        <button class="btn-secondary btn-sm active-banner-btn" onclick="abandonActiveMatch()">
          <i class="bi bi-x-lg"></i> ${escapeHtml(t('match.abandonMatch'))}
        </button>
      </div>
    `;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/**
 * Resume active match from banner
 */
export function resumeActiveMatch(targetGameId, targetMatchId) {
  let activeMatch = state.activeMatch;
  if (!activeMatch) {
    try {
      const saved = localStorage.getItem('tfd_active_match');
      if (saved) activeMatch = JSON.parse(saved);
    } catch (e) {}
  }
  
  if (activeMatch && (!targetMatchId || activeMatch.matchID === targetMatchId || activeMatch.matchId === targetMatchId)) {
    enterMatch(activeMatch);
    return;
  }

  // If we have saved credentials for target match
  if (targetMatchId) {
    try {
      const credsKey = `tfd_creds_${targetMatchId}`;
      const savedCreds = localStorage.getItem(credsKey);
      if (savedCreds) {
        const parsed = JSON.parse(savedCreds);
        enterMatch(parsed);
        return;
      }
    } catch (e) {}
  }

  if (activeMatch) {
    enterMatch(activeMatch);
  } else {
    showToast('No active match credentials found to resume.', 'warning');
  }
}

/**
 * Abandon and clear active match
 */
export async function abandonActiveMatch() {
  let activeMatch = state.activeMatch;
  if (!activeMatch) {
    try {
      const saved = localStorage.getItem('tfd_active_match');
      if (saved) activeMatch = JSON.parse(saved);
    } catch (e) {}
  }

  // Immediately silence audio and unmount active game client before async network calls
  document.body.classList.remove('in-game');
  unmountGameClient();

  if (activeMatch) {
    const gameName = activeMatch.gameName || activeMatch.gameId;
    const matchID = activeMatch.matchID || activeMatch.matchId;
    const playerID = activeMatch.playerID !== undefined ? String(activeMatch.playerID) : null;
    const credentials = activeMatch.credentials;

    // Send leave request to boardgame.io server
    if (gameName && matchID && playerID !== null && credentials) {
      try {
        await fetch(`/games/${gameName}/${matchID}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerID,
            credentials
          })
        });
      } catch (err) {
        console.warn('[MATCH-ABANDON] Failed to send leave request to server:', err.message);
      }
    }
  }

  // Leave match party room if currently in a match-synced group
  if (state.currentParty && state.currentParty.code && state.currentParty.code.startsWith('M-')) {
    try {
      const code = state.currentParty.code;
      const memberId = state.currentMember ? state.currentMember.id : null;
      if (code && memberId) {
        await fetch(`/api/groups/${code}/leave`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId })
        });
      }
    } catch (e) {}
    state.currentParty = null;
    state.currentMember = null;
    try { sessionStorage.removeItem('tfd_party_code'); } catch (e) {}
  }

  state.activeMatch = null;
  state.isMatchOver = false;
  try {
    localStorage.removeItem('tfd_active_match');
  } catch (e) {}

  const viewBoard = el('viewMatchBoard');
  if (viewBoard) viewBoard.classList.add('hidden');

  const targetFlow = state.currentParty && !state.currentParty.code.startsWith('M-') ? 'group' : (state.activeFlow || 'game');
  if (typeof switchFlowHandler === 'function') {
    switchFlowHandler(targetFlow);
  }

  checkActiveMatchBanner();
  if (typeof window.refreshTables === 'function') {
    window.refreshTables();
  }
  showToast('Left active match.', 'info');
}

/**
 * Dynamically load game client assets and mount client onto board container
 * @param {object} matchConfig 
 */
export function mountGameClient(matchConfig) {
  const gameName = (matchConfig.gameName || (state.games[0] ? state.games[0].id : '')).toLowerCase();
  const container = el('boardMountContainer');
  if (!container || !gameName) return;
  hasMountedGame = true;
  container.innerHTML = '';

  // Create isolated Shadow DOM host
  const shadowHost = document.createElement('div');
  shadowHost.className = 'game-shadow-host';
  shadowHost.style.cssText = 'width: 100%; height: 100%; display: flex; flex-direction: column;';
  container.appendChild(shadowHost);

  const shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // 1. Reset all inherited CSS and theme properties from parent document
  const resetStyle = document.createElement('style');
  resetStyle.textContent = `
    :host {
      all: initial;
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
  `;
  shadowRoot.appendChild(resetStyle);

  // 2. Load Bootstrap Icons inside the Shadow DOM for game icon support
  const iconStyle = document.createElement('link');
  iconStyle.rel = 'stylesheet';
  iconStyle.href = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css';
  shadowRoot.appendChild(iconStyle);

  // 3. Load game-specific stylesheet strictly inside the Shadow DOM
  const gameStyle = document.createElement('link');
  gameStyle.rel = 'stylesheet';
  gameStyle.href = `/game_modules/${gameName}/style.css`;
  shadowRoot.appendChild(gameStyle);

  // 4. Create internal mount point for the game client
  const mountRoot = document.createElement('div');
  mountRoot.className = 'game-mount-root';
  mountRoot.style.cssText = 'width: 100%; height: 100%; display: flex; flex-direction: column;';
  shadowRoot.appendChild(mountRoot);

  const doMount = () => {
    if (window.GameModules && window.GameModules[gameName] && typeof window.GameModules[gameName].mountClient === 'function') {
      window.GameModules[gameName].mountClient(mountRoot, matchConfig);
      return true;
    }
    return false;
  };

  if (!doMount()) {
    const scriptId = `script_game_${gameName}`;
    let script = document.getElementById(scriptId);
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.src = `/game_modules/${gameName}/client.js`;
      document.head.appendChild(script);
    }
    const onScriptLoaded = () => {
      if (!doMount()) {
        renderDefaultGamePlaceholder(mountRoot, matchConfig);
      }
    };
    script.onload = onScriptLoaded;
    script.onerror = onScriptLoaded;
  }
}

/**
 * Fallback game board placeholder UI
 */
export function renderDefaultGamePlaceholder(container, matchConfig) {
  container.innerHTML = `
    <div class="empty-state">
      <i class="bi bi-dice-5-fill"></i>
      <h3>${escapeHtml(matchConfig.gameName)} in progress</h3>
      <p>Match ID: ${matchConfig.matchID} | You are Player ${parseInt(matchConfig.playerID, 10) + 1}</p>
    </div>
  `;
}

/**
 * Sync match with party group for Play Again coordination
 * @param {object} [matchConfig]
 */
export async function syncMatchParty(matchConfig) {
  // If already attached to an active party session, preserve the room across matches
  if (state.currentParty && state.currentMember) return;

  const cfg = matchConfig || state.activeMatch;
  if (!cfg) return;
  const matchId = cfg.matchID || cfg.matchId;
  const gameId = cfg.gameName || cfg.gameId || 'tic-tac-toe';
  const playerSeat = cfg.playerID !== undefined ? String(cfg.playerID) : '0';
  const memberName = cfg.playerName || (state.currentUser ? state.currentUser.username : `Player ${parseInt(playerSeat, 10) + 1}`);
  const mode = cfg.mode || (cfg.setupData && cfg.setupData.mode) || 'normal';

  if (!matchId) return;

  try {
    const res = await fetch('/api/groups/sync-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchId,
        memberName,
        userId: state.currentUser ? state.currentUser.id : null,
        avatar: state.currentUser ? state.currentUser.avatar : null,
        gameId,
        setupData: cfg.setupData || { mode },
        playerSeat
      })
    });
    if (res.ok) {
      const data = await res.json();
      state.currentParty = data.group;
      state.currentMember = data.member;
      if (typeof partyPollingHandler === 'function') {
        partyPollingHandler();
      }
      updatePlayAgainButton();
    }
  } catch (e) {
    console.warn('[MATCH-SYNC] Could not sync match group:', e.message);
  }
}

/**
 * Handle Play Again / Rematch coordination
 */
export async function handlePlayAgain() {
  if (!state.currentParty || !state.currentMember) {
    const active = state.activeMatch || (localStorage.getItem('tfd_active_match') ? JSON.parse(localStorage.getItem('tfd_active_match')) : null);
    if (active) {
      await syncMatchParty(active);
    }
  }

  if (!state.currentParty || !state.currentMember) {
    // Direct rematch fallback if party API is unreachable
    const active = state.activeMatch || (localStorage.getItem('tfd_active_match') ? JSON.parse(localStorage.getItem('tfd_active_match')) : null);
    if (active) {
      showToast('Starting a new match...', 'info');
      await createDirectRematch(active);
      return;
    }
    showToast('Cannot request rematch: no active match data.', 'warning');
    return;
  }

  try {
    const res = await fetch(`/api/groups/${state.currentParty.code}/play-again`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: state.currentMember.id,
        isPlayAgain: true
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.group) {
        state.currentParty = data.group;
        updatePlayAgainButton();

        const members = data.group.members || [];
        const voted = members.filter(m => m.playAgain).length;
        const total = members.length;

        // If all active players voted
        if (data.allPlayAgain || (total > 0 && voted >= total)) {
          if (data.group.matchId && state.activeMatch && data.group.matchId !== state.activeMatch.matchID) {
            showToast('All players ready! Starting new game...', 'success');
            await transitionToNewMatch(data.group);
          } else {
            // Provision new match and launch
            showToast('Everyone voted! Launching new game...', 'success');
            const gameId = data.group.selectedGameId || (state.activeMatch && state.activeMatch.gameName) || 'tic-tac-toe';
            const numPlayers = Math.max(members.length, 2);
            const setupData = data.group.setupData || (state.activeMatch && state.activeMatch.setupData) || { mode: 'normal' };

            try {
              const createRes = await fetch(`/games/${gameId}/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ numPlayers, setupData })
              });
              if (createRes.ok) {
                const createData = await createRes.json();
                const launchRes = await fetch(`/api/groups/${data.group.code}/launch`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    memberId: state.currentMember.id,
                    matchId: createData.matchID,
                    isPlayAgain: true
                  })
                });
                const launchData = launchRes.ok ? await launchRes.json() : null;
                await transitionToNewMatch((launchData && launchData.group) || { ...data.group, matchId: createData.matchID });
              }
            } catch (createErr) {
              console.error('[PLAY AGAIN] Error creating match on client:', createErr.message);
            }
          }
        } else {
          showToast(`Play Again requested (${voted}/${total} players ready)`, 'info');
        }
      }
    } else {
      // If server process hasn't reloaded the route or group expired, fallback to direct table launch
      const active = state.activeMatch || (localStorage.getItem('tfd_active_match') ? JSON.parse(localStorage.getItem('tfd_active_match')) : null);
      if (active) {
        showToast('Restarting match...', 'info');
        await createDirectRematch(active);
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    const active = state.activeMatch || (localStorage.getItem('tfd_active_match') ? JSON.parse(localStorage.getItem('tfd_active_match')) : null);
    if (active) {
      showToast('Restarting match...', 'info');
      await createDirectRematch(active);
      return;
    }
    showToast('Play again error: ' + err.message, 'error');
  }
}

/**
 * Direct rematch creation fallback (alternates first-player turn for 2 players)
 * @param {object} active 
 */
export async function createDirectRematch(active) {
  const gameId = active.gameName || 'tic-tac-toe';
  const mode = active.mode || (active.setupData && active.setupData.mode) || 'normal';
  const numPlayers = 2;
  const playerName = active.playerName || (state.currentUser ? state.currentUser.username : 'Player 1');
  const prevSeat = active.playerID !== undefined ? String(active.playerID) : '0';
  const nextSeat = prevSeat === '0' ? '1' : '0';

  try {
    const createRes = await fetch(`/games/${gameId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numPlayers,
        setupData: { mode }
      })
    });
    if (!createRes.ok) throw new Error('Failed to create match');
    const createData = await createRes.json();

    const joinRes = await fetch(`/games/${gameId}/${createData.matchID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: nextSeat,
        playerName
      })
    });
    const joinData = await joinRes.json();

    enterMatch({
      gameName: gameId,
      matchID: createData.matchID,
      playerID: nextSeat,
      credentials: joinData.playerCredentials,
      playerName,
      mode
    });
  } catch (err) {
    showToast('Rematch error: ' + err.message, 'error');
  }
}

/**
 * Update the state and label of the Play Again button
 */
export function updatePlayAgainButton() {
  const btn = el('btnPlayAgain');
  const label = el('playAgainLabel');
  if (!btn || !label) return;

  // Only visible when there is NOT an active game (i.e. match has finished)
  if (!state.isMatchOver || !document.body.classList.contains('in-game')) {
    btn.classList.add('hidden');
    return;
  }

  btn.classList.remove('hidden');
  const members = (state.currentParty && state.currentParty.members) || [];
  const votedCount = members.filter(m => m.playAgain).length;
  const totalCount = Math.max(members.length, 1);
  const myMember = members.find(m => state.currentMember && m.id === state.currentMember.id);
  const iVoted = myMember && myMember.playAgain;

  if (iVoted) {
    btn.classList.add('voted');
    label.textContent = totalCount > 1 && votedCount < totalCount ?
      `${t('party.ready')} (${votedCount}/${totalCount})` :
      `${t('party.ready')} (${votedCount}/${totalCount})`;
  } else {
    btn.classList.remove('voted');
    label.textContent = votedCount > 0 ? `${t('match.playAgain')} (${votedCount}/${totalCount})` : t('match.playAgain');
  }
}

/**
 * Transition current party into a newly launched match
 * @param {object} group 
 */
export async function transitionToNewMatch(group) {
  if (!group || !group.matchId || !state.currentMember) return;
  state.currentParty = group;

  // For 2-player rematches, alternate from the player's seat in the previous match
  let playerID = '0';
  if (state.activeMatch && state.activeMatch.playerID !== undefined) {
    const prevSeat = String(state.activeMatch.playerID);
    playerID = prevSeat === '0' ? '1' : '0';
  } else if (group && group.members && state.currentMember) {
    const myIndex = group.members.findIndex(m => m.id === state.currentMember.id);
    playerID = String(myIndex >= 0 ? myIndex : (state.currentMember.playerSeat || '0'));
  }

  const gameId = group.selectedGameId || (state.activeMatch && state.activeMatch.gameName) || 'tic-tac-toe';
  const playerName = state.currentMember ? state.currentMember.name : (state.currentUser ? state.currentUser.username : `Player ${parseInt(playerID, 10) + 1}`);
  const mode = (group.setupData && group.setupData.mode) || (state.activeMatch && state.activeMatch.mode) || 'normal';

  try {
    let joinRes = await fetch(`/games/${gameId}/${group.matchId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID,
        playerName
      })
    });

    let assignedSeat = playerID;
    let credentials = '';

    if (joinRes.ok) {
      const joinData = await joinRes.json();
      credentials = joinData.playerCredentials;
      assignedSeat = joinData.playerID !== undefined ? String(joinData.playerID) : playerID;
    } else if (joinRes.status === 409) {
      if (state.activeMatch && state.activeMatch.matchID === group.matchId && state.activeMatch.credentials) {
        credentials = state.activeMatch.credentials;
        assignedSeat = state.activeMatch.playerID;
      } else {
        // Seat already claimed -> claim opposite seat
        const altSeat = playerID === '0' ? '1' : '0';
        const retryRes = await fetch(`/games/${gameId}/${group.matchId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerID: altSeat, playerName })
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          credentials = retryData.playerCredentials;
          assignedSeat = retryData.playerID !== undefined ? String(retryData.playerID) : altSeat;
        }
      }
    }

    showToast('Starting new match!', 'success');
    enterMatch({
      gameName: gameId,
      matchID: group.matchId,
      playerID: assignedSeat,
      credentials,
      playerName,
      mode
    });
    updatePlayAgainButton();
  } catch (err) {
    console.error('[PLAY AGAIN] Transition error:', err.message);
  }
}
