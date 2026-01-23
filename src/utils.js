function isTikTokUrl(text) {
  try {
    const u = new URL(text);
    return u.hostname.includes('tiktok.com');
  } catch {
    return false;
  }
}

function extractVideoId(url) {
  const m = String(url).match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// يلتقط ref من ctx.startPayload أو من نص "/start ref_123"
function parseRefFromStart(ctx) {
  const p = (ctx.startPayload ? String(ctx.startPayload).trim() : '');
  const t = (ctx.message?.text ? String(ctx.message.text).trim() : '');

  const candidate = p || (t.startsWith('/start') ? t.replace('/start', '').trim() : '');
  if (!candidate) return null;

  const m = candidate.match(/^ref_(\d+)$/);
  return m ? m[1] : null;
}

module.exports = {
  isTikTokUrl,
  extractVideoId,
  formatCountdown,
  parseRefFromStart
};
