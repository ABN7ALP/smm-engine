const https = require('https');

function isTikTokUrl(s) {
  try {
    const u = new URL(s);
    return u.hostname.includes('tiktok.com');
  } catch { return false; }
}

function extractVideoKey(urlStr) {
  try {
    const u = new URL(urlStr);
    const m = u.pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : null;
  } catch { return null; }
}

// تتبع Redirect مرة أو مرتين لدعم vt/vm
function resolveRedirect(url, maxHops = 3) {
  return new Promise((resolve) => {
    let current = url;
    let hops = 0;

    const step = () => {
      if (hops >= maxHops) return resolve(current);
      hops += 1;

      try {
        const u = new URL(current);
        const opts = { method: 'HEAD', hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' } };
        const req = https.request(opts, (res) => {
          const loc = res.headers.location;
          if (loc) {
            current = loc.startsWith('http') ? loc : `${u.protocol}//${u.hostname}${loc}`;
            return step();
          }
          return resolve(current);
        });
        req.on('error', () => resolve(current));
        req.end();
      } catch {
        resolve(current);
      }
    };

    step();
  });
}

module.exports = { isTikTokUrl, extractVideoKey, resolveRedirect };
