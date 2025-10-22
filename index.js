// =================================================================
//  SMM Engine - Final Backend Server (v4 - Correct Route Order)
// =================================================================

const http = require('http' );
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { exec } = require('child_process'); // لاستدعاء المحلل الذكي
const metascraper = require('metascraper')([
  require('metascraper-url')(),
  require('metascraper-title')(),
  require('metascraper-description')(),
  require('metascraper-image')()
]);

// ---------- 1. Configuration & Database Paths ----------
const DB_SERVICES = path.join(__dirname, 'db.json');
const DB_ORDERS = path.join(__dirname, 'orders.json');
const DB_LOGS = path.join(__dirname, 'logs.json');
const CONFIG = path.join(__dirname, 'config.json');

// ---------- 2. Helper Functions ----------
function loadJson(filePath, defaultValue) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return defaultValue; }
}
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => resolve(body));
  });
}
function nowISO() { return new Date().toISOString(); }
function isValidUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ['http:', 'https:'].includes(u.protocol );
  } catch { return false; }
}

// ---------- 3. Load Data ----------
let servicesDB = loadJson(DB_SERVICES, { services: [] });
let ordersDB = loadJson(DB_ORDERS, { orders: [] });
let logsDB = loadJson(DB_LOGS, { logs: [] });
let config = loadJson(CONFIG, { users: [{ username: "admin", password: "password" }], sessionTTLMin: 240 });

// ---------- 4. Authentication & Session Management ----------
const sessions = new Map();
function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = (config.sessionTTLMin || 240) * 60 * 1000;
  sessions.set(token, { username, expires: Date.now() + ttl });
  return token;
}
function checkAuth(req) {
  const token = req.headers['x-auth-token'] || null;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || Date.now() > session.expires) {
    if (session) sessions.delete(token);
    return null;
  }
  return session.username;
}
setInterval(() => { sessions.forEach((s, t) => { if (Date.now() > s.expires) sessions.delete(t); }); }, 10 * 60 * 1000);

// ---------- 5. Logging & Caching ----------
function logAction(user, action, meta = {}) {
  const entry = { id: Date.now(), time: nowISO(), user, action, meta };
  logsDB.logs.unshift(entry);
  if (logsDB.logs.length > 2000) logsDB.logs.pop();
  saveJson(DB_LOGS, logsDB);
}
const previewCache = new Map();
const PREVIEW_TTL = 10 * 60 * 1000;

// ---------- 6. Main Server Logic ----------
const server = http.createServer(async (req, res ) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}` );
    const pathname = url.pathname;
    const method = req.method;

    // --- A. PUBLIC ROUTES (No Auth Needed) ---

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const publicDir = path.join(__dirname, 'public');
      const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
      let filePath = path.join(publicDir, safePath === '/' ? 'user.html' : safePath);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        filePath = path.join(publicDir, 'user.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/orders/public/')) {
      const id = parseInt(pathname.split('/').pop(), 10);
      const order = (ordersDB.orders || []).find(o => o.id === id);
      if (order) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Order not found' }));
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/services') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(servicesDB.services || []));
      return;
    }

    if (method === 'POST' && pathname === '/api/orders') {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      if (!data.serviceId || !data.link || !isValidUrl(data.link)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid fields' }));
        return;
      }
      const order = { id: Date.now(), ...data, status: 'pending', createdAt: nowISO() };
      ordersDB.orders.unshift(order);
      saveJson(DB_ORDERS, ordersDB);
      logAction('public', 'order_create', { id: order.id });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(order));
      return;
    }
    
    if (method === 'POST' && pathname === '/api/preview') {
      const body = await readBody(req);
      const { url: link } = JSON.parse(body || '{}');
      if (!link || !isValidUrl(link)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid URL' })); return;
      }
      const cached = previewCache.get(link);
      if (cached && (Date.now() - cached.time < PREVIEW_TTL)) {
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cached.data)); return;
      }
      try {
        const response = await fetch(link, { timeout: 8000 });
        const html = await response.text();
        const meta = await metascraper({ html, url: link });
        const result = { url: meta.url || link, title: meta.title || '', description: meta.description || '', image: meta.image || '' };
        previewCache.set(link, { time: Date.now(), data: result });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Failed to fetch preview' }));
      }
      return;
    }

    // =============================================================
    //  SMART LINK ANALYZER ENDPOINT - (MOVED TO PUBLIC SECTION)
    // =============================================================
    if (method === 'POST' && pathname === '/api/analyze') {
      const body = await readBody(req);
      const { url: linkToAnalyze } = JSON.parse(body || '{}');

      if (!linkToAnalyze || !isValidUrl(linkToAnalyze)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL provided' }));
        return;
      }

      exec(`node analyzer.js "${linkToAnalyze}"`, (error, stdout, stderr) => {
              // نطبع كل المخرجات دائماً لتشخيص الأخطاء
              console.log(`[ANALYZER STDOUT]: ${stdout}`);
              console.error(`[ANALYZER STDERR]: ${stderr}`);

              if (error) {
                  console.error(`[ANALYZER EXEC ERROR]: ${error.message}`);
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ 
                      error: 'Failed to execute analyzer script.', 
                      details: stderr || error.message 
                  }));
                  return;
              }

              try {
                  if (!stdout) {
                      throw new Error("Analyzer returned empty output.");
                  }
                  const analysisResult = JSON.parse(stdout);
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify(analysisResult));
              } catch (e) {
                  console.error(`[ANALYZER PARSING ERROR]: ${e.message}`);
                  res.writeHead(500, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ 
                      error: 'Failed to parse analyzer output.', 
                      details: stdout 
                  }));
              }
          });
          return;
      }


    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body || '{}');
      const user = (config.users || []).find(u => u.username === username && u.password === password);
      if (user) {
        const token = createSession(username);
        logAction(username, 'login');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token, username }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }
      return;
    }

    // --- B. PROTECTED ROUTES (Auth Required from this point on) ---
    const user = checkAuth(req);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Authentication required' }));
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      sessions.delete(req.headers['x-auth-token']);
      logAction(user, 'logout');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname.startsWith('/api/services')) {
      if (method === 'POST') {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        const maxId = servicesDB.services.reduce((max, s) => s.id > max ? s.id : max, 0);
        const newService = {
          id: maxId + 1,
          name: data.name,
          category: data.category,
          type: data.type,
          rate: data.rate ? parseFloat(data.rate) : undefined,
          price: data.price ? parseFloat(data.price) : undefined,
          min: data.min ? parseInt(data.min, 10) : undefined,
          max: data.max ? parseInt(data.max, 10) : undefined,
        };
        servicesDB.services.push(newService);
        saveJson(DB_SERVICES, servicesDB);
        logAction(user, 'service_create', { id: newService.id, name: newService.name });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newService));
        return;
      }

      const id = parseInt(pathname.split('/').pop(), 10);
      if (method === 'PUT') {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        const idx = servicesDB.services.findIndex(s => s.id === id);
        if (idx > -1) {
          const updatedData = {
            ...data,
            rate: data.rate ? parseFloat(data.rate) : undefined,
            price: data.price ? parseFloat(data.price) : undefined,
            min: data.min ? parseInt(data.min, 10) : undefined,
            max: data.max ? parseInt(data.max, 10) : undefined,
          };
          servicesDB.services[idx] = { ...servicesDB.services[idx], ...updatedData };
          saveJson(DB_SERVICES, servicesDB);
          logAction(user, 'service_update', { id, changes: data });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(servicesDB.services[idx]));
        } else { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Not Found' })); }
        return;
      }

      if (method === 'DELETE') {
        const initialLength = servicesDB.services.length;
        servicesDB.services = servicesDB.services.filter(s => s.id !== id);
        if (servicesDB.services.length < initialLength) {
          saveJson(DB_SERVICES, servicesDB);
          logAction(user, 'service_delete', { id });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service not found' }));
        }
        return;
      }
    }

    if (pathname === '/api/orders' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ordersDB.orders || []));
      return;
    }

    if (pathname.startsWith('/api/orders/') && method === 'PUT') {
      const id = parseInt(pathname.split('/').pop(), 10);
      const idx = ordersDB.orders.findIndex(o => o.id === id);
      if (idx > -1) {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        ordersDB.orders[idx] = { ...ordersDB.orders[idx], ...data, updatedAt: nowISO() };
        saveJson(DB_ORDERS, ordersDB);
        logAction(user, 'order_update', { id, changes: data });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ordersDB.orders[idx]));
      } else { res.writeHead(404); res.end(); }
      return;
    }

    if (pathname === '/api/stats' && method === 'GET') {
      const orders = ordersDB.orders || [];
      const services = servicesDB.services || [];
      const priceValues = services.map(s => parseFloat(s.type === 'fixed' ? s.price : s.rate) || 0).filter(v => v > 0);
      const stats = {
        totalServices: services.length,
        totalOrders: orders.length,
        pendingOrders: orders.filter(o => o.status === 'pending').length,
        avgPrice: priceValues.length ? (priceValues.reduce((a, b) => a + b, 0) / priceValues.length).toFixed(2) : 0
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    if (pathname === '/api/logs' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logsDB.logs || []));
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/export/')) {
      const type = pathname.split('/').pop();
      let data, header;
      if (type === 'services.csv') {
        data = servicesDB.services || [];
        header = 'id,name,category,type,price_or_rate,min,max\n';
        const rows = data.map(s => `${s.id},"${s.name || ''}","${s.category || ''}",${s.type},${s.type === 'fixed' ? s.price || '' : s.rate || ''},${s.min || ''},${s.max || ''}`).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="services.csv"' });
        res.end('\uFEFF' + header + rows);
      } else if (type === 'orders.csv') {
        data = ordersDB.orders || [];
        header = 'id,serviceId,link,quantity,price,status,createdAt,updatedAt\n';
        const rows = data.map(o => `${o.id},${o.serviceId},"${o.link || ''}",${o.quantity || ''},${o.price || ''},${o.status},${o.createdAt || ''},${o.updatedAt || ''}`).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"' });
        res.end('\uFEFF' + header + rows);
      } else { res.writeHead(404); res.end('Not Found'); }
      return;
    }

    // --- C. NOT FOUND ---
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API Endpoint Not Found' }));

  } catch (err) {
    console.error('Server Error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error' }));
    } else {
      res.end();
    }
  }
});

// ---------- 7. Start Server ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}` ));
