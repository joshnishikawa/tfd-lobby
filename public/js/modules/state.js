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

/**
 * Simple prompt dialog helper for guest display name
 * @param {string} msg 
 * @returns {string | null}
 */
export function promptForName(msg = 'Enter your display name:') {
  const name = prompt(msg, 'Player');
  return name ? name.trim() : null;
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
