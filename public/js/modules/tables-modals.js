/**
 * The Flying Dutchmen - Tables Listing & Table Modals
 */

import { state, el, escapeHtml, showToast } from './state.js';
import { enterMatch } from './match-manager.js';
import { t } from './i18n.js';

// Table Modal Selection State
let currentModalGameId = null;
let currentModalMatchID = null;
let currentModalMode = null;

/**
 * Fetch and render open tables for a game or all games
 * @param {string} [targetGameId]
 */
export async function refreshTables(targetGameId) {
  const gamesToRefresh = targetGameId ? [targetGameId] : state.games.map(g => g.id);

  for (const gameId of gamesToRefresh) {
    const list = el(`tablesList_${gameId}`);
    if (!list) continue;

    try {
      const res = await fetch(`/games/${gameId}`);
      if (!res.ok) {
        list.innerHTML = `<div class="empty-tables-hint"><p>No active tables found.</p></div>`;
        continue;
      }
      const data = await res.json();
      const matches = data.matches || [];

      // Filter to open (joinable) tables
      const openMatches = matches.filter(m => {
        const joinedCount = (m.players || []).filter(p => p.name).length;
        const totalSeats = (m.players || []).length;
        return joinedCount < totalSeats && !m.gameover;
      });

      if (openMatches.length === 0) {
        list.innerHTML = `
          <div class="empty-tables-hint">
            <p><i class="bi bi-info-circle"></i> ${t('catalog.noOpenTables')}</p>
          </div>
        `;
        continue;
      }

      list.innerHTML = openMatches.map(m => {
        const mode = (m.setupData && m.setupData.mode) || '';
        const game = state.games.find(g => g.id === gameId);
        const modeObj = game && game.modes ? game.modes.find(md => md.id === mode) : null;
        const modeLabel = modeObj ? t(`catalog.modes.${modeObj.id}`, { defaultValue: modeObj.name }) : (mode ? (mode.charAt(0).toUpperCase() + mode.slice(1)) : '');
        const modeBadgeHtml = modeLabel ? `<span class="table-mode-badge ${escapeHtml(mode)}">${escapeHtml(modeLabel)}</span>` : '';
        const joinedCount = (m.players || []).filter(p => p.name).length;
        const totalSeats = (m.players || []).length;

        return `
          <div class="table-row">
            <div class="table-info-left">
              ${modeBadgeHtml}
              <span class="table-seats-badge"><i class="bi bi-people"></i> ${t('tables.playersRatio', { current: joinedCount, total: totalSeats })}</span>
            </div>
            <button class="btn-gold btn-sm" onclick="openJoinTableModal('${gameId}', '${m.matchID}', ${JSON.stringify(m.players).replace(/"/g, '&quot;')}, '${escapeHtml(mode)}')">
              <i class="bi bi-door-open"></i> ${t('tables.joinBtn')}
            </button>
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="empty-tables-hint"><p>Could not fetch tables.</p></div>`;
    }
  }
}

/**
 * Start background polling for open tables list
 */
export function startTablesPolling() {
  if (state.tablesPollTimer) clearInterval(state.tablesPollTimer);
  state.tablesPollTimer = setInterval(() => {
    if (state.activeFlow === 'game' && !state.activeMatch) {
      state.games.forEach(g => refreshTables(g.id));
    }
  }, 4000);
}

/**
 * Open Create Table modal
 * @param {string} [targetGameId] 
 */
export function openCreateTableModal(targetGameId) {
  const modal = el('createTableModal');
  const gameSelect = el('createGameSelect');
  const activeGameId = targetGameId || state.selectedGameId || (state.games[0] && state.games[0].id);
  
  if (gameSelect) {
    gameSelect.innerHTML = state.games.map(g => `
      <option value="${g.id}" ${g.id === activeGameId ? 'selected' : ''}>${escapeHtml(g.name)}</option>
    `).join('');
  }

  updateCreateModalPlayerOptions();
  if (modal) modal.classList.remove('hidden');
}

/**
 * Update player count options in Create Table modal based on selected game
 */
export function updateCreateModalPlayerOptions() {
  const select = el('createGameSelect');
  if (!select) return;
  const gameId = select.value;
  const game = state.games.find(g => g.id === gameId);
  const numSelect = el('createNumPlayers');
  if (!numSelect) return;
  numSelect.innerHTML = '';

  const min = game ? game.minPlayers : 2;
  const max = game ? game.maxPlayers : 2;

  for (let i = min; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = t('catalog.playersCountOption', { count: i });
    numSelect.appendChild(opt);
  }
}

/**
 * Close Create Table modal
 */
export function closeCreateTableModal() {
  const modal = el('createTableModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Submit Create Table modal
 */
export async function submitCreateTable() {
  const gameId = el('createGameSelect').value;
  const numPlayers = parseInt(el('createNumPlayers').value, 10) || 2;
  const playerName = el('createPlayerName').value.trim() || (state.currentUser ? state.currentUser.username : 'Player 1');
  const game = state.games.find(g => g.id === gameId);
  const selectedMode = (state.selectedGameMode && state.selectedGameMode[gameId]) || (game && game.modes && game.modes[0] ? game.modes[0].id : 'normal');

  try {
    const createRes = await fetch(`/games/${gameId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numPlayers, setupData: { mode: selectedMode } })
    });
    if (!createRes.ok) throw new Error('Could not create table');
    const createData = await createRes.json();
    const matchID = createData.matchID;

    const joinRes = await fetch(`/games/${gameId}/${matchID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: '0',
        playerName
      })
    });
    const joinData = await joinRes.json();

    closeCreateTableModal();
    enterMatch({
      gameName: gameId,
      matchID,
      playerID: '0',
      credentials: joinData.playerCredentials,
      playerName,
      mode: selectedMode
    });
  } catch (err) {
    showToast('Failed to create table: ' + err.message, 'error');
  }
}

/**
 * Open Join Table modal
 * @param {string} gameId 
 * @param {string} matchID 
 * @param {Array} players 
 * @param {string} mode 
 */
export function openJoinTableModal(gameId, matchID, players, mode) {
  currentModalGameId = gameId;
  currentModalMatchID = matchID;
  currentModalMode = mode || 'normal';
  const modal = el('joinTableModal');
  const infoEl = el('joinTableInfo');
  const joinedCount = (players || []).filter(p => p.name).length;
  const totalSeats = (players || []).length;
  if (infoEl) infoEl.textContent = t('tables.joiningTableInfo', { id: matchID.substring(0, 8), current: joinedCount, total: totalSeats });

  const seatSelect = el('joinSeatSelect');
  if (seatSelect) {
    seatSelect.innerHTML = '';
    (players || []).forEach((p, idx) => {
      if (!p.name) {
        const opt = document.createElement('option');
        opt.value = idx;
        opt.textContent = t('tables.seatOpen', { seat: idx + 1 });
        seatSelect.appendChild(opt);
      }
    });
  }

  if (modal) modal.classList.remove('hidden');
}

/**
 * Close Join Table modal
 */
export function closeJoinTableModal() {
  currentModalGameId = null;
  currentModalMatchID = null;
  currentModalMode = null;
  const modal = el('joinTableModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * Submit Join Table modal
 */
export async function submitJoinTable() {
  if (!currentModalMatchID) return;
  const matchID = currentModalMatchID;
  const gameId = currentModalGameId || state.selectedGameId;
  const mode = currentModalMode || 'normal';
  const playerID = el('joinSeatSelect').value;
  const playerName = el('joinPlayerName').value.trim() || (state.currentUser ? state.currentUser.username : `Player ${parseInt(playerID, 10) + 1}`);

  try {
    const res = await fetch(`/games/${gameId}/${matchID}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerID, playerName })
    });
    if (!res.ok) throw new Error('Failed to join table');
    const data = await res.json();

    closeJoinTableModal();
    enterMatch({
      gameName: gameId,
      matchID,
      playerID,
      credentials: data.playerCredentials,
      playerName,
      mode
    });
  } catch (err) {
    showToast('Error joining table: ' + err.message, 'error');
  }
}
