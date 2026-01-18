const Database = require('better-sqlite3');

function initDb() {
  const db = new Database('bot.sqlite');

  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      last_seen_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT NOT NULL,
      video_url TEXT NOT NULL,
      video_key TEXT,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,  -- pending | done | cancelled
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requests_user_status ON requests(telegram_id, status);
  `);

  return db;
}

module.exports = { initDb };
