window.GameModules = window.GameModules || {};

function mountTicTacToeClient(container, config) {
  if (!container || typeof container === 'string') {
    container = document.getElementById(container || 'boardMountContainer');
  }
  if (!container) return;

  const matchID = config && config.matchID ? config.matchID : '';
  const playerID = config && config.playerID !== undefined ? String(config.playerID) : '0';
  const credentials = config && config.credentials ? config.credentials : '';
  const playerName = config && config.playerName ? config.playerName : 'Player';
  const gameName = config && config.gameName ? config.gameName : 'tic-tac-toe';

  let currentGameState = null;
  let matchData = null;
  let socket = null;

  const isUltimate = (config && config.mode === 'ultimate') || (config && config.setupData && config.setupData.mode === 'ultimate');

  const initialGridHtml = isUltimate ? `
    <div class="uttt-main-grid">
      ${[0,1,2,3,4,5,6,7,8].map(bIdx => `
        <div class="uttt-sub-board active-target" data-board="${bIdx}">
          ${[0,1,2,3,4,5,6,7,8].map(localIdx => {
            const cId = bIdx * 9 + localIdx;
            return `<div class="uttt-cell disabled" data-cell="${cId}"></div>`;
          }).join('')}
        </div>
      `).join('')}
    </div>
  ` : `
    <div class="ttt-grid">
      ${[0,1,2,3,4,5,6,7,8].map(i => `<div class="ttt-cell disabled" data-id="${i}"></div>`).join('')}
    </div>
  `;

  // Render initial board UI immediately
  container.innerHTML = `
    <div class="ttt-board-container">
      <div class="ttt-status-banner" id="tttStatusBanner">
        <i class="bi bi-hourglass-split"></i> Connecting to match...
      </div>
      <div id="tttGridMount">
        ${initialGridHtml}
      </div>
    </div>
  `;

  if (typeof io !== 'undefined') {
    const nspUrl = `${window.location.origin}/${gameName}`;
    socket = io(nspUrl);

    socket.on('connect', () => {
      socket.emit('sync', matchID, String(playerID), credentials);
    });

    socket.on('sync', (mId, syncData) => {
      if (mId === matchID && syncData && syncData.state) {
        currentGameState = syncData.state;
        if (syncData.matchData) {
          matchData = syncData.matchData;
        }
        renderBoardState(currentGameState, matchData);
      }
    });

    socket.on('update', (mId, stateData) => {
      if (mId === matchID && stateData) {
        currentGameState = stateData;
        renderBoardState(currentGameState, matchData);
      }
    });

    socket.on('disconnect', () => {
      const banner = document.getElementById('tttStatusBanner');
      if (banner) banner.innerHTML = `<i class="bi bi-exclamation-triangle-fill text-warning"></i> Disconnected. Reconnecting...`;
    });
  } else {
    const banner = document.getElementById('tttStatusBanner');
    if (banner) banner.innerHTML = `<i class="bi bi-exclamation-circle text-danger"></i> Socket client unavailable`;
  }

  // Poll for opponent joining match
  let matchDataPollTimer = setInterval(async () => {
    if (!currentGameState) return;
    const joined = (matchData && matchData.players || []).filter(p => p && p.name);
    if (joined.length >= 2) {
      clearInterval(matchDataPollTimer);
      return;
    }
    try {
      const res = await fetch(`/games/${gameName}/${matchID}`);
      if (res.ok) {
        const mRes = await res.json();
        if (mRes.matchData) {
          matchData = mRes.matchData;
          renderBoardState(currentGameState, matchData);
        }
      }
    } catch (e) {}
  }, 2500);

  // Cell click handler (Normal & Ultimate)
  window.handleCellClick = (cellId) => {
    if (!currentGameState || !socket) return;
    const { G, ctx } = currentGameState;

    if (ctx.gameover) return;
    if (String(ctx.currentPlayer) !== String(playerID)) {
      if (typeof showToast === 'function') showToast("It's not your turn!", 'warning');
      return;
    }

    const mode = G.mode || 'normal';
    if (mode === 'ultimate') {
      const bIdx = Math.floor(cellId / 9);
      if (G.cells[cellId] !== null) return;
      if (G.boardWins[bIdx] !== null) return;
      if (G.activeBoard !== null && G.activeBoard !== bIdx) {
        if (typeof showToast === 'function') showToast(`Must play in Grid #${G.activeBoard + 1}!`, 'warning');
        return;
      }
    } else {
      if (G.cells[cellId] !== null) return;
    }

    const action = {
      type: 'MAKE_MOVE',
      payload: {
        type: 'clickCell',
        args: [cellId],
        playerID: String(playerID),
        credentials
      }
    };

    socket.emit('update', action, currentGameState._stateID, matchID, String(playerID));
  };

  function renderBoardState(gameState, mData) {
    if (!gameState) return;
    const { G, ctx } = gameState;
    const mode = G.mode || 'normal';
    const gridMount = document.getElementById('tttGridMount');
    if (!gridMount) return;

    const joinedPlayers = (mData && mData.players || []).filter(p => p && p.name);
    const isWaitingForOpponent = mData && joinedPlayers.length < 2 && !ctx.gameover;
    const isMyTurn = String(ctx.currentPlayer) === String(playerID) && !ctx.gameover;

    if (mode === 'ultimate') {
      // Render Ultimate 9-nested 3x3 grids
      gridMount.innerHTML = `
        <div class="uttt-main-grid">
          ${[0,1,2,3,4,5,6,7,8].map(bIdx => {
            const winStatus = G.boardWins[bIdx]; // '0', '1', 'draw', or null
            const isTargetBoard = !ctx.gameover && (G.activeBoard === null || G.activeBoard === bIdx) && winStatus === null;
            const winClass = winStatus === '0' ? 'won-x' : winStatus === '1' ? 'won-o' : winStatus === 'draw' ? 'won-draw' : '';
            const targetClass = isTargetBoard ? 'active-target' : '';

            return `
              <div class="uttt-sub-board ${winClass} ${targetClass}" data-board="${bIdx}">
                ${[0,1,2,3,4,5,6,7,8].map(localIdx => {
                  const cId = bIdx * 9 + localIdx;
                  const val = G.cells[cId];
                  const valClass = val === '0' ? 'x-mark' : val === '1' ? 'o-mark' : '';
                  const valText = val === '0' ? 'X' : val === '1' ? 'O' : '';
                  const cellCanClick = isMyTurn && isTargetBoard && val === null && winStatus === null;

                  return `
                    <div class="uttt-cell ${valClass} ${cellCanClick ? '' : 'disabled'}"
                         data-cell="${cId}"
                         ${cellCanClick ? `onclick="window.handleCellClick(${cId})"` : ''}>
                      ${valText}
                    </div>
                  `;
                }).join('')}
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else {
      // Render Normal 3x3 Grid
      gridMount.innerHTML = `
        <div class="ttt-grid">
          ${[0,1,2,3,4,5,6,7,8].map(i => {
            const val = G.cells[i];
            const valClass = val === '0' ? 'x-mark disabled' : val === '1' ? 'o-mark disabled' : isMyTurn ? '' : 'disabled';
            const valText = val === '0' ? 'X' : val === '1' ? 'O' : '';
            const cellCanClick = isMyTurn && val === null;

            return `
              <div class="ttt-cell ${valClass}"
                   data-id="${i}"
                   ${cellCanClick ? `onclick="window.handleCellClick(${i})"` : ''}>
                ${valText}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Render Banner Status
    const banner = document.getElementById('tttStatusBanner');
    if (!banner) return;

    const mySymbol = String(playerID) === '0' ? 'X (Player 1)' : 'O (Player 2)';

    if (ctx.gameover) {
      if (typeof window.clearActiveMatchState === 'function') window.clearActiveMatchState();

      if (ctx.gameover.winner !== undefined && ctx.gameover.winner !== null) {
        const isMeWinner = String(ctx.gameover.winner) === String(playerID);
        banner.innerHTML = isMeWinner ? 
          `<i class="bi bi-trophy-fill" style="color: #f6e05e"></i> Victory! You Won!` :
          `<i class="bi bi-x-circle-fill" style="color: #ef4444"></i> Game Over. Player ${parseInt(ctx.gameover.winner, 10) + 1} won.`;
      } else {
        banner.innerHTML = `<i class="bi bi-dash-circle-fill"></i> Draw Game!`;
      }
    } else if (isWaitingForOpponent) {
      banner.innerHTML = `<i class="bi bi-person-plus-fill text-gold"></i> Waiting for opponent to join match... (1/2 Players)`;
    } else {
      const turnText = isMyTurn ?
        `<i class="bi bi-lightning-fill text-gold"></i> Your Turn! (You are ${mySymbol})` :
        `<i class="bi bi-hourglass-split"></i> Opponent's Turn (You are ${mySymbol})`;

      if (mode === 'ultimate') {
        const boardHint = G.activeBoard === null ?
          ' (Free Move in ANY Grid)' :
          ` (Play in Grid #${G.activeBoard + 1})`;
        banner.innerHTML = turnText + `<span style="font-size:0.85rem; color:var(--text-muted); margin-left:0.4rem;">${boardHint}</span>`;
      } else {
        banner.innerHTML = turnText;
      }
    }
  }
}

window.GameModules['tic-tac-toe'] = {
  mountClient: mountTicTacToeClient
};
window.mountTicTacToeClient = mountTicTacToeClient;
