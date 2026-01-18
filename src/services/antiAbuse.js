async function checkRateLimit(pool, telegramId, maxPerMin) {
  const now = Date.now();
  const { rows } = await pool.query(
    `SELECT msg_bucket, bucket_reset_at FROM user_limits WHERE telegram_id=$1`,
    [telegramId.toString()]
  );
  const row = rows[0];
  if (!row) return { ok: true };

  let bucket = row.msg_bucket;
  let resetAt = Number(row.bucket_reset_at);

  if (!resetAt || now > resetAt) {
    bucket = 0;
    resetAt = now + 60_000;
  }

  bucket += 1;

  await pool.query(
    `UPDATE user_limits SET msg_bucket=$1, bucket_reset_at=$2 WHERE telegram_id=$3`,
    [bucket, resetAt, telegramId.toString()]
  );

  if (bucket > maxPerMin) {
    return { ok: false, waitMs: resetAt - now };
  }
  return { ok: true };
}

async function checkCooldown(pool, telegramId, cooldownHours) {
  const now = Date.now();
  const { rows } = await pool.query(
    `SELECT last_free_at FROM user_limits WHERE telegram_id=$1`,
    [telegramId.toString()]
  );
  const last = Number(rows[0]?.last_free_at || 0);
  const cooldownMs = cooldownHours * 3600_000;
  if (last && now - last < cooldownMs) {
    return { ok: false, remainingMs: cooldownMs - (now - last) };
  }
  return { ok: true };
}

async function markFreeUsed(pool, telegramId) {
  const now = Date.now();
  await pool.query(
    `UPDATE user_limits SET last_free_at=$1 WHERE telegram_id=$2`,
    [now, telegramId.toString()]
  );
}

module.exports = { checkRateLimit, checkCooldown, markFreeUsed };
