const { INVALID_MOVE, ActivePlayers } = require('boardgame.io/core');
const publishedSandboxStore = require('../../lib/published-sandbox-store');

const SEAT_COLORS = ['#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00'];
const DEFAULT_PHASES = ['Draw', 'Action Phase', 'Cleanup'];

function cloneDeep(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowTimeStr() {
  return new Date().toISOString().slice(11, 19);
}

function appendLog(G, seatIndex, text, type = 'EVENT', authorOverride = null) {
  if (!Array.isArray(G.eventLog)) G.eventLog = [];
  const seat = (G.seats || []).find((s) => Number(s.seatIndex) === Number(seatIndex));
  G.eventLog.push({
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    ts: nowTimeStr(),
    type,
    author: authorOverride || (seat ? seat.playerName : `Player ${seatIndex || 1}`),
    seatColor: seat ? seat.color : '#38BDF8',
    text: String(text || '').slice(0, 240)
  });
  if (G.eventLog.length > 150) {
    G.eventLog = G.eventLog.slice(-150);
  }
}

function nextZInTier(boardObjects, type) {
  const tiers = {
    BOARD: [100, 199],
    ZONE: [200, 299],
    DECK: [300, 499],
    CARD: [300, 499],
    TOKEN: [500, 699],
    SPAWNER: [500, 699],
    DIE: [500, 699]
  };
  const [min, max] = tiers[type] || tiers.TOKEN;
  let highest = min - 1;
  for (const obj of Object.values(boardObjects || {})) {
    if (!obj) continue;
    const [oMin] = tiers[obj.type] || tiers.TOKEN;
    if (oMin === min && Number.isFinite(Number(obj.zIndex))) {
      if (Number(obj.zIndex) > highest) highest = Number(obj.zIndex);
    }
  }
  return Math.min(max, Math.max(min, highest + 1));
}

function shuffleArray(arr, random) {
  if (random && typeof random.Shuffle === 'function') {
    return random.Shuffle([...arr]);
  }
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function replenishMarketZones(G) {
  if (!Array.isArray(G.zones)) return;
  for (const zone of G.zones) {
    if (!zone || !zone.autoReplenish || !zone.sourceDeckId) continue;
    const deck = G.boardObjects[zone.sourceDeckId];
    if (!deck || deck.type !== 'DECK' || !Array.isArray(deck.cardIds) || deck.cardIds.length === 0) continue;

    const slots = Math.max(1, Number(zone.slots) || 4);
    const slotW = (Number(zone.width) || 620) / slots;
    const zoneLeft = Number(zone.x) || 0;
    const zoneRight = zoneLeft + (Number(zone.width) || 620);
    const zoneTop = Number(zone.y) || 0;
    const zoneBottom = zoneTop + (Number(zone.height) || 220);

    const cardsInZone = Object.values(G.boardObjects).filter((o) => {
      if (!o || o.type !== 'CARD' || o.ownerSeat !== null) return false;
      const cx = (Number(o.x) || 0) + (Number(o.width) || 140) / 2;
      const cy = (Number(o.y) || 0) + (Number(o.height) || 200) / 2;
      return cx >= zoneLeft && cx <= zoneRight && cy >= zoneTop && cy <= zoneBottom;
    });

    const needed = Math.max(0, slots - cardsInZone.length);
    for (let i = 0; i < needed && deck.cardIds.length > 0; i++) {
      const cid = deck.cardIds.shift();
      const card = G.boardObjects[cid];
      if (!card) continue;
      const slotIdx = (cardsInZone.length + i) % slots;
      card.ownerSeat = null;
      card.faceUp = true;
      card.x = Math.round(zoneLeft + 12 + slotIdx * slotW);
      card.y = Math.round(zoneTop + 14);
      card.zIndex = nextZInTier(G.boardObjects, 'CARD');
    }
  }
}

function buildInitialState(publishedSandboxId, numPlayers, rawSnapshot) {
  const snap = cloneDeep(rawSnapshot || {});
  const count = Math.max(1, Math.min(6, Number(numPlayers) || 2));

  const existingSeats = Array.isArray(snap.seats) ? snap.seats : [];
  const seats = [];
  for (let i = 1; i <= count; i++) {
    const prev = existingSeats.find((s) => Number(s.seatIndex) === i) || {};
    seats.push({
      seatIndex: i,
      color: prev.color || SEAT_COLORS[i - 1],
      assignedUserId: null,
      playerName: prev.playerName || `Player ${i}`,
      handCardIds: Array.isArray(prev.handCardIds) ? prev.handCardIds : [],
      resources: prev.resources && typeof prev.resources === 'object' ? prev.resources : { Money: 10, VP: 0 }
    });
  }

  const boardObjects = snap.boardObjects && typeof snap.boardObjects === 'object' && !Array.isArray(snap.boardObjects)
    ? snap.boardObjects
    : {};

  // Auto-shuffle any decks configured with autoShuffleOnReset
  for (const obj of Object.values(boardObjects)) {
    if (obj && obj.type === 'DECK' && obj.autoShuffleOnReset && Array.isArray(obj.cardIds) && obj.cardIds.length > 1) {
      obj.cardIds = shuffleArray(obj.cardIds);
    }
  }

  const turnState = snap.turnState && typeof snap.turnState === 'object'
    ? {
        activeSeat: Math.min(count, Math.max(1, Number(snap.turnState.activeSeat) || 1)),
        roundNumber: Math.max(1, Number(snap.turnState.roundNumber) || 1),
        currentPhase: snap.turnState.currentPhase || DEFAULT_PHASES[0],
        phases: Array.isArray(snap.turnState.phases) && snap.turnState.phases.length > 0 ? snap.turnState.phases : DEFAULT_PHASES
      }
    : { activeSeat: 1, roundNumber: 1, currentPhase: DEFAULT_PHASES[0], phases: DEFAULT_PHASES };

  return {
    publishedSandboxId: Number(publishedSandboxId) || 0,
    mode: 'PLAY',
    turnState,
    seats,
    boardObjects,
    zones: Array.isArray(snap.zones) ? snap.zones : [],
    notes: Array.isArray(snap.notes) ? snap.notes : [],
    eventLog: Array.isArray(snap.eventLog) ? snap.eventLog.slice(-50) : []
  };
}

function resolveSeatIndex(G, playerID, requestedSeatIndex) {
  const numSeats = (G.seats || []).length;
  // In 1-player solo testing, allow switching between any seat on the table
  if (numSeats === 1 && requestedSeatIndex !== undefined && requestedSeatIndex !== null) {
    const req = Number(requestedSeatIndex);
    if (req >= 1 && req <= numSeats) return req;
  }
  const fromPlayer = Number(playerID) + 1;
  if (Number.isInteger(fromPlayer) && fromPlayer >= 1 && fromPlayer <= numSeats) {
    return fromPlayer;
  }
  return 1;
}

const SandboxRunnerGame = {
  name: 'sandbox-runner',

  setup: (context, setupData) => {
    const data = setupData || (context && context.setupData) || {};
    const numPlayers = (context && context.ctx && context.ctx.numPlayers) || (context && context.numPlayers) || 2;
    const publishedSandboxId = Number(data.publishedSandboxId) || 0;

    let snapshot = data.snapshotOverride || null;
    if (!snapshot && publishedSandboxId > 0) {
      const record = publishedSandboxStore.getSandboxSync(publishedSandboxId);
      if (record && record.snapshot) {
        snapshot = record.snapshot;
      }
    }

    const state = buildInitialState(publishedSandboxId, numPlayers, snapshot);
    if (data.snapshotOverride) {
      state._snapshotOverride = cloneDeep(data.snapshotOverride);
    }
    appendLog(state, 1, 'Tabletop session initialized.', 'EVENT', 'System');
    return state;
  },

  turn: {
    activePlayers: ActivePlayers.ALL
  },

  moves: {
    moveObjects: ({ G }, updates) => {
      if (!Array.isArray(updates) || updates.length === 0) return INVALID_MOVE;
      for (const u of updates) {
        if (!u || !u.id || !G.boardObjects[u.id]) continue;
        const obj = G.boardObjects[u.id];
        if (obj.isLocked) continue;
        if (Number.isFinite(Number(u.x))) obj.x = Math.round(Number(u.x));
        if (Number.isFinite(Number(u.y))) obj.y = Math.round(Number(u.y));
        if (Number.isFinite(Number(u.zIndex))) obj.zIndex = Number(u.zIndex);
        if (u.parentId !== undefined) obj.parentId = u.parentId || null;
      }
    },

    moveZone: ({ G }, payload) => {
      if (!payload || !payload.zoneId) return INVALID_MOVE;
      const zone = (G.zones || []).find((z) => z && z.id === payload.zoneId);
      if (!zone) return INVALID_MOVE;
      if (Number.isFinite(Number(payload.x))) zone.x = Math.round(Number(payload.x));
      if (Number.isFinite(Number(payload.y))) zone.y = Math.round(Number(payload.y));
    },

    flipCards: ({ G, playerID }, cardIds) => {
      if (!Array.isArray(cardIds) || cardIds.length === 0) return INVALID_MOVE;
      const seatIdx = resolveSeatIndex(G, playerID);
      let flipped = 0;
      for (const id of cardIds) {
        const obj = G.boardObjects[id];
        if (!obj || obj.type !== 'CARD') continue;
        obj.faceUp = !obj.faceUp;
        obj.peekingUserIds = [];
        flipped++;
      }
      if (flipped === 0) return INVALID_MOVE;
      appendLog(G, seatIdx, `flipped ${flipped} card(s).`);
    },

    tapCards: ({ G, playerID }, cardIds) => {
      if (!Array.isArray(cardIds) || cardIds.length === 0) return INVALID_MOVE;
      const seatIdx = resolveSeatIndex(G, playerID);
      let count = 0;
      for (const id of cardIds) {
        const obj = G.boardObjects[id];
        if (!obj || obj.type !== 'CARD') continue;
        obj.isTapped = !obj.isTapped;
        obj.rotation = obj.isTapped ? 90 : 0;
        count++;
      }
      if (count === 0) return INVALID_MOVE;
      appendLog(G, seatIdx, `tapped/readied ${count} card(s).`);
    },

    rotateObjects: ({ G }, payload) => {
      const ids = payload && Array.isArray(payload.objectIds) ? payload.objectIds : [];
      const delta = Number(payload && payload.deltaDeg) || 90;
      if (ids.length === 0) return INVALID_MOVE;
      for (const id of ids) {
        const obj = G.boardObjects[id];
        if (!obj || obj.isLocked) continue;
        obj.rotation = ((Number(obj.rotation) || 0) + delta) % 360;
      }
    },

    drawCards: ({ G, playerID }, payload) => {
      const deckId = payload && payload.deckId;
      const count = Math.max(1, Math.min(20, Number(payload && payload.count) || 1));
      const deck = deckId ? G.boardObjects[deckId] : null;
      if (!deck || deck.type !== 'DECK' || !Array.isArray(deck.cardIds) || deck.cardIds.length === 0) {
        return INVALID_MOVE;
      }
      const seatIdx = resolveSeatIndex(G, playerID, payload && payload.seatIndex);
      const seat = (G.seats || []).find((s) => Number(s.seatIndex) === seatIdx);
      if (!seat) return INVALID_MOVE;
      if (!Array.isArray(seat.handCardIds)) seat.handCardIds = [];

      let drawn = 0;
      for (let i = 0; i < count && deck.cardIds.length > 0; i++) {
        const cid = deck.cardIds.shift();
        const card = G.boardObjects[cid];
        if (!card) continue;
        card.ownerSeat = seatIdx;
        card.faceUp = true;
        card.parentId = null;
        if (!seat.handCardIds.includes(cid)) {
          seat.handCardIds.push(cid);
        }
        drawn++;
      }
      if (drawn === 0) return INVALID_MOVE;
      appendLog(G, seatIdx, `drew ${drawn} card(s) from "${deck.name || 'Deck'}".`);
      replenishMarketZones(G);
    },

    takeSpecificCardToHand: ({ G, playerID }, payload) => {
      const cardId = payload && payload.cardId;
      const fromDeckId = payload && payload.fromDeckId;
      const card = cardId ? G.boardObjects[cardId] : null;
      if (!card || card.type !== 'CARD') return INVALID_MOVE;

      const seatIdx = resolveSeatIndex(G, playerID, payload && payload.seatIndex);
      const seat = (G.seats || []).find((s) => Number(s.seatIndex) === seatIdx);
      if (!seat) return INVALID_MOVE;

      if (fromDeckId && G.boardObjects[fromDeckId] && Array.isArray(G.boardObjects[fromDeckId].cardIds)) {
        G.boardObjects[fromDeckId].cardIds = G.boardObjects[fromDeckId].cardIds.filter((id) => id !== cardId);
      }
      for (const s of G.seats || []) {
        if (Array.isArray(s.handCardIds)) {
          s.handCardIds = s.handCardIds.filter((id) => id !== cardId);
        }
      }
      if (!Array.isArray(seat.handCardIds)) seat.handCardIds = [];
      seat.handCardIds.push(cardId);
      card.ownerSeat = seatIdx;
      card.faceUp = true;
      card.parentId = null;
      appendLog(G, seatIdx, `took "${card.name || 'Card'}" into hand.`);
    },

    shuffleDeck: ({ G, playerID, random }, deckId) => {
      const deck = deckId ? G.boardObjects[deckId] : null;
      if (!deck || deck.type !== 'DECK' || !Array.isArray(deck.cardIds)) return INVALID_MOVE;
      deck.cardIds = shuffleArray(deck.cardIds, random);
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, `shuffled "${deck.name || 'Deck'}" (${deck.cardIds.length} cards).`);
    },

    playCardFromHand: ({ G, playerID }, payload) => {
      const cardId = payload && payload.cardId;
      const card = cardId ? G.boardObjects[cardId] : null;
      if (!card || card.type !== 'CARD') return INVALID_MOVE;

      const seatIdx = resolveSeatIndex(G, playerID, payload && payload.seatIndex);
      for (const s of G.seats || []) {
        if (Array.isArray(s.handCardIds)) {
          s.handCardIds = s.handCardIds.filter((id) => id !== cardId);
        }
      }
      card.ownerSeat = null;
      card.x = Number.isFinite(Number(payload.x)) ? Math.round(Number(payload.x)) : 200;
      card.y = Number.isFinite(Number(payload.y)) ? Math.round(Number(payload.y)) : 200;
      card.faceUp = payload.faceUp !== undefined ? Boolean(payload.faceUp) : true;
      card.isTapped = false;
      card.rotation = 0;
      card.peekingUserIds = [];
      card.zIndex = nextZInTier(G.boardObjects, 'CARD');

      appendLog(G, seatIdx, `played ${card.faceUp ? `"${card.name || 'Card'}"` : 'a face-down card'} to the table.`);
    },

    togglePeekCard: ({ G, playerID }, cardId) => {
      const card = cardId ? G.boardObjects[cardId] : null;
      if (!card || card.type !== 'CARD') return INVALID_MOVE;
      if (!Array.isArray(card.peekingUserIds)) card.peekingUserIds = [];
      const pid = String(playerID);
      if (card.peekingUserIds.includes(pid)) {
        card.peekingUserIds = card.peekingUserIds.filter((x) => x !== pid);
      } else {
        card.peekingUserIds.push(pid);
      }
    },

    spawnFromSpawner: ({ G, playerID }, payload) => {
      const spawner = payload && payload.spawnerId ? G.boardObjects[payload.spawnerId] : null;
      if (!spawner || spawner.type !== 'SPAWNER') return INVALID_MOVE;
      const newId = `tok_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      G.boardObjects[newId] = {
        id: newId,
        type: 'TOKEN',
        assetId: spawner.assetId || null,
        name: String(spawner.name || 'Token').replace(/\s*Supply$/i, ''),
        color: spawner.color || '#E53935',
        imageUrl: spawner.imageUrl || null,
        x: Number.isFinite(Number(payload.x)) ? Math.round(Number(payload.x)) : (spawner.x || 0) + 18,
        y: Number.isFinite(Number(payload.y)) ? Math.round(Number(payload.y)) : (spawner.y || 0) + 18,
        width: 48,
        height: 48,
        rotation: 0,
        isLocked: false,
        zIndex: nextZInTier(G.boardObjects, 'TOKEN')
      };
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, `spawned ${G.boardObjects[newId].name}.`);
    },

    rollDie: ({ G, playerID, random }, dieId) => {
      const die = dieId ? G.boardObjects[dieId] : null;
      if (!die || die.type !== 'DIE') return INVALID_MOVE;
      const faces = Math.max(2, Number(die.faces) || 6);
      const result = random && typeof random.Die === 'function' ? random.Die(faces) : Math.floor(Math.random() * faces) + 1;
      die.value = result;
      const label = Array.isArray(die.customFaces) && die.customFaces[result - 1]
        ? die.customFaces[result - 1]
        : String(result);
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, `rolled d${faces} → ${label}`, 'DICE');
    },

    adjustResource: ({ G, playerID }, payload) => {
      if (!payload || !payload.key) return INVALID_MOVE;
      const seatIdx = resolveSeatIndex(G, playerID, payload.seatIndex);
      const seat = (G.seats || []).find((s) => Number(s.seatIndex) === seatIdx);
      if (!seat) return INVALID_MOVE;
      if (!seat.resources || typeof seat.resources !== 'object') seat.resources = {};

      const key = String(payload.key).slice(0, 40);
      const cur = Number(seat.resources[key]) || 0;
      const next = payload.exact !== undefined && payload.exact !== null
        ? Number(payload.exact)
        : cur + (Number(payload.delta) || 0);
      if (!Number.isFinite(next)) return INVALID_MOVE;

      seat.resources[key] = Math.round(next);
      appendLog(G, seatIdx, `set ${key} to ${seat.resources[key]}`, 'RESOURCE');
    },

    transferResource: ({ G, playerID }, payload) => {
      if (!payload || !payload.key) return INVALID_MOVE;
      const seatIdx = resolveSeatIndex(G, playerID, payload.fromSeatIndex);
      const fromSeat = (G.seats || []).find((s) => Number(s.seatIndex) === seatIdx);
      if (!fromSeat) return INVALID_MOVE;
      const key = String(payload.key).slice(0, 40);
      const amount = Math.max(1, Math.round(Number(payload.amount) || 1));

      if (!fromSeat.resources) fromSeat.resources = {};
      fromSeat.resources[key] = (Number(fromSeat.resources[key]) || 0) - amount;

      if (payload.target === 'BANK') {
        appendLog(G, seatIdx, `paid ${amount} ${key} to Bank.`, 'RESOURCE');
      } else {
        const targetSeat = (G.seats || []).find((s) => Number(s.seatIndex) === Number(payload.target));
        if (!targetSeat) return INVALID_MOVE;
        if (!targetSeat.resources) targetSeat.resources = {};
        targetSeat.resources[key] = (Number(targetSeat.resources[key]) || 0) + amount;
        appendLog(G, seatIdx, `transferred ${amount} ${key} to ${targetSeat.playerName}.`, 'RESOURCE');
      }
    },

    readyAllMyCards: ({ G, playerID }, seatIndexOverride) => {
      const seatIdx = resolveSeatIndex(G, playerID, seatIndexOverride);
      let count = 0;
      for (const obj of Object.values(G.boardObjects || {})) {
        if (obj && obj.type === 'CARD' && obj.isTapped) {
          obj.isTapped = false;
          obj.rotation = 0;
          count++;
        }
      }
      if (count > 0) {
        appendLog(G, seatIdx, `readied ${count} tapped card(s).`);
      }
    },

    advancePhaseOrTurn: ({ G, playerID }) => {
      const ts = G.turnState || { activeSeat: 1, roundNumber: 1, currentPhase: DEFAULT_PHASES[0], phases: DEFAULT_PHASES };
      const phases = Array.isArray(ts.phases) && ts.phases.length > 0 ? ts.phases : DEFAULT_PHASES;
      const idx = phases.indexOf(ts.currentPhase);
      if (idx === -1 || idx + 1 >= phases.length) {
        ts.currentPhase = phases[0];
        const totalSeats = Math.max(1, (G.seats || []).length);
        if (ts.activeSeat >= totalSeats) {
          ts.activeSeat = 1;
          ts.roundNumber = (Number(ts.roundNumber) || 1) + 1;
        } else {
          ts.activeSeat = (Number(ts.activeSeat) || 1) + 1;
        }
      } else {
        ts.currentPhase = phases[idx + 1];
      }
      G.turnState = ts;
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, `advanced to R${ts.roundNumber} · Seat ${ts.activeSeat} (${ts.currentPhase}).`);
    },

    toggleLock: ({ G, playerID }, objectIds) => {
      if (!Array.isArray(objectIds) || objectIds.length === 0) return INVALID_MOVE;
      for (const id of objectIds) {
        const obj = G.boardObjects[id];
        if (obj) obj.isLocked = !obj.isLocked;
      }
    },

    addChatLog: ({ G, playerID }, payload) => {
      const text = payload && typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) return INVALID_MOVE;
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, text, 'CHAT', payload.author || null);
    },

    resetTable: ({ G, playerID }) => {
      const numSeats = Math.max(1, (G.seats || []).length);
      let snapshot = G._snapshotOverride || null;
      if (!snapshot && G.publishedSandboxId > 0) {
        const record = publishedSandboxStore.getSandboxSync(G.publishedSandboxId);
        if (record && record.snapshot) snapshot = record.snapshot;
      }
      if (!snapshot) return INVALID_MOVE;

      const fresh = buildInitialState(G.publishedSandboxId, numSeats, snapshot);
      if (G._snapshotOverride) fresh._snapshotOverride = G._snapshotOverride;
      G.turnState = fresh.turnState;
      G.seats = fresh.seats;
      G.boardObjects = fresh.boardObjects;
      G.zones = fresh.zones;
      G.notes = fresh.notes;
      G.eventLog = [];
      const seatIdx = resolveSeatIndex(G, playerID);
      appendLog(G, seatIdx, 'reset the table to the published starting layout.');
    }
  },

  playerView: ({ G, playerID }) => {
    const numSeats = (G.seats || []).length;
    // In 1-player solo playtest, do not redact any cards so the tester can test all seats
    if (numSeats <= 1) return G;

    const viewerSeat = Number(playerID) + 1;
    const pidStr = String(playerID);

    const view = cloneDeep(G);
    delete view._snapshotOverride;

    const deckCardIds = new Map();
    const handOwnerByCard = new Map();

    for (const seat of view.seats || []) {
      const sIdx = Number(seat.seatIndex);
      for (const cid of seat.handCardIds || []) {
        handOwnerByCard.set(String(cid), sIdx);
      }
    }
    for (const obj of Object.values(view.boardObjects || {})) {
      if (obj && obj.type === 'DECK') {
        const isFaceDown = !obj.faceUp;
        for (const cid of obj.cardIds || []) {
          deckCardIds.set(String(cid), isFaceDown);
        }
      }
    }

    for (const [id, obj] of Object.entries(view.boardObjects || {})) {
      if (!obj || obj.type !== 'CARD') continue;
      const peekingIds = Array.isArray(obj.peekingUserIds) ? obj.peekingUserIds.map(String) : [];
      const isPeeking = peekingIds.includes(pidStr);
      const inHandOf = handOwnerByCard.has(id) ? handOwnerByCard.get(id) : obj.ownerSeat;
      const inFaceDownDeck = deckCardIds.get(id) === true;

      let visible = false;
      if (inHandOf !== null && inHandOf !== undefined) {
        visible = Number(inHandOf) === viewerSeat;
      } else if (inFaceDownDeck) {
        visible = isPeeking;
      } else {
        visible = Boolean(obj.faceUp) || isPeeking;
      }

      if (!visible) {
        obj.frontImageUrl = null;
        obj.name = 'Hidden Card';
        obj.metadata = {};
        obj.rowData = {};
      }
    }

    return view;
  }
};

module.exports = SandboxRunnerGame;
