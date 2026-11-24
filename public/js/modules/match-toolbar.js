/**
 * The Flying Dutchmen - In-Game Match Toolbar API
 *
 * Exposes a declarative API (`matchConfig.toolbar` / `window.tfdMatchToolbar`)
 * so game modules running inside Shadow DOM can populate the shared top toolbar:
 *
 *   Left:   [← Lobby] [Play Again*] [#Code] [Zoom Slider]
 *   Center: [Game Logo]
 *   Right:  [Other Links...] [Manual] [⚙ DevTools (incl. Save / Load State)]
 */

import { state, el, escapeHtml, isUserAdmin } from './state.js';
import { getLanguage, setLanguage } from './i18n.js';

let defaultConfig = {};
let currentConfig = {};
let zoomInputEl = null;
let zoomLabelEl = null;
let zoomHandlers = null;
let activeSaveLoad = null;
let audioBridge = null;
let lastNonZeroVolume = 1;
let devMenuOpen = false;
let outsideClickBound = false;
let utilityControlsBound = false;

function isCurrentUserAdmin() {
  if (isUserAdmin(state.currentUser)) return true;
  if (window.tfdNavbar && isUserAdmin(window.tfdNavbar.currentUser)) return true;
  return false;
}

function getStoragePrefix() {
  if (activeSaveLoad && activeSaveLoad.storageKey) return String(activeSaveLoad.storageKey);
  const gameId = (state.activeMatch && (state.activeMatch.catalogGameId || state.activeMatch.gameName)) || 'game';
  return `tfd_state_${gameId}`;
}

function closeDevMenu() {
  devMenuOpen = false;
  const menu = el('matchToolbarDevMenu');
  const btn = el('matchToolbarDevBtn');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function bindGlobalCloseListeners() {
  if (outsideClickBound) return;
  outsideClickBound = true;

  document.addEventListener('click', (e) => {
    if (!devMenuOpen) return;
    const host = el('matchToolbarDevTools');
    if (host && !host.contains(e.target)) {
      closeDevMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (devMenuOpen) closeDevMenu();
      closeManualModal();
      closeSaveLoadModal();
    }
  });
}

/* ==========================================================================
   Shared Full-Screen Manual Modal
   ========================================================================== */

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

/* ==========================================================================
   Shared Save / Load Game State Modal
   ========================================================================== */

function setSaveLoadStatus(msg, isError = false) {
  const statusEl = el('matchStateStatus');
  if (!statusEl) return;
  if (!msg) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    return;
  }
  statusEl.textContent = msg;
  statusEl.classList.toggle('is-error', Boolean(isError));
  statusEl.classList.remove('hidden');
}

function readSnapshots() {
  try {
    const raw = localStorage.getItem(`${getStoragePrefix()}_saved_snapshots`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function writeSnapshots(list) {
  localStorage.setItem(`${getStoragePrefix()}_saved_snapshots`, JSON.stringify(list));
}

function buildSnapshot(name = '') {
  if (!activeSaveLoad || typeof activeSaveLoad.getState !== 'function') {
    throw new Error('This game has not registered a getState() handler.');
  }
  const payload = activeSaveLoad.getState();
  if (!payload || typeof payload !== 'object') {
    throw new Error('No game state available to save.');
  }
  const cloned = JSON.parse(JSON.stringify(payload));
  return {
    ...cloned,
    id: Date.now().toString(),
    name: name || `Save ${new Date().toLocaleTimeString()}`,
    timestamp: new Date().toISOString(),
    formattedTime: new Date().toLocaleString()
  };
}

function applySnapshot(snapshot) {
  if (!activeSaveLoad || typeof activeSaveLoad.loadState !== 'function') {
    throw new Error('This game has not registered a loadState() handler.');
  }
  activeSaveLoad.loadState(snapshot);
}

function renderSnapshotsList() {
  const listEl = el('matchStateSnapshotsList');
  if (!listEl) return;
  const snapshots = readSnapshots();
  if (snapshots.length === 0) {
    listEl.innerHTML = '<div class="match-state-empty">No saved snapshots yet.</div>';
    return;
  }

  listEl.innerHTML = snapshots.map((snap) => {
    const metaParts = [
      snap.formattedTime || '',
      snap.phase ? String(snap.phase) : '',
      snap.turn !== undefined ? `Turn ${snap.turn}` : ''
    ].filter(Boolean).join(' · ');
    return `
      <div class="match-state-snap-row" data-snap-id="${escapeHtml(snap.id)}">
        <div class="match-state-snap-info">
          <div class="match-state-snap-name">${escapeHtml(snap.name || 'Snapshot')}</div>
          ${metaParts ? `<div class="match-state-snap-meta">${escapeHtml(metaParts)}</div>` : ''}
        </div>
        <div class="match-state-snap-actions">
          <button type="button" class="btn-pill match-toolbar-btn" data-action="load" data-snap-id="${escapeHtml(snap.id)}">Load</button>
          <button type="button" class="btn-pill btn-abandon-match" data-action="delete" data-snap-id="${escapeHtml(snap.id)}" title="Delete"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('button[data-action="load"]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-snap-id');
      const snap = readSnapshots().find((s) => String(s.id) === String(id));
      if (!snap) return;
      try {
        applySnapshot(snap);
        setSaveLoadStatus(`Loaded "${snap.name}".`);
        setTimeout(() => closeSaveLoadModal(), 500);
      } catch (err) {
        setSaveLoadStatus(`Load failed: ${err.message}`, true);
      }
    };
  });

  listEl.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-snap-id');
      try {
        writeSnapshots(readSnapshots().filter((s) => String(s.id) !== String(id)));
        renderSnapshotsList();
        setSaveLoadStatus('Snapshot deleted.');
      } catch (err) {
        setSaveLoadStatus(`Delete failed: ${err.message}`, true);
      }
    };
  });
}

function wireSaveLoadModalControls() {
  const modal = el('matchStateModal');
  if (!modal || modal.dataset.wired) return;
  modal.dataset.wired = '1';

  const btnQuickSave = el('matchStateQuickSave');
  const btnQuickLoad = el('matchStateQuickLoad');
  const btnSaveNamed = el('matchStateSaveNamed');
  const nameInput = el('matchStateNameInput');
  const btnCopyJson = el('matchStateCopyJson');
  const btnToggleImport = el('matchStateToggleImport');
  const importArea = el('matchStateImportArea');
  const importInput = el('matchStateImportInput');
  const btnImportJson = el('matchStateImportJson');

  if (btnQuickSave) {
    btnQuickSave.onclick = () => {
      try {
        const snap = buildSnapshot('Quick Save');
        localStorage.setItem(`${getStoragePrefix()}_quick_save`, JSON.stringify(snap));
        setSaveLoadStatus('Quick Save created.');
      } catch (err) {
        setSaveLoadStatus(`Quick Save failed: ${err.message}`, true);
      }
    };
  }

  if (btnQuickLoad) {
    btnQuickLoad.onclick = () => {
      try {
        const raw = localStorage.getItem(`${getStoragePrefix()}_quick_save`);
        if (!raw) {
          setSaveLoadStatus('No Quick Save found.', true);
          return;
        }
        applySnapshot(JSON.parse(raw));
        setSaveLoadStatus('Quick Save loaded.');
        setTimeout(() => closeSaveLoadModal(), 500);
      } catch (err) {
        setSaveLoadStatus(`Quick Load failed: ${err.message}`, true);
      }
    };
  }

  const doSaveNamed = () => {
    const label = nameInput ? nameInput.value.trim() : '';
    if (!label) {
      setSaveLoadStatus('Enter a snapshot name first.', true);
      return;
    }
    try {
      const snap = buildSnapshot(label);
      const updated = [snap, ...readSnapshots()];
      writeSnapshots(updated);
      if (nameInput) nameInput.value = '';
      renderSnapshotsList();
      setSaveLoadStatus(`Saved "${snap.name}".`);
    } catch (err) {
      setSaveLoadStatus(`Save failed: ${err.message}`, true);
    }
  };

  if (btnSaveNamed) btnSaveNamed.onclick = doSaveNamed;
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSaveNamed();
    });
  }

  if (btnCopyJson) {
    btnCopyJson.onclick = () => {
      try {
        const snap = buildSnapshot('Exported State');
        navigator.clipboard.writeText(JSON.stringify(snap, null, 2));
        setSaveLoadStatus('Game state JSON copied to clipboard.');
      } catch (err) {
        setSaveLoadStatus(`Copy failed: ${err.message}`, true);
      }
    };
  }

  if (btnToggleImport && importArea) {
    btnToggleImport.onclick = () => {
      importArea.classList.toggle('hidden');
    };
  }

  if (btnImportJson && importInput) {
    btnImportJson.onclick = () => {
      const raw = importInput.value.trim();
      if (!raw) {
        setSaveLoadStatus('Paste JSON state first.', true);
        return;
      }
      try {
        applySnapshot(JSON.parse(raw));
        importInput.value = '';
        if (importArea) importArea.classList.add('hidden');
        setSaveLoadStatus('Game state imported.');
        setTimeout(() => closeSaveLoadModal(), 500);
      } catch (err) {
        setSaveLoadStatus(`Invalid JSON: ${err.message}`, true);
      }
    };
  }
}

export function openSaveLoadModal() {
  const modal = el('matchStateModal');
  if (!modal) return;
  bindGlobalCloseListeners();
  wireSaveLoadModalControls();
  setSaveLoadStatus('');
  const importArea = el('matchStateImportArea');
  if (importArea) importArea.classList.add('hidden');
  renderSnapshotsList();
  modal.classList.remove('hidden');
}

export function closeSaveLoadModal() {
  const modal = el('matchStateModal');
  if (modal) modal.classList.add('hidden');
}

/* ==========================================================================
   Toolbar Slot Renderers
   ========================================================================== */

function renderLogo(logo) {
  const slot = el('matchToolbarLogo');
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
  wrapper.className = 'match-toolbar-brand';
  if (cfg.title) wrapper.title = cfg.title;

  if (cfg.src) {
    const img = document.createElement('img');
    img.src = cfg.src;
    img.alt = cfg.alt || cfg.text || 'Game Logo';
    img.className = `match-toolbar-logo-img${cfg.invert ? ' match-toolbar-logo-invert' : ''}`;
    if (cfg.height) img.style.height = typeof cfg.height === 'number' ? `${cfg.height}px` : cfg.height;
    wrapper.appendChild(img);
  }

  if (cfg.icon && !cfg.src) {
    const icon = document.createElement('i');
    icon.className = `bi ${cfg.icon} match-toolbar-brand-icon`;
    wrapper.appendChild(icon);
  }

  if (cfg.text) {
    const span = document.createElement('span');
    span.className = 'match-toolbar-brand-text';
    span.textContent = cfg.text;
    wrapper.appendChild(span);
  }

  slot.appendChild(wrapper);
  slot.classList.remove('hidden');
}

function renderManual(manual) {
  const slot = el('matchToolbarManual');
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
    link.className = 'btn-pill match-toolbar-btn';
    link.title = cfg.title || `Open ${label}`;
    link.innerHTML = `<i class="bi ${escapeHtml(iconCls)}"></i><span>${escapeHtml(label)}</span>`;
    slot.appendChild(link);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-pill match-toolbar-btn';
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
  const slot = el('matchToolbarLinks');
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
    node.className = `btn-pill match-toolbar-btn${item.active ? ' active' : ''}${item.variant ? ` match-toolbar-btn-${item.variant}` : ''}`;
    if (item.title) node.title = item.title;

    const iconHtml = item.icon ? `<i class="bi ${escapeHtml(item.icon)}"></i>` : '';
    const labelHtml = item.label ? `<span>${escapeHtml(item.label)}</span>` : '';
    node.innerHTML = `${iconHtml}${labelHtml}`;
    slot.appendChild(node);
  });

  slot.classList.remove('hidden');
}

function renderZoom(zoom) {
  const slot = el('matchToolbarZoom');
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
  pill.className = 'match-toolbar-zoom-pill';
  pill.title = zoom.title || 'Zoom board area';

  const icon = document.createElement('i');
  icon.className = 'bi bi-zoom-in match-toolbar-zoom-icon';

  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'match-toolbar-zoom-slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initialVal);
  input.setAttribute('aria-label', zoom.label || 'Board Zoom');

  const pct = document.createElement('button');
  pct.type = 'button';
  pct.className = 'match-toolbar-zoom-pct';
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
  const slot = el('matchToolbarDevTools');
  if (!slot) return;
  slot.innerHTML = '';
  devMenuOpen = false;

  const baseItems = Array.isArray(devTools) ? devTools.filter(Boolean) : [];
  const items = [...baseItems];

  // Auto-inject shared Save / Load State entry when game provides saveLoad handlers
  if (activeSaveLoad && typeof activeSaveLoad.getState === 'function' && typeof activeSaveLoad.loadState === 'function') {
    items.unshift({
      label: activeSaveLoad.label || 'Save / Load State',
      icon: 'bi-floppy',
      onClick: () => openSaveLoadModal()
    });
  }

  const allowShow = options.forceDevTools === true || isCurrentUserAdmin();

  if (items.length === 0 || !allowShow) {
    slot.classList.add('hidden');
    return;
  }

  bindGlobalCloseListeners();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'matchToolbarDevBtn';
  btn.className = `btn-pill match-toolbar-gear-btn${items.some((i) => i.active) ? ' active' : ''}`;
  btn.title = 'Developer Tools';
  btn.setAttribute('aria-label', 'Developer Tools');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<i class="bi bi-gear"></i>';

  const menu = document.createElement('div');
  menu.id = 'matchToolbarDevMenu';
  menu.className = 'match-toolbar-dev-menu hidden';
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
    elItem.className = `match-toolbar-dev-item${item.active ? ' active' : ''}${item.danger ? ' danger' : ''}${item.divider ? ' has-divider' : ''}`;
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

function syncAudioUI() {
  const icon = el('matchToolbarMuteIcon');
  const btn = el('matchToolbarMuteBtn');
  const slider = el('matchToolbarVolumeSlider');
  const audioState = audioBridge && typeof audioBridge.getAudioState === 'function'
    ? audioBridge.getAudioState()
    : { volume: 1, muted: false };
  const effectivelyMuted = Boolean(audioState.muted) || Number(audioState.volume) <= 0;

  if (slider && document.activeElement !== slider) {
    slider.value = String(effectivelyMuted ? 0 : audioState.volume);
  }
  if (icon) {
    icon.className = effectivelyMuted
      ? 'bi bi-volume-mute-fill'
      : (audioState.volume < 0.5 ? 'bi bi-volume-down-fill' : 'bi bi-volume-up-fill');
  }
  if (btn) {
    btn.classList.toggle('is-muted', effectivelyMuted);
    btn.title = effectivelyMuted ? 'Unmute' : 'Mute';
  }
}

function syncLangUI(lang) {
  const select = el('matchToolbarLangSelect');
  if (select && lang) {
    select.value = lang;
  }
}

function bindUtilityControls() {
  if (utilityControlsBound) {
    syncAudioUI();
    syncLangUI(getLanguage());
    return;
  }
  utilityControlsBound = true;

  const muteBtn = el('matchToolbarMuteBtn');
  const volSlider = el('matchToolbarVolumeSlider');
  const langSelect = el('matchToolbarLangSelect');

  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!audioBridge) return;
      const cur = audioBridge.getAudioState();
      const effectivelyMuted = cur.muted || cur.volume <= 0;
      if (effectivelyMuted) {
        const restoreVol = cur.volume > 0 ? cur.volume : (lastNonZeroVolume > 0 ? lastNonZeroVolume : 0.8);
        audioBridge.setAudioState({ volume: restoreVol, muted: false });
      } else {
        if (cur.volume > 0) lastNonZeroVolume = cur.volume;
        audioBridge.setAudioState({ muted: true });
      }
      syncAudioUI();
    });
  }

  if (volSlider) {
    volSlider.addEventListener('input', (e) => {
      if (!audioBridge) return;
      const val = parseFloat(e.target.value);
      if (val > 0) lastNonZeroVolume = val;
      audioBridge.setAudioState({ volume: val, muted: val <= 0 });
      syncAudioUI();
    });
  }

  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener('change', (e) => {
      const lang = e.target.value;
      setLanguage(lang);
      if (window.tfdNavbar && typeof window.tfdNavbar.setLanguage === 'function') {
        try { window.tfdNavbar.setLanguage(lang); } catch (_) {}
      }
      window.dispatchEvent(new CustomEvent('tfd-language-change', { detail: { language: lang } }));
    });
  }

  window.addEventListener('tfd-language-change', (e) => {
    const lang = e.detail && e.detail.language;
    if (lang) syncLangUI(lang);
  });

  window.addEventListener('languageChanged', (e) => {
    const lang = e.detail && e.detail.language;
    if (lang) syncLangUI(lang);
  });

  syncAudioUI();
}

function renderUtilitySlots(cfg) {
  const audioSlot = el('matchToolbarAudio');
  if (audioSlot) {
    const showAudio = Boolean(cfg.audio || cfg.volume);
    audioSlot.classList.toggle('hidden', !showAudio);
    if (showAudio) syncAudioUI();
  }

  const langSlot = el('matchToolbarLang');
  if (langSlot) {
    const showLang = Boolean(cfg.language);
    langSlot.classList.toggle('hidden', !showLang);
    if (showLang) syncLangUI(getLanguage());
  }

  const newGameBtn = el('matchToolbarNewGame');
  if (newGameBtn) {
    const showNewGame = Boolean(cfg.newGame);
    newGameBtn.classList.toggle('hidden', !showNewGame);
    newGameBtn.onclick = showNewGame && typeof cfg.onNewGame === 'function'
      ? () => cfg.onNewGame()
      : null;
  }
}

export const matchToolbar = {
  /** Connect the match-manager audio sandbox bridge to the toolbar's volume/mute controls */
  bindAudioBridge(bridge) {
    audioBridge = bridge || null;
    bindUtilityControls();
  },

  /**
   * Set manifest-backed default toolbar config (from game.json) and render it.
   * Any field omitted in subsequent configure() calls inherits from these defaults.
   * @param {object} defaults
   */
  setDefaults(defaults = {}) {
    defaultConfig = { ...(defaults || {}) };
    this.configure({});
  },

  /**
   * Configure game-specific items in the shared in-game toolbar.
   * Omitted keys inherit from game.json defaults; pass `null` to explicitly hide a default.
   * @param {object} options
   */
  configure(options = {}) {
    const opts = options || {};
    currentConfig = { ...defaultConfig, ...opts };
    if (opts.zoom === false || opts.zoom === null) {
      currentConfig.zoom = null;
    } else if (opts.zoom && typeof opts.zoom === 'object' && defaultConfig.zoom && typeof defaultConfig.zoom === 'object') {
      currentConfig.zoom = { ...defaultConfig.zoom, ...opts.zoom };
    }
    const saveLoadAllowed = defaultConfig.saveLoad !== false && opts.saveLoad !== false && opts.saveLoad !== null;
    activeSaveLoad = saveLoadAllowed && currentConfig.saveLoad && typeof currentConfig.saveLoad === 'object'
      ? currentConfig.saveLoad
      : null;
    renderLogo(currentConfig.logo);
    renderManual(currentConfig.manual);
    renderLinks(currentConfig.links);
    renderZoom(currentConfig.zoom);
    renderUtilitySlots(currentConfig);
    renderDevTools(currentConfig.devTools, currentConfig);
  },

  /** Alias for configure() */
  set(options = {}) {
    this.configure(options);
  },

  /**
   * Sync the zoom slider and percentage readout without rebuilding the toolbar.
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

  /** Open / close the lobby's built-in manual modal */
  openManual: openManualModal,
  closeManual: closeManualModal,

  /** Open / close the lobby's built-in Save / Load Game State modal */
  openSaveLoad: openSaveLoadModal,
  closeSaveLoad: closeSaveLoadModal,

  /** Reset all game-provided toolbar slots (called automatically on unmount) */
  reset() {
    defaultConfig = {};
    currentConfig = {};
    zoomInputEl = null;
    zoomLabelEl = null;
    zoomHandlers = null;
    activeSaveLoad = null;
    closeDevMenu();
    closeManualModal();
    closeSaveLoadModal();
    ['matchToolbarLogo', 'matchToolbarManual', 'matchToolbarLinks', 'matchToolbarZoom', 'matchToolbarDevTools'].forEach((id) => {
      const slot = el(id);
      if (slot) {
        slot.innerHTML = '';
        slot.classList.add('hidden');
      }
    });
    ['matchToolbarAudio', 'matchToolbarLang', 'matchToolbarNewGame'].forEach((id) => {
      const slot = el(id);
      if (slot) slot.classList.add('hidden');
    });
  }
};

window.tfdMatchToolbar = matchToolbar;
window.closeMatchManualModal = closeManualModal;
window.closeMatchStateModal = closeSaveLoadModal;
