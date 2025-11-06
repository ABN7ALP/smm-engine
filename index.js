// =================================================================
//  SMM Engine - Final Backend Server (v4 - Correct Route Order)
// =================================================================

const http = require('http' );
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { exec } = require('child_process'); // لاستدعاء المحلل الذكي
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
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
let config = loadJson(CONFIG, { sessionTTLMin: 240 });
let usersDB = loadJson(DB_USERS, { users: [] });

// إضافة مستخدم أدمن افتراضي إذا لم يكن هناك مستخدمون
if (usersDB.users.length === 0) {
  const adminPassword = bcrypt.hashSync("adminpassword", 10); // كلمة سر افتراضية قوية
  usersDB.users.push({
    id: uuidv4(),
    email: "admin@example.com",
    password: adminPassword,
    username: "admin",
    role: "admin",
    balance: 0.00,
    phone: "0000000000",
    status: "active", // active, banned
    balanceStatus: "active", // active, frozen
    createdAt: nowISO(),
    lastLogin: nowISO()
  });
  saveJson(DB_USERS, usersDB);
}

// ---------- 4. Authentication & Session Management ----------
const sessions = new Map();
function createSession(userId, username) {
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = (config.sessionTTLMin || 240) * 60 * 1000;
  sessions.set(token, { userId, username, expires: Date.now() + ttl });
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
  const user = usersDB.users.find(u => u.id === session.userId);
  if (!user || user.status === 'banned') {
    sessions.delete(token);
    return null;
  }
  return user; // نرجع كائن المستخدم بالكامل
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

    // مسار عام للتحقق من حالة الطلب (لا يتطلب مصادقة)
    if (method === 'GET' && pathname.startsWith('/api/orders/public/')) {
      const id = parseInt(pathname.split('/').pop(), 10);
      const order = (ordersDB.orders || []).find(o => o.id === id);
      if (order) {
        // إخفاء معلومات المستخدم الحساسة
        const publicOrder = {
          id: order.id,
          serviceName: order.serviceName,
          link: order.link,
          quantity: order.quantity,
          status: order.status,
          createdAt: order.createdAt
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(publicOrder));
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
      const auth = checkAuth(req);
      if (!auth.user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'يجب تسجيل الدخول لإنشاء طلب.' }));
        return;
      }

      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      const { serviceId, link, quantity } = data;

      if (!serviceId || !link || !isValidUrl(link) || !quantity || quantity <= 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'بيانات الطلب غير كاملة أو غير صالحة.' }));
        return;
      }

      const service = servicesDB.services.find(s => s.id === serviceId);
      if (!service) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'الخدمة المطلوبة غير موجودة.' }));
        return;
      }

      let cost = 0;
      if (service.type === 'quantity') {
        cost = (quantity / 1000) * service.rate;
      } else if (service.type === 'fixed') {
        cost = service.rate;
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'نوع الخدمة غير مدعوم.' }));
        return;
      }

      if (auth.user.balance < cost) {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'الرصيد غير كافٍ لإتمام الطلب.', required: cost, current: auth.user.balance }));
        return;
      }
      
      if (auth.user.balanceStatus === 'frozen') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `تم تجميد رصيدك بسبب: ${auth.user.freezeReason || 'مشكلة في الحساب'}. لا يمكن استخدام الرصيد حالياً.` }));
        return;
      }

      // خصم الرصيد
      auth.user.balance -= cost;
      saveJson(DB_USERS, usersDB);

      const order = { 
        id: Date.now(), 
        userId: auth.user.id,
        username: auth.user.username,
        serviceId,
        serviceName: service.name,
        link, 
        quantity,
        cost: parseFloat(cost.toFixed(2)),
        status: 'pending', 
        createdAt: nowISO() 
      };
      ordersDB.orders.unshift(order);
      saveJson(DB_ORDERS, ordersDB);
      logAction(auth.user.username, 'order_create', { id: order.id, cost: order.cost });

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

  return; // ✅ هذا السطر مهم لإنهاء المسار
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
      const { email, password } = JSON.parse(body || '{}');
      const user = usersDB.users.find(u => u.email === email);

      if (!user || !bcrypt.compareSync(password, user.password)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'البريد الإلكتروني أو كلمة السر غير صحيحة' }));
        return;
      }

      if (user.status === 'banned') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `تم حظر حسابك بسبب: ${user.banReason || 'انتهاك شروط الخدمة'}. يرجى التواصل معنا عبر واتساب.` }));
        return;
      }

      const token = createSession(user.id, user.username);
      user.lastLogin = nowISO();
      saveJson(DB_USERS, usersDB);
      logAction(user.username, 'login');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token, username: user.username, role: user.role }));
      return;
    }

    if (method === 'POST' && pathname === '/api/auth/register') {
      const body = await readBody(req);
      const { username, email, password, phone } = JSON.parse(body || '{}');

      if (!username || !email || !password || !phone) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'الرجاء ملء جميع الحقول المطلوبة' }));
        return;
      }

      if (usersDB.users.some(u => u.email === email)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'هذا البريد الإلكتروني مسجل بالفعل' }));
        return;
      }

      const hashedPassword = bcrypt.hashSync(password, 10);
      const newUser = {
        id: uuidv4(),
        email,
        password: hashedPassword,
        username,
        phone,
        role: "user",
        balance: 0.00,
        status: "active",
        balanceStatus: "active",
        createdAt: nowISO(),
        lastLogin: nowISO()
      };

      usersDB.users.push(newUser);
      saveJson(DB_USERS, usersDB);
      logAction(newUser.username, 'register');

      const token = createSession(newUser.id, newUser.username);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token, username: newUser.username, role: newUser.role }));
      return;
    }

    // --- B. PROTECTED ROUTES (Auth Required from this point on) ---
    const authUser = checkAuth(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Authentication required' }));
      return;
    }
    const user = authUser; // استخدام اسم متغير أسهل للاستخدام في باقي الدوال

    if (method === 'POST' && pathname === '/api/auth/logout') {
      sessions.delete(req.headers['x-auth-token']);
      logAction(user.username, 'logout');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // --- USER PROFILE ROUTES ---

    if (method === 'GET' && pathname === '/api/user/orders') {
      const userOrders = ordersDB.orders
        .filter(order => order.userId === user.id)
        .sort((a, b) => b.id - a.id); // ترتيب تنازلي حسب التاريخ

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(userOrders));
      return;
    }
    if (pathname === '/api/user/profile' && method === 'GET') {
      // إرجاع بيانات المستخدم الحالي
      const userOrders = ordersDB.orders.filter(o => o.userId === user.id);
      const totalOrders = userOrders.length;
      const completedOrders = userOrders.filter(o => o.status === 'completed').length;
      const rejectedOrders = userOrders.filter(o => o.status === 'rejected').length;
      const pendingOrders = userOrders.filter(o => o.status === 'pending' || o.status === 'processing').length;

      const profile = {
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        balance: user.balance,
        role: user.role,
        status: user.status,
        balanceStatus: user.balanceStatus,
        totalOrders,
        completedOrders,
        rejectedOrders,
        pendingOrders
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(profile));
      return;
    }

    if (pathname === '/api/user/profile' && method === 'PUT') {
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      const userIndex = usersDB.users.findIndex(u => u.id === user.id);

      if (userIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
        return;
      }

      const updatedUser = usersDB.users[userIndex];

      // تحديث كلمة السر
      if (data.newPassword) {
        if (!data.currentPassword || !bcrypt.compareSync(data.currentPassword, updatedUser.password)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'كلمة السر الحالية غير صحيحة' }));
          return;
        }
        updatedUser.password = bcrypt.hashSync(data.newPassword, 10);
        logAction(user.username, 'password_change');
      }

      // تحديث باقي المعلومات (باستثناء الإيميل)
      if (data.username) updatedUser.username = data.username;
      if (data.phone) updatedUser.phone = data.phone;
      if (data.image) updatedUser.image = data.image; // افتراض أن الصورة هي رابط أو مسار

      usersDB.users[userIndex] = updatedUser;
      saveJson(DB_USERS, usersDB);
      logAction(user.username, 'profile_update', { changes: Object.keys(data) });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'تم تحديث الملف الشخصي بنجاح' }));
      return;
    }

    // --- ADMIN ROUTES ---
    if (user.role !== 'admin') {
      // منع الوصول لجميع مسارات الأدمن إذا لم يكن أدمن
      if (pathname.startsWith('/api/admin/')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: Admin access required' }));
        return;
      }
    }

    if (pathname === '/api/admin/users' && method === 'GET') {
      // إرجاع قائمة المستخدمين للأدمن
      const usersList = usersDB.users.map(u => {
        const userOrders = ordersDB.orders.filter(o => o.userId === u.id);
        const totalOrders = userOrders.length;
        const completedOrders = userOrders.filter(o => o.status === 'completed').length;
        const rejectedOrders = userOrders.filter(o => o.status === 'rejected').length;
        const pendingOrders = userOrders.filter(o => o.status === 'pending' || o.status === 'processing').length;

        return {
          id: u.id,
          username: u.username,
          email: u.email,
          phone: u.phone,
          balance: u.balance,
          role: u.role,
          status: u.status,
          balanceStatus: u.balanceStatus,
          createdAt: u.createdAt,
          totalOrders,
          completedOrders,
          rejectedOrders,
          pendingOrders
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(usersList));
      return;
    }

    if (pathname.startsWith('/api/admin/users/') && method === 'PUT') {
      const userId = pathname.split('/').pop();
      const body = await readBody(req);
      const data = JSON.parse(body || '{}');
      const userIndex = usersDB.users.findIndex(u => u.id === userId);

      if (userIndex === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
        return;
      }

      const targetUser = usersDB.users[userIndex];
      const changes = {};

      // تعديل الرصيد
      if (data.balance !== undefined && typeof data.balance === 'number') {
        const oldBalance = targetUser.balance;
        targetUser.balance = parseFloat(data.balance.toFixed(2));
        changes.balance = targetUser.balance;
        if (targetUser.balance > oldBalance) {
           // إضافة سجل إيداع
          logAction('Admin', 'balance_deposit', { userId: targetUser.id, amount: targetUser.balance - oldBalance, newBalance: targetUser.balance });
        }
      }

      // تعديل حالة الحساب (حظر/تفعيل)
      if (data.status && ['active', 'banned'].includes(data.status)) {
        targetUser.status = data.status;
        targetUser.banReason = data.banReason || (data.status === 'banned' ? 'تم الحظر من قبل الإدارة' : undefined);
        changes.status = targetUser.status;
      }

      // تعديل حالة تجميد الرصيد
      if (data.balanceStatus && ['active', 'frozen'].includes(data.balanceStatus)) {
        targetUser.balanceStatus = data.balanceStatus;
        targetUser.freezeReason = data.freezeReason || (data.balanceStatus === 'frozen' ? 'تم تجميد الرصيد من قبل الإدارة' : undefined);
        changes.balanceStatus = targetUser.balanceStatus;
      }

      // تعديل كلمة السر (اختياري للأدمن)
      if (data.newPassword) {
        targetUser.password = bcrypt.hashSync(data.newPassword, 10);
        changes.password = 'changed';
      }

      // تعديل باقي المعلومات
      if (data.username) targetUser.username = data.username;
      if (data.phone) targetUser.phone = data.phone;

      usersDB.users[userIndex] = targetUser;
      saveJson(DB_USERS, usersDB);
      logAction(user.username, 'admin_user_update', { targetId: userId, changes });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'تم تحديث بيانات المستخدم بنجاح' }));
      return;
    }

    if (pathname.startsWith('/api/admin/users/') && method === 'DELETE') {
      const userId = pathname.split('/').pop();
      const initialLength = usersDB.users.length;
      usersDB.users = usersDB.users.filter(u => u.id !== userId);

      if (usersDB.users.length < initialLength) {
        saveJson(DB_USERS, usersDB);
        logAction(user.username, 'admin_user_delete', { targetId: userId });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));


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
    }

    if (pathname === '/api/orders' && method === 'GET') {
      if (user.role !== 'admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden' }));
        return;
      }
      // إرجاع الطلبات مع اسم المستخدم
      const ordersWithUsername = (ordersDB.orders || []).map(order => {
        const orderUser = usersDB.users.find(u => u.id === order.userId);
        return {
          ...order,
          username: orderUser ? orderUser.username : 'N/A'
        };
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ordersWithUsername));
      return;
    }

    if (pathname.startsWith('/api/orders/') && method === 'PUT') {
      const id = parseInt(pathname.split('/').pop(), 10);
      const idx = ordersDB.orders.findIndex(o => o.id === id);
      if (idx > -1) {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        const oldOrder = ordersDB.orders[idx];
        const newOrder = { ...oldOrder, ...data, updatedAt: nowISO() };

        // منطق إعادة الرصيد في حالة الرفض
        if (oldOrder.status !== 'rejected' && newOrder.status === 'rejected') {
          const orderUser = usersDB.users.find(u => u.id === oldOrder.userId);
          if (orderUser) {
            orderUser.balance += oldOrder.cost;
            saveJson(DB_USERS, usersDB);
            logAction(user.username, 'balance_refund', { userId: orderUser.id, orderId: oldOrder.id, amount: oldOrder.cost });
          }
        }

        ordersDB.orders[idx] = newOrder;
        saveJson(DB_ORDERS, ordersDB);
        logAction(user.username, 'order_update', { id, changes: data });
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
