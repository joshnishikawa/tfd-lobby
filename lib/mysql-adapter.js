const { pool, initSchema } = require('./db');
const { Async } = require('boardgame.io/internal');

class MySQLAdapter extends Async {
  constructor() {
    super();
    this.pool = pool;
    this.initPromise = null;
  }

  type() {
    return 'ASYNC';
  }

  async connect() {
    if (!this.initPromise) {
      this.initPromise = initSchema();
    }
    return this.initPromise;
  }

  async createMatch(matchID, opts) {
    await this.connect();
    const { initialState, metadata } = opts;
    const gameName = (metadata && metadata.gameName) || 'unknown';
    const now = Date.now();

    const sql = `
      INSERT INTO matches (id, game_name, state, initial_state, metadata, log, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        game_name = VALUES(game_name),
        state = VALUES(state),
        initial_state = VALUES(initial_state),
        metadata = VALUES(metadata),
        log = VALUES(log),
        updated_at = VALUES(updated_at)
    `;

    const stateStr = JSON.stringify(initialState);
    const initialStr = JSON.stringify(initialState);
    const metaStr = JSON.stringify(metadata || {});
    const logStr = JSON.stringify([]);

    await this.pool.execute(sql, [
      matchID,
      gameName,
      stateStr,
      initialStr,
      metaStr,
      logStr,
      metadata?.createdAt || now,
      metadata?.updatedAt || now
    ]);
  }

  async setState(matchID, state, deltalog) {
    await this.connect();
    const now = Date.now();

    if (deltalog && deltalog.length > 0) {
      const connection = await this.pool.getConnection();
      try {
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT log FROM matches WHERE id = ? FOR UPDATE', [matchID]);
        let currentLog = [];
        if (rows.length > 0 && rows[0].log) {
          try {
            currentLog = typeof rows[0].log === 'string' ? JSON.parse(rows[0].log) : rows[0].log;
          } catch (e) {
            currentLog = [];
          }
        }
        const updatedLog = currentLog.concat(deltalog);

        await connection.query(
          'UPDATE matches SET state = ?, log = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify(state), JSON.stringify(updatedLog), now, matchID]
        );

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }
    } else {
      await this.pool.execute(
        'UPDATE matches SET state = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(state), now, matchID]
      );
    }
  }

  async setMetadata(matchID, metadata) {
    await this.connect();
    const now = Date.now();
    const gameName = metadata?.gameName;

    if (gameName) {
      await this.pool.execute(
        'UPDATE matches SET metadata = ?, game_name = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(metadata), gameName, metadata.updatedAt || now, matchID]
      );
    } else {
      await this.pool.execute(
        'UPDATE matches SET metadata = ?, updated_at = ? WHERE id = ?',
        [JSON.stringify(metadata), metadata?.updatedAt || now, matchID]
      );
    }
  }

  async fetch(matchID, opts = {}) {
    await this.connect();
    const { state, metadata, initialState, log } = opts;

    const [rows] = await this.pool.execute(
      'SELECT state, initial_state, metadata, log FROM matches WHERE id = ?',
      [matchID]
    );

    if (!rows || rows.length === 0) {
      return {};
    }

    const row = rows[0];
    const result = {};

    if (state && row.state !== null && row.state !== undefined) {
      result.state = typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
    }
    if (metadata && row.metadata !== null && row.metadata !== undefined) {
      result.metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    }
    if (initialState && row.initial_state !== null && row.initial_state !== undefined) {
      result.initialState = typeof row.initial_state === 'string' ? JSON.parse(row.initial_state) : row.initial_state;
    }
    if (log && row.log !== null && row.log !== undefined) {
      result.log = typeof row.log === 'string' ? JSON.parse(row.log) : row.log;
    }

    return result;
  }

  async wipe(matchID) {
    await this.connect();
    await this.pool.execute('DELETE FROM matches WHERE id = ?', [matchID]);
  }

  async listMatches(opts = {}) {
    await this.connect();
    const { gameName, where } = opts;

    let query = 'SELECT id, game_name, updated_at FROM matches WHERE 1=1';
    const params = [];

    if (gameName) {
      query += ' AND game_name = ?';
      params.push(gameName);
    }

    if (where && where.updatedBefore !== undefined) {
      query += ' AND updated_at < ?';
      params.push(where.updatedBefore);
    }

    if (where && where.updatedAfter !== undefined) {
      query += ' AND updated_at > ?';
      params.push(where.updatedAfter);
    }

    const [rows] = await this.pool.execute(query, params);
    return rows.map(r => r.id);
  }
}

module.exports = MySQLAdapter;
