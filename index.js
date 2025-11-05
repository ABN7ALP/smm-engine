// =================================================================
//  SMM Engine - Final Backend Server (v6 - Complete User System with Auto File Creation)
// =================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { exec } = require('child_process');
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
const DB_USERS = path.join(__dirname, 'users.json');
const CONFIG = path.join(__dirname, 'config.json');

// ---------- 2. Helper Functions ----------
function loadJson(filePath, defaultValue) {
  try {
    // التحقق من وجود الملف أولاً
    if (!fs.existsSync(filePath)) {
      console.log(`📁 الملف غير موجود، سيتم إنشاء: ${filePath}`);
      // إنشاء الملف بالقيمة الافتراضية
      saveJson(filePath, defaultValue);
      return defaultValue;
    }
    
    // إذا الملف موجود، حمله
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`✅ تم تحميل ${filePath}`);
    return data;
  } catch (error) {
    console.error(`❌ خطأ في تحميل ${filePath}:`, error.message);
    // في حالة خطأ، أنشئ الملف بالقيمة الافتراضية
    saveJson(filePath, defaultValue);
    return defaultValue;
  }
}

function saveJson(filePath, data) {
  try {
    // التأكد من وجود المجلد أولاً
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 تم إنشاء المجلد: ${dir}`);
    }
    
    // حفظ البيانات
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`💾 تم حفظ البيانات في: ${filePath}`);
    return true;
  } catch (error) {
    console.error(`❌ خطأ في حفظ ${filePath}:`, error);
    return false;
  }
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
    return ['http:', 'https:'].includes(u.protocol);
  } catch { return false; }
}

// ---------- 3. Load Data ----------
console.log('🚀 بدء تحميل قواعد البيانات...');

let servicesDB = loadJson(DB_SERVICES, { services: [] });
let ordersDB = loadJson(DB_ORDERS, { orders: [] });
let logsDB = loadJson(DB_LOGS, { logs: [] });
let usersDB = loadJson(DB_USERS, { users: [] });
let config = loadJson(CONFIG, { 
  users: [{ username: "admin", password: "password" }], 
  sessionTTLMin: 240 
});

// التحقق النهائي من وجود الملفات
console.log('🔍 التحقق النهائي من الملفات:');
[DB_SERVICES, DB_ORDERS, DB_LOGS, DB_USERS, CONFIG].forEach(file => {
  const exists = fs.existsSync(file);
  console.log(`   ${exists ? '✅' : '❌'} ${path.basename(file)} ${exists ? 'موجود' : 'مفقود'}`);
});

// تسجيل حالة قواعد البيانات
console.log('📊 حالة قواعد البيانات:');
console.log(`   - الخدمات: ${servicesDB.services.length}`);
console.log(`   - الطلبات: ${ordersDB.orders.length}`);
console.log(`   - المستخدمون: ${usersDB.users.length}`);
console.log(`   - السجلات: ${logsDB.logs.length}`);

// ---------- 4. Authentication & Session Management ----------
const sessions = new Map();
const userSessions = new Map();

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = (config.sessionTTLMin || 240) * 60 * 1000;
  sessions.set(token, { username, expires: Date.now() + ttl });
  return token;
}

function createUserSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = (config.sessionTTLMin || 240) * 60 * 1000;
  userSessions.set(token, { userId, expires: Date.now() + ttl });
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

function checkUserAuth(req) {
  const token = req.headers['x-user-token'] || req.headers['authorization']?.replace('Bearer ', '') || null;
  if (!token) return null;
  const session = userSessions.get(token);
  if (!session || Date.now() > session.expires) {
    if (session) userSessions.delete(token);
    return null;
  }
  return session.userId;
}

// تنظيف الجلسات المنتهية كل 10 دقائق
setInterval(() => { 
  sessions.forEach((s, t) => { if (Date.now() > s.expires) sessions.delete(t); });
  userSessions.forEach((s, t) => { if (Date.now() > s.expires) userSessions.delete(t); });
}, 10 * 60 * 1000);

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
const server = http.createServer(async (req, res) => {
  // إعداد CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-auth-token, x-user-token, authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;

    console.log(`🌐 ${method} ${pathname}`);

    // --- A. PUBLIC ROUTES (No Auth Needed) ---

    if (method === 'GET' && !pathname.startsWith('/api/')) {
      const publicDir = path.join(__dirname, 'public');
      const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
      let filePath = path.join(publicDir, safePath === '/' ? 'user.html' : safePath);
      
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        filePath = path.join(publicDir, 'user.html');
      }
      
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = { 
        '.html': 'text/html', 
        '.css': 'text/css', 
        '.js': 'application/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif'
      };
      
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // نقاط نهاية التصحيح
    if (method === 'GET' && pathname === '/api/debug/files') {
      const files = [
        { name: 'Services', path: DB_SERVICES },
        { name: 'Orders', path: DB_ORDERS },
        { name: 'Logs', path: DB_LOGS },
        { name: 'Users', path: DB_USERS },
        { name: 'Config', path: CONFIG }
      ];
      
      const result = files.map(file => ({
        name: file.name,
        path: file.path,
        exists: fs.existsSync(file.path),
        size: fs.existsSync(file.path) ? fs.statSync(file.path).size : 0,
        lastModified: fs.existsSync(file.path) ? fs.statSync(file.path).mtime : null
      }));
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (method === 'GET' && pathname === '/api/debug/users') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalUsers: usersDB.users.length,
        users: usersDB.users.map(u => ({ 
          id: u.id, 
          email: u.email, 
          name: u.name,
          country: u.country,
          balance: u.balance,
          createdAt: u.createdAt,
          lastLogin: u.lastLogin
        }))
      }));
      return;
    }

    if (method === 'GET' && pathname === '/api/debug/users-file') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(usersDB));
      return;
    }

    if (method === 'GET' && pathname.startsWith('/api/orders/public/')) {
      const id = parseInt(pathname.split('/').pop(), 10);
      const order = (ordersDB.orders || []).find(o => o.id === id);
      if (order) {
        const service = (servicesDB.services || []).find(s => s.id === order.serviceId);
        const orderWithService = {
          ...order,
          serviceName: service ? service.name : `خدمة رقم ${order.serviceId}`
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orderWithService));
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

      const userId = checkUserAuth(req);
      const order = { 
        id: Date.now(), 
        ...data, 
        status: 'pending', 
        createdAt: nowISO(),
        userId: userId || null
      };

      ordersDB.orders.unshift(order);
      saveJson(DB_ORDERS, ordersDB);
      logAction(userId ? `user:${userId}` : 'public', 'order_create', { id: order.id });
      
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(order));
      return;
    }

    if (method === 'POST' && pathname === '/api/preview') {
      const body = await readBody(req);
      const { url: link } = JSON.parse(body || '{}');
      
      if (!link || !isValidUrl(link)) {
        res.writeHead(400, { 'Content-Type': 'application/json' }); 
        res.end(JSON.stringify({ error: 'Invalid URL' })); 
        return;
      }
      
      const cached = previewCache.get(link);
      if (cached && (Date.now() - cached.time < PREVIEW_TTL)) {
        res.writeHead(200, { 'Content-Type': 'application/json' }); 
        res.end(JSON.stringify(cached.data)); 
        return;
      }
      
      try {
        const response = await fetch(link, { timeout: 8000 });
        const html = await response.text();
        const meta = await metascraper({ html, url: link });
        const result = { 
          url: meta.url || link, 
          title: meta.title || '', 
          description: meta.description || '', 
          image: meta.image || '' 
        };
        
        previewCache.set(link, { time: Date.now(), data: result });
        res.writeHead(200, { 'Content-Type': 'application/json' }); 
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' }); 
        res.end(JSON.stringify({ error: 'Failed to fetch preview' }));
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/analyze') {
      const body = await readBody(req);
      const { url: linkToAnalyze } = JSON.parse(body || '{}');

      if (!linkToAnalyze || !isValidUrl(linkToAnalyze)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL provided' }));
        return;
      }

      exec(`node analyzer.js "${linkToAnalyze}"`, (error, stdout, stderr) => {
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

    // ========== نقاط نهاية إدارة المستخدمين ==========

    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody(req);
      const { name, email, password, country, phone } = JSON.parse(body || '{}');

      if (!name || !email || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'الاسم، البريد الإلكتروني وكلمة السر مطلوبة' }));
        return;
      }

      // التحقق من عدم وجود مستخدم بنفس البريد
      const existingUser = usersDB.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (existingUser) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'البريد الإلكتروني مستخدم بالفعل' }));
        return;
      }

      // التأكد من أن usersDB موجود
      if (!usersDB || !usersDB.users) {
        console.log('⚠️ usersDB غير مهيء، إعادة التهيئة...');
        usersDB = { users: [] };
      }

      // إنشاء المستخدم الجديد
      const newUser = {
        id: Date.now(),
        name,
        email: email.toLowerCase(),
        password: password,
        country: country || '',
        phone: phone || '',
        profilePicture: '',
        balance: 0.0,
        createdAt: nowISO(),
        lastLogin: null
      };

      // إضافة المستخدم إلى قاعدة البيانات
      usersDB.users.push(newUser);
      
      // حفظ البيانات في الملف
      const saveResult = saveJson(DB_USERS, usersDB);
      if (!saveResult) {
        console.log('❌ فشل حفظ بيانات المستخدم في الملف');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'فشل في حفظ بيانات المستخدم' }));
        return;
      }

      // التحقق من أن الملف تم إنشاؤه فعلياً
      if (fs.existsSync(DB_USERS)) {
        const stats = fs.statSync(DB_USERS);
        console.log(`✅ تم إنشاء/تحديث الملف: ${DB_USERS} (${stats.size} bytes)`);
      } else {
        console.log(`❌ الملف لم ينشأ: ${DB_USERS}`);
      }

      console.log(`✅ تم إنشاء مستخدم جديد: ${newUser.email} (ID: ${newUser.id})`);

      // إنشاء جلسة للمستخدم
      const token = createUserSession(newUser.id);

      // إرجاع البيانات بدون كلمة السر
      const { password: _, ...userWithoutPassword } = newUser;
      
      logAction(newUser.email, 'user_register', { userId: newUser.id });
      
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        token, 
        user: userWithoutPassword,
        message: 'تم إنشاء الحساب بنجاح'
      }));
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/user-login') {
      const body = await readBody(req);
      const { email, password } = JSON.parse(body || '{}');

      console.log(`🔐 محاولة تسجيل دخول: ${email}`);
      console.log(`📋 المستخدمون المسجلون:`, usersDB.users.map(u => u.email));

      // البحث عن المستخدم (case-insensitive)
      const user = usersDB.users.find(u => 
        u.email.toLowerCase() === email.toLowerCase() && 
        u.password === password
      );
      
      if (user) {
        console.log(`✅ تم العثور على المستخدم: ${user.email}`);
        
        // تحديث آخر تسجيل دخول
        user.lastLogin = nowISO();
        
        // حفظ التحديث في الملف
        if (!saveJson(DB_USERS, usersDB)) {
          console.log(`❌ فشل في حفظ تحديث آخر تسجيل دخول`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'خطأ في تحديث بيانات المستخدم' }));
          return;
        }

        const token = createUserSession(user.id);
        const { password: _, ...userWithoutPassword } = user;
        
        console.log(`✅ تم تسجيل دخول ناجح: ${user.email} (ID: ${user.id})`);
        logAction(user.email, 'user_login');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          token, 
          user: userWithoutPassword,
          message: 'تم تسجيل الدخول بنجاح'
        }));
      } else {
        console.log(`❌ فشل تسجيل الدخول: ${email}`);
        console.log(`🔍 السبب:`, 
          usersDB.users.find(u => u.email.toLowerCase() === email.toLowerCase()) 
            ? 'كلمة السر غير صحيحة' 
            : 'المستخدم غير موجود'
        );
        
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'البريد الإلكتروني أو كلمة السر غير صحيحة' }));
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/forgot-password') {
      const body = await readBody(req);
      const { email } = JSON.parse(body || '{}');
      
      const user = usersDB.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (user) {
        logAction(user.email, 'forgot_password_request');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'إذا كان البريد مسجلاً، ستستلم رابط إعادة التعيين' }));
      } else {
        // لأسباب أمنية، لا نكشف إذا كان البريد مسجلاً أم لا
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'إذا كان البريد مسجلاً، ستستلم رابط إعادة التعيين' }));
      }
      return;
    }

   // --- B. ADMIN PROTECTED ROUTES (Auth Required) ---
    const adminUser = checkAuth(req);
    if (!adminUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Authentication required' }));
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/logout') {
      sessions.delete(req.headers['x-auth-token']);
      logAction(adminUser, 'logout');
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
        logAction(adminUser, 'service_create', { id: newService.id, name: newService.name });
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
          logAction(adminUser, 'service_update', { id, changes: data });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(servicesDB.services[idx]));
        } else { 
          res.writeHead(404, { 'Content-Type': 'application/json' }); 
          res.end(JSON.stringify({ error: 'Not Found' })); 
        }
        return;
      }

      if (method === 'DELETE') {
        const initialLength = servicesDB.services.length;
        servicesDB.services = servicesDB.services.filter(s => s.id !== id);
        if (servicesDB.services.length < initialLength) {
          saveJson(DB_SERVICES, servicesDB);
          logAction(adminUser, 'service_delete', { id });
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
        logAction(adminUser, 'order_update', { id, changes: data });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ordersDB.orders[idx]));
      } else { 
        res.writeHead(404); 
        res.end(); 
      }
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
      } else { 
        res.writeHead(404); 
        res.end('Not Found'); 
      }
      return;
    }

    // --- C. USER PROTECTED ROUTES (User Auth Required) ---
    const userId = checkUserAuth(req);
    if (userId) {
      const user = usersDB.users.find(u => u.id === userId);
      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
        return;
      }

      if (method === 'GET' && pathname === '/api/user/profile') {
        const { password: _, ...userWithoutPassword } = user;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userWithoutPassword));
        return;
      }

      if (method === 'PUT' && pathname === '/api/user/profile') {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        // تحديث البيانات المسموح بها
        const allowedFields = ['name', 'country', 'phone', 'profilePicture'];
        allowedFields.forEach(field => {
          if (data[field] !== undefined) user[field] = data[field];
        });
        
        if (!saveJson(DB_USERS, usersDB)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'فشل في تحديث الملف الشخصي' }));
          return;
        }
        
        const { password: _, ...userWithoutPassword } = user;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userWithoutPassword));
        return;
      }

      if (method === 'POST' && pathname === '/api/user/balance') {
        const body = await readBody(req);
        const { amount } = JSON.parse(body || '{}');
        
        if (!amount || amount <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'المبلغ يجب أن يكون رقمًا موجبًا' }));
          return;
        }
        
        user.balance += parseFloat(amount);
        
        if (!saveJson(DB_USERS, usersDB)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'فشل في تحديث الرصيد' }));
          return;
        }
        
        logAction(user.email, 'balance_add', { amount });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ balance: user.balance }));
        return;
      }

      if (method === 'GET' && pathname === '/api/user/orders') {
        const userOrders = (ordersDB.orders || []).filter(o => o.userId === userId);
        // إضافة اسم الخدمة لكل طلب
        const ordersWithServiceNames = userOrders.map(order => {
          const service = servicesDB.services.find(s => s.id === order.serviceId);
          return {
            ...order,
            serviceName: service ? service.name : `خدمة ${order.serviceId}`
          };
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ordersWithServiceNames));
        return;
      }

      if (method === 'GET' && pathname === '/api/user/stats') {
        const userOrders = (ordersDB.orders || []).filter(o => o.userId === userId);
        const stats = {
          totalOrders: userOrders.length,
          completedOrders: userOrders.filter(o => o.status === 'completed').length,
          pendingOrders: userOrders.filter(o => o.status === 'pending' || o.status === 'processing').length,
          totalSpent: userOrders.reduce((sum, o) => sum + (o.price || 0), 0)
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/user-logout') {
        userSessions.delete(req.headers['x-user-token']);
        logAction(user.email, 'user_logout');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (method === 'POST' && pathname === '/api/user/change-password') {
        const body = await readBody(req);
        const { currentPassword, newPassword } = JSON.parse(body || '{}');
        
        if (user.password !== currentPassword) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'كلمة السر الحالية غير صحيحة' }));
          return;
        }
        
        user.password = newPassword;
        
        if (!saveJson(DB_USERS, usersDB)) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'فشل في تغيير كلمة السر' }));
          return;
        }
        
        logAction(user.email, 'password_change');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'تم تغيير كلمة السر بنجاح' }));
        return;
      }
    }

    // --- D. NOT FOUND ---
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API Endpoint Not Found' }));

  } catch (err) {
    console.error('❌ Server Error:', err);
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
server.listen(PORT, () => {
  console.log('\n✨ ========================================');
  console.log('🚀 SMM Engine Server Started Successfully!');
  console.log(`📍 http://localhost:${PORT}`);
  console.log('📁 ملفات البيانات:');
  console.log(`   - المستخدمون: ${DB_USERS}`);
  console.log(`   - الخدمات: ${DB_SERVICES}`);
  console.log(`   - الطلبات: ${DB_ORDERS}`);
  console.log(`   - السجلات: ${DB_LOGS}`);
  console.log('🔗 نقاط التصحيح:');
  console.log(`   - فحص الملفات: http://localhost:${PORT}/api/debug/files`);
  console.log(`   - فحص المستخدمين: http://localhost:${PORT}/api/debug/users`);
  console.log('✨ ========================================\n');
});
