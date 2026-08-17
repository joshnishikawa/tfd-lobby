const { INVALID_MOVE } = require('boardgame.io/core');

// Check 3-in-a-row for 9 cells (returns '0', '1', or null)
function isSubBoardVictory(cells, offset = 0) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (let [a, b, c] of lines) {
    const valA = cells[offset + a];
    const valB = cells[offset + b];
    const valC = cells[offset + c];
    if (valA !== null && valA !== 'draw' && valA === valB && valA === valC) {
      return valA;
    }
  }
  return null;
}

function isSubBoardDraw(cells, offset = 0) {
  for (let i = 0; i < 9; i++) {
    if (cells[offset + i] === null) return false;
  }
  return true;
}

const TicTacToe = {
  name: 'tic-tac-toe',
  setup: (pluginsOrCtx, setupData) => {
    const data = setupData || (pluginsOrCtx && pluginsOrCtx.setupData) || pluginsOrCtx || {};
    const mode = (data && data.mode) ? data.mode : 'normal';

    if (mode === 'ultimate') {
      return {
        mode: 'ultimate',
        cells: Array(81).fill(null), // 9 sub-boards * 9 cells
        boardWins: Array(9).fill(null), // '0', '1', or 'draw' for each sub-board
        activeBoard: null // null = any sub-board; 0..8 = mandatory target sub-board
      };
    } else {
      return {
        mode: 'normal',
        cells: Array(9).fill(null)
      };
    }
  },
  turn: {
    minMoves: 1,
    maxMoves: 1,
  },
  moves: {
    clickCell: ({ G, ctx }, id) => {
      const mode = G.mode || 'normal';

      if (mode === 'ultimate') {
        const boardIndex = Math.floor(id / 9);
        const localIndex = id % 9;

        // Validation 1: cell must be empty
        if (G.cells[id] !== null) return INVALID_MOVE;

        // Validation 2: target sub-board must not already be won/tied
        if (G.boardWins[boardIndex] !== null) return INVALID_MOVE;

        // Validation 3: if activeBoard restriction is set, must play in activeBoard
        if (G.activeBoard !== null && G.activeBoard !== boardIndex) return INVALID_MOVE;

        // Execute Move
        G.cells[id] = String(ctx.currentPlayer);

        // Check if this move wins or draws the sub-board
        const offset = boardIndex * 9;
        const subWinner = isSubBoardVictory(G.cells, offset);
        if (subWinner !== null) {
          G.boardWins[boardIndex] = subWinner;
        } else if (isSubBoardDraw(G.cells, offset)) {
          G.boardWins[boardIndex] = 'draw';
        }

        // Set activeBoard for next player
        // If the target sub-board (localIndex) is already won/drawn, player gets free choice (activeBoard = null)
        if (G.boardWins[localIndex] !== null) {
          G.activeBoard = null;
        } else {
          G.activeBoard = localIndex;
        }

      } else {
        // Normal 3x3 Tic Tac Toe
        if (G.cells[id] !== null) {
          return INVALID_MOVE;
        }
        G.cells[id] = String(ctx.currentPlayer);
      }
    },
  },
  endIf: ({ G, ctx }) => {
    const mode = G.mode || 'normal';

    if (mode === 'ultimate') {
      // Win main game by getting 3 sub-board wins in a row
      const winner = isSubBoardVictory(G.boardWins, 0);
      if (winner !== null) {
        return { winner };
      }
      // Draw main game if all 9 sub-boards are complete
      if (G.boardWins.every(w => w !== null)) {
        return { draw: true };
      }
    } else {
      // Normal game win/draw check
      const winner = isSubBoardVictory(G.cells, 0);
      if (winner !== null) {
        return { winner };
      }
      if (isSubBoardDraw(G.cells, 0)) {
        return { draw: true };
      }
    }
  },
  ai: {
    enumerate: (G, ctx) => {
      const moves = [];
      const mode = G.mode || 'normal';

      if (mode === 'ultimate') {
        for (let i = 0; i < 81; i++) {
          const bIdx = Math.floor(i / 9);
          if (G.cells[i] === null && G.boardWins[bIdx] === null) {
            if (G.activeBoard === null || G.activeBoard === bIdx) {
              moves.push({ move: 'clickCell', args: [i] });
            }
          }
        }
      } else {
        for (let i = 0; i < 9; i++) {
          if (G.cells[i] === null) {
            moves.push({ move: 'clickCell', args: [i] });
          }
        }
      }
      return moves;
    },
  },
};

module.exports = TicTacToe;
