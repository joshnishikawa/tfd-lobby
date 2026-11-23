/**
 * The Flying Dutchmen - In-Game Match Navbar API
 *
 * Exposes a clean declarative API (`matchConfig.navbar` / `window.tfdMatchNavbar`)
 * so game modules running inside Shadow DOM can populate the shared top strip:
 *
 *   [← Lobby] [Play Again] [Game Logo] [Manual] [Links...] [Zoom Slider]   ...   [⚙ DevTools]
 */

import { state, el, escapeHtml, isUserAdmin } from './state.js';

let currentConfig = {};
let zoomInputEl = null;
let zoomLabelEl = null;
let zoomHandlers = null;
let devMenuOpen = false;
let outsideClickBound = false;

function isCurrentUserAdmin() {
  if (isUserAdmin(state.currentUser)) return true;
  if (window.tfdNavbar && isUserAdmin(window.tfdNavbar.currentUser)) return true;
  return false;
}

function closeDevMenu() {
  devMenuOpen = false;
  const menu = el('matchNavDevMenu');
  const btn = el('matchNavDevBtn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function bindGlobalCloseListeners() {
  if (outsideClickBound) return;
  outsideClickBound = true;

  document.addEventListener('click', (e) => {
    if (!devMenuOpen) return;
    const host = el('matchNavDevTools');
    if (host && !host.contains(e.target)) {
      closeDevMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (devMenuOpen) closeDevMenu();
      closeManualModal();
    }
  });
}

export function openManualModal({ title = 'Game Manual', url = null, html = null } = {}) {
  const modal = el('matchManualModal');
  const bodyEl = el('matchManualBody');
  const extLink = el('matchManualExtLink');
  if (!modal || !bodyEl) return;

  if (extLink) {
    if (url) {
      extLink.href = url;
      extLink.classList.remove('hidden');
    } else {
      extLink.classList.add('hidden');
    }
  }

  bodyEl.innerHTML = '';
  if (url) {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = title || 'Game Manual';
    iframe.className = 'match-manual-iframe';
    bodyEl.appendChild(iframe);
  } else if (html) {
    const content = document.createElement('div');
    content.className = 'match-manual-content';
    content.innerHTML = html;
    bodyEl.appendChild(content);
  }

  modal.classList.remove('hidden');
}

export function closeManualModal() {
  const modal = el('matchManualModal');
  const bodyEl = el('matchManualBody');
  if (modal) modal.classList.add('hidden');
  if (bodyEl) bodyEl.innerHTML = '';
}

function renderLogo(logo) {
  const slot = el('matchNavLogo');
  if (!slot) return;
  slot.innerHTML = '';

  if (!logo) {
    slot.classList.add('hidden');
    return;
  }

  const cfg = typeof logo === 'string' ? { src: logo } : logo;
  const wrapper = document.createElement(cfg.onClick ? 'button' : 'div');
  if (cfg.onClick) {
    wrapper.type = 'button';
    wrapper.onclick = cfg.onClick;
  }
  wrapper.className = 'match-nav-brand';
  if (cfg.title) wrapper.title = cfg.title;

  if (cfg.src) {
    const img = document.createElement('img');
    img.src = cfg.src;
    img.alt = cfg.alt || cfg.text || 'Game Logo';
    img.className = `match-nav-logo-img${cfg.invert ? ' match-nav-logo-invert' : ''}`;
    if (cfg.height) img.style.height = typeof cfg.height === 'number' ? `${cfg.height}px` : cfg.height;
    wrapper.appendChild(img);
  }

  if (cfg.icon && !cfg.src) {
    const icon = document.createElement('i');
    icon.className = `bi ${cfg.icon} match-nav-brand-icon`;
    wrapper.appendChild(icon);
  }

  if (cfg.text) {
    const span = document.createElement('span');
    span.className = 'match-nav-brand-text';
    span.textContent = cfg.text;
    wrapper.appendChild(span);
  }

  slot.appendChild(wrapper);
  slot.classList.remove('hidden');
}

function renderManual(manual) {
  const slot = el('matchNavManual');
  if (!slot) return;
  slot.innerHTML = '';

  if (!manual) {
    slot.classList.add('hidden');
    return;
  }

  const cfg = typeof manual === 'string' ? { url: manual } : manual;
  const label = cfg.label || 'Manual';
  const iconCls = cfg.icon || 'bi-book';

  if (cfg.url && !cfg.modal && !cfg.onClick) {
    const link = document.createElement('a');
    link.href = cfg.url;
    link.target = cfg.target || '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'btn-pill match-nav-btn';
    link.title = cfg.title || `Open ${label}`;
    link.innerHTML = `<i class="bi ${escapeHtml(iconCls)}"></i><span>${escapeHtml(label)}</span>`;
    slot.appendChild(link);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-pill match-nav-btn';
    btn.title = cfg.title || `Open ${label}`;
    btn.innerHTML = `<i class="bi ${escapeHtml(iconCls)}"></i><span>${escapeHtml(label)}</span>`;
    btn.onclick = () => {
      if (typeof cfg.onClick === 'function') {
        cfg.onClick();
      } else {
        openManualModal({
          title: cfg.title || label,
          url: cfg.url || null,
          html: cfg.html || null
        });
      }
    };
    slot.appendChild(btn);
  }

  slot.classList.remove('hidden');
}

function renderLinks(links) {
  const slot = el('matchNavLinks');
  if (!slot) return;
  slot.innerHTML = '';

  if (!Array.isArray(links) || links.length === 0) {
    slot.classList.add('hidden');
    return;
  }

  links.forEach((item) => {
    if (!item) return;
    const isLink = Boolean(item.url && !item.onClick);
    const node = document.createElement(isLink ? 'a' : 'button');
    if (isLink) {
      node.href = item.url;
      node.target = item.target || '_blank';
      node.rel = 'noopener noreferrer';
    } else {
      node.type = 'button';
      if (typeof item.onClick === 'function') {
        node.onclick = item.onClick;
      }
    }
    if (item.id) node.id = item.id;
    node.className = `btn-pill match-nav-btn${item.active ? ' active' : ''}${item.variant ? ` match-nav-btn-${item.variant}` : ''}`;
    if (item.title) node.title = item.title;

    const iconHtml = item.icon ? `<i class="bi ${escapeHtml(item.icon)}"></i>` : '';
    const labelHtml = item.label ? `<span>${escapeHtml(item.label)}</span>` : '';
    node.innerHTML = `${iconHtml}${labelHtml}`;
    slot.appendChild(node);
  });

  slot.classList.remove('hidden');
}

function renderZoom(zoom) {
  const slot = el('matchNavZoom');
  if (!slot) return;

  if (!zoom || typeof zoom !== 'object') {
    zoomInputEl = null;
    zoomLabelEl = null;
    zoomHandlers = null;
    slot.innerHTML = '';
    slot.classList.add('hidden');
    return;
  }

  const min = zoom.min !== undefined ? Number(zoom.min) : 0.5;
  const max = zoom.max !== undefined ? Number(zoom.max) : 2;
  const step = zoom.step !== undefined ? Number(zoom.step) : 0.01;
  const initialVal = zoom.value !== undefined ? Number(zoom.value) : 1;

  zoomHandlers = {
    onChange: zoom.onChange,
    onReset: zoom.onReset,
    defaultValue: zoom.defaultValue !== undefined ? Number(zoom.defaultValue) : 1
  };

  // Reuse existing slider DOM if already mounted so re-configuring never interrupts an active drag
  if (zoomInputEl && zoomLabelEl && slot.contains(zoomInputEl)) {
    zoomInputEl.min = String(min);
    zoomInputEl.max = String(max);
    zoomInputEl.step = String(step);
    if (document.activeElement !== zoomInputEl) {
      zoomInputEl.value = String(Math.min(max, Math.max(min, initialVal)));
    }
    zoomLabelEl.textContent = `${Math.round(initialVal * 100)}%`;
    slot.classList.remove('hidden');
    return;
  }

  slot.innerHTML = '';

  const pill = document.createElement('div');
  pill.className = 'match-nav-zoom-pill';
  pill.title = zoom.title || 'Zoom board area';

  const icon = document.createElement('i');
  icon.className = 'bi bi-zoom-in match-nav-zoom-icon';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'match-nav-zoom-slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initialVal);
  input.setAttribute('aria-label', zoom.label || 'Board Zoom');

  const pct = document.createElement('button');
  pct.type = 'button';
  pct.className = 'match-nav-zoom-pct';
  pct.title = 'Click to reset zoom';
  pct.textContent = `${Math.round(initialVal * 100)}%`;

  input.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    pct.textContent = `${Math.round(val * 100)}%`;
    if (zoomHandlers && typeof zoomHandlers.onChange === 'function') {
      zoomHandlers.onChange(val);
    }
  });

  pct.addEventListener('click', () => {
    if (zoomHandlers && typeof zoomHandlers.onReset === 'function') {
      zoomHandlers.onReset();
    } else {
      const resetVal = zoomHandlers ? zoomHandlers.defaultValue : 1;
      input.value = String(resetVal);
      pct.textContent = `${Math.round(resetVal * 100)}%`;
      if (zoomHandlers && typeof zoomHandlers.onChange === 'function') {
        zoomHandlers.onChange(resetVal);
      }
    }
  });

  pill.appendChild(icon);
  pill.appendChild(input);
  pill.appendChild(pct);
  slot.appendChild(pill);
  slot.classList.remove('hidden');

  zoomInputEl = input;
  zoomLabelEl = pct;
}

function renderDevTools(devTools, options = {}) {
  const slot = el('matchNavDevTools');
  if (!slot) return;
  slot.innerHTML = '';
  devMenuOpen = false;

  const items = Array.isArray(devTools) ? devTools.filter(Boolean) : [];
  const allowShow = options.forceDevTools === true || isCurrentUserAdmin();

  if (items.length === 0 || !allowShow) {
    slot.classList.add('hidden');
    return;
  }

  bindGlobalCloseListeners();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'matchNavDevBtn';
  btn.className = `btn-pill match-nav-gear-btn${items.some((i) => i.active) ? ' active' : ''}`;
  btn.title = 'Developer Tools';
  btn.setAttribute('aria-label', 'Developer Tools');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i class="bi bi-gear"></i>';

  const menu = document.createElement('div');
  menu.id = 'matchNavDevMenu';
  menu.className = 'match-nav-dev-menu hidden';
  menu.setAttribute('role', 'menu');

  items.forEach((item) => {
    const isLink = Boolean(item.url && !item.onClick);
    const elItem = document.createElement(isLink ? 'a' : 'button');
    if (isLink) {
      elItem.href = item.url;
      elItem.target = item.target || '_blank';
      elItem.rel = 'noopener noreferrer';
    } else {
      elItem.type = 'button';
    }
    elItem.setAttribute('role', 'menuitem');
    elItem.className = `match-nav-dev-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}${item.divider ? ' has-divider' : ''}`;
    if (item.title) elItem.title = item.title;

    const labelSpan = document.createElement('span');
    labelSpan.textContent = item.label || item.name || 'Tool';
    elItem.appendChild(labelSpan);

    if (item.icon) {
      const icon = document.createElement('i');
      icon.className = `bi ${item.icon}`;
      elItem.appendChild(icon);
    }

    elItem.addEventListener('click', () => {
      closeDevMenu();
      if (typeof item.onClick === 'function') {
        item.onClick();
      }
    });

    menu.appendChild(elItem);
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    devMenuOpen = !devMenuOpen;
    menu.classList.toggle('hidden', !devMenuOpen);
    btn.setAttribute('aria-expanded', String(devMenuOpen));
  });

  slot.appendChild(btn);
  slot.appendChild(menu);
  slot.classList.remove('hidden');
}

export const matchNavbar = {
  /**
   * Configure game-specific items in the shared in-game navbar.
   * @param {object} options
   */
  configure(options = {}) {
    currentConfig = { ...(options || {}) };
    renderLogo(currentConfig.logo);
    renderManual(currentConfig.manual);
    renderLinks(currentConfig.links);
    renderZoom(currentConfig.zoom);
    renderDevTools(currentConfig.devTools, currentConfig);
  },

  /** Alias for configure() */
  set(options = {}) {
    this.configure(options);
  },

  /**
   * Sync the zoom slider and percentage readout without rebuilding the navbar.
   * @param {number} value
   */
  updateZoom(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    if (zoomInputEl && document.activeElement !== zoomInputEl) {
      const min = parseFloat(zoomInputEl.min);
      const max = parseFloat(zoomInputEl.max);
      const clamped = Math.min(max, Math.max(min, num));
      zoomInputEl.value = String(clamped);
    }
    if (zoomLabelEl) {
      zoomLabelEl.textContent = `${Math.round(num * 100)}%`;
    }
  },

  /** Open the lobby's built-in manual modal directly */
  openManual: openManualModal,

  /** Close the lobby's built-in manual modal */
  closeManual: closeManualModal,

  /** Reset all game-provided navbar slots (called automatically on unmount) */
  reset() {
    currentConfig = {};
    zoomInputEl = null;
    zoomLabelEl = null;
    zoomHandlers = null;
    closeDevMenu();
    closeManualModal();
    ['matchNavLogo', 'matchNavManual', 'matchNavLinks', 'matchNavZoom', 'matchNavDevTools'].forEach((id) => {
      const slot = el(id);
      if (slot) {
        slot.innerHTML = '';
        slot.classList.add('hidden');
      }
    });
  }
};

window.tfdMatchNavbar = matchNavbar;
window.closeMatchManualModal = closeManualModal;
