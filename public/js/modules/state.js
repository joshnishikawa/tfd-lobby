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
  if (!trimmed) return;
  try {
    localStorage.setItem(GUEST_NAME_KEY, trimmed);
  } catch (e) {}
  syncPlayerNameUI();
}

/**
 * Sync player name inputs and guest name badge with current user or saved guest name
 */
export function syncPlayerNameUI() {
  const activeName = state.currentUser ? state.currentUser.username : getSavedGuestName();
  ['createPlayerName', 'joinPlayerName', 'createPartyHostName', 'joinPartyMemberName'].forEach((id) => {
    const input = el(id);
    if (input && activeName) {
      input.value = activeName;
    }
  });

  const btn = el('guestNameBtn');
  const label = el('guestNameDisplay');
  if (!btn || !label) return;

  if (state.currentUser) {
    btn.classList.add('hidden');
  } else {
    const guestName = getSavedGuestName();
    label.textContent = guestName || 'Set Display Name';
    btn.classList.remove('hidden');
  }
}

/**
 * Simple prompt dialog helper for guest display name
 * @param {string} msg 
 * @param {boolean} [forcePrompt=false]
 * @returns {string | null}
 */
export function promptForName(msg = 'Enter your display name:', forcePrompt = false) {
  const saved = getSavedGuestName();
  if (!forcePrompt && saved) {
    return saved;
  }
  const name = prompt(msg, saved || 'Player');
  if (name === null) return null;
  const trimmed = name.trim();
  if (trimmed) {
    saveGuestName(trimmed);
    return trimmed;
  }
  return null;
}

/**
 * Prompt guest user to set or change their saved display name
 */
export function editGuestName() {
  promptForName('Enter your display name:', true);
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
