/**
 * The Flying Dutchmen - Lobby State Store & DOM Utilities
 */

export const state = {
  currentUser: null,
  games: [],
  selectedGameId: null,
  selectedGameMode: {},
  selectedPlayerCount: {},
  activeFlow: 'game', // 'game' | 'group'
  currentParty: null, // party object when in Group-First flow
  currentMember: null, // our member in the party
  partyPollTimer: null,
  activeMatch: null, // { gameName, matchID, playerID, credentials }
  boardgameClient: null,
  tablesPollTimer: null,
  isMatchOver: false,
};

export const API_ORIGIN = window.location.origin;

/**
 * Shorthand document.getElementById helper
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export const el = (id) => document.getElementById(id);

/**
 * Escapes unsafe HTML characters in a string
 * @param {string} str 
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const GUEST_NAME_KEY = 'tfd_guest_name';

/**
 * Retrieve saved guest display name from localStorage
 * @returns {string}
 */
export function getSavedGuestName() {
  try {
    return (localStorage.getItem(GUEST_NAME_KEY) || '').trim();
  } catch (e) {
    return '';
  }
}

/**
 * Persist guest display name to localStorage and sync UI inputs/badge
 * @param {string} name
 */
export function saveGuestName(name) {
  const trimmed = (name || '').trim();
  try {
    if (trimmed) {
      localStorage.setItem(GUEST_NAME_KEY, trimmed);
    } else {
      localStorage.removeItem(GUEST_NAME_KEY);
    }
  } catch (e) {}
  syncPlayerNameUI();
}

/**
 * Sync player name inputs and guest name field with current user or saved guest name
 */
export function syncPlayerNameUI() {
  const activeName = state.currentUser ? state.currentUser.username : getSavedGuestName();
  ['guestNameInput', 'createPlayerName', 'joinPlayerName', 'createPartyHostName', 'joinPartyMemberName'].forEach((id) => {
    const input = el(id);
    if (input && document.activeElement !== input) {
      input.value = activeName;
    }
  });

  const btn = el('guestNameBtn');
  if (!btn) return;

  if (state.currentUser) {
    btn.classList.add('hidden');
  } else {
    btn.classList.remove('hidden');
  }
}

/**
 * Resolve guest display name from inline field or saved state
 * @returns {string}
 */
export function promptForName() {
  const input = el('guestNameInput');
  const typed = input ? input.value.trim() : '';
  if (typed) {
    saveGuestName(typed);
    return typed;
  }
  return getSavedGuestName() || 'Player';
}

/**
 * Display non-blocking toast notification banner
 * @param {string} message 
 * @param {'info' | 'success' | 'warning' | 'error'} type 
 */
export function showToast(message, type = 'info') {
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

/**
 * Check whether a user object has admin privileges
 * @param {object | null} user 
 * @returns {boolean}
 */
export function isUserAdmin(user) {
  if (!user) return false;
  if (user.is_admin === true || user.isAdmin === true) return true;
  if (user.is_super_admin === true || user.isSuperAdmin === true) return true;
  if (user.admin_type === 'super' || user.admin_type === 'admin') return true;
  if (typeof user.role === 'string' && (user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'administrator')) return true;
  if (Array.isArray(user.roles) && user.roles.some(r => ['admin', 'administrator', 'administrators'].includes(String(r).toLowerCase()))) return true;
  if (Array.isArray(user.groups) && user.groups.some(g => ['admin', 'administrator', 'administrators'].includes(String(g).toLowerCase()))) return true;
  return false;
}

/**
 * Check whether a game is single-player only
 * @param {object | null} game 
 * @returns {boolean}
 */
export function isSinglePlayerGame(game) {
  if (!game) return false;
  if (game.maxPlayers === 1) return true;
  const playerCounts = game.playerCounts || (game.minPlayers ? [game.minPlayers] : []);
  if (Array.isArray(playerCounts) && playerCounts.length === 1 && playerCounts[0] === 1) return true;
  return false;
}

/**
 * Resolve the boardgame.io transport game ID (`sandbox-runner` for published sandboxes).
 * @param {object | string | null} gameOrId
 * @returns {string}
 */
export function getTransportGameId(gameOrId) {
  if (!gameOrId) return '';
  if (typeof gameOrId === 'string') {
    const found = state.games.find((g) => g.id === gameOrId);
    if (found) return found.runnerGameId || found.id;
    if (/^sandbox-\d+$/.test(gameOrId)) return 'sandbox-runner';
    return gameOrId;
  }
  return gameOrId.runnerGameId || gameOrId.id || '';
}

/**
 * Build boardgame.io `setupData` preserving `publishedSandboxId` for published sandboxes.
 * @param {object | string | null} gameOrId
 * @param {string} [mode]
 * @returns {object}
 */
export function buildMatchSetupData(gameOrId, mode = 'normal') {
  const game = typeof gameOrId === 'string' ? state.games.find((g) => g.id === gameOrId) : gameOrId;
  const setupData = { mode: mode || 'normal' };
  if (game && game.publishedSandboxId) {
    setupData.publishedSandboxId = Number(game.publishedSandboxId);
  } else if (typeof gameOrId === 'string') {
    const m = /^sandbox-(\d+)$/.exec(gameOrId);
    if (m) setupData.publishedSandboxId = Number(m[1]);
  }
  return setupData;
}

/**
 * Determine whether a boardgame.io match belongs to the given catalog game entry.
 * @param {object} match
 * @param {object | null} game
 * @returns {boolean}
 */
export function matchesCatalogGame(match, game) {
  if (!game) return true;
  const matchSandboxId = match && match.setupData && match.setupData.publishedSandboxId
    ? Number(match.setupData.publishedSandboxId)
    : null;
  if (game.isPublishedSandbox || game.publishedSandboxId) {
    return matchSandboxId === Number(game.publishedSandboxId);
  }
  return !matchSandboxId;
}
