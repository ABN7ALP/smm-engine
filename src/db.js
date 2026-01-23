const Database = require('better-sqlite3');
const db = new Database('bot.sqlite');

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    last_seen INTEGER,
    free_used INTEGER DEFAULT 0,
    bonus_tokens INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    video_url TEXT,
    video_key TEXT,
    amount INTEGER,
    status TEXT,         -- pending | done | cancelled
    kind TEXT,           -- free | bonus
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT NOT NULL,
    referred_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    qualified INTEGER DEFAULT 0,
    qualified_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_requests_user_status ON requests(telegram_id, status);
  CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
`);

function upsertUser(from) {
  const telegramId = String(from.id);

  db.prepare(`
    INSERT INTO users (telegram_id, first_name, username, last_seen, free_used, bonus_tokens)
    VALUES (?, ?, ?, ?, 0, 0)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name=excluded.first_name,
      username=excluded.username,
      last_seen=excluded.last_seen
  `).run(
    telegramId,
    from.first_name || '',
    from.username || '',
    Date.now()
  );

  return telegramId;
}

function getUser(telegramId) {
  return db.prepare(`SELECT * FROM users WHERE telegram_id=?`).get(String(telegramId));
}

function setFreeUsed(telegramId) {
  db.prepare(`UPDATE users SET free_used=1 WHERE telegram_id=?`).run(String(telegramId));
}

function addBonusToken(telegramId, count = 1) {
  db.prepare(`UPDATE users SET bonus_tokens = bonus_tokens + ? WHERE telegram_id=?`).run(count, String(telegramId));
}

function consumeBonusToken(telegramId) {
  db.prepare(`
    UPDATE users
    SET bonus_tokens = CASE WHEN bonus_tokens > 0 THEN bonus_tokens - 1 ELSE 0 END
    WHERE telegram_id=?
  `).run(String(telegramId));
}

function getPendingRequest(telegramId, minutes) {
  const since = Date.now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='pending' AND created_at >= ?
    ORDER BY id DESC LIMIT 1
  `).get(String(telegramId), since);
}

function hasAnyRequest(telegramId) {
  const row = db.prepare(`SELECT 1 AS x FROM requests WHERE telegram_id=? LIMIT 1`).get(String(telegramId));
  return !!row;
}

function createRequest(telegramId, url, key, amount, kind) {
  const info = db.prepare(`
    INSERT INTO requests
    (telegram_id, video_url, video_key, amount, status, kind, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(String(telegramId), url, key, amount, kind, Date.now());

  return info.lastInsertRowid;
}

// Referral
function recordReferralStart(referrerId, referredId) {
  const a = String(referrerId);
  const b = String(referredId);

  if (a === b) return { created: false, reason: 'self' };

  const existing = db.prepare(`SELECT * FROM referrals WHERE referred_id=?`).get(b);
  if (existing) return { created: false, reason: 'already_referred' };

  db.prepare(`
    INSERT INTO referrals (referrer_id, referred_id, created_at, qualified, qualified_at)
    VALUES (?, ?, ?, 0, NULL)
  `).run(a, b, Date.now());

  return { created: true };
}

function getReferralByReferredId(referredId) {
  return db.prepare(`SELECT * FROM referrals WHERE referred_id=?`).get(String(referredId));
}

function qualifyReferral(referralId) {
  db.prepare(`
    UPDATE referrals
    SET qualified=1, qualified_at=?
    WHERE id=? AND qualified=0
  `).run(Date.now(), referralId);
}

module.exports = {
  db,
  upsertUser,
  getUser,
  setFreeUsed,
  addBonusToken,
  consumeBonusToken,
  getPendingRequest,
  hasAnyRequest,
  createRequest,
  recordReferralStart,
  getReferralByReferredId,
  qualifyReferral
};
