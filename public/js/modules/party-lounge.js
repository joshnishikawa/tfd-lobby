/**
 * The Flying Dutchmen - Party Lounge (Group-First Flow)
 */

import { state, el, escapeHtml, showToast } from './state.js';
import { enterMatch, updatePlayAgainButton, transitionToNewMatch } from './match-manager.js';
import { t } from './i18n.js';

/**
 * Persist active party session to localStorage
 * @param {object} group 
 * @param {object} member 
 */
export function savePartySession(group, member) {
  if (!group || !member || (group.code && group.code.startsWith('M-'))) return;
  try {
    localStorage.setItem('tfd_party_session', JSON.stringify({
      code: group.code,
      memberId: member.id,
      member: member
    }));
  } catch (e) {}
}

/**
 * Clear party session from localStorage
 */
export function clearPartySession() {
  try {
    localStorage.removeItem('tfd_party_session');
  } catch (e) {}
}

/**
 * Restore party session from localStorage on app load
 * @param {function} [onFlowSwitch]
 */
export async function restorePartySession(onFlowSwitch) {
  try {
    const raw = localStorage.getItem('tfd_party_session');
    if (!raw) return;
    const session = JSON.parse(raw);
    if (!session || !session.code || !session.memberId) {
      clearPartySession();
      return;
    }

    const res = await fetch(`/api/groups/${encodeURIComponent(session.code)}`);
    if (!res.ok) {
      clearPartySession();
      return;
    }

    const data = await res.json();
    const group = data.group;
    if (!group) {
      clearPartySession();
      return;
    }

    const member = group.members.find(m => m.id === session.memberId);
    if (!member) {
      clearPartySession();
      return;
    }

    state.currentParty = group;
    state.currentMember = member;
    savePartySession(group, member);

    if (typeof onFlowSwitch === 'function') {
      onFlowSwitch('group');
    }
    renderPartyGameOptions();
    renderActiveParty();
    startPartyPolling();
  } catch (err) {
    console.error('[PARTY RESTORE] Error restoring party session:', err);
    clearPartySession();
  }
}

/**
 * Populate game selection dropdown inside party lounge
 */
export function renderPartyGameOptions() {
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

/**
 * Update game details preview when selected in party lounge
 */
export function updatePartyGamePreview() {
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

  const gameDesc = t(`catalog.descriptions.${game.id}`, { defaultValue: game.description || 'No description available.' });
  const countStr = game.minPlayers === game.maxPlayers ? game.minPlayers : `${game.minPlayers}-${game.maxPlayers}`;

  if (el('partyGameName')) el('partyGameName').textContent = game.name;
  if (el('partyGameDesc')) el('partyGameDesc').textContent = gameDesc;
  if (el('partyGameReqs')) el('partyGameReqs').innerHTML = `<i class="bi bi-info-circle"></i> ${t('catalog.playersCount', { count: countStr })}`;
}

/**
 * Create a new party lounge room
 */
export async function handleCreateGroup() {
  const nameInput = el('createPartyHostName');
  const hostName = (nameInput && nameInput.value.trim()) || (state.currentUser ? state.currentUser.username : '');
  if (!hostName) {
    showToast('Please enter your name', 'warning');
    if (nameInput) nameInput.focus();
    return;
  }

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
    savePartySession(data.group, data.member);
    renderActiveParty();
    startPartyPolling();
    showToast('Party room created! Share the code.', 'success');
  } catch (err) {
    showToast('Failed to create party room', 'error');
  }
}

/**
 * Join an existing party lounge with a room code
 */
export async function handleJoinGroup() {
  const codeInput = el('inputPartyCode');
  const nameInput = el('joinPartyMemberName');
  const code = (codeInput && codeInput.value.trim().toUpperCase()) || '';
  const memberName = (nameInput && nameInput.value.trim()) || (state.currentUser ? state.currentUser.username : '');

  if (!code) {
    showToast('Please enter a party code', 'warning');
    if (codeInput) codeInput.focus();
    return;
  }
  if (!memberName) {
    showToast('Please enter your name', 'warning');
    if (nameInput) nameInput.focus();
    return;
  }

  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(code)}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberName,
        userId: state.currentUser ? state.currentUser.id : null
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Could not join party');
    }
    const data = await res.json();
    state.currentParty = data.group;
    state.currentMember = data.member;
    savePartySession(data.group, data.member);
    renderPartyGameOptions();
    renderActiveParty();
    startPartyPolling();
    showToast(`Joined party ${data.group.code}!`, 'success');
  } catch (err) {
    showToast(err.message || 'Failed to join party room', 'error');
  }
}

/**
 * Render active party lounge room UI
 */
export function renderActiveParty() {
  const entryArea = el('partyEntryArea');
  const loungePanel = el('activePartyLounge');
  if (!entryArea || !loungePanel) return;

  if (!state.currentParty) {
    entryArea.classList.remove('hidden');
    loungePanel.classList.add('hidden');
    return;
  }

  entryArea.classList.add('hidden');
  loungePanel.classList.remove('hidden');

  if (el('loungeRoomCode')) el('loungeRoomCode').textContent = state.currentParty.code;
  if (el('loungeMemberCount')) el('loungeMemberCount').textContent = state.currentParty.members.length;
  if (el('loungeMembersHeader')) el('loungeMembersHeader').textContent = t('party.partyMembers', { count: state.currentParty.members.length }).split('(')[0].trim();

  const isHost = state.currentMember && state.currentMember.isHost;
  if (el('hostGameSelectorArea')) el('hostGameSelectorArea').style.display = isHost ? 'block' : 'none';
  if (el('btnLaunchPartyGame')) el('btnLaunchPartyGame').style.display = isHost ? 'flex' : 'none';

  // Members list roster
  const list = el('loungeMembersList');
  if (list) {
    list.innerHTML = state.currentParty.members.map(m => `
      <div class="member-item">
        <div class="member-name-info">
          <i class="bi bi-person-circle text-gold"></i>
          <span>${escapeHtml(m.name)}</span>
          ${m.isHost ? `<span class="host-tag">${t('party.hostTag')}</span>` : ''}
          ${state.currentMember && m.id === state.currentMember.id ? `<span style="font-size: 0.75rem; color: #94a3b8;">(${t('party.youTag')})</span>` : ''}
        </div>
        <span class="ready-badge ${m.isReady ? 'is-ready' : 'not-ready'}">
          ${m.isReady ? `<i class="bi bi-check"></i> ${t('party.ready')}` : t('party.notReady')}
        </span>
      </div>
    `).join('');
  }

  // Ready button state for user
  const me = state.currentParty.members.find(m => state.currentMember && m.id === state.currentMember.id);
  const btnReady = el('btnToggleReady');
  if (btnReady) {
    if (me && me.isReady) {
      btnReady.classList.add('active-ready');
      btnReady.innerHTML = `<i class="bi bi-check-circle-fill"></i> ${t('party.ready')}`;
    } else {
      btnReady.classList.remove('active-ready');
      btnReady.innerHTML = `<i class="bi bi-check-circle"></i> ${t('party.readyUp')}`;
    }
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
  const readyCount = state.currentParty.members.filter(m => m.isReady).length;
  const allReady = state.currentParty.members.every(m => m.isReady);

  const canLaunch = currentCount >= minPlayers && currentCount <= maxPlayers && allReady;
  const btnLaunch = el('btnLaunchPartyGame');
  if (btnLaunch) btnLaunch.disabled = !canLaunch;

  const hintText = el('launchHintText');
  if (hintText) {
    if (!allReady) {
      hintText.textContent = t('party.launchHintWaiting', { ready: readyCount, total: currentCount });
    } else if (currentCount < minPlayers) {
      hintText.textContent = `Need at least ${minPlayers} players (${currentCount}/${minPlayers})`;
    } else if (currentCount > maxPlayers) {
      hintText.textContent = `Too many players for this game (Max ${maxPlayers})`;
    } else {
      hintText.textContent = t('party.allReadyHost');
    }
  }
}

/**
 * Toggle ready status for current user
 */
export async function handleToggleReady() {
  if (!state.currentParty || !state.currentMember) return;
  const me = state.currentParty.members.find(m => m.id === state.currentMember.id);
  const nextReady = me ? !me.isReady : true;

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
    if (state.currentMember) savePartySession(data.group, state.currentMember);
    renderActiveParty();
  } catch (err) {
    showToast('Failed to update ready status', 'error');
  }
}

/**
 * Host changes selected game for party
 * @param {string} gameId 
 */
export async function handleHostGameChange(gameId) {
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
    if (state.currentMember) savePartySession(data.group, state.currentMember);
    renderActiveParty();
  } catch (err) {
    showToast('Could not change game: ' + err.message, 'error');
  }
}

/**
 * Host launches the selected game for all party members
 */
export async function handleLaunchPartyGame() {
  if (!state.currentParty || !state.currentMember || !state.currentMember.isHost) return;
  const gameId = state.currentParty.selectedGameId || (state.games[0] ? state.games[0].id : '');
  if (!gameId) {
    showToast('No game selected to launch', 'warning');
    return;
  }
  const numPlayers = Math.max((state.currentParty.members && state.currentParty.members.length) || 2, 2);
  const setupData = state.currentParty.setupData || {};

  try {
    showToast('Creating match on game server...', 'info');

    // 1. Create boardgame.io match
    const createRes = await fetch(`/games/${gameId}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numPlayers, setupData })
    });
    const createData = await createRes.json();
    const matchId = createData.matchID;

    // 2. Join host into slot (alternating if rematching from a 2-player match)
    const prevSeat = (state.activeMatch && state.activeMatch.playerID !== undefined) ? String(state.activeMatch.playerID) : null;
    const hostSeat = (prevSeat !== null && numPlayers === 2) ? (prevSeat === '0' ? '1' : '0') : '0';

    const joinRes = await fetch(`/games/${gameId}/${matchId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerID: hostSeat,
        playerName: state.currentMember.name
      })
    });
    const joinData = await joinRes.json();

    // 3. Immediately enter match so background poller doesn't race
    enterMatch({
      gameName: gameId,
      matchID: matchId,
      playerID: hostSeat,
      credentials: joinData.playerCredentials,
      playerName: state.currentMember.name,
      mode: (setupData && setupData.mode) || ''
    });

    // 4. Notify group server so other members are alerted to join
    await fetch(`/api/groups/${state.currentParty.code}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: state.currentMember.id,
        matchId
      })
    });
  } catch (err) {
    showToast('Launch failed: ' + err.message, 'error');
  }
}

/**
 * Start background polling for party lounge updates
 */
export function startPartyPolling() {
  if (state.partyPollTimer) clearInterval(state.partyPollTimer);
  state.partyPollTimer = setInterval(async () => {
    if (!state.currentParty) return;

    try {
      const res = await fetch(`/api/groups/${state.currentParty.code}`);
      if (res.status === 404) {
        state.currentParty = null;
        state.currentMember = null;
        clearPartySession();
        clearInterval(state.partyPollTimer);
        renderActiveParty();
        updatePlayAgainButton();
        return;
      }
      const data = await res.json();
      const updated = data.group;

      if (state.currentMember && !updated.members.some(m => m.id === state.currentMember.id)) {
        state.currentParty = null;
        state.currentMember = null;
        clearPartySession();
        clearInterval(state.partyPollTimer);
        renderActiveParty();
        updatePlayAgainButton();
        return;
      }

      if (state.currentMember) {
        const me = updated.members.find(m => m.id === state.currentMember.id);
        if (me) {
          state.currentMember = me;
          savePartySession(updated, me);
        }
      }

      // Check if a new/next match was launched and we haven't entered it yet
      if (updated.status === 'IN_GAME' && updated.matchId && (!state.activeMatch || state.activeMatch.matchID !== updated.matchId)) {
        await transitionToNewMatch(updated);
        return;
      }

      state.currentParty = updated;
      renderActiveParty();
      updatePlayAgainButton();
    } catch (err) {
      console.warn('[POLL] Party sync error:', err.message);
    }
  }, 1200);
}

/**
 * Leave current party room
 */
export async function handleLeaveGroup() {
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
  clearPartySession();
  clearInterval(state.partyPollTimer);
  renderActiveParty();
  updatePlayAgainButton();
  showToast('Left party room', 'info');
}

/**
 * Copy party code to clipboard
 */
export function copyPartyCode() {
  if (!state.currentParty) return;
  navigator.clipboard.writeText(state.currentParty.code);
  showToast('Party code copied to clipboard!', 'success');
}
