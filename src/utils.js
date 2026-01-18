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

module.exports = {
  isTikTokUrl,
  extractVideoId
};
