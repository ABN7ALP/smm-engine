function normalizeUrl(url) {
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

function isTikTokUrl(urlStr) {
  const u = normalizeUrl(urlStr);
  if (!u) return false;
  return u.includes('tiktok.com/');
}

// استخراج video id من روابط شائعة: /video/123...
function extractVideoKey(urlStr) {
  const u = normalizeUrl(urlStr);
  if (!u) return null;

  // مثال: https://www.tiktok.com/@name/video/1234567890
  const m = u.match(/\/video\/(\d+)/);
  if (m && m[1]) return m[1];

  // روابط tiktok قصيرة أحياناً لا تحتوي id بشكل مباشر
  return null;
}

module.exports = { normalizeUrl, isTikTokUrl, extractVideoKey };
