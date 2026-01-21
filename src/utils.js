const https = require('https');

function isTikTokUrl(text) {
  try {
    const u = new URL(text);
    const hostname = u.hostname;
    return hostname.includes('tiktok.com') || 
           hostname.includes('vm.tiktok.com') || 
           hostname.includes('vt.tiktok.com');
  } catch {
    return false;
  }
}

function extractVideoId(url) {
  try {
    // Standard URL
    let match = url.match(/\/video\/(\d+)/);
    if (match) return match[1];
    
    // Short URL - need to resolve
    match = url.match(/\/(vm|vt)\.tiktok\.com\/([a-zA-Z0-9]+)/);
    if (match) return match[2];
    
    return null;
  } catch {
    return null;
  }
}

function resolveShortUrl(shortUrl) {
  return new Promise((resolve) => {
    try {
      const u = new URL(shortUrl);
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'HEAD',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      };

      https.request(opts, (res) => {
        const location = res.headers.location;
        if (location) {
          const videoMatch = location.match(/\/video\/(\d+)/);
          return resolve(videoMatch ? videoMatch[1] : extractVideoId(location));
        }
        resolve(extractVideoId(shortUrl));
      }).on('error', () => resolve(null)).end();
    } catch {
      resolve(null);
    }
  });
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}ث`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}د`;
}

function generateShareText(refCode, userName) {
  const messages = [
    `🔥 يا ${userName}! جربت الخدمة الجديدة؟ اكسب 5000 مشاهدة مجاناً! ${refCode}`,
    `✨ احصل على مشاهدات حقيقية مجاناً! استخدم: ${refCode}`,
    `🚀 أنا استخدمت هاي الخدمة وفعلاً شغلت! ${refCode}`,
    `💡 نصيحة: اكسب مشاهدات مجانية عبر ${refCode}`,
    `🎁 عرض حصري: مشاهدات تيك توك مجاناً! ${refCode}`
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

module.exports = {
  isTikTokUrl,
  extractVideoId,
  resolveShortUrl,
  formatTime,
  generateShareText
};
