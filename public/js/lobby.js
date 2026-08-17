/**
 * The Flying Dutchmen - Multi-Game Lobby Client Script
 */

// State
const state = {
  currentUser: null,
  games: [],
  selectedGameId: null,
  activeFlow: 'game', // 'game' | 'group'
  currentParty: null, // party object when in Group-First flow
  currentMember: null, // our member in the party
  partyPollTimer: null,
  activeMatch: null, // { gameName, matchID, playerID, credentials }
  boardgameClient: null,
  tablesPollTimer: null,
};

const API_ORIGIN = window.location.origin;

// DOM Elements
const el = (id) => document.getElementById(id);

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  await loadGamesCatalog();
  startTablesPolling();
  checkActiveMatchBanner();
});

// Listen to SSO auth updates from shared tfd-navbar
window.addEventListener('tfd-auth-change', (e) => {
  const user = e.detail && e.detail.user;
  state.currentUser = user;
  if (user) {
    if (el('createPlayerName')) el('createPlayerName').value = user.username;
    if (el('joinPlayerName')) el('joinPlayerName').value = user.username;
  }
});

// Flow Switching (Game-First vs Group-First)
function switchFlow(flow) {
  state.activeFlow = flow;
  const tabGame = el('tabGameFirst');
  const tabGroup = el('tabGroupFirst');
  const viewGame = el('viewGameFirst');
  const viewGroup = el('viewGroupFirst');
  const viewBoard = el('viewMatchBoard');

  if (viewBoard) viewBoard.classList.add('hidden');

  if (flow === 'game') {
    if (tabGame) tabGame.classList.add('active');
    if (tabGroup) tabGroup.classList.remove('active');
    if (viewGame) {
      viewGame.classList.remove('hidden');
      viewGame.classList.add('active');
    }
    if (viewGroup) {
      viewGroup.classList.remove('active');
    }
    renderGamesCatalog();
    refreshTables();
  } else {
    if (tabGroup) tabGroup.classList.add('active');
    if (tabGame) tabGame.classList.remove('active');
    if (viewGroup) {
      viewGroup.classList.remove('hidden');
      viewGroup.classList.add('active');
    }
    if (viewGame) {
      viewGame.classList.remove('active');
    }
  }
}

// ==========================================================================
// GAME CATALOG & GAME-FIRST FLOW
// ==========================================================================
async function loadGamesCatalog() {
  try {
    const res = await fetch('/api/games');
    const data = await res.json();
    state.games = data.games || [];
    if (!state.selectedGameId && state.games.length > 0) {
      state.selectedGameId = state.games[0].id;
    }
    renderGamesCatalog();
    renderPartyGameOptions();
  } catch (err) {
    showToast('Failed to load games catalog', 'error');
  }
}

state.selectedGameMode = state.selectedGameMode || {};

function selectGameMode(gameId, modeId) {
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

function renderGamesCatalog() {
  const grid = el('gamesGrid');
  if (!grid) return;

  if (state.games.length === 0) {
    grid.innerHTML = `<div class="empty-state"><p>No games installed.</p></div>`;
    return;
  }

  grid.innerHTML = state.games.map(game => {
    let playerCounts = game.playerCounts || (game.minPlayers ? [game.minPlayers] : [2]);
    if (!playerCounts || playerCounts.length === 0) playerCounts = [2];

    const playerSelectHtml = playerCounts.length > 1 ? `
      <div class="player-select-wrapper">
        <label for="playerCountSelect_${game.id}"><i class="bi bi-people"></i></label>
        <select class="player-count-select" id="playerCountSelect_${game.id}">
          ${playerCounts.map(n => `<option value="${n}">${n} Players</option>`).join('')}
        </select>
      </div>
    ` : `<span class="game-players-badge"><i class="bi bi-person"></i> ${playerCounts[0]} Players</span>`;

    let modes = game.modes || [];
    const defaultMode = (modes.find(m => m.isDefault) || modes[0] || {}).id || 'normal';
    const selectedMode = state.selectedGameMode[game.id] || defaultMode;

    const modeSelectorHtml = modes.length > 0 ? `
      <div class="mode-options-grid">
        ${modes.map(mode => `
          <label class=" ${selectedMode === mode.id ? 'active' : ''}" id="modeOpt_${mode.id}_${game.id}">
            <div class="mode-radio-row">
              <input type="radio" name="gameMode_${game.id}" value="${escapeHtml(mode.id)}" ${selectedMode === mode.id ? 'checked' : ''} onchange="selectGameMode('${game.id}', '${mode.id}')">
              <span class="mode-title">${escapeHtml(mode.name)}</span>
            </div>
            ${mode.description ? `<p class="mode-desc">${escapeHtml(mode.description)}</p>` : ''}
          </label>
        `).join('')}
      </div>
    ` : '';

    return `
      <div class="game-card consolidated-card" id="gameCard_${game.id}">
        <div class="game-card-header">
          <h3 class="game-card-title">${escapeHtml(game.name)}</h3>
          ${playerSelectHtml}
        </div>

        <p class="game-card-desc">${escapeHtml(game.description)}</p>

        ${modeSelectorHtml}

        <div class="game-card-actions">
          <button class="btn-primary flex-1" onclick="handleQuickMatch('${game.id}')">
            <i class="bi bi-lightning-charge-fill"></i> Quick Match
          </button>
          <button class="btn-primary flex-1" onclick="handleCreateGameDirect('${game.id}')">
            <i class="bi bi-plus-circle"></i> Create Game
          </button>
        </div>

        <div class="card-tables-section">
          <div class="card-tables-header">
            <span>Open Tables</span>
            <button class="btn-refresh-sm" onclick="refreshTables('${game.id}')" title="Refresh open tables">
              <i class="bi bi-arrow-clockwise"></i> Refresh
            </button>
          </div>
          <div class="card-tables-list" id="tablesList_${game.id}">
            <div class="empty-tables-hint">
              <i class="bi bi-hourglass-split"></i> Loading open tables...
            </div>
          </div>
        </div>

        <div class="game-card-footer">
          <span>${(game.tags || []).join(' • ')}</span>
        </div>
      </div>
    `;
  }).join('');

  // Fetch open tables for all games
  state.games.forEach(g => refreshTables(g.id));
}

function selectGame(gameId) {
  state.selectedGameId = gameId;
  refreshTables(gameId);
}

// Table / Match Listing
async function refreshTables(targetGameId) {
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
            <p><i class="bi bi-info-circle"></i> No open tables. Click <strong>Quick Match</strong> or <strong>Create Game</strong> to start!</p>
          </div>
        `;
        continue;
      }

      list.innerHTML = openMatches.map(m => {
        const mode = (m.setupData && m.setupData.mode) || '';
        const game = state.games.find(g => g.id === gameId);
        const modeObj = game && game.modes ? game.modes.find(md => md.id === mode) : null;
        const modeLabel = modeObj ? modeObj.name : (mode ? (mode.charAt(0).toUpperCase() + mode.slice(1)) : '');
        const modeBadgeHtml = modeLabel ? `<span class="table-mode-badge ${escapeHtml(mode)}">${escapeHtml(modeLabel)}</span>` : '';
        const joinedCount = (m.players || []).filter(p => p.name).length;
        const totalSeats = (m.players || []).length;

        return `
          <div class="table-row">
            <div class="table-info-left">
              <span class="table-id-badge">#${m.matchID.substring(0, 8)}</span>
              ${modeBadgeHtml}
              <span class="table-seats-badge"><i class="bi bi-people"></i> ${joinedCount}/${totalSeats}</span>
            </div>
            <button class="btn-gold btn-sm" onclick="openJoinTableModal('${gameId}', '${m.matchID}', ${JSON.stringify(m.players).replace(/"/g, '&quot;')}, '${escapeHtml(mode)}')">
              <i class="bi bi-door-open"></i> Join Table
            </button>
          </div>
        `;
      }).join('');
    } catch (err) {
      list.innerHTML = `<div class="empty-tables-hint"><p>Could not fetch tables.</p></div>`;
    }
  }
}

function startTablesPolling() {
  if (state.tablesPollTimer) clearInterval(state.tablesPollTimer);
  state.tablesPollTimer = setInterval(() => {
    if (state.activeFlow === 'game' && !state.activeMatch) {
      state.games.forEach(g => refreshTables(g.id));
    }
  }, 4000);
}

// Create Game Directly from Card
async function handleCreateGameDirect(targetGameId) {
  const gameId = targetGameId || state.selectedGameId || (state.games[0] && state.games[0].id);
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const playerName = state.currentUser ? state.currentUser.username : promptForName();
  if (!playerName) return;

  const selectedMode = (state.selectedGameMode && state.selectedGameMode[game.id]) || (game.modes && game.modes[0] ? game.modes[0].id : 'normal');
  
  const selectElem = el(`playerCountSelect_${game.id}`);
  const numPlayers = selectElem ? parseInt(selectElem.value, 10) : (game.playerCounts ? game.playerCounts[0] : 2);

  showToast(`Creating new ${game.name} game (${numPlayers} Players)...`, 'info');

  try {
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

    showToast(`Created new game #${createData.matchID.substring(0, 8)}!`, 'success');
    enterMatch({
      gameName: game.id,
      matchID: createData.matchID,
      playerID: '0',
      credentials: joinData.playerCredentials,
      playerName,
      mode: selectedMode
    });
  } catch (err) {
    showToast('Create game error: ' + err.message, 'error');
  }
}

// Quick Match
async function handleQuickMatch(targetGameId) {
  const gameId = targetGameId || state.selectedGameId || (state.games[0] && state.games[0].id);
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const playerName = state.currentUser ? state.currentUser.username : promptForName();
  if (!playerName) return;

  const selectedMode = (state.selectedGameMode && state.selectedGameMode[game.id]) || (game.modes && game.modes[0] ? game.modes[0].id : 'normal');

  showToast(`Searching for an open ${game.name} match (${selectedMode})...`, 'info');

  try {
    const res = await fetch(`/games/${game.id}`);
    const data = await res.json();
    const matches = data.matches || [];

    // Find match with open seat that matches chosen mode
    for (const m of matches) {
      const matchMode = (m.setupData && m.setupData.mode) || 'normal';
      if (matchMode !== selectedMode) continue;

      const openSlot = (m.players || []).findIndex(p => !p.name);
      if (openSlot !== -1 && !m.gameover) {
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

    // No open table found with matching mode -> Create one!
    const createRes = await fetch(`/games/${game.id}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        numPlayers: game.minPlayers || 2,
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

// Create Table Modal
function openCreateTableModal(targetGameId) {
  const modal = el('createTableModal');
  const gameSelect = el('createGameSelect');
  const activeGameId = targetGameId || state.selectedGameId || (state.games[0] && state.games[0].id);
  
  gameSelect.innerHTML = state.games.map(g => `
    <option value="${g.id}" ${g.id === activeGameId ? 'selected' : ''}>${escapeHtml(g.name)}</option>
  `).join('');

  updateCreateModalPlayerOptions();
  modal.classList.remove('hidden');
}

function updateCreateModalPlayerOptions() {
  const gameId = el('createGameSelect').value;
  const game = state.games.find(g => g.id === gameId);
  const numSelect = el('createNumPlayers');
  numSelect.innerHTML = '';

  const min = game ? game.minPlayers : 2;
  const max = game ? game.maxPlayers : 2;

  for (let i = min; i <= max; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i} Players`;
    numSelect.appendChild(opt);
  }
}

function closeCreateTableModal() {
  el('createTableModal').classList.add('hidden');
}

async function submitCreateTable() {
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

// Join Table Modal
let currentModalGameId = null;
let currentModalMatchID = null;
let currentModalMode = null;

function openJoinTableModal(gameId, matchID, players, mode) {
  currentModalGameId = gameId;
  currentModalMatchID = matchID;
  currentModalMode = mode || 'normal';
  const modal = el('joinTableModal');
  el('joinTableInfo').textContent = `Joining Table #${matchID.substring(0, 8)}`;

  const seatSelect = el('joinSeatSelect');
  seatSelect.innerHTML = '';

  (players || []).forEach((p, idx) => {
    if (!p.name) {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `Seat ${idx + 1} (Available)`;
      seatSelect.appendChild(opt);
    }
  });

  modal.classList.remove('hidden');
}

function closeJoinTableModal() {
  currentModalGameId = null;
  currentModalMatchID = null;
  currentModalMode = null;
  el('joinTableModal').classList.add('hidden');
}

async function submitJoinTable() {
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

// ==========================================================================
// GROUP-FIRST FLOW (PARTY LOUNGE)
// ==========================================================================
function renderPartyGameOptions() {
  const select = el('selectPartyGame');
  if (!select) return;

  if (state.games.length === 0) {
    select.innerHTML = `<option value="">No games available</option>`;
    updatePartyGamePreview();
    return;
  }

  select.innerHTML = state.games.map(g => `
    <option value="${g.id}">${escapeHtml(g.name)}</option>
  `).join('');

  if (state.currentParty && state.currentParty.selectedGameId) {
    select.value = state.currentParty.selectedGameId;
  }

  updatePartyGamePreview();
}

function updatePartyGamePreview() {
  const select = el('selectPartyGame');
  if (!select) return;
  const gameId = select.value || (state.games[0] ? state.games[0].id : null);
  const game = state.games.find(g => g.id === gameId);
  if (!game) {
    if (el('partyGameName')) el('partyGameName').textContent = 'No game selected';
    if (el('partyGameDesc')) el('partyGameDesc').textContent = 'Select a game from the dropdown.';
    if (el('partyGameReqs')) el('partyGameReqs').innerHTML = '<i class="bi bi-info-circle"></i> Requires players';
    return;
  }

  el('partyGameName').textContent = game.name;
  el('partyGameDesc').textContent = game.description || 'No description available.';
  el('partyGameReqs').innerHTML = `<i class="bi bi-info-circle"></i> Requires ${game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}-${game.maxPlayers}`} players`;
}

async function handleCreateGroup() {
  const hostName = state.currentUser ? state.currentUser.username : promptForName('Enter your host name:');
  if (!hostName) return;

  try {
    const res = await fetch('/api/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hostName,
        hostUserId: state.currentUser ? state.currentUser.id : null
      })
    });
    const data = await res.json();
    state.currentParty = data.group;
    state.currentMember = data.member;
    renderActiveParty();
    startPartyPolling();
    showToast('Party room created! Share the code.', 'success');
  } catch (err) {
    showToast('Failed to create party room', 'error');
  }
}

async function handleJoinGroup() {
  const code = el('inputPartyCode').value.trim();
  if (!code) {
    showToast('Please enter a party code', 'warning');
    return;
  }
  const memberName = state.currentUser ? state.currentUser.username : promptForName();
  if (!memberName) return;

  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberName,
        userId: state.currentUser ? state.currentUser.id : null
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to join group');

    state.currentParty = data.group;
    state.currentMember = data.member;
    renderActiveParty();
    startPartyPolling();
    showToast(`Joined party ${code}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderActiveParty() {
  if (!state.currentParty) {
    el('partyEntryArea').classList.remove('hidden');
    el('activePartyLounge').classList.add('hidden');
    return;
  }

  el('partyEntryArea').classList.add('hidden');
  el('activePartyLounge').classList.remove('hidden');

  el('loungeRoomCode').textContent = state.currentParty.code;
  el('loungeMemberCount').textContent = state.currentParty.members.length;

  const isHost = state.currentMember && state.currentMember.isHost;
  el('hostGameSelectorArea').style.display = isHost ? 'block' : 'none';
  el('btnLaunchPartyGame').style.display = isHost ? 'flex' : 'none';

  // Members list
  const list = el('loungeMembersList');
  list.innerHTML = state.currentParty.members.map(m => `
    <div class="member-item">
      <div class="member-name-info">
        <i class="bi bi-person-circle text-gold"></i>
        <span>${escapeHtml(m.name)}</span>
        ${m.isHost ? '<span class="host-tag">HOST</span>' : ''}
        ${m.id === state.currentMember.id ? '<span style="font-size: 0.75rem; color: #94a3b8;">(You)</span>' : ''}
      </div>
      <span class="ready-badge ${m.isReady ? 'is-ready' : 'not-ready'}">
        ${m.isReady ? '<i class="bi bi-check"></i> Ready' : 'Not Ready'}
      </span>
    </div>
  `).join('');

  // Ready button state for user
  const me = state.currentParty.members.find(m => m.id === state.currentMember.id);
  const btnReady = el('btnToggleReady');
  if (me && me.isReady) {
    btnReady.classList.add('active-ready');
    btnReady.innerHTML = '<i class="bi bi-check-circle-fill"></i> You are Ready';
  } else {
    btnReady.classList.remove('active-ready');
    btnReady.innerHTML = '<i class="bi bi-check-circle"></i> Ready Up';
  }

  // Selected game
  if (el('selectPartyGame')) {
    el('selectPartyGame').value = state.currentParty.selectedGameId || (state.games[0] ? state.games[0].id : '');
  }
  updatePartyGamePreview();

  // Launch button validity
  const game = state.games.find(g => g.id === state.currentParty.selectedGameId);
  const minPlayers = game ? game.minPlayers : 2;
  const maxPlayers = game ? game.maxPlayers : 2;
  const currentCount = state.currentParty.members.length;
  const allReady = state.currentParty.members.every(m => m.isReady);

  const canLaunch = currentCount >= minPlayers && currentCount <= maxPlayers && allReady;
  el('btnLaunchPartyGame').disabled = !canLaunch;

  if (!allReady) {
    el('launchHintText').textContent = 'Waiting for all members to be ready...';
  } else if (currentCount < minPlayers) {
    el('launchHintText').textContent = `Need at least ${minPlayers} players (${currentCount}/${minPlayers})`;
  } else if (currentCount > maxPlayers) {
    el('launchHintText').textContent = `Too many players for this game (Max ${maxPlayers})`;
  } else {
    el('launchHintText').textContent = 'All players ready! Host can launch the match.';
  }
}

async function handleToggleReady() {
  if (!state.currentParty || !state.currentMember) return;
  const me = state.currentParty.members.find(m => m.id === state.currentMember.id);
  const nextReady = !me.isReady;

  try {
    const res = await fetch(`/api/groups/${state.currentParty.code}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: state.currentMember.id,
        isReady: nextReady
      })
    });
    const data = await res.json();
    state.currentParty = data.group;
    renderActiveParty();
  } catch (err) {
    showToast('Failed to update ready status', 'error');
  }
}

async function handleHostGameChange(gameId) {
  if (!state.currentParty || !state.currentMember || !state.currentMember.isHost) return;

  try {
    const res = await fetch(`/api/groups/${state.currentParty.code}/select-game`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: state.currentMember.id,
        gameId
      })
    });
    const data = await res.json();
    state.currentParty = data.group;
    renderActiveParty();
  } catch (err) {
    showToast('Could not change game: ' + err.message, 'error');
  }
}

async function handleLaunchPartyGame() {
  if (!state.currentParty || !state.currentMember || !state.currentMember.isHost) return;
  const gameId = state.currentParty.selectedGameId || (state.games[0] ? state.games[0].id : '');
  if (!gameId) {
    showToast('No game selected to launch', 'warning');
    return;
  }
  const numPlayers = state.currentParty.members.length;

  try {
    showToast('Creating match on game server...', 'info');

    // 1. Create boardgame.io match
    const createRes = await fetch(`/games/${gameId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numPlayers })
    });
    const createData = await createRes.json();
    const matchId = createData.matchID;

    // 2. Notify group server that game is launched
    await fetch(`/api/groups/${state.currentParty.code}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: state.currentMember.id,
        matchId
      })
    });

    // 3. Join host into slot 0
    const joinRes = await fetch(`/games/${gameId}/${matchId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: '0',
        playerName: state.currentMember.name
      })
    });
    const joinData = await joinRes.json();

    enterMatch({
      gameName: gameId,
      matchID: matchId,
      playerID: '0',
      credentials: joinData.playerCredentials,
      playerName: state.currentMember.name
    });
  } catch (err) {
    showToast('Launch failed: ' + err.message, 'error');
  }
}

function startPartyPolling() {
  if (state.partyPollTimer) clearInterval(state.partyPollTimer);
  state.partyPollTimer = setInterval(async () => {
    if (!state.currentParty) return;

    try {
      const res = await fetch(`/api/groups/${state.currentParty.code}`);
      if (res.status === 404) {
        state.currentParty = null;
        clearInterval(state.partyPollTimer);
        renderActiveParty();
        return;
      }
      const data = await res.json();
      const updated = data.group;

      // Check if match was launched by host and we haven't joined yet
      if (updated.status === 'IN_GAME' && updated.matchId && !state.activeMatch) {
        state.currentParty = updated;
        const myIndex = updated.members.findIndex(m => m.id === state.currentMember.id);
        const playerID = String(myIndex >= 0 ? myIndex : 0);

        // Join match
        const joinRes = await fetch(`/games/${updated.selectedGameId}/${updated.matchId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerID,
            playerName: state.currentMember.name
          })
        });
        const joinData = await joinRes.json();

        enterMatch({
          gameName: updated.selectedGameId,
          matchID: updated.matchId,
          playerID,
          credentials: joinData.playerCredentials,
          playerName: state.currentMember.name
        });
        return;
      }

      state.currentParty = updated;
      renderActiveParty();
    } catch (err) {
      console.warn('[POLL] Party sync error:', err.message);
    }
  }, 2000);
}

async function handleLeaveGroup() {
  if (!state.currentParty || !state.currentMember) return;
  try {
    await fetch(`/api/groups/${state.currentParty.code}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: state.currentMember.id })
    });
  } catch (err) {}
  state.currentParty = null;
  state.currentMember = null;
  clearInterval(state.partyPollTimer);
  renderActiveParty();
  showToast('Left party room', 'info');
}

function copyPartyCode() {
  if (!state.currentParty) return;
  navigator.clipboard.writeText(state.currentParty.code);
  showToast('Party code copied to clipboard!', 'success');
}

// ==========================================================================
// MATCH / GAME BOARD MOUNT & PERSISTENCE
// ==========================================================================
function enterMatch(matchConfig) {
  state.activeMatch = matchConfig;
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

  const game = state.games.find(g => g.id === matchConfig.gameName);
  const titleEl = el('boardGameTitle');
  const idEl = el('boardMatchId');
  const matchIdStr = matchConfig.matchID || matchConfig.matchId || '';
  if (titleEl) titleEl.textContent = game ? game.name : matchConfig.gameName;
  if (idEl) idEl.textContent = `Match #${matchIdStr ? matchIdStr.substring(0, 8) : '000'}`;

  checkActiveMatchBanner();
  mountGameClient(matchConfig);
}

function exitToLobby() {
  document.body.classList.remove('in-game');
  if (state.boardgameClient) {
    try { state.boardgameClient.stop(); } catch (e) {}
    state.boardgameClient = null;
  }
  const viewBoard = el('viewMatchBoard');
  if (viewBoard) viewBoard.classList.add('hidden');
  switchFlow(state.activeFlow || 'game');
  checkActiveMatchBanner();
}

function checkActiveMatchBanner() {
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
        <span>Active Match: <strong>${escapeHtml(gameTitle)} (#${matchShortId})</strong></span>
      </div>
      <div class="active-match-actions">
        <button class="btn-gold btn-sm active-banner-btn" onclick="resumeActiveMatch()">
          <i class="bi bi-play-fill"></i> Resume
        </button>
        <button class="btn-secondary btn-sm active-banner-btn" onclick="abandonActiveMatch()">
          <i class="bi bi-x-lg"></i> Leave
        </button>
      </div>
    `;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function resumeActiveMatch() {
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

function abandonActiveMatch() {
  state.activeMatch = null;
  try {
    localStorage.removeItem('tfd_active_match');
  } catch (e) {}
  checkActiveMatchBanner();
  showToast('Left active match.', 'info');
}

function mountGameClient(matchConfig) {
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

function renderDefaultGamePlaceholder(container, matchConfig) {
  container.innerHTML = `
    <div class="empty-state">
      <i class="bi bi-dice-5-fill"></i>
      <h3>${escapeHtml(matchConfig.gameName)} in progress</h3>
      <p>Match ID: ${matchConfig.matchID} | You are Player ${parseInt(matchConfig.playerID, 10) + 1}</p>
    </div>
  `;
}

// Helpers
function promptForName(msg = 'Enter your display name:') {
  const name = prompt(msg, 'Player');
  return name ? name.trim() : null;
}

function showToast(message, type = 'info') {
  const toast = el('toastNotification');
  if (!toast) return;

  const icon = type === 'success' ? 'bi-check-circle-fill text-success' :
               type === 'error' ? 'bi-exclamation-triangle-fill text-danger' :
               type === 'warning' ? 'bi-exclamation-circle-fill text-warning' : 'bi-info-circle-fill text-info';

  toast.innerHTML = `<i class="bi ${icon}"></i> <span>${escapeHtml(message)}</span>`;
  toast.classList.remove('hidden');

  setTimeout(() => {
    toast.classList.add('hidden');
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
