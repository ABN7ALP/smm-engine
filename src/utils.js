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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseStartRef(payload) {
  // start payload مثل: "ref_123456"
  if (!payload) return null;
  const m = String(payload).match(/^ref_(\d+)$/);
  return m ? m[1] : null;
}

module.exports = {
  isTikTokUrl,
  extractVideoId,
  clamp,
  formatCountdown,
  parseStartRef
};
