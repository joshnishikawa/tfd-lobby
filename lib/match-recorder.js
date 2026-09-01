const { pool } = require('./db');

class MatchRecorder {
  constructor() {
    this.pool = pool;
  }

  /**
   * Records a completed match into the match_history table.
   * @param {string} matchId
   * @param {object} metadata - boardgame.io match metadata
   * @param {object} state - boardgame.io match state (G, ctx, etc.)
   */
  async recordCompletedMatch(matchId, metadata, state) {
    if (!matchId || !metadata) return false;

    try {
      const gameName = metadata.gameName || 'unknown';
      const players = metadata.players ? Object.values(metadata.players).filter(p => p && p.name) : [];
      
      const gameover = metadata.gameover || (state && state.ctx && state.ctx.gameover) || null;
      let winnerId = null;
      let winnerName = null;

      if (gameover) {
        if (gameover.winner !== undefined && gameover.winner !== null) {
          winnerId = String(gameover.winner);
          const winnerPlayer = metadata.players ? metadata.players[winnerId] : null;
          winnerName = winnerPlayer?.name || (typeof gameover.winner === 'string' ? gameover.winner : `Player ${winnerId}`);
        } else if (gameover.draw) {
          winnerName = 'Draw';
        }
      }

      const totalTurns = (state && state.ctx && state.ctx.turn) ? state.ctx.turn : 0;
      const startedAt = metadata.createdAt ? new Date(metadata.createdAt) : new Date();
      const endedAt = metadata.updatedAt ? new Date(metadata.updatedAt) : new Date();

      const sql = `
        INSERT INTO match_history (
          match_id, game_name, players, winner_id, winner_name, gameover_data, total_turns, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          players = VALUES(players),
          winner_id = VALUES(winner_id),
          winner_name = VALUES(winner_name),
          gameover_data = VALUES(gameover_data),
          total_turns = VALUES(total_turns),
          ended_at = VALUES(ended_at)
      `;

      await this.pool.execute(sql, [
        matchId,
        gameName,
        JSON.stringify(players),
        winnerId,
        winnerName,
        JSON.stringify(gameover),
        totalTurns,
        startedAt,
        endedAt
      ]);

      console.log(`[MATCH RECORDER] Logged match history for ${matchId} (${gameName})`);
      return true;
    } catch (err) {
      console.error(`[MATCH RECORDER] Error recording match ${matchId}:`, err.message);
      return false;
    }
  }

  /**
   * Retrieves recent match history.
   */
  async getRecentMatches(limit = 50, gameName = null) {
    try {
      let sql = 'SELECT * FROM match_history';
      const params = [];

      if (gameName) {
        sql += ' WHERE game_name = ?';
        params.push(gameName);
      }

      sql += ' ORDER BY ended_at DESC LIMIT ?';
      params.push(parseInt(limit, 10) || 50);

      const [rows] = await this.pool.query(sql, params);
      return rows.map(r => ({
        ...r,
        players: typeof r.players === 'string' ? JSON.parse(r.players) : r.players,
        gameover_data: typeof r.gameover_data === 'string' ? JSON.parse(r.gameover_data) : r.gameover_data
      }));
    } catch (err) {
      console.error('[MATCH RECORDER] Error getting match history:', err.message);
      return [];
    }
  }
}

module.exports = MatchRecorder;
