function isTikTokUrl(text) {
  try {
    const u = new URL(text);
    return u.hostname.includes('tiktok.com');
  } catch {
    return false;
  }
}

function extractVideoId(url) {
  try {
    const m = url.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function parseStartRef(payload) {
  // expecting "ref_<telegramId>"
  if (!payload) return null;
  const p = String(payload).trim();
  const m = p.match(/^ref_(\d+)$/);
  return m ? m[1] : null;
}

module.exports = {
  isTikTokUrl,
  extractVideoId,
  clampInt,
  parseStartRef
};
