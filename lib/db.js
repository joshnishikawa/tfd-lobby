require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
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

async function initSchema() {
  const connection = await pool.getConnection();
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
}

module.exports = {
  pool,
  initSchema
};
