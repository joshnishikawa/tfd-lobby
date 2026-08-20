/**
 * The Flying Dutchmen - Games Catalog & Quick Match Flow
 */

import { state, el, escapeHtml, promptForName, showToast, isUserAdmin } from './state.js';
import { refreshTables } from './tables-modals.js';
import { enterMatch, abandonActiveMatch } from './match-manager.js';
import { t } from './i18n.js';

/**
 * Load list of available games from the backend
 * @param {boolean | null} [isAdmin]
 */
export async function loadGamesCatalog(isAdmin = null) {
  try {
    const userIsAdmin = isAdmin !== null ? Boolean(isAdmin) : isUserAdmin(state.currentUser);
    const url = userIsAdmin ? '/api/games?admin=true' : '/api/games';
    const res = await fetch(url);
    const data = await res.json();
    state.games = data.games || [];
    if (!state.selectedGameId || !state.games.some(g => g.id === state.selectedGameId)) {
      state.selectedGameId = state.games.length > 0 ? state.games[0].id : null;
    }
    renderGamesCatalog();
  } catch (err) {
    showToast('Failed to load games catalog', 'error');
  }
}

/**
 * Select a specific game mode for a game
 * @param {string} gameId 
 * @param {string} modeId 
 */
export function selectGameMode(gameId, modeId) {
  state.selectedGameMode[gameId] = modeId;
  const game = state.games.find(g => g.id === gameId);
  const modes = (game && game.modes) || [];
  modes.forEach(m => {
    const optEl = el(`modeOpt_${m.id}_${gameId}`);
    if (optEl) {
      if (m.id === modeId) {
        optEl.classList.add('active');
      } else {
        optEl.classList.remove('active');
      }
    }
  });
}

/**
 * Select player count for a game
 * @param {string} gameId 
 * @param {number} count 
 */
export function selectPlayerCount(gameId, count) {
  state.selectedPlayerCount[gameId] = count;
}

/**
 * Render games catalog cards grid
 */
export function renderGamesCatalog() {
  const grid = el('gamesGrid');
  if (!grid) return;

  if (state.games.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No games installed.</p></div>`;
    return;
  }

  grid.innerHTML = state.games.map(game => {
    let playerCounts = game.playerCounts || (game.minPlayers ? [game.minPlayers] : [2]);
    if (!playerCounts || playerCounts.length === 0) playerCounts = [2];
    const selectedPlayerCount = state.selectedPlayerCount[game.id] || playerCounts[0];

    const playerSelectHtml = playerCounts.length > 1 ? `
      <div class="player-select-wrapper">
        <label for="playerCountSelect_${game.id}"><i class="bi bi-people"></i></label>
        <select class="player-count-select" id="playerCountSelect_${game.id}" onchange="selectPlayerCount('${game.id}', parseInt(this.value, 10))">
          ${playerCounts.map(n => `<option value="${n}" ${n === selectedPlayerCount ? 'selected' : ''}>${t('catalog.playersCountOption', { count: n })}</option>`).join('')}
        </select>
      </div>
    ` : `<span class="game-players-badge"><i class="bi bi-person"></i> ${t('catalog.playersCount', { count: playerCounts[0] })}</span>`;

    let modes = game.modes || [];
    const defaultMode = (modes.find(m => m.isDefault) || modes[0] || {}).id || 'normal';
    const selectedMode = state.selectedGameMode[game.id] || defaultMode;

    const modeSelectorHtml = modes.length > 0 ? `
      <div class="mode-options-grid">
        ${modes.map(mode => {
          const modeTitle = t(`catalog.modes.${mode.id}`, { defaultValue: mode.name });
          return `
            <label class=" ${selectedMode === mode.id ? 'active' : ''}" id="modeOpt_${mode.id}_${game.id}">
              <div class="mode-radio-row">
                <input type="radio" name="gameMode_${game.id}" value="${escapeHtml(mode.id)}" ${selectedMode === mode.id ? 'checked' : ''} onchange="selectGameMode('${game.id}', '${mode.id}')">
                <span class="mode-title">${escapeHtml(modeTitle)}</span>
              </div>
              ${mode.description ? `<p class="mode-desc">${escapeHtml(mode.description)}</p>` : ''}
            </label>
          `;
        }).join('')}
      </div>
    ` : '';

    const gameDesc = t(`catalog.descriptions.${game.id}`, { defaultValue: game.description });
    const adminBadgeHtml = (game.enabled === false) ? `
      <span class="game-admin-badge" title="Hidden from regular users via games.config.json">
        <i class="bi bi-shield-lock-fill"></i> Admin Only
      </span>
    ` : '';

    return `
      <div class="game-card consolidated-card" id="gameCard_${game.id}">
        <div class="game-card-header">
          <div class="game-title-group">
            <h3 class="game-card-title">${escapeHtml(game.name)}</h3>
            ${adminBadgeHtml}
          </div>
          ${playerSelectHtml}
        </div>

        <p class="game-card-desc">${escapeHtml(gameDesc)}</p>

        ${modeSelectorHtml}

        <div class="game-card-actions">
          <button class="btn-primary w-100" onclick="handleQuickMatch('${game.id}')">
            <i class="bi bi-lightning-charge-fill"></i> ${t('catalog.quickMatch')}
          </button>
        </div>

        <div class="card-tables-section">
          <div class="card-tables-header">
            <span>${t('catalog.openTables')}</span>
            <button class="btn-refresh-sm" onclick="refreshTables('${game.id}')" title="${t('common.refresh', { defaultValue: 'Refresh' })}">
              <i class="bi bi-arrow-clockwise"></i> ${t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
          </div>
          <div class="card-tables-list" id="tablesList_${game.id}">
            <div class="empty-tables-hint">
              <i class="bi bi-hourglass-split"></i> ${t('common.loading')}
            </div>
          </div>
        </div>

      </div>
    `;
  }).join('');

  // Fetch open tables for all games
  state.games.forEach(g => refreshTables(g.id));
}

/**
 * Focus / select a specific game
 * @param {string} gameId 
 */
export function selectGame(gameId) {
  state.selectedGameId = gameId;
  refreshTables(gameId);
}

/**
 * Quick Match matchmaking handler:
 * Finds unfilled table with matching options or creates one automatically.
 * @param {string} [targetGameId]
 */
export async function handleQuickMatch(targetGameId) {
  const gameId = targetGameId || state.selectedGameId || (state.games[0] && state.games[0].id);
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const playerName = state.currentUser ? state.currentUser.username : promptForName();
  if (!playerName) return;

  const modes = game.modes || [];
  const defaultMode = (modes.find(m => m.isDefault) || modes[0] || {}).id || 'normal';
  const selectedMode = (state.selectedGameMode && state.selectedGameMode[game.id]) || defaultMode;

  const selectElem = el(`playerCountSelect_${game.id}`);
  const numPlayers = selectElem ? parseInt(selectElem.value, 10) : (state.selectedPlayerCount && state.selectedPlayerCount[game.id]) || (game.playerCounts ? game.playerCounts[0] : (game.minPlayers || 2));

  const modeObj = modes.find(m => m.id === selectedMode);
  const modeLabel = modeObj ? modeObj.name : selectedMode;

  // 1. If player already has an active match for this game, resume it directly!
  let activeMatch = state.activeMatch;
  if (!activeMatch) {
    try {
      const saved = localStorage.getItem('tfd_active_match');
      if (saved) activeMatch = JSON.parse(saved);
    } catch (e) {}
  }

  if (activeMatch && activeMatch.gameName === game.id && !state.isMatchOver) {
    showToast(`Resuming your active ${game.name} match...`, 'info');
    enterMatch(activeMatch);
    return;
  }

  // If user had an active match for a different game, abandon it cleanly first
  if (activeMatch && (activeMatch.matchID || activeMatch.matchId)) {
    await abandonActiveMatch();
  }

  showToast(`Searching for open ${game.name} match (${modeLabel}, ${numPlayers}P)...`, 'info');

  try {
    const res = await fetch(`/games/${game.id}`);
    const data = await res.json();
    const matches = data.matches || [];

    // Find match with open seat that matches chosen options (mode, player count)
    for (const m of matches) {
      if (m.gameover) continue;

      const matchMode = (m.setupData && m.setupData.mode) || 'normal';
      if (matchMode !== selectedMode) continue;

      const totalSeats = (m.players || []).length;
      if (totalSeats !== numPlayers) continue;

      // Don't join a table where this player is already registered
      if ((m.players || []).some(p => p && p.name === playerName)) continue;

      // Don't join a dead table where all existing players are disconnected
      const hasConnectedPlayer = (m.players || []).some(p => p && p.name && p.isConnected);
      if (!hasConnectedPlayer) continue;

      const openSlot = (m.players || []).findIndex(p => !p.name);
      if (openSlot !== -1) {
        // Join this match!
        const joinRes = await fetch(`/games/${game.id}/${m.matchID}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerID: String(openSlot),
            playerName
          })
        });
        if (joinRes.ok) {
          const joinData = await joinRes.json();
          showToast(`Joined open match #${m.matchID.substring(0, 8)}!`, 'success');
          enterMatch({
            gameName: game.id,
            matchID: m.matchID,
            playerID: String(openSlot),
            credentials: joinData.playerCredentials,
            playerName,
            mode: matchMode
          });
          return;
        }
      }
    }

    // No open table found with matching options -> Create one automatically!
    const createRes = await fetch(`/games/${game.id}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numPlayers,
        setupData: { mode: selectedMode }
      })
    });
    if (!createRes.ok) throw new Error('Failed to create match');
    const createData = await createRes.json();

    // Join as player 0
    const joinRes = await fetch(`/games/${game.id}/${createData.matchID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: '0',
        playerName
      })
    });
    if (!joinRes.ok) throw new Error('Failed to join match');
    const joinData = await joinRes.json();

    showToast(`Created new table #${createData.matchID.substring(0, 8)}. Waiting for opponent...`, 'info');
    enterMatch({
      gameName: game.id,
      matchID: createData.matchID,
      playerID: '0',
      credentials: joinData.playerCredentials,
      playerName,
      mode: selectedMode
    });
  } catch (err) {
    showToast('Quick match error: ' + err.message, 'error');
  }
}
