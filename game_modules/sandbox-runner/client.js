/**
 * Shadow DOM Client Adapter for Published Board Game Studio Sandboxes.
 * Follows all /tfd_lobby guardrails:
 *  - Zero global document.querySelector / getElementById for game elements
 *  - Scoped strictly inside mountRoot
 *  - Full teardown in unmountClient()
 */
(function () {
  'use strict';

  window.GameModules = window.GameModules || {};

  const GAME_ID = 'sandbox-runner';

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  let activeCleanup = null;

  function mountClient(container, config) {
    if (!container) return;
    unmountClient();

    const matchID = (config && config.matchID) || '';
    const playerID = config && config.playerID !== undefined ? String(config.playerID) : '0';
    const credentials = (config && config.credentials) || '';
    const playerName = (config && config.playerName) || 'Admin';
    const gameTitle = (config && config.gameTitle) || 'Sandbox Playtest';

    container.innerHTML = `
      <div class="sr-root" tabindex="0">
        <header class="sr-topbar">
          <div class="sr-top-left">
            <span class="sr-title" title="${escapeHtml(gameTitle)}">${escapeHtml(gameTitle)}</span>
            <span class="sr-badge-admin">Admin Playtest</span>
          </div>
          <div class="sr-top-center" id="srTurnBar"></div>
          <div class="sr-top-right">
            <button type="button" class="sr-btn" id="srBtnCenter">Center View</button>
            <button type="button" class="sr-btn sr-btn-amber" id="srBtnReset">Reset Table</button>
          </div>
        </header>

        <div class="sr-middle">
          <section class="sr-viewport" id="srViewport" tabindex="0">
            <div class="sr-world" id="srWorld">
              <div class="sr-grid-surface"></div>
              <div class="sr-layer" id="srLayerBoards"></div>
              <div class="sr-layer" id="srLayerZones"></div>
              <div class="sr-layer" id="srLayerCards"></div>
              <div class="sr-layer" id="srLayerTokens"></div>
              <div class="sr-layer" id="srLayerNotes"></div>
            </div>
            <div class="sr-canvas-hud" id="srCanvasHud"></div>
            <div class="sr-zoom-preview hidden" id="srZoomPreview"></div>
          </section>

          <aside class="sr-dock">
            <div class="sr-dock-section" id="srResourcesPanel"></div>
            <div class="sr-log-section" id="srLogPanel"></div>
          </aside>
        </div>

        <footer class="sr-hand-tray" id="srHandTray"></footer>
        <div class="sr-context-menu hidden" id="srContextMenu"></div>
        <div class="sr-modal-backdrop hidden" id="srModalBackdrop">
          <div class="sr-modal-card" id="srModalCard"></div>
        </div>
      </div>
    `;

    const q = (sel) => container.querySelector(sel);
    const rootEl = q('.sr-root');
    const viewportEl = q('#srViewport');
    const worldEl = q('#srWorld');
    const turnBarEl = q('#srTurnBar');
    const layerBoards = q('#srLayerBoards');
    const layerZones = q('#srLayerZones');
    const layerCards = q('#srLayerCards');
    const layerTokens = q('#srLayerTokens');
    const layerNotes = q('#srLayerNotes');
    const hudEl = q('#srCanvasHud');
    const zoomPreviewEl = q('#srZoomPreview');
    const resourcesEl = q('#srResourcesPanel');
    const logEl = q('#srLogPanel');
    const handTrayEl = q('#srHandTray');
    const ctxMenuEl = q('#srContextMenu');
    const modalBackdrop = q('#srModalBackdrop');
    const modalCard = q('#srModalCard');

    let currentGameState = null;
    let matchData = null;
    let selectedIds = [];
    let hoveredId = null;
    let soloSeatOverride = Number(playerID) + 1;
    let isSpaceDown = false;
    let isAltDown = false;
    let dragState = null;
    let hasAutoFitted = false;
    let socket = null;

    const cam = { x: 240, y: 140, scale: 0.85 };

    function getViewportRect() {
      const rect = viewportEl.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width > 0 ? rect.width : (window.innerWidth || 1024) - 300,
        height: rect.height > 0 ? rect.height : (window.innerHeight || 768) - 240
      };
    }

    function applyCamera() {
      worldEl.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
      renderCanvasHud();
    }

    function screenToWorld(clientX, clientY) {
      const rect = getViewportRect();
      return {
        x: (clientX - rect.left - cam.x) / cam.scale,
        y: (clientY - rect.top - cam.y) / cam.scale
      };
    }

    function zoomBy(factor, clientX, clientY) {
      const rect = getViewportRect();
      const cx = clientX !== undefined ? clientX - rect.left : rect.width / 2;
      const cy = clientY !== undefined ? clientY - rect.top : rect.height / 2;
      const nextScale = Math.min(2.5, Math.max(0.2, cam.scale * factor));
      const ratio = nextScale / cam.scale;
      cam.x = cx - (cx - cam.x) * ratio;
      cam.y = cy - (cy - cam.y) * ratio;
      cam.scale = nextScale;
      applyCamera();
    }

    function fitCameraToObjects() {
      if (!currentGameState || !currentGameState.G) return;
      const G = currentGameState.G;
      const inDeckIds = new Set();
      Object.values(G.boardObjects || {}).forEach((o) => {
        if (o && o.type === 'DECK' && Array.isArray(o.cardIds)) {
          o.cardIds.forEach((cid) => inDeckIds.add(cid));
        }
      });
      const visible = Object.values(G.boardObjects || {}).filter(
        (o) => o && (o.ownerSeat === undefined || o.ownerSeat === null) && !(o.type === 'CARD' && inDeckIds.has(o.id))
      );
      if (visible.length === 0) {
        cam.x = 240;
        cam.y = 140;
        cam.scale = 0.85;
        applyCamera();
        return;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      visible.forEach((o) => {
        const x = Number(o.x) || 0;
        const y = Number(o.y) || 0;
        const w = Number(o.width) || 140;
        const h = Number(o.height) || 200;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
      });
      const rect = getViewportRect();
      const bw = Math.max(200, maxX - minX);
      const bh = Math.max(200, maxY - minY);
      const scale = Math.min(1.05, Math.max(0.28, Math.min((rect.width - 100) / bw, (rect.height - 100) / bh)));
      cam.scale = scale;
      cam.x = Math.round(rect.width / 2 - ((minX + maxX) / 2) * scale);
      cam.y = Math.round(rect.height / 2 - ((minY + maxY) / 2) * scale);
      applyCamera();
    }

    function sendMove(moveName, argsArray = []) {
      if (!socket || !currentGameState) return;
      const action = {
        type: 'MAKE_MOVE',
        payload: {
          type: moveName,
          args: argsArray,
          playerID: String(playerID),
          credentials
        }
      };
      socket.emit('update', action, currentGameState._stateID, matchID, String(playerID));
    }

    function getMySeatIndex(G) {
      const seats = (G && G.seats) || [];
      if (seats.length <= 1) {
        return soloSeatOverride || 1;
      }
      return Number(playerID) + 1;
    }

    function closeContextMenu() {
      ctxMenuEl.classList.add('hidden');
    }

    function showContextMenu(clientX, clientY, items) {
      ctxMenuEl.innerHTML = items
        .map((it, idx) =>
          it.divider
            ? '<div class="sr-ctx-divider"></div>'
            : `<button type="button" class="sr-ctx-item" data-ctx-idx="${idx}">
                <span>${escapeHtml(it.label)}</span>
                ${it.shortcut ? `<span style="color:#64748b;font-family:monospace">${escapeHtml(it.shortcut)}</span>` : ''}
              </button>`
        )
        .join('');
      ctxMenuEl.style.left = `${Math.min((window.innerWidth || 1024) - 210, clientX)}px`;
      ctxMenuEl.style.top = `${Math.min((window.innerHeight || 768) - 220, clientY)}px`;
      ctxMenuEl.classList.remove('hidden');

      ctxMenuEl.querySelectorAll('.sr-ctx-item').forEach((btn) => {
        btn.onclick = () => {
          const item = items[Number(btn.getAttribute('data-ctx-idx'))];
          closeContextMenu();
          if (item && typeof item.action === 'function') item.action();
        };
      });
    }

    function closeModal() {
      modalBackdrop.classList.add('hidden');
      modalCard.innerHTML = '';
    }

    function openDeckSearchModal(deck) {
      if (!currentGameState || !currentGameState.G) return;
      const G = currentGameState.G;
      const cardIds = Array.isArray(deck.cardIds) ? deck.cardIds : [];
      const cards = cardIds.map((id, idx) => ({ idx, card: G.boardObjects[id] })).filter((x) => x.card);

      modalCard.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b;padding-bottom:8px;">
          <div>
            <div style="font-size:15px;font-weight:800;color:#fff;">Search / Peek: ${escapeHtml(deck.name || 'Deck')}</div>
            <div style="font-size:11px;color:#94a3b8;">${cardIds.length} card(s) in deck</div>
          </div>
          <button type="button" class="sr-btn" id="srModalClose">Close</button>
        </div>
        <div class="sr-modal-grid">
          ${cards.length === 0
            ? '<div style="grid-column:1/-1;text-align:center;color:#64748b;padding:24px;">Deck is empty.</div>'
            : cards
                .map(
                  ({ idx, card }) => `
              <div class="sr-modal-item">
                <div>
                  <div style="font-size:10px;color:#64748b;">#${idx + 1} from top</div>
                  <div style="font-weight:700;color:#f1f5f9;margin-top:2px;">${escapeHtml(card.name || 'Hidden Card')}</div>
                </div>
                <button type="button" class="sr-btn sr-btn-sky" data-take-card="${escapeHtml(card.id)}">Take to Hand</button>
              </div>
            `
                )
                .join('')}
        </div>
      `;
      modalCard.querySelector('#srModalClose').onclick = closeModal;
      modalCard.querySelectorAll('button[data-take-card]').forEach((btn) => {
        btn.onclick = () => {
          const cid = btn.getAttribute('data-take-card');
          sendMove('takeSpecificCardToHand', [{ cardId: cid, fromDeckId: deck.id, seatIndex: getMySeatIndex(G) }]);
          closeModal();
        };
      });
      modalBackdrop.classList.remove('hidden');
    }

    function updateZoomPreview() {
      if (!isAltDown || !hoveredId || !currentGameState || !currentGameState.G) {
        zoomPreviewEl.classList.add('hidden');
        return;
      }
      const card = currentGameState.G.boardObjects[hoveredId];
      if (!card || card.type !== 'CARD') {
        zoomPreviewEl.classList.add('hidden');
        return;
      }
      const peekingIds = Array.isArray(card.peekingUserIds) ? card.peekingUserIds.map(String) : [];
      const canSee = Boolean(card.faceUp || peekingIds.includes(String(playerID)));
      zoomPreviewEl.classList.remove('hidden');
      zoomPreviewEl.innerHTML = `
        <div style="font-weight:800;font-size:13px;color:#fff;">${escapeHtml(canSee ? (card.name || 'Card') : 'Face-Down Card')}</div>
        ${canSee && card.frontImageUrl ? `<img src="${escapeHtml(card.frontImageUrl)}" alt="">` : ''}
        <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">
          ${canSee
            ? Object.entries(card.metadata || {})
                .map(([k, v]) => `<div><span style="color:#94a3b8">${escapeHtml(k)}:</span> <strong>${escapeHtml(v)}</strong></div>`)
                .join('') || 'No metadata'
            : 'Right-click → Peek Privately to inspect.'}
        </div>
      `;
    }

    function renderCanvasHud() {
      const pct = Math.round(cam.scale * 100);
      hudEl.innerHTML = `
        <div class="sr-hud-pill">
          <button type="button" id="srZoomOut">−</button>
          <span style="font-family:monospace;min-width:38px;text-align:center;">${pct}%</span>
          <button type="button" id="srZoomIn">+</button>
          <button type="button" id="srZoomFit" style="border-left:1px solid #334155;padding-left:8px;color:#94a3b8;">Center</button>
        </div>
        <div class="sr-hud-pill" style="color:#94a3b8;">
          <span><strong style="color:#e2e8f0">Space+Drag</strong> Pan · <strong style="color:#e2e8f0">F</strong> Flip · <strong style="color:#e2e8f0">T</strong> Tap · <strong style="color:#e2e8f0">R</strong> Rotate · <strong style="color:#e2e8f0">Alt</strong> Preview</span>
        </div>
      `;
      hudEl.querySelector('#srZoomOut').onclick = () => zoomBy(0.85);
      hudEl.querySelector('#srZoomIn').onclick = () => zoomBy(1.15);
      hudEl.querySelector('#srZoomFit').onclick = () => fitCameraToObjects();
    }

    function renderTurnBar(G) {
      const ts = G.turnState || { activeSeat: 1, roundNumber: 1, currentPhase: 'Action Phase' };
      const seats = G.seats || [];
      const activeSeatObj = seats.find((s) => Number(s.seatIndex) === Number(ts.activeSeat)) || seats[0];
      turnBarEl.innerHTML = `
        <div class="sr-turn-pill">
          <span style="font-weight:800;color:#94a3b8;">R${Number(ts.roundNumber) || 1}</span>
          <span style="color:#475569;">·</span>
          <span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;color:#fff;">
            <span class="sr-seat-dot" style="background:${escapeHtml(activeSeatObj ? activeSeatObj.color : '#38BDF8')}"></span>
            ${escapeHtml(activeSeatObj ? activeSeatObj.playerName : `Seat ${ts.activeSeat}`)}
          </span>
          <span class="sr-phase-chip">${escapeHtml(ts.currentPhase || 'Action')}</span>
          <button type="button" class="sr-btn sr-btn-primary" id="srNextPhaseBtn" style="padding:2px 8px;">Next →</button>
        </div>
      `;
      turnBarEl.querySelector('#srNextPhaseBtn').onclick = () => sendMove('advancePhaseOrTurn', []);
    }

    function renderBoardObjects(G) {
      layerBoards.innerHTML = '';
      layerZones.innerHTML = '';
      layerCards.innerHTML = '';
      layerTokens.innerHTML = '';
      layerNotes.innerHTML = '';

      const objs = Object.values(G.boardObjects || {});
      const inDeckIds = new Set();
      objs.forEach((o) => {
        if (o && o.type === 'DECK' && Array.isArray(o.cardIds)) {
          o.cardIds.forEach((cid) => inDeckIds.add(cid));
        }
      });

      const attachDrag = (el, obj) => {
        el.addEventListener('pointerenter', () => {
          hoveredId = obj.id;
          updateZoomPreview();
        });
        el.addEventListener('pointerleave', () => {
          if (hoveredId === obj.id) hoveredId = null;
          updateZoomPreview();
        });
        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || isSpaceDown) return;
          e.stopPropagation();
          closeContextMenu();
          if (!selectedIds.includes(obj.id)) {
            selectedIds = [obj.id];
          }
          if (obj.type === 'SPAWNER') {
            const pt = screenToWorld(e.clientX, e.clientY);
            sendMove('spawnFromSpawner', [{ spawnerId: obj.id, x: pt.x + 12, y: pt.y + 12 }]);
            return;
          }
          if (obj.isLocked) {
            renderAll();
            return;
          }
          const startWorld = screenToWorld(e.clientX, e.clientY);
          dragState = {
            kind: 'OBJECT',
            id: obj.id,
            el,
            startWorldX: startWorld.x,
            startWorldY: startWorld.y,
            origX: Number(obj.x) || 0,
            origY: Number(obj.y) || 0,
            moved: false
          };
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectedIds = [obj.id];
          const items = [];
          if (obj.type === 'CARD') {
            items.push({ label: obj.faceUp ? 'Flip Face-Down' : 'Flip Face-Up', shortcut: 'F', action: () => sendMove('flipCards', [[obj.id]]) });
            items.push({ label: obj.isTapped ? 'Untap / Ready' : 'Tap 90°', shortcut: 'T', action: () => sendMove('tapCards', [[obj.id]]) });
            items.push({ label: 'Peek Privately', action: () => sendMove('togglePeekCard', [obj.id]) });
            items.push({ label: 'Take into Hand', action: () => sendMove('takeSpecificCardToHand', [{ cardId: obj.id, seatIndex: getMySeatIndex(G) }]) });
          } else if (obj.type === 'DECK') {
            items.push({ label: 'Draw 1 Card', action: () => sendMove('drawCards', [{ deckId: obj.id, count: 1, seatIndex: getMySeatIndex(G) }]) });
            items.push({ label: 'Draw 3 Cards', action: () => sendMove('drawCards', [{ deckId: obj.id, count: 3, seatIndex: getMySeatIndex(G) }]) });
            items.push({ label: 'Shuffle Deck', action: () => sendMove('shuffleDeck', [obj.id]) });
            items.push({ label: 'Search / Peek Deck...', action: () => openDeckSearchModal(obj) });
          } else if (obj.type === 'DIE') {
            items.push({ label: `Roll d${obj.faces || 6}`, action: () => sendMove('rollDie', [obj.id]) });
          }
          if (items.length > 0) items.push({ divider: true });
          items.push({ label: 'Rotate +90°', shortcut: 'R', action: () => sendMove('rotateObjects', [{ objectIds: [obj.id], deltaDeg: 90 }]) });
          items.push({ label: obj.isLocked ? 'Unlock' : 'Lock', action: () => sendMove('toggleLock', [[obj.id]]) });
          showContextMenu(e.clientX, e.clientY, items);
        });
      };

      // 1. Boards
      objs
        .filter((o) => o && o.type === 'BOARD')
        .sort((a, b) => (a.zIndex || 100) - (b.zIndex || 100))
        .forEach((board) => {
          const el = document.createElement('div');
          el.className = `sr-obj sr-board ${board.isLocked ? 'locked' : ''} ${selectedIds.includes(board.id) ? 'is-selected' : ''}`;
          el.style.left = `${board.x || 0}px`;
          el.style.top = `${board.y || 0}px`;
          el.style.width = `${board.width || 800}px`;
          el.style.height = `${board.height || 600}px`;
          el.style.zIndex = String(board.zIndex || 100);
          el.style.transform = `rotate(${board.rotation || 0}deg)`;
          if (board.fill) el.style.backgroundColor = board.fill;
          if (board.imageUrl) {
            el.style.backgroundImage = `url("${board.imageUrl}")`;
            el.style.backgroundSize = '100% 100%';
            el.style.backgroundPosition = 'center';
            el.style.backgroundRepeat = 'no-repeat';
          }
          el.innerHTML = `<span class="sr-board-badge">${escapeHtml(board.name || 'Board')}${board.isLocked ? ' 🔒' : ''}</span>`;
          attachDrag(el, board);
          layerBoards.appendChild(el);
        });

      // 2. Zones
      (G.zones || []).forEach((zone) => {
        const zEl = document.createElement('div');
        zEl.className = 'sr-obj sr-zone';
        zEl.style.left = `${zone.x || 0}px`;
        zEl.style.top = `${zone.y || 0}px`;
        zEl.style.width = `${zone.width || 620}px`;
        zEl.style.height = `${zone.height || 220}px`;
        zEl.style.zIndex = '220';
        zEl.innerHTML = `
          <div class="sr-zone-header">
            <span>${escapeHtml(zone.name || 'Zone')}</span>
            <span style="font-size:10px;opacity:0.8;">${escapeHtml(zone.zoneType || 'SNAP_ZONE')}</span>
          </div>
        `;
        zEl.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 || isSpaceDown) return;
          e.stopPropagation();
          const startWorld = screenToWorld(e.clientX, e.clientY);
          dragState = {
            kind: 'ZONE',
            id: zone.id,
            el: zEl,
            startWorldX: startWorld.x,
            startWorldY: startWorld.y,
            origX: Number(zone.x) || 0,
            origY: Number(zone.y) || 0,
            moved: false
          };
        });
        layerZones.appendChild(zEl);
      });

      // 3. Decks
      objs
        .filter((o) => o && o.type === 'DECK')
        .sort((a, b) => (a.zIndex || 310) - (b.zIndex || 310))
        .forEach((deck) => {
          const count = Array.isArray(deck.cardIds) ? deck.cardIds.length : 0;
          const el = document.createElement('div');
          el.className = `sr-obj sr-deck ${selectedIds.includes(deck.id) ? 'is-selected' : ''}`;
          el.style.left = `${deck.x || 0}px`;
          el.style.top = `${deck.y || 0}px`;
          el.style.width = `${deck.width || 140}px`;
          el.style.height = `${deck.height || 200}px`;
          el.style.zIndex = String(deck.zIndex || 310);
          el.style.transform = `rotate(${deck.rotation || 0}deg)`;
          el.innerHTML = `
            <div class="sr-deck-head">
              <span class="sr-deck-title">${escapeHtml(deck.name || 'Deck')}</span>
              <span class="sr-deck-count">${count}</span>
            </div>
            <div class="sr-deck-mid">${deck.faceUp ? 'Face-Up Stack' : 'Face-Down Stack'}</div>
            <div class="sr-deck-actions">
              <button type="button" class="sr-deck-btn draw" data-dact="draw" ${count === 0 ? 'disabled' : ''}>Draw 1</button>
              <button type="button" class="sr-deck-btn" data-dact="shuffle">Shuffle</button>
              <button type="button" class="sr-deck-btn" data-dact="search">Search</button>
            </div>
          `;
          el.querySelectorAll('button[data-dact]').forEach((btn) => {
            btn.addEventListener('pointerdown', (e) => e.stopPropagation());
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              const act = btn.getAttribute('data-dact');
              if (act === 'draw') sendMove('drawCards', [{ deckId: deck.id, count: 1, seatIndex: getMySeatIndex(G) }]);
              if (act === 'shuffle') sendMove('shuffleDeck', [deck.id]);
              if (act === 'search') openDeckSearchModal(deck);
            });
          });
          attachDrag(el, deck);
          layerCards.appendChild(el);
        });

      // 4. Cards on table
      objs
        .filter((o) => o && o.type === 'CARD' && (o.ownerSeat === null || o.ownerSeat === undefined) && !inDeckIds.has(o.id))
        .sort((a, b) => (a.zIndex || 350) - (b.zIndex || 350))
        .forEach((card) => {
          const el = document.createElement('div');
          const peekingIds = Array.isArray(card.peekingUserIds) ? card.peekingUserIds.map(String) : [];
          const isPeekingSelf = peekingIds.includes(String(playerID));
          const showFront = Boolean(card.faceUp || isPeekingSelf);
          const rot = Number(card.rotation) || (card.isTapped ? 90 : 0);

          el.className = `sr-obj sr-card ${selectedIds.includes(card.id) ? 'is-selected' : ''}`;
          el.style.left = `${card.x || 0}px`;
          el.style.top = `${card.y || 0}px`;
          el.style.width = `${card.width || 140}px`;
          el.style.height = `${card.height || 200}px`;
          el.style.zIndex = String(card.zIndex || 350);
          el.style.transform = `rotate(${rot}deg)`;

          if (showFront) {
            if (card.frontImageUrl) {
              el.innerHTML = `
                <img class="sr-card-img" src="${escapeHtml(card.frontImageUrl)}" alt="${escapeHtml(card.name || 'Card')}">
                ${card.isTapped ? '<span class="sr-tap-pill">90°</span>' : ''}
                ${peekingIds.length > 0 ? '<span class="sr-peek-pill">👁 Peek</span>' : ''}
              `;
            } else {
              const pills = Object.entries(card.metadata || {})
                .slice(0, 3)
                .map(([k, v]) => `<span class="sr-meta-pill">${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong></span>`)
                .join('');
              el.innerHTML = `
                <div class="sr-card-fallback">
                  <div class="sr-card-title">${escapeHtml(card.name || 'Card')}</div>
                  <div class="sr-card-meta">${pills}</div>
                </div>
                ${card.isTapped ? '<span class="sr-tap-pill">90°</span>' : ''}
                ${peekingIds.length > 0 ? '<span class="sr-peek-pill">👁 Peek</span>' : ''}
              `;
            }
          } else {
            el.innerHTML = `
              <div class="sr-card-back">
                <div class="sr-card-back-circle">TFD</div>
                <span style="font-size:10px;color:#94a3b8;font-weight:600;">Face Down</span>
              </div>
              ${peekingIds.length > 0 ? '<span class="sr-peek-pill">👁 Peeking</span>' : ''}
            `;
          }

          el.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            sendMove('tapCards', [[card.id]]);
          });
          attachDrag(el, card);
          layerCards.appendChild(el);
        });

      // 5. Tokens, Spawners, Dice
      objs
        .filter((o) => o && (o.type === 'TOKEN' || o.type === 'SPAWNER' || o.type === 'DIE'))
        .sort((a, b) => (a.zIndex || 500) - (b.zIndex || 500))
        .forEach((item) => {
          const el = document.createElement('div');
          el.className = `sr-obj ${selectedIds.includes(item.id) ? 'is-selected' : ''}`;
          el.style.left = `${item.x || 0}px`;
          el.style.top = `${item.y || 0}px`;
          el.style.width = `${item.width || 56}px`;
          el.style.height = `${item.height || 56}px`;
          el.style.zIndex = String(item.zIndex || 500);
          el.style.transform = `rotate(${item.rotation || 0}deg)`;

          if (item.type === 'SPAWNER') {
            el.classList.add('sr-spawner');
            el.innerHTML = `
              ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : ''}
              <span style="font-size:9px;font-weight:800;color:#6ee7b7;line-height:1.1;">${escapeHtml(item.name || 'Supply')}</span>
              <span style="font-size:8px;color:#34d399;">∞ Click/Drag</span>
            `;
          } else if (item.type === 'DIE') {
            const faces = Number(item.faces) || 6;
            const val = item.value || 1;
            const label = Array.isArray(item.customFaces) && item.customFaces[val - 1] ? item.customFaces[val - 1] : String(val);
            el.classList.add('sr-die');
            el.innerHTML = `
              <span class="sr-die-val">${escapeHtml(label)}</span>
              <span class="sr-die-sub">d${faces} · Roll</span>
            `;
            el.addEventListener('click', (e) => {
              if (el.dataset.wasDragged === '1') {
                el.dataset.wasDragged = '0';
                return;
              }
              e.stopPropagation();
              sendMove('rollDie', [item.id]);
            });
          } else {
            el.classList.add('sr-token');
            if (item.imageUrl) {
              el.innerHTML = `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || 'Token')}">`;
            } else {
              el.classList.add('sr-token-circle');
              el.style.backgroundColor = item.color || '#E53935';
              el.innerHTML = `<span>${escapeHtml((item.name || 'T').slice(0, 4))}</span>`;
            }
          }

          attachDrag(el, item);
          layerTokens.appendChild(el);
        });

      // 6. Sticky Notes (Read-only display)
      (G.notes || []).forEach((note) => {
        const nEl = document.createElement('div');
        nEl.className = 'sr-obj sr-note';
        nEl.style.left = `${note.x || 0}px`;
        nEl.style.top = `${note.y || 0}px`;
        nEl.style.width = '180px';
        nEl.style.zIndex = '680';
        nEl.innerHTML = `
          <div style="font-weight:800;font-size:10px;margin-bottom:3px;">📌 ${escapeHtml(note.author || 'Note')}</div>
          <div>${escapeHtml(note.text || '')}</div>
        `;
        layerNotes.appendChild(nEl);
      });
    }

    function renderResources(G) {
      const seats = G.seats || [];
      const seatIdx = getMySeatIndex(G);
      const seat = seats.find((s) => Number(s.seatIndex) === seatIdx) || seats[0];
      if (!seat) {
        resourcesEl.innerHTML = '';
        return;
      }
      const resources = seat.resources || { Money: 10, VP: 0 };
      const keys = Object.keys(resources);

      resourcesEl.innerHTML = `
        <div class="sr-dock-title">
          <span style="display:flex;align-items:center;gap:6px;">
            <span class="sr-seat-dot" style="background:${escapeHtml(seat.color)}"></span>
            <span>${escapeHtml(seat.playerName)} Stats</span>
          </span>
        </div>
        ${keys
          .map(
            (key) => `
          <div class="sr-res-row">
            <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;max-width:85px;" title="${escapeHtml(key)}">${escapeHtml(key)}</span>
            <div class="sr-res-btns">
              <button type="button" class="sr-res-btn" data-rkey="${escapeHtml(key)}" data-rdelta="-5">-5</button>
              <button type="button" class="sr-res-btn" data-rkey="${escapeHtml(key)}" data-rdelta="-1">-1</button>
              <input type="number" class="sr-res-val" data-rexact="${escapeHtml(key)}" value="${Number(resources[key]) || 0}">
              <button type="button" class="sr-res-btn" data-rkey="${escapeHtml(key)}" data-rdelta="1">+1</button>
              <button type="button" class="sr-res-btn" data-rkey="${escapeHtml(key)}" data-rdelta="5">+5</button>
            </div>
          </div>
        `
          )
          .join('')}
      `;

      resourcesEl.querySelectorAll('button[data-rdelta]').forEach((btn) => {
        btn.onclick = () =>
          sendMove('adjustResource', [
            {
              seatIndex: seat.seatIndex,
              key: btn.getAttribute('data-rkey'),
              delta: Number(btn.getAttribute('data-rdelta'))
            }
          ]);
      });
      resourcesEl.querySelectorAll('input[data-rexact]').forEach((inp) => {
        inp.onchange = () =>
          sendMove('adjustResource', [
            {
              seatIndex: seat.seatIndex,
              key: inp.getAttribute('data-rexact'),
              exact: Number(inp.value)
            }
          ]);
      });
    }

    function renderEventLog(G) {
      const existingInp = logEl.querySelector('#srChatInput');
      const draft = existingInp ? existingInp.value : '';
      const events = Array.isArray(G.eventLog) ? G.eventLog : [];

      logEl.innerHTML = `
        <div class="sr-dock-section" style="padding:8px 12px;">
          <div class="sr-dock-title" style="margin-bottom:0;">
            <span>Event & Chat Log</span>
            <span style="font-size:10px;color:#64748b;">${events.length}</span>
          </div>
        </div>
        <div class="sr-log-feed" id="srLogFeed">
          ${events.length === 0
            ? '<div style="color:#64748b;font-style:italic;">Actions, dice rolls, and chat appear here.</div>'
            : events
                .slice(-60)
                .map((ev) => {
                  const icon = ev.type === 'DICE' ? '🎲' : ev.type === 'RESOURCE' ? '💰' : ev.type === 'CHAT' ? '💬' : '•';
                  return `
                    <div class="sr-log-entry">
                      <span class="sr-log-ts">${escapeHtml(ev.ts || '')}</span>
                      <span>${icon}</span>
                      <strong style="color:${escapeHtml(ev.seatColor || '#38BDF8')}">${escapeHtml(ev.author || 'Player')}:</strong>
                      <span>${escapeHtml(ev.text || '')}</span>
                    </div>
                  `;
                })
                .join('')}
        </div>
        <form class="sr-chat-form" id="srChatForm">
          <input type="text" class="sr-chat-input" id="srChatInput" maxlength="200" placeholder="Send note or chat..." value="${escapeHtml(draft)}">
          <button type="submit" class="sr-btn sr-btn-sky">Send</button>
        </form>
      `;

      const feed = logEl.querySelector('#srLogFeed');
      if (feed) feed.scrollTop = feed.scrollHeight;
      logEl.querySelector('#srChatForm').onsubmit = (e) => {
        e.preventDefault();
        const inp = logEl.querySelector('#srChatInput');
        const text = (inp.value || '').trim();
        if (!text) return;
        inp.value = '';
        sendMove('addChatLog', [{ text, author: playerName }]);
      };
    }

    function renderHandTray(G) {
      const seats = G.seats || [];
      const activeSeatIdx = getMySeatIndex(G);
      const activeSeat = seats.find((s) => Number(s.seatIndex) === activeSeatIdx) || seats[0];
      const handIds = (activeSeat && Array.isArray(activeSeat.handCardIds) ? activeSeat.handCardIds : []);
      const isSolo = seats.length <= 1;

      handTrayEl.innerHTML = `
        <div class="sr-hand-header">
          <div class="sr-seat-tabs">
            ${seats
              .map((s) => {
                const isCur = activeSeat && Number(s.seatIndex) === Number(activeSeat.seatIndex);
                const disabled = !isSolo && Number(s.seatIndex) !== Number(playerID) + 1;
                return `
                  <button type="button" class="sr-seat-tab ${isCur ? 'active' : ''}" data-seat-tab="${s.seatIndex}" ${disabled ? 'disabled' : ''}>
                    <span class="sr-seat-dot" style="background:${escapeHtml(s.color)}"></span>
                    <span>${escapeHtml(s.playerName)}${Number(s.seatIndex) === Number(playerID) + 1 ? ' (You)' : ''}</span>
                    <span style="font-size:10px;opacity:0.75;">(${(s.handCardIds || []).length})</span>
                  </button>
                `;
              })
              .join('')}
          </div>
          <button type="button" class="sr-btn" id="srBtnReadyAll" style="padding:3px 8px;font-size:10px;">↻ Ready All Cards</button>
        </div>
        <div class="sr-hand-cards" id="srHandCardsRow">
          ${handIds.length === 0
            ? `<div style="font-size:12px;color:#64748b;font-style:italic;">Your hand is empty. Click "Draw 1" on any deck to draw cards.</div>`
            : ''}
        </div>
      `;

      handTrayEl.querySelectorAll('button[data-seat-tab]').forEach((btn) => {
        btn.onclick = () => {
          if (!isSolo) return;
          soloSeatOverride = Number(btn.getAttribute('data-seat-tab'));
          renderAll();
        };
      });
      handTrayEl.querySelector('#srBtnReadyAll').onclick = () => sendMove('readyAllMyCards', [activeSeatIdx]);

      const row = handTrayEl.querySelector('#srHandCardsRow');
      handIds.forEach((cid) => {
        const card = G.boardObjects[cid];
        if (!card) return;
        const cEl = document.createElement('div');
        cEl.className = 'sr-hand-card';
        cEl.innerHTML = `
          <div style="font-size:11px;font-weight:800;color:#fff;line-height:1.2;overflow:hidden;">${escapeHtml(card.name || 'Card')}</div>
          <div class="sr-hand-card-actions">
            <button type="button" data-play-up style="flex:1;background:#0284c7;color:#fff;">Play</button>
            <button type="button" data-play-down style="background:#334155;color:#e2e8f0;" title="Play Face-Down">FD</button>
          </div>
        `;
        cEl.querySelector('[data-play-up]').onclick = () => {
          const centerWorld = screenToWorld(getViewportRect().left + getViewportRect().width / 2, getViewportRect().top + getViewportRect().height / 2);
          sendMove('playCardFromHand', [{ cardId: cid, x: centerWorld.x - 70, y: centerWorld.y - 100, faceUp: true, seatIndex: activeSeatIdx }]);
        };
        cEl.querySelector('[data-play-down]').onclick = () => {
          const centerWorld = screenToWorld(getViewportRect().left + getViewportRect().width / 2, getViewportRect().top + getViewportRect().height / 2);
          sendMove('playCardFromHand', [{ cardId: cid, x: centerWorld.x - 70, y: centerWorld.y - 100, faceUp: false, seatIndex: activeSeatIdx }]);
        };
        row.appendChild(cEl);
      });
    }

    function renderAll() {
      if (!currentGameState || !currentGameState.G) return;
      const G = currentGameState.G;
      if (matchData && Array.isArray(G.seats)) {
        const players = Array.isArray(matchData) ? matchData : Object.values(matchData);
        G.seats.forEach((s, idx) => {
          if (players[idx] && players[idx].name) {
            s.playerName = players[idx].name;
          }
        });
      }
      renderTurnBar(G);
      renderBoardObjects(G);
      renderResources(G);
      renderEventLog(G);
      renderHandTray(G);
      renderCanvasHud();
    }

    // Viewport pan/zoom & pointer drag handling
    viewportEl.addEventListener('pointerdown', (e) => {
      closeContextMenu();
      viewportEl.focus();
      if (e.button === 1 || (e.button === 0 && isSpaceDown)) {
        e.preventDefault();
        viewportEl.classList.add('panning');
        dragState = { kind: 'PAN', startX: e.clientX, startY: e.clientY, origCamX: cam.x, origCamY: cam.y };
        return;
      }
      if (e.button === 0) {
        selectedIds = [];
        renderAll();
      }
    });

    viewportEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX, e.clientY);
      },
      { passive: false }
    );

    const onWindowPointerMove = (e) => {
      if (!dragState) return;
      if (dragState.kind === 'PAN') {
        cam.x = dragState.origCamX + (e.clientX - dragState.startX);
        cam.y = dragState.origCamY + (e.clientY - dragState.startY);
        applyCamera();
        return;
      }
      const pt = screenToWorld(e.clientX, e.clientY);
      const dx = pt.x - dragState.startWorldX;
      const dy = pt.y - dragState.startWorldY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragState.moved = true;
        if (dragState.el) dragState.el.dataset.wasDragged = '1';
      }
      dragState.curX = Math.round(dragState.origX + dx);
      dragState.curY = Math.round(dragState.origY + dy);
      if (dragState.el) {
        dragState.el.style.left = `${dragState.curX}px`;
        dragState.el.style.top = `${dragState.curY}px`;
      }
    };

    const onWindowPointerUp = () => {
      if (!dragState) return;
      const done = dragState;
      dragState = null;
      viewportEl.classList.remove('panning');

      if (done.kind === 'OBJECT' && done.moved) {
        sendMove('moveObjects', [[{ id: done.id, x: done.curX, y: done.curY }]]);
      } else if (done.kind === 'ZONE' && done.moved) {
        sendMove('moveZone', [{ zoneId: done.id, x: done.curX, y: done.curY }]);
      }
    };

    const onWindowKeyDown = (e) => {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea') return;
      if (e.code === 'Space') isSpaceDown = true;
      if (e.key === 'Alt') {
        isAltDown = true;
        updateZoomPreview();
      }
      if (e.key === 'f' || e.key === 'F') {
        if (selectedIds.length > 0) sendMove('flipCards', [selectedIds]);
      } else if (e.key === 't' || e.key === 'T') {
        if (selectedIds.length > 0) sendMove('tapCards', [selectedIds]);
      } else if (e.key === 'r' || e.key === 'R') {
        if (selectedIds.length > 0) sendMove('rotateObjects', [{ objectIds: selectedIds, deltaDeg: 90 }]);
      }
    };

    const onWindowKeyUp = (e) => {
      if (e.code === 'Space') isSpaceDown = false;
      if (e.key === 'Alt') {
        isAltDown = false;
        updateZoomPreview();
      }
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('keydown', onWindowKeyDown);
    window.addEventListener('keyup', onWindowKeyUp);

    q('#srBtnCenter').onclick = () => fitCameraToObjects();
    q('#srBtnReset').onclick = () => {
      sendMove('resetTable', []);
    };
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => applyCamera())
      : null;
    if (resizeObserver) resizeObserver.observe(viewportEl);

    if (typeof io !== 'undefined') {
      socket = io(`${window.location.origin}/${GAME_ID}`);
      socket.on('connect', () => {
        socket.emit('sync', matchID, String(playerID), credentials);
      });
      socket.on('sync', (mId, syncData) => {
        if (mId === matchID && syncData && syncData.state) {
          currentGameState = syncData.state;
          matchData = syncData.filteredMetadata || syncData.matchData || matchData;
          renderAll();
          if (!hasAutoFitted) {
            hasAutoFitted = true;
            setTimeout(() => fitCameraToObjects(), 40);
          }
        }
      });
      socket.on('matchData', (mId, filteredMetadata) => {
        if (mId === matchID && filteredMetadata) {
          matchData = filteredMetadata;
          renderAll();
        }
      });
      socket.on('update', (mId, stateData) => {
        if (mId === matchID && stateData) {
          currentGameState = stateData;
          renderAll();
        }
      });
    }

    applyCamera();

    activeCleanup = () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerUp);
      window.removeEventListener('keydown', onWindowKeyDown);
      window.removeEventListener('keyup', onWindowKeyUp);
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch (_) {}
      }
      if (socket) {
        try { socket.disconnect(); } catch (_) {}
        socket = null;
      }
      container.innerHTML = '';
    };
  }

  function unmountClient() {
    if (typeof activeCleanup === 'function') {
      try { activeCleanup(); } catch (_) {}
      activeCleanup = null;
    }
  }

  window.GameModules[GAME_ID] = {
    mountClient,
    unmountClient
  };
})();
