const Database = require('better-sqlite3');
const db = new Database('bot.sqlite');

// Improve durability a bit
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    last_seen INTEGER,
    has_used_free INTEGER DEFAULT 0,
    referred_by TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT NOT NULL,
    video_url TEXT NOT NULL,
    video_key TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL, -- pending | done | cancelled
    created_at INTEGER NOT NULL,
    site_visited INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rewards (
    telegram_id TEXT PRIMARY KEY,
    credits INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT NOT NULL,
    referred_id TEXT NOT NULL,
    status TEXT NOT NULL, -- pending | qualified
    created_at INTEGER NOT NULL,
    qualified_at INTEGER DEFAULT NULL,
    UNIQUE(referrer_id, referred_id)
  );

  CREATE INDEX IF NOT EXISTS idx_requests_user_status ON requests(telegram_id, status);
  CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
`);

function now() {
  return Date.now();
}

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
    now()
  );

  // Ensure rewards row exists
  db.prepare(`
    INSERT INTO rewards (telegram_id, credits)
    VALUES (?, 0)
    ON CONFLICT(telegram_id) DO NOTHING
  `).run(String(from.id));

  return String(from.id);
}

function getUser(telegramId) {
  return db.prepare(`SELECT * FROM users WHERE telegram_id=?`).get(String(telegramId)) || null;
}

function setReferredByIfEmpty(referredId, referrerId) {
  const u = getUser(referredId);
  if (!u) return false;
  if (u.referred_by) return false;
  if (String(referredId) === String(referrerId)) return false;

  db.prepare(`UPDATE users SET referred_by=? WHERE telegram_id=? AND (referred_by IS NULL OR referred_by='')`)
    .run(String(referrerId), String(referredId));

  // Create referral record (pending)
  db.prepare(`
    INSERT INTO referrals (referrer_id, referred_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
    ON CONFLICT(referrer_id, referred_id) DO NOTHING
  `).run(String(referrerId), String(referredId), now());

  return true;
}

function getPendingRequest(telegramId, minutes) {
  const since = now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='pending' AND created_at >= ?
    ORDER BY id DESC LIMIT 1
  `).get(String(telegramId), since) || null;
}

function createRequest(telegramId, url, key, amount) {
  const info = db.prepare(`
    INSERT INTO requests (telegram_id, video_url, video_key, amount, status, created_at, site_visited)
    VALUES (?, ?, ?, ?, 'pending', ?, 0)
  `).run(String(telegramId), url, key, amount, now());

  return info.lastInsertRowid;
}

function markRequestSiteVisitedByUser(telegramId) {
  // Mark latest pending request as visited (if any)
  const req = db.prepare(`
    SELECT * FROM requests WHERE telegram_id=? ORDER BY id DESC LIMIT 1
  `).get(String(telegramId));

  if (!req) return null;

  db.prepare(`UPDATE requests SET site_visited=1 WHERE id=?`).run(req.id);
  return req.id;
}

function hasAnyRequest(telegramId) {
  const row = db.prepare(`SELECT COUNT(1) AS c FROM requests WHERE telegram_id=?`).get(String(telegramId));
  return (row?.c || 0) > 0;
}

function getCredits(telegramId) {
  const r = db.prepare(`SELECT credits FROM rewards WHERE telegram_id=?`).get(String(telegramId));
  return r ? Number(r.credits) : 0;
}

function addCredits(telegramId, amount) {
  db.prepare(`
    INSERT INTO rewards (telegram_id, credits)
    VALUES (?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET credits = rewards.credits + excluded.credits
  `).run(String(telegramId), Number(amount));
}

function deductCredits(telegramId, amount) {
  const current = getCredits(telegramId);
  if (current < amount) return false;
  db.prepare(`UPDATE rewards SET credits = credits - ? WHERE telegram_id=?`).run(Number(amount), String(telegramId));
  return true;
}

function markUsedFree(telegramId) {
  db.prepare(`UPDATE users SET has_used_free=1 WHERE telegram_id=?`).run(String(telegramId));
}

function qualifyReferralIfPossible(referredId) {
  // Conditions: referred has referrer, has at least one request, and site_visited=1 on latest request
  const u = getUser(referredId);
  if (!u || !u.referred_by) return { qualified: false };

  const latestReq = db.prepare(`SELECT * FROM requests WHERE telegram_id=? ORDER BY id DESC LIMIT 1`).get(String(referredId));
  if (!latestReq) return { qualified: false };
  if (Number(latestReq.site_visited) !== 1) return { qualified: false };

  // ensure referral record exists
  db.prepare(`
    INSERT INTO referrals (referrer_id, referred_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
    ON CONFLICT(referrer_id, referred_id) DO NOTHING
  `).run(String(u.referred_by), String(referredId), now());

  // qualify if still pending
  const refRow = db.prepare(`
    SELECT * FROM referrals WHERE referrer_id=? AND referred_id=?
  `).get(String(u.referred_by), String(referredId));

  if (!refRow) return { qualified: false };

  if (refRow.status === 'qualified') {
    return { qualified: false, already: true, referrerId: String(u.referred_by) };
  }

  db.prepare(`
    UPDATE referrals
    SET status='qualified', qualified_at=?
    WHERE referrer_id=? AND referred_id=? AND status='pending'
  `).run(now(), String(u.referred_by), String(referredId));

  return { qualified: true, referrerId: String(u.referred_by) };
}

module.exports = {
  db,
  upsertUser,
  getUser,
  setReferredByIfEmpty,
  getPendingRequest,
  createRequest,
  markRequestSiteVisitedByUser,
  hasAnyRequest,
  getCredits,
  addCredits,
  deductCredits,
  markUsedFree,
  qualifyReferralIfPossible
};
