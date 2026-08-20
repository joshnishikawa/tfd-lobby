/**
 * The Flying Dutchmen - Multi-Game Lobby Orchestrator
 * 
 * Modular architecture:
 * - modules/state.js: Shared application state and DOM/toast helpers
 * - modules/games-view.js: Games catalog, mode selection, and quick matchmaking
 * - modules/tables-modals.js: Tables listing, polling, and create/join table modals
 * - modules/party-lounge.js: Party lounge rooms, session persistence, and group launch
 * - modules/match-manager.js: Active match lifecycle, game board mounting, and rematch coordination
 */

import { state, el, isUserAdmin } from './modules/state.js';
import { translateDOM, setLanguage, getLanguage } from './modules/i18n.js';
import {
  loadGamesCatalog,
  selectGameMode,
  selectPlayerCount,
  renderGamesCatalog,
  selectGame,
  handleQuickMatch
} from './modules/games-view.js';
import {
  refreshTables,
  startTablesPolling,
  openCreateTableModal,
  updateCreateModalPlayerOptions,
  closeCreateTableModal,
  submitCreateTable,
  openJoinTableModal,
  closeJoinTableModal,
  submitJoinTable
} from './modules/tables-modals.js';
import {
  savePartySession,
  clearPartySession,
  restorePartySession,
  renderPartyGameOptions,
  updatePartyGamePreview,
  handleCreateGroup,
  handleJoinGroup,
  renderActiveParty,
  handleToggleReady,
  handleHostGameChange,
  handleLaunchPartyGame,
  startPartyPolling,
  handleLeaveGroup,
  copyPartyCode
} from './modules/party-lounge.js';
import {
  enterMatch,
  exitToLobby,
  checkActiveMatchBanner,
  resumeActiveMatch,
  abandonActiveMatch,
  mountGameClient,
  renderDefaultGamePlaceholder,
  syncMatchParty,
  handlePlayAgain,
  createDirectRematch,
  updatePlayAgainButton,
  transitionToNewMatch,
  registerMatchCallbacks
} from './modules/match-manager.js';

// Setup input listeners for Enter keys & syncing nickname
function setupPartyInputs() {
  const createHostInput = el('createPartyHostName');
  const joinMemberInput = el('joinPartyMemberName');
  const partyCodeInput = el('inputPartyCode');

  if (createHostInput) {
    createHostInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCreateGroup();
    });
    createHostInput.addEventListener('input', () => {
      if (joinMemberInput && !joinMemberInput.dataset.touched) {
        joinMemberInput.value = createHostInput.value;
      }
    });
  }

  if (joinMemberInput) {
    joinMemberInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJoinGroup();
    });
    joinMemberInput.addEventListener('input', () => {
      joinMemberInput.dataset.touched = 'true';
    });
  }

  if (partyCodeInput) {
    partyCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJoinGroup();
    });
  }
}

// Flow Switching (Quick Match vs Party Lounge)
export function switchFlow(flow) {
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
      viewGroup.classList.add('hidden');
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
      viewGame.classList.add('hidden');
    }
    renderPartyGameOptions();
    renderActiveParty();
  }
}

// Register callbacks in match manager to prevent circular module dependencies
registerMatchCallbacks({
  switchFlow,
  leaveGroup: handleLeaveGroup,
  startPartyPolling
});

// Window global bindings for HTML template inline onclick handlers
window.switchFlow = switchFlow;
window.handleQuickMatch = handleQuickMatch;
window.selectGameMode = selectGameMode;
window.selectPlayerCount = selectPlayerCount;
window.selectGame = selectGame;
window.refreshTables = refreshTables;
window.openCreateTableModal = openCreateTableModal;
window.updateCreateModalPlayerOptions = updateCreateModalPlayerOptions;
window.closeCreateTableModal = closeCreateTableModal;
window.submitCreateTable = submitCreateTable;
window.openJoinTableModal = openJoinTableModal;
window.closeJoinTableModal = closeJoinTableModal;
window.submitJoinTable = submitJoinTable;
window.handleCreateGroup = handleCreateGroup;
window.handleJoinGroup = handleJoinGroup;
window.handleToggleReady = handleToggleReady;
window.handleHostGameChange = handleHostGameChange;
window.handleLaunchPartyGame = handleLaunchPartyGame;
window.handleLeaveGroup = handleLeaveGroup;
window.copyPartyCode = copyPartyCode;
window.exitToLobby = exitToLobby;
window.handlePlayAgain = handlePlayAgain;
window.resumeActiveMatch = resumeActiveMatch;
window.abandonActiveMatch = abandonActiveMatch;

window.setMatchGameOver = function(isOver = true) {
  state.isMatchOver = Boolean(isOver);
  updatePlayAgainButton();
};

window.clearActiveMatchState = function() {
  state.isMatchOver = true;
  updatePlayAgainButton();
};

// Handle language changes dynamically
function handleLanguageChange(lang) {
  setLanguage(lang);
  translateDOM();
  if (state.activeFlow === 'game') {
    renderGamesCatalog();
  } else {
    renderPartyGameOptions();
    renderActiveParty();
  }
  checkActiveMatchBanner();
  updatePlayAgainButton();
}

window.addEventListener('tfd-language-change', (e) => {
  const lang = e.detail && e.detail.language;
  if (lang) handleLanguageChange(lang);
});

window.addEventListener('languageChanged', (e) => {
  const lang = e.detail && e.detail.language;
  if (lang) handleLanguageChange(lang);
});

// Listen to SSO auth updates from shared tfd-navbar
window.addEventListener('tfd-auth-change', (e) => {
  const user = e.detail && e.detail.user;
  const prevIsAdmin = isUserAdmin(state.currentUser);
  state.currentUser = user;
  if (user) {
    if (el('createPlayerName')) el('createPlayerName').value = user.username;
    if (el('joinPlayerName')) el('joinPlayerName').value = user.username;
    if (el('createPartyHostName')) el('createPartyHostName').value = user.username;
    if (el('joinPartyMemberName')) el('joinPartyMemberName').value = user.username;
  }
  const newIsAdmin = isUserAdmin(user);
  if (newIsAdmin !== prevIsAdmin) {
    loadGamesCatalog(newIsAdmin);
  }
});

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  translateDOM();
  await loadGamesCatalog();
  startTablesPolling();
  await restorePartySession(switchFlow);
  checkActiveMatchBanner();
  setupPartyInputs();
});
