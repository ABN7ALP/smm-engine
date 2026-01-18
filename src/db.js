const { Pool } = require('pg');

function makePool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  return new Pool({ connectionString: url, ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : undefined });
}

async function migrate(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      first_name TEXT,
      username TEXT,
      last_seen_at BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS requests (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id),
      video_url TEXT NOT NULL,
      video_key TEXT,
      amount INT NOT NULL,
      status TEXT NOT NULL, -- pending | done | cancelled
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requests_user_status ON requests(telegram_id, status);
    CREATE INDEX IF NOT EXISTS idx_requests_created ON requests(created_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_limits (
      telegram_id BIGINT PRIMARY KEY REFERENCES users(telegram_id),
      last_free_at BIGINT NOT NULL DEFAULT 0,
      msg_bucket INT NOT NULL DEFAULT 0,
      bucket_reset_at BIGINT NOT NULL DEFAULT 0
    );
  `);
}

async function upsertUser(pool, from) {
  const telegramId = BigInt(from.id);
  const firstName = from.first_name || '';
  const username = from.username || '';
  const ts = Date.now();

  await pool.query(
    `INSERT INTO users (telegram_id, first_name, username, last_seen_at)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (telegram_id) DO UPDATE SET
       first_name=EXCLUDED.first_name,
       username=EXCLUDED.username,
       last_seen_at=EXCLUDED.last_seen_at`,
    [telegramId.toString(), firstName, username, ts]
  );

  await pool.query(
    `INSERT INTO user_limits (telegram_id, last_free_at, msg_bucket, bucket_reset_at)
     VALUES ($1,0,0,0)
     ON CONFLICT (telegram_id) DO NOTHING`,
    [telegramId.toString()]
  );

  return telegramId;
}

async function getPending(pool, telegramId, pendingMinutes) {
  const since = Date.now() - pendingMinutes * 60 * 1000;
  const { rows } = await pool.query(
    `SELECT * FROM requests
     WHERE telegram_id=$1 AND status='pending' AND created_at >= $2
     ORDER BY id DESC LIMIT 1`,
    [telegramId.toString(), since]
  );
  return rows[0] || null;
}

async function createRequest(pool, telegramId, videoUrl, videoKey, amount) {
  const ts = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO requests (telegram_id, video_url, video_key, amount, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'pending',$5,$5)
     RETURNING id`,
    [telegramId.toString(), videoUrl, videoKey, amount, ts]
  );
  return rows[0].id;
}

async function setRequestStatus(pool, requestId, status) {
  const ts = Date.now();
  await pool.query(
    `UPDATE requests SET status=$1, updated_at=$2 WHERE id=$3`,
    [status, ts, requestId]
  );
}

module.exports = { makePool, migrate, upsertUser, getPending, createRequest, setRequestStatus };
