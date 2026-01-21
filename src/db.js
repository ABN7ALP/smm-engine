const Database = require('better-sqlite3');
const db = new Database('bot.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    last_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    video_url TEXT,
    video_key TEXT,
    amount INTEGER,
    status TEXT,
    created_at INTEGER
  );
`);

function upsertUser(from) {
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, first_name, username, last_seen)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name=excluded.first_name,
      username=excluded.username,
      last_seen=excluded.last_seen
  `);

  stmt.run(
    String(from.id),
    from.first_name || '',
    from.username || '',
    Date.now()
  );

  return String(from.id);
}

function getPendingRequest(telegramId, minutes) {
  const since = Date.now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='pending' AND created_at >= ?
    LIMIT 1
  `).get(telegramId, since);
}

function createRequest(telegramId, url, key, amount) {
  const info = db.prepare(`
    INSERT INTO requests
    (telegram_id, video_url, video_key, amount, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(telegramId, url, key, amount, Date.now());

  return info.lastInsertRowid;
}

module.exports = {
  upsertUser,
  getPendingRequest,
  createRequest
};
