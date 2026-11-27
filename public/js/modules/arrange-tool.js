/**
 * Shared Admin "Arrange Components" Floating Toolbar for tfd-lobby games.
 * Games register callbacks via `window.tfdMatchToolbar.configure({ arrange: { ... } })`
 * and update live selection/state via `window.tfdMatchToolbar.updateArrange(...)`.
 */
import { escapeHtml } from './state.js';

let panelEl = null;
let dragState = null;
let panelPos = null;
let showImport = false;
let viewOpen = false;
let viewStep = 1;
let spotStep = 1;
let currentCfg = null;
let globalListenersBound = false;

function bindDragListeners() {
  if (globalListenersBound) return;
  globalListenersBound = true;

  window.addEventListener('pointermove', (e) => {
    if (!dragState || !panelEl) return;
    const x = Math.max(8, Math.min(window.innerWidth - Math.min(dragState.w, window.innerWidth - 16) - 8, e.clientX - dragState.ox));
    const y = Math.max(8, Math.min(window.innerHeight - Math.min(dragState.h, 60) - 8, e.clientY - dragState.oy));
    panelPos = { x, y };
    panelEl.style.left = `${x}px`;
    panelEl.style.top = `${y}px`;
    panelEl.style.right = 'auto';
  });

  window.addEventListener('pointerup', () => {
    dragState = null;
  });
}

function ensurePanel() {
  if (panelEl && document.body.contains(panelEl)) return panelEl;
  panelEl = document.createElement('div');
  panelEl.id = 'matchArrangePanel';
  panelEl.className = 'match-arrange-panel hidden';
  document.body.appendChild(panelEl);
  bindDragListeners();
  return panelEl;
}

function nudgePadHtml(prefix, stepLabel) {
  return `
    <div class="arrange-nudge-pad">
      <span></span>
      <button type="button" class="arrange-btn arrange-btn-icon" data-act="${prefix}-up" title="Move Up (${escapeHtml(stepLabel)})"><i class="bi bi-arrow-up"></i></button>
      <span></span>
      <button type="button" class="arrange-btn arrange-btn-icon" data-act="${prefix}-left" title="Move Left (${escapeHtml(stepLabel)})"><i class="bi bi-arrow-left"></i></button>
      <span class="arrange-nudge-step">${escapeHtml(stepLabel)}</span>
      <button type="button" class="arrange-btn arrange-btn-icon" data-act="${prefix}-right" title="Move Right (${escapeHtml(stepLabel)})"><i class="bi bi-arrow-right"></i></button>
      <span></span>
      <button type="button" class="arrange-btn arrange-btn-icon" data-act="${prefix}-down" title="Move Down (${escapeHtml(stepLabel)})"><i class="bi bi-arrow-down"></i></button>
      <span></span>
    </div>
  `;
}

export function renderArrangePanel(cfg) {
  currentCfg = cfg && cfg.active ? cfg : null;
  if (!currentCfg) {
    if (panelEl) panelEl.classList.add('hidden');
    showImport = false;
    return;
  }

  const root = ensurePanel();
  const c = currentCfg;
  const selected = Array.isArray(c.selectedKeys) ? c.selectedKeys : [];
  const spots = c.spots || {};
  const fmt = typeof c.formatLabel === 'function' ? c.formatLabel : (k) => k;
  const firstSpot = selected.length > 0 ? (spots[selected[0]] || {}) : {};
  const activeAngle = firstSpot.rot !== undefined ? Math.round(firstSpot.rot) : 0;
  const activeScalePct = firstSpot.scale !== undefined ? Math.round(firstSpot.scale * 100) : 100;

  const togglesHtml = (c.toggles || []).map((t, idx) => `
    <button type="button" class="arrange-chip" data-toggle-idx="${idx}" title="${escapeHtml(t.title || '')}">${escapeHtml(t.label)}</button>
  `).join('');

  const groupsHtml = (c.groups || []).map((g, idx) => `
    <button type="button" class="arrange-chip" data-group-idx="${idx}">${escapeHtml(g.label)}</button>
  `).join('');

  const selectedSummary = selected.length > 5
    ? `${selected.slice(0, 5).map(fmt).join(', ')} +${selected.length - 5}`
    : selected.map(fmt).join(', ');

  root.innerHTML = `
    <div class="arrange-header" data-drag-handle="1" title="Drag to move">
      <div class="arrange-title-row">
        <span class="arrange-title"><i class="bi bi-grip-vertical"></i> ${escapeHtml(c.title || 'Arrange Components')}</span>
        <button type="button" class="arrange-close" data-act="close" title="Exit Arrange" aria-label="Exit Arrange">&times;</button>
      </div>
    </div>

    <div class="arrange-body">
      <div class="arrange-toolbar-grid">
        ${c.onSaveDraft ? '<button type="button" class="arrange-btn arrange-btn-success" data-act="save"><i class="bi bi-floppy"></i> Save</button>' : ''}
        ${c.onResetDraft ? '<button type="button" class="arrange-btn arrange-btn-danger" data-act="reset"><i class="bi bi-arrow-counterclockwise"></i> Reset</button>' : ''}
        ${c.onCopyJson ? `<button type="button" class="arrange-btn" data-act="copy"><i class="bi bi-clipboard"></i> ${c.copied ? 'Copied!' : 'Copy'}</button>` : ''}
        ${c.onImportJson ? `<button type="button" class="arrange-btn ${showImport ? 'arrange-btn-primary' : ''}" data-act="toggle-import"><i class="bi bi-clipboard-check"></i> Paste</button>` : ''}
      </div>

      ${showImport ? `
        <div class="arrange-import-box">
          <textarea class="arrange-textarea" id="arrangeImportText" rows="4" placeholder="Paste exported layout JSON here..."></textarea>
          <div class="arrange-inline-row" style="justify-content: flex-end;">
            <button type="button" class="arrange-btn" data-act="toggle-import">Cancel</button>
            <button type="button" class="arrange-btn arrange-btn-primary" data-act="apply-import">Load JSON</button>
          </div>
        </div>
      ` : ''}

      ${c.statusMsg ? `<div class="arrange-status">${escapeHtml(c.statusMsg)}</div>` : ''}

      ${togglesHtml ? `<div class="arrange-inline-row">${togglesHtml}</div>` : ''}

      <div class="arrange-section">
        <div class="arrange-section-head">
          <span>Select</span>
          <div class="arrange-inline-row">
            <button type="button" class="arrange-chip" data-act="select-all">All</button>
            ${selected.length > 0 ? `<button type="button" class="arrange-chip arrange-chip-danger" data-act="clear-sel">Clear (${selected.length})</button>` : ''}
          </div>
        </div>
        ${groupsHtml ? `<div class="arrange-chips">${groupsHtml}</div>` : ''}
        ${selected.length === 0 ? '<div class="arrange-hint">Click any spot on the board to edit (Shift+click for multi-select).</div>' : ''}
      </div>

      ${selected.length > 0 ? `
        <div class="arrange-section">
          <div class="arrange-section-head">
            <span>Selected (${selected.length})</span>
            <span class="arrange-selected-names">${escapeHtml(selectedSummary)}</span>
          </div>

          ${c.onNudge ? `
            <div class="arrange-control-row">
              <div class="arrange-control-meta">
                <span class="arrange-control-label">Move</span>
                <div class="arrange-segmented">
                  ${[1, 5, 10].map((px) => `<button type="button" class="arrange-seg-btn ${spotStep === px ? 'active' : ''}" data-spot-step="${px}">${px}px</button>`).join('')}
                </div>
              </div>
              ${nudgePadHtml('spot', `${spotStep}px`)}
            </div>
          ` : ''}

          ${c.onRotate ? `
            <div class="arrange-control-block">
              <div class="arrange-section-head">
                <span class="arrange-control-label">Rotate</span>
                <span class="arrange-metric">${activeAngle}°</span>
              </div>
              <div class="arrange-inline-row">
                ${[-45, -5, -1].map((d) => `<button type="button" class="arrange-btn arrange-btn-xs" data-rot="${d}">${d}°</button>`).join('')}
                ${c.onSetAngle ? `<input type="number" class="arrange-input" id="arrangeAngleInput" value="${escapeHtml(c.angleInput ?? activeAngle)}" aria-label="Angle degrees" />` : ''}
                ${[1, 5, 45].map((d) => `<button type="button" class="arrange-btn arrange-btn-xs" data-rot="${d}">+${d}°</button>`).join('')}
                <button type="button" class="arrange-btn arrange-btn-xs arrange-btn-primary" data-rot="180" title="Flip 180°">180°</button>
              </div>
            </div>
          ` : ''}

          ${selected.length > 1 && c.onGroupRotate ? `
            <div class="arrange-control-block">
              <div class="arrange-section-head">
                <span class="arrange-control-label">Group Orbit</span>
              </div>
              <div class="arrange-inline-row">
                ${[-5, -1, 1, 5].map((d) => `<button type="button" class="arrange-btn arrange-btn-xs" data-grot="${d}">${d < 0 ? `↺ ${d}°` : `↻ +${d}°`}</button>`).join('')}
              </div>
            </div>
          ` : ''}

          ${c.onScale ? `
            <div class="arrange-control-block">
              <div class="arrange-section-head">
                <span class="arrange-control-label">Scale</span>
                <span class="arrange-metric">${activeScalePct}%</span>
              </div>
              <div class="arrange-inline-row">
                ${[-0.25, -0.05].map((d) => `<button type="button" class="arrange-btn arrange-btn-xs" data-scale="${d}">${Math.round(d * 100)}%</button>`).join('')}
                ${c.onSetScale ? `<input type="number" class="arrange-input" id="arrangeScaleInput" value="${escapeHtml(c.scaleInput ?? activeScalePct)}" aria-label="Scale percent" />` : ''}
                ${[0.05, 0.25].map((d) => `<button type="button" class="arrange-btn arrange-btn-xs" data-scale="${d}">+${Math.round(d * 100)}%</button>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      ` : ''}

      ${c.view ? `
        <details class="arrange-section arrange-details" ${viewOpen ? 'open' : ''}>
          <summary class="arrange-section-head arrange-summary">
            <span>${escapeHtml(c.view.label || 'Board View')}</span>
            ${c.view.metrics ? `<span class="arrange-metric">${escapeHtml(c.view.metrics)}</span>` : ''}
          </summary>
          <div class="arrange-control-row" style="margin-top: 6px;">
            <div class="arrange-control-meta">
              <div class="arrange-segmented">
                ${[1, 5].map((s) => `<button type="button" class="arrange-seg-btn ${viewStep === s ? 'active' : ''}" data-view-step="${s}">${s}% / ${s}°</button>`).join('')}
              </div>
              <div class="arrange-inline-row">
                <button type="button" class="arrange-btn arrange-btn-xs" data-act="view-rot-l">↺ -${viewStep}°</button>
                <button type="button" class="arrange-btn arrange-btn-xs" data-act="view-rot-r">↻ +${viewStep}°</button>
                <button type="button" class="arrange-btn arrange-btn-xs" data-act="view-reset">Reset</button>
              </div>
            </div>
            ${nudgePadHtml('view', `${viewStep}%`)}
          </div>
        </details>
      ` : ''}
    </div>
  `;

  if (panelPos) {
    root.style.left = `${panelPos.x}px`;
    root.style.top = `${panelPos.y}px`;
    root.style.right = 'auto';
  }
  root.classList.remove('hidden');

  const detailsEl = root.querySelector('.arrange-details');
  if (detailsEl) detailsEl.ontoggle = () => { viewOpen = detailsEl.open; };

  const handle = root.querySelector('[data-drag-handle]');
  if (handle) {
    handle.onpointerdown = (e) => {
      if (e.target.closest('button, input, textarea')) return;
      const r = root.getBoundingClientRect();
      dragState = { ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height };
    };
  }

  root.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn || !currentCfg) return;
    const act = btn.dataset.act;
    if (act === 'close') currentCfg.onToggle?.();
    else if (act === 'save') currentCfg.onSaveDraft?.();
    else if (act === 'reset') currentCfg.onResetDraft?.();
    else if (act === 'copy') currentCfg.onCopyJson?.();
    else if (act === 'toggle-import') { showImport = !showImport; renderArrangePanel(currentCfg); }
    else if (act === 'apply-import') {
      const txt = root.querySelector('#arrangeImportText')?.value || '';
      if (currentCfg.onImportJson?.(txt)) { showImport = false; renderArrangePanel(currentCfg); }
    } else if (act === 'select-all') currentCfg.onSelect?.(Object.keys(currentCfg.spots || {}));
    else if (act === 'clear-sel') currentCfg.onSelect?.([]);
    else if (act === 'view-up') currentCfg.view?.onNudge?.(0, -viewStep);
    else if (act === 'view-down') currentCfg.view?.onNudge?.(0, viewStep);
    else if (act === 'view-left') currentCfg.view?.onNudge?.(-viewStep, 0);
    else if (act === 'view-right') currentCfg.view?.onNudge?.(viewStep, 0);
    else if (act === 'view-rot-l') currentCfg.view?.onRotate?.(-viewStep);
    else if (act === 'view-rot-r') currentCfg.view?.onRotate?.(viewStep);
    else if (act === 'view-reset') currentCfg.view?.onReset?.();
    else if (act === 'spot-up') currentCfg.onNudge?.(0, -spotStep);
    else if (act === 'spot-down') currentCfg.onNudge?.(0, spotStep);
    else if (act === 'spot-left') currentCfg.onNudge?.(-spotStep, 0);
    else if (act === 'spot-right') currentCfg.onNudge?.(spotStep, 0);
    else if (btn.dataset.toggleIdx !== undefined) currentCfg.toggles?.[Number(btn.dataset.toggleIdx)]?.onClick?.();
    else if (btn.dataset.groupIdx !== undefined) currentCfg.onSelect?.(currentCfg.groups?.[Number(btn.dataset.groupIdx)]?.keys || []);
    else if (btn.dataset.viewStep !== undefined) { viewStep = Number(btn.dataset.viewStep); renderArrangePanel(currentCfg); }
    else if (btn.dataset.spotStep !== undefined) { spotStep = Number(btn.dataset.spotStep); renderArrangePanel(currentCfg); }
    else if (btn.dataset.rot !== undefined) currentCfg.onRotate?.(Number(btn.dataset.rot));
    else if (btn.dataset.scale !== undefined) currentCfg.onScale?.(Number(btn.dataset.scale));
    else if (btn.dataset.grot !== undefined) currentCfg.onGroupRotate?.(Number(btn.dataset.grot));
  };

  const angleEl = root.querySelector('#arrangeAngleInput');
  if (angleEl) angleEl.oninput = (e) => currentCfg?.onSetAngle?.(e.target.value);
  const scaleEl = root.querySelector('#arrangeScaleInput');
  if (scaleEl) scaleEl.oninput = (e) => currentCfg?.onSetScale?.(e.target.value);
}

export function resetArrangePanel() {
  currentCfg = null;
  showImport = false;
  viewOpen = false;
  panelPos = null;
  if (panelEl) {
    panelEl.classList.add('hidden');
    panelEl.innerHTML = '';
  }
}
