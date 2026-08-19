/**
 * The Flying Dutchmen - Match Lifecycle, Game Mounting & Rematch Manager
 */

import { state, el, escapeHtml, showToast } from './state.js';
import { t } from './i18n.js';

let switchFlowHandler = null;
let leaveGroupHandler = null;
let partyPollingHandler = null;

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
  state.activeMatch = matchConfig;
  state.isMatchOver = false;
  try {
    localStorage.setItem('tfd_active_match', JSON.stringify(matchConfig));
  } catch (e) {}

  document.body.classList.add('in-game');
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

  const matchIdStr = matchConfig.matchID || matchConfig.matchId || '';
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
  if (state.boardgameClient) {
    try { state.boardgameClient.stop(); } catch (e) {}
    state.boardgameClient = null;
  }
  if (window.__currentTTTSocket) {
    try { window.__currentTTTSocket.disconnect(); } catch (e) {}
    window.__currentTTTSocket = null;
  }
  if (window.__currentTTTPoll) {
    clearInterval(window.__currentTTTPoll);
    window.__currentTTTPoll = null;
  }
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
export function resumeActiveMatch() {
  let activeMatch = state.activeMatch;
  if (!activeMatch) {
    try {
      const saved = localStorage.getItem('tfd_active_match');
      if (saved) activeMatch = JSON.parse(saved);
    } catch (e) {}
  }
  if (activeMatch) {
    enterMatch(activeMatch);
  } else {
    showToast('No active match found to resume.', 'warning');
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

  // Stop client / socket / polling
  if (state.boardgameClient) {
    try { state.boardgameClient.stop(); } catch (e) {}
    state.boardgameClient = null;
  }
  if (window.__currentTTTSocket) {
    try { window.__currentTTTSocket.disconnect(); } catch (e) {}
    window.__currentTTTSocket = null;
  }
  if (window.__currentTTTPoll) {
    clearInterval(window.__currentTTTPoll);
    window.__currentTTTPoll = null;
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

  document.body.classList.remove('in-game');
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
  container.innerHTML = '';

  // Dynamically load game stylesheet if not already present
  const styleId = `style_game_${gameName}`;
  if (!document.getElementById(styleId)) {
    const link = document.createElement('link');
    link.id = styleId;
    link.rel = 'stylesheet';
    link.href = `/game_modules/${gameName}/style.css`;
    document.head.appendChild(link);
  }

  const doMount = () => {
    if (window.GameModules && window.GameModules[gameName] && typeof window.GameModules[gameName].mountClient === 'function') {
      window.GameModules[gameName].mountClient(container, matchConfig);
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
        renderDefaultGamePlaceholder(container, matchConfig);
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
                    matchId: createData.matchID
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
 * Direct rematch creation fallback
 * @param {object} active 
 */
export async function createDirectRematch(active) {
  const gameId = active.gameName || 'tic-tac-toe';
  const mode = active.mode || (active.setupData && active.setupData.mode) || 'normal';
  const numPlayers = 2;
  const playerName = active.playerName || (state.currentUser ? state.currentUser.username : 'Player 1');

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
        playerID: '0',
        playerName
      })
    });
    const joinData = await joinRes.json();

    enterMatch({
      gameName: gameId,
      matchID: createData.matchID,
      playerID: '0',
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

  const myIndex = group.members.findIndex(m => m.id === state.currentMember.id);
  const playerID = String(myIndex >= 0 ? myIndex : (state.currentMember.playerSeat || '0'));
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
        // Seat was taken -> auto-claim the first available seat
        const retryRes = await fetch(`/games/${gameId}/${group.matchId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerName })
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          credentials = retryData.playerCredentials;
          assignedSeat = retryData.playerID !== undefined ? String(retryData.playerID) : playerID;
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
