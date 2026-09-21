require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Determine if we should attempt MySQL or fallback to embedded file storage
const hasMysqlConfig = Boolean(process.env.DB_HOST || process.env.DB_PASSWORD || process.env.DB_USER);

let pool = null;
let dbType = 'mysql';

// File-based embedded storage implementation (fallback when MySQL is absent or fails)
class EmbeddedDB {
  constructor(dataDir) {
    this.dataDir = dataDir || path.join(__dirname, '../data');
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this.matchesFile = path.join(this.dataDir, 'matches.json');
    this.historyFile = path.join(this.dataDir, 'match_history.json');
    this._matches = new Map();
    this._history = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.matchesFile)) {
        const raw = fs.readFileSync(this.matchesFile, 'utf8');
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          this._matches.set(k, v);
        }
      }
    } catch (e) {
      console.warn('[DB] Could not load embedded matches:', e.message);
    }

    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf8');
        this._history = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[DB] Could not load embedded history:', e.message);
    }
  }

  _saveMatches() {
    try {
      const obj = {};
      for (const [k, v] of this._matches.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.matchesFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (e) {
      console.error('[DB] Error saving embedded matches:', e.message);
    }
  }

  _saveHistory() {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this._history, null, 2), 'utf8');
    } catch (e) {
      console.error('[DB] Error saving embedded history:', e.message);
    }
  }

  async execute(sql, params = []) {
    const trimmed = sql.trim();

    // 1. Insert / Update match into matches table
    if (trimmed.startsWith('INSERT INTO matches')) {
      const [id, game_name, state, initial_state, metadata, log, created_at, updated_at] = params;
      const existing = this._matches.get(id) || {};
      const updated = {
        id,
        game_name: game_name ?? existing.game_name ?? 'unknown',
        state: state !== undefined ? state : existing.state,
        initial_state: initial_state !== undefined ? initial_state : existing.initial_state,
        metadata: metadata !== undefined ? metadata : existing.metadata,
        log: log !== undefined ? log : (existing.log || '[]'),
        created_at: created_at || existing.created_at || Date.now(),
        updated_at: updated_at || Date.now()
      };
      this._matches.set(id, updated);
      this._saveMatches();
      return [{ affectedRows: 1 }];
    }

    // 2. Update matches SET state
    if (trimmed.startsWith('UPDATE matches SET state = ?, updated_at = ? WHERE id = ?')) {
      const [state, updated_at, id] = params;
      const item = this._matches.get(id);
      if (item) {
        item.state = state;
        item.updated_at = updated_at;
        this._matches.set(id, item);
        this._saveMatches();
      }
      return [{ affectedRows: item ? 1 : 0 }];
    }

    // 3. Update matches SET state, log, updated_at
    if (trimmed.startsWith('UPDATE matches SET state = ?, log = ?, updated_at = ? WHERE id = ?')) {
      const [state, log, updated_at, id] = params;
      const item = this._matches.get(id);
      if (item) {
        item.state = state;
        item.log = log;
        item.updated_at = updated_at;
        this._matches.set(id, item);
        this._saveMatches();
      }
      return [{ affectedRows: item ? 1 : 0 }];
    }

    // 4. Update metadata
    if (trimmed.includes('UPDATE matches SET metadata =')) {
      if (params.length === 4) {
        // [metadata, gameName, updated_at, matchID]
        const [metadata, gameName, updated_at, id] = params;
        const item = this._matches.get(id);
        if (item) {
          item.metadata = metadata;
          item.game_name = gameName;
          item.updated_at = updated_at;
          this._matches.set(id, item);
          this._saveMatches();
        }
      } else if (params.length === 3) {
        // [metadata, updated_at, matchID]
        const [metadata, updated_at, id] = params;
        const item = this._matches.get(id);
        if (item) {
          item.metadata = metadata;
          item.updated_at = updated_at;
          this._matches.set(id, item);
          this._saveMatches();
        }
      }
      return [{ affectedRows: 1 }];
    }

    // 5. Select matches
    if (trimmed.startsWith('SELECT state, initial_state, metadata, log FROM matches WHERE id = ?')) {
      const [id] = params;
      const item = this._matches.get(id);
      return [item ? [item] : []];
    }

    // 6. Delete match
    if (trimmed.startsWith('DELETE FROM matches WHERE id = ?')) {
      const [id] = params;
      const deleted = this._matches.delete(id);
      if (deleted) this._saveMatches();
      return [{ affectedRows: deleted ? 1 : 0 }];
    }

    // 7. List matches
    if (trimmed.startsWith('SELECT id, game_name, updated_at FROM matches WHERE 1=1')) {
      let results = Array.from(this._matches.values());
      let paramIdx = 0;

      if (trimmed.includes('AND game_name = ?')) {
        const gn = params[paramIdx++];
        results = results.filter(r => r.game_name === gn);
      }
      if (trimmed.includes('AND updated_at < ?')) {
        const ub = params[paramIdx++];
        results = results.filter(r => r.updated_at < ub);
      }
      if (trimmed.includes('AND updated_at > ?')) {
        const ua = params[paramIdx++];
        results = results.filter(r => r.updated_at > ua);
      }
      return [results.map(r => ({ id: r.id, game_name: r.game_name, updated_at: r.updated_at }))];
    }

    // 8. Insert into match_history
    if (trimmed.startsWith('INSERT INTO match_history')) {
      const [match_id, game_name, players, winner_id, winner_name, gameover_data, total_turns, started_at, ended_at] = params;
      const entry = {
        id: this._history.length + 1,
        match_id,
        game_name,
        players: typeof players === 'string' ? players : JSON.stringify(players),
        winner_id,
        winner_name,
        gameover_data: typeof gameover_data === 'string' ? gameover_data : JSON.stringify(gameover_data),
        total_turns,
        started_at: started_at instanceof Date ? started_at.toISOString() : started_at,
        ended_at: ended_at instanceof Date ? ended_at.toISOString() : ended_at,
        created_at: new Date().toISOString()
      };

      const existingIdx = this._history.findIndex(h => h.match_id === match_id);
      if (existingIdx >= 0) {
        this._history[existingIdx] = { ...this._history[existingIdx], ...entry, id: this._history[existingIdx].id };
      } else {
        this._history.unshift(entry);
      }
      this._saveHistory();
      return [{ affectedRows: 1 }];
    }

    return [[]];
  }

  async query(sql, params = []) {
    const trimmed = sql.trim();

    // Select log FOR UPDATE
    if (trimmed.startsWith('SELECT log FROM matches WHERE id = ?')) {
      const [id] = params;
      const item = this._matches.get(id);
      return [item ? [{ log: item.log }] : []];
    }

    // Update log in matches
    if (trimmed.startsWith('UPDATE matches SET state = ?, log = ?, updated_at = ? WHERE id = ?')) {
      return this.execute(sql, params);
    }

    // Select recent match history
    if (trimmed.startsWith('SELECT * FROM match_history')) {
      let results = [...this._history];
      let limit = 50;

      if (trimmed.includes('WHERE game_name = ?')) {
        const gameName = params[0];
        results = results.filter(r => r.game_name === gameName);
        if (params.length > 1) {
          limit = parseInt(params[1], 10) || 50;
        }
      } else if (params.length > 0) {
        limit = parseInt(params[0], 10) || 50;
      }

      // Sort by ended_at DESC
      results.sort((a, b) => new Date(b.ended_at || 0) - new Date(a.ended_at || 0));
      return [results.slice(0, limit)];
    }

    return [[]];
  }

  async getConnection() {
    return {
      query: (sql, params) => this.query(sql, params),
      execute: (sql, params) => this.execute(sql, params),
      beginTransaction: async () => {},
      commit: async () => {},
      rollback: async () => {},
      release: () => {}
    };
  }
}

// Universal database wrapper that delegates to MySQL pool or Embedded fallback
class UniversalPool {
  constructor() {
    this.mysqlPool = null;
    this.embeddedDB = null;
    this.activeType = null;
  }

  async _init() {
    if (this.activeType) return;

    if (hasMysqlConfig) {
      try {
        const mysql = require('mysql2/promise');
        this.mysqlPool = mysql.createPool({
          host: process.env.DB_HOST || '127.0.0.1',
          port: parseInt(process.env.DB_PORT, 10) || 3306,
          user: process.env.DB_USER || 'tfd_user',
          password: process.env.DB_PASSWORD || '',
          database: process.env.DB_NAME || 'tfd_lobby',
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          charset: 'utf8mb4'
        });

        // Test connection with 2 second timeout
        const testConn = await Promise.race([
          this.mysqlPool.getConnection(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 2000))
        ]);
        testConn.release();
        this.activeType = 'mysql';
        return;
      } catch (err) {
        console.warn(`[DB] MySQL connection not available (${err.message}).`);
        if (this.mysqlPool) {
          try { await this.mysqlPool.end(); } catch (_) {}
          this.mysqlPool = null;
        }
      }
    }

    console.log('[DB] Falling back to zero-config embedded storage (data/*.json). No database setup required!');
    this.embeddedDB = new EmbeddedDB();
    this.activeType = 'embedded';
  }

  async execute(sql, params) {
    await this._init();
    if (this.activeType === 'mysql') {
      return this.mysqlPool.execute(sql, params);
    }
    return this.embeddedDB.execute(sql, params);
  }

  async query(sql, params) {
    await this._init();
    if (this.activeType === 'mysql') {
      return this.mysqlPool.query(sql, params);
    }
    return this.embeddedDB.query(sql, params);
  }

  async getConnection() {
    await this._init();
    if (this.activeType === 'mysql') {
      return this.mysqlPool.getConnection();
    }
    return this.embeddedDB.getConnection();
  }
}

const universalPool = new UniversalPool();

async function initSchema() {
  await universalPool._init();

  if (universalPool.activeType === 'mysql') {
    const connection = await universalPool.getConnection();
    try {
      // 1. Matches table for boardgame.io persistence
      await connection.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id VARCHAR(128) NOT NULL PRIMARY KEY,
          game_name VARCHAR(64) NOT NULL,
          state MEDIUMTEXT,
          initial_state MEDIUMTEXT,
          metadata MEDIUMTEXT,
          log MEDIUMTEXT,
          created_at BIGINT UNSIGNED,
          updated_at BIGINT UNSIGNED,
          INDEX idx_game_name (game_name),
          INDEX idx_updated_at (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      // 2. Completed matches stats and history table
      await connection.query(`
        CREATE TABLE IF NOT EXISTS match_history (
          id INT AUTO_INCREMENT PRIMARY KEY,
          match_id VARCHAR(128) NOT NULL UNIQUE,
          game_name VARCHAR(64) NOT NULL,
          players JSON,
          winner_id VARCHAR(64),
          winner_name VARCHAR(128),
          gameover_data JSON,
          total_turns INT DEFAULT 0,
          started_at DATETIME,
          ended_at DATETIME,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_history_game (game_name),
          INDEX idx_history_ended (ended_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);

      console.log('[DB] MySQL schema initialized successfully.');
    } finally {
      connection.release();
    }
  } else {
    console.log('[DB] Embedded schema initialized successfully.');
  }
}

module.exports = {
  pool: universalPool,
  initSchema
};
