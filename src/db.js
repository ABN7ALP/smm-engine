const Database = require('better-sqlite3');
const db = new Database('bot.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id TEXT PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    full_name TEXT,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    total_free_used INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    last_seen INTEGER,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    video_url TEXT,
    video_key TEXT,
    amount INTEGER,
    status TEXT DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER,
    FOREIGN KEY(telegram_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id TEXT,
    referred_id TEXT,
    status TEXT DEFAULT 'pending',
    bonus_claimed INTEGER DEFAULT 0,
    created_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY(referrer_id) REFERENCES users(telegram_id),
    FOREIGN KEY(referred_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS user_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    interaction_type TEXT,
    data TEXT,
    created_at INTEGER,
    FOREIGN KEY(telegram_id) REFERENCES users(telegram_id)
  );

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER,
    telegram_id TEXT,
    first_name TEXT,
    username TEXT,
    video_url TEXT,
    amount INTEGER,
    status TEXT,
    progress INTEGER,
    message_id INTEGER,
    created_at INTEGER
  );
`);

function upsertUser(from, referralCode = null) {
  const telegramId = String(from.id);
  const fullName = `${from.first_name || ''} ${from.last_name || ''}`.trim();
  
  const existing = db.prepare('SELECT referral_code FROM users WHERE telegram_id = ?').get(telegramId);
  
  if (!existing) {
    const newRefCode = `ref_${telegramId}_${Date.now()}`;
    db.prepare(`
      INSERT INTO users (telegram_id, first_name, username, full_name, referral_code, referred_by, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(telegramId, from.first_name || '', from.username || '', fullName, newRefCode, referralCode || null, Date.now(), Date.now());
  } else {
    db.prepare(`
      UPDATE users SET first_name=?, username=?, full_name=?, last_seen=? WHERE telegram_id=?
    `).run(from.first_name || '', from.username || '', fullName, Date.now(), telegramId);
  }
  
  return telegramId;
}

function getReferralCode(telegramId) {
  const user = db.prepare('SELECT referral_code FROM users WHERE telegram_id = ?').get(telegramId);
  return user?.referral_code;
}

function getUserByReferralCode(code) {
  return db.prepare('SELECT telegram_id FROM users WHERE referral_code = ?').get(code);
}

function getPendingRequest(telegramId, minutes) {
  const since = Date.now() - minutes * 60 * 1000;
  return db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='pending' AND created_at >= ?
    ORDER BY created_at DESC LIMIT 1
  `).get(telegramId, since);
}

function getLastCompletedRequest(telegramId, hours) {
  const since = Date.now() - hours * 3600 * 1000;
  return db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='completed' AND completed_at >= ?
    ORDER BY completed_at DESC LIMIT 1
  `).get(telegramId, since);
}

function createRequest(telegramId, url, key, amount) {
  const info = db.prepare(`
    INSERT INTO requests (telegram_id, video_url, video_key, amount, status, progress, started_at, created_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(telegramId, url, key, amount, Date.now(), Date.now());

  return info.lastInsertRowid;
}

function updateRequestProgress(requestId, progress, status = 'pending') {
  db.prepare(`
    UPDATE requests SET progress=?, status=? WHERE id=?
  `).run(progress, status, requestId);
}

function completeRequest(requestId) {
  db.prepare(`
    UPDATE requests SET status='completed', progress=100, completed_at=? WHERE id=?
  `).run(Date.now(), requestId);
}

function getPendingReferrals(referrerId) {
  return db.prepare(`
    SELECT r.*, u.first_name, u.username, u.full_name
    FROM referrals r
    JOIN users u ON r.referred_id = u.telegram_id
    WHERE r.referrer_id = ? AND r.status = 'pending'
  `).all(referrerId);
}

function getCompletedReferrals(referrerId) {
  return db.prepare(`
    SELECT r.*, u.first_name, u.username, u.full_name
    FROM referrals r
    JOIN users u ON r.referred_id = u.telegram_id
    WHERE r.referrer_id = ? AND r.status = 'completed'
  `).all(referrerId);
}

function createOrGetReferral(referrerId, referredId) {
  const existing = db.prepare(`
    SELECT id FROM referrals WHERE referrer_id = ? AND referred_id = ?
  `).get(referrerId, referredId);
  
  if (existing) return existing.id;
  
  const info = db.prepare(`
    INSERT INTO referrals (referrer_id, referred_id, status, created_at)
    VALUES (?, ?, 'pending', ?)
  `).run(referrerId, referredId, Date.now());
  
  return info.lastInsertRowid;
}

function completeReferral(referralId) {
  db.prepare(`
    UPDATE referrals SET status='completed', completed_at=? WHERE id=?
  `).run(Date.now(), referralId);
}

function logToAdmin(requestId, telegramId, firstName, username, videoUrl, amount, status, progress, messageId) {
  db.prepare(`
    INSERT INTO admin_logs (request_id, telegram_id, first_name, username, video_url, amount, status, progress, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, telegramId, firstName, username, videoUrl, amount, status, progress, messageId, Date.now());
}

function updateAdminLogStatus(requestId, status, progress) {
  db.prepare(`
    UPDATE admin_logs SET status=?, progress=? WHERE request_id=? ORDER BY created_at DESC LIMIT 1
  `).run(status, progress, requestId);
}

function logInteraction(telegramId, type, data) {
  db.prepare(`
    INSERT INTO user_interactions (telegram_id, interaction_type, data, created_at)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, type, JSON.stringify(data), Date.now());
}

module.exports = {
  upsertUser,
  getReferralCode,
  getUserByReferralCode,
  getPendingRequest,
  getLastCompletedRequest,
  createRequest,
  updateRequestProgress,
  completeRequest,
  getPendingReferrals,
  getCompletedReferrals,
  createOrGetReferral,
  completeReferral,
  logToAdmin,
  updateAdminLogStatus,
  logInteraction
};
