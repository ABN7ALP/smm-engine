// =================================================================
//  SMM Engine - نظام متكامل 100% (مصحح ومرتب ومؤمن)
// =================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const metascraper = require('metascraper')([
  require('metascraper-url')(),
  require('metascraper-title')(),
  require('metascraper-description')(),
  require('metascraper-image')()
]);

// ==================== إعدادات الأمان ====================
const SALT_ROUNDS = 12;
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 ساعات
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_TIMEOUT = 15 * 60 * 1000; // 15 دقيقة

// ==================== إعدادات قاعدة البيانات ====================
const MONGODB_URI = "mongodb+srv://ds132z1998_db_user:AL2sG3m1yB6BaoRY@cluster1.ehjwrgc.mongodb.net/smmdb?retryWrites=true&w=majority";

// تخزين محاولات تسجيل الدخول الفاشلة
const loginAttempts = new Map();

/**
 * الاتصال بقاعدة البيانات MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح');
  } catch (error) {
    console.log('❌ خطأ في الاتصال بقاعدة البيانات:', error.message);
    process.exit(1);
  }
}

connectDB();

/**
 * إعادة تعيين كلمة سر الأدمن (تشغيل مرة واحدة فقط)
 */
async function resetAdminPassword() {
  try {
    const newPassword = "Admin123!"; // كلمة السر الجديدة القوية
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    await User.findOneAndUpdate(
      { username: 'admin' },
      { 
        password: hashedPassword,
        lastPasswordChange: new Date()
      }
    );
    
    console.log('🔑 تم تحديث كلمة سر الأدمن:', newPassword);
  } catch (error) {
    console.log('❌ خطأ في تحديث كلمة السر:', error.message);
  }
}

// استدعاء الدالة مرة واحدة ثم تعليقها
//resetAdminPassword();
// ==================== نماذج قاعدة البيانات ====================

/**
 * نموذج المستخدم - تخزين بيانات المستخدمين
 */
const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30,
        match: /^[a-zA-Z0-9_]+$/ // فقط أحرف إنجليزية وأرقام وشرطة سفلية
    },
    password: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true,
        lowercase: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    },
    phone: {
        type: String,
        match: /^[\+]?[0-9]{10,15}$/
    },
    fullName: {
        type: String,
        trim: true,
        maxlength: 100
    },
    avatar: { 
        type: String, 
        default: '/assets/default-avatar.png' 
    },
    role: { 
        type: String, 
        enum: ['user', 'admin'], 
        default: 'user' 
    },
    balance: { 
        type: Number, 
        default: 0,
        min: 0
    },
    totalSpent: { 
        type: Number, 
        default: 0,
        min: 0
    },
    status: { 
        type: String, 
        enum: ['active', 'suspended', 'banned'], 
        default: 'active' 
    },
    banReason: String,
    balanceFrozen: { 
        type: Boolean, 
        default: false 
    },
    freezeReason: String,
    
    // الإحصائيات
    orders: {
        total: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        pending: { type: Number, default: 0 },
        rejected: { type: Number, default: 0 }
    },
    
    // التواريخ
    lastLogin: Date,
    lastPasswordChange: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

/**
 * نموذج الخدمة - تخزين خدمات SMM
 */
const serviceSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  name: String,
  category: String,
  type: String,
  rate: Number,
  price: Number,
  min: Number,
  max: Number
});

/**
 * نموذج الطلب - تخزين طلبات المستخدمين
 */
const orderSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  serviceId: String,
  link: String,
  quantity: Number,
  price: Number,
  status: { type: String, default: 'pending' },
  userId: String,
  username: String
}, { timestamps: true });

/**
 * نموذج السجل - تخزين سجلات النظام
 */
const logSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  user: String,
  action: String,
  meta: Object,
  ip: String
}, { timestamps: true });

/**
 * نموذج المعاملة - تخزين معاملات الرصيد
 */
const transactionSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    username: String,
    type: { type: String, enum: ['deposit', 'withdraw', 'payment', 'refund'], default: 'deposit' },
    amount: { type: Number, required: true },
    method: { type: String, enum: ['bank', 'sham', 'transfer', 'system'], default: 'bank' },
    status: { type: String, enum: ['pending', 'completed', 'rejected', 'cancelled'], default: 'pending' },
    details: {
        bankName: String,
        accountNumber: String,
        accountName: String,
        shamQrCode: String,
        transferOffice: String,
        receiptImage: String,
        whatsappNumber: String
    },
    adminNote: String,
    userNote: String,
    createdAt: { type: Date, default: Date.now },
    processedAt: Date,
    processedBy: String
});

/**
 * نموذج الإشعار - تخزين إشعارات المستخدمين
 */
const notificationSchema = new mongoose.Schema({
    id: { type: Number, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['info', 'success', 'warning', 'error'], default: 'info' },
    title: String,
    message: String,
    read: { type: Boolean, default: false },
    relatedTo: String,
    relatedId: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now }
});

// ==================== تعريف النماذج ====================
const User = mongoose.model('User', userSchema);
const Service = mongoose.model('Service', serviceSchema);
const Order = mongoose.model('Order', orderSchema);
const Log = mongoose.model('Log', logSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Notification = mongoose.model('Notification', notificationSchema);

// ==================== الدوال المساعدة ====================

/**
 * الحصول على الوقت الحالي بصيغة ISO
 */
function nowISO() { 
    return new Date().toISOString(); 
}

/**
 * التحقق من صحة الرابط
 */
function isValidUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return ['http:', 'https:'].includes(u.protocol);
  } catch { 
    return false; 
  }
}

/**
 * قراءة body الطلب
 */
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

/**
 * التحقق من قوة كلمة المرور
 */
function isPasswordStrong(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    return password.length >= minLength && 
           hasUpperCase && 
           hasLowerCase && 
           hasNumbers && 
           hasSpecialChar;
}

/**
 * الحصول على IP العميل
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           'unknown';
}

// ==================== نظام المصادقة وإدارة الجلسات ====================
const sessions = new Map();

/**
 * إنشاء جلسة جديدة للمستخدم
 */
function createSession(username, ip) {
  const token = crypto.randomBytes(32).toString('hex');
  const ttl = SESSION_DURATION;
  sessions.set(token, { 
    username, 
    ip,
    expires: Date.now() + ttl,
    createdAt: new Date()
  });
  return token;
}

/**
 * التحقق من صحة التوكن
 */
function checkAuth(req) {
  const token = req.headers['x-auth-token'] || null;
  if (!token) return null;
  
  const session = sessions.get(token);
  if (!session || Date.now() > session.expires) {
    if (session) sessions.delete(token);
    return null;
  }
  
  // تجديد مدة الجلسة عند النشاط
  session.expires = Date.now() + SESSION_DURATION;
  return session.username;
}

/**
 * التحقق من محاولات تسجيل الدخول
 */
function checkLoginAttempts(username, ip) {
    const key = `${username}_${ip}`;
    const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
    
    // إذا تجاوز الحد المسموح وكان الوقت لم ينته بعد
    if (attempts.count >= MAX_LOGIN_ATTEMPTS && 
        Date.now() - attempts.lastAttempt < LOGIN_TIMEOUT) {
        return false;
    }
    
    // إذا انتهى الوقت، إعادة تعيين العداد
    if (Date.now() - attempts.lastAttempt >= LOGIN_TIMEOUT) {
        attempts.count = 0;
    }
    
    return true;
}

/**
 * تسجيل محاولة تسجيل دخول فاشلة
 */
function recordFailedLogin(username, ip) {
    const key = `${username}_${ip}`;
    const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
    
    attempts.count++;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(key, attempts);
}

/**
 * مسح محاولات تسجيل الدخول الناجحة
 */
function clearLoginAttempts(username, ip) {
    const key = `${username}_${ip}`;
    loginAttempts.delete(key);
}

// تنظيف الجلسات والمحاولات المنتهية كل 10 دقائق
setInterval(() => {
  const now = Date.now();
  
  // تنظيف الجلسات المنتهية
  sessions.forEach((session, token) => {
    if (now > session.expires) sessions.delete(token);
  });
  
  // تنظيف محاولات تسجيل الدخول المنتهية
  loginAttempts.forEach((attempts, key) => {
    if (now - attempts.lastAttempt >= LOGIN_TIMEOUT) {
      loginAttempts.delete(key);
    }
  });
}, 10 * 60 * 1000);

// ==================== نظام السجلات والكاش ====================

/**
 * تسجيل إجراء في النظام
 */
async function logAction(user, action, meta = {}, ip = 'unknown') {
  try {
    const maxIdLog = await Log.findOne().sort('-id').exec();
    const newId = (maxIdLog?.id || 0) + 1;
    
    await Log.create({
      id: newId,
      user,
      action,
      meta,
      ip,
      createdAt: new Date()
    });
  } catch (error) {
    console.log('❌ خطأ في حفظ السجل:', error.message);
  }
}

const previewCache = new Map();
const PREVIEW_TTL = 10 * 60 * 1000; // 10 دقائق

// ==================== تهيئة البيانات الافتراضية ====================

/**
 * إنشاء البيانات الافتراضية عند التشغيل الأول
 */
async function initializeDefaultData() {
  try {
    // التحقق من وجود خدمات
    const serviceCount = await Service.countDocuments();
    if (serviceCount === 0) {
      console.log('🔧 جاري إنشاء الخدمات الافتراضية...');
      
      const defaultServices = [
        { id: 1, name: "متابعين انستجرام", category: "انستا", type: "quantity", rate: 5, min: 100, max: 10000 },
        { id: 2, name: "لايكات انستجرام", category: "انستا", type: "quantity", rate: 2, min: 100, max: 5000 },
        { id: 3, name: "مشاهدات يوتيوب", category: "يوتيوب", type: "quantity", rate: 3, min: 1000, max: 50000 },
        { id: 4, name: "إعجابات فيسبوك", category: "فيس بوك", type: "quantity", rate: 4, min: 100, max: 10000 }
      ];
      
      await Service.insertMany(defaultServices);
      console.log('✅ تم إنشاء الخدمات الافتراضية');
    }

    // التحقق من وجود أدمن
    const adminCount = await User.countDocuments({ username: 'admin' });
    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash('Admin123!', SALT_ROUNDS);
      
      await User.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@smm.com',
        role: 'admin',
        balance: 0,
        status: 'active',
        fullName: 'مدير النظام'
      });
      console.log('✅ تم إنشاء حساب الأدمن');
    }
  } catch (error) {
    console.log('❌ خطأ في تهيئة البيانات:', error.message);
  }
}

// تشغيل التهيئة بعد الاتصال بقاعدة البيانات
mongoose.connection.once('open', async () => {
  console.log('📊 جاري تهيئة البيانات...');
  await initializeDefaultData();
});

// ==================== السيرفر الرئيسي ====================
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;
    const clientIP = getClientIP(req);

    // ==================== المسارات العامة (لا تحتاج مصادقة) ====================

    // خدمة الملفات الثابتة
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
        '.gif': 'image/gif'
      };
      
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // الحصول على طلب عام (للعرض العام)
    if (method === 'GET' && pathname.startsWith('/api/orders/public/')) {
      const id = parseInt(pathname.split('/').pop(), 10);
      try {
        const order = await Order.findOne({ id });
        if (order) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(order));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Order not found' }));
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error' }));
      }
      return;
    }

    // الحصول على الخدمات
    if (method === 'GET' && pathname === '/api/services') {
      try {
        const services = await Service.find({});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(services));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load services' }));
      }
      return;
    }
    
    
    // إنشاء طلب جديد مع الإشعارات
if (method === 'POST' && pathname === '/api/orders') {
  console.log('🎯 تم استلام طلب جديد من:', checkAuth(req) || 'مستخدم عام');
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    
    if (!data.serviceId || !data.link || !isValidUrl(data.link)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid fields' }));
        return;
    }

    try {
        const maxIdOrder = await Order.findOne().sort('-id').exec();
        const newId = (maxIdOrder?.id || 0) + 1;
        
        // الحصول على المستخدم إذا كان مسجلاً
let username = 'public';
let userId = null;

const authUsername = checkAuth(req);
console.log(`🔍 authUsername: ${authUsername}`); // <-- أضف هذا

if (authUsername) {
    const user = await User.findOne({ username: authUsername });
    if (user) {
        username = user.username;
        userId = user._id.toString(); // ✅ تأكد من تحويله لـ string
        console.log(`🔍 تم العثور على المستخدم: ${username}, userId: ${userId}`);
        
        // التحقق من الرصيد إذا كان الطلب مدفوع
        if (user.balanceFrozen) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'لا يمكن إنشاء طلب - الرصيد مجمد' }));
            return;
        }
    }
}
        
        const order = await Order.create({
    id: newId,
    serviceId: data.serviceId,
    link: data.link,
    quantity: data.quantity,
    price: data.price,
    status: 'pending',
    username: username,
    userId: userId
});

await logAction(username, 'order_create', { id: order.id }, clientIP);

// إرسال إشعار للمستخدم إذا كان مسجلاً
console.log(`🔍 debugging - userId: ${userId}, username: ${username}`);

if (userId) {
    console.log(`🔍 جاري إنشاء إشعار للمستخدم: ${username}`);
    try {
        const notification = await Notification.create({
            id: Date.now(),
            userId: userId,
            type: 'success', 
            title: 'تم إنشاء طلب جديد',
            message: `تم إنشاء طلبك #${order.id} بنجاح. سيتم معالجته قريباً.`,
            relatedTo: 'order',
            relatedId: order.id,
            read: false,
            createdAt: new Date()
        });
        console.log(`✅ تم إنشاء الإشعار بنجاح:`, notification);
    } catch (error) {
        console.error('❌ خطأ في إنشاء الإشعار:', error);
    }

    // تحديث إحصائيات المستخدم
    const user = await User.findOne({ username: authUsername });
    if (user) {
        user.orders.total = (user.orders.total || 0) + 1;
        user.orders.pending = (user.orders.pending || 0) + 1;
        await user.save();
    }
} else {
    console.log('🔍 المستخدم غير مسجل دخول - لا إشعارات');
}

// إرسال إشعار للأدمن
try {
    const adminUsers = await User.find({ role: 'admin' });
    for (let i = 0; i < adminUsers.length; i++) {
        const admin = adminUsers[i];
        await Notification.create({
            id: Date.now() + i, // ✅ نستخدم index لتجنب التكرار
            userId: admin._id,
            type: 'info',
            title: 'طلب جديد',
            message: `تم إنشاء طلب جديد #${order.id} من قبل ${username}`,
            relatedTo: 'order',
            relatedId: order.id,
            read: false,
            createdAt: new Date()
        });
    }
    console.log(`✅ تم إرسال إشعارات للأدمن بخصوص الطلب #${order.id}`);
} catch (error) {
    console.error('❌ خطأ في إرسال إشعارات الأدمن:', error);
}
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order));
    } catch (error) {
        console.error('خطأ في إنشاء الطلب:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create order' }));
    }
    return;
}
    // معاينة الرابط
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

    // تحليل الرابط
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

    // تسجيل الدخول (محدث مع نظام الأمان)
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body || '{}');
      
      // التحقق من محاولات تسجيل الدخول
      if (!checkLoginAttempts(username, clientIP)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'تم تجاوز عدد المحاولات المسموحة. الرجاء المحاولة بعد 15 دقيقة.' 
        }));
        return;
      }
      
      try {
        const user = await User.findOne({ username, status: 'active' });
        
        if (user && await bcrypt.compare(password, user.password)) {
          // تسجيل الدخول ناجح
          const token = createSession(username, clientIP);
          await logAction(username, 'login_success', {}, clientIP);
          clearLoginAttempts(username, clientIP);
          
          // تحديث آخر تسجيل دخول
          await User.updateOne({ username }, { lastLogin: new Date() });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            token, 
            username,
            role: user.role,
            balance: user.balance,
            message: 'تم تسجيل الدخول بنجاح'
          }));
        } else {
          // تسجيل الدخول فاشل
          recordFailedLogin(username, clientIP);
          await logAction(username, 'login_failed', { reason: 'invalid_credentials' }, clientIP);
          
            // التحقق إذا الحساب محظور
          const bannedUser = await User.findOne({ username, status: 'banned' });
          if (bannedUser) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'الحساب محظور', 
              reason: bannedUser.banReason || 'يرجى الاتصال بالدعم'
            }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'اسم المستخدم أو كلمة السر غير صحيحة',
              remainingAttempts: MAX_LOGIN_ATTEMPTS - (loginAttempts.get(`${username}_${clientIP}`)?.count || 0)
            }));
          }
        }
      } catch (error) {
        await logAction('system', 'login_error', { error: error.message }, clientIP);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'خطأ في الخادم' }));
      }
      return;
    }

    // ==================== نظام المستخدمين ====================

    // تسجيل مستخدم جديد (محدث مع تشفير كلمات المرور)
    if (method === 'POST' && pathname === '/api/auth/register') {
        const body = await readBody(req);
        const { username, password, email, phone, fullName } = JSON.parse(body || '{}');
        
        if (!username || !password || !email) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'اسم المستخدم، كلمة السر، والبريد الإلكتروني مطلوبة' }));
            return;
        }

        // التحقق من صحة البريد الإلكتروني
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'صيغة البريد الإلكتروني غير صحيحة' }));
            return;
        }

        // التحقق من قوة كلمة السر
        if (!isPasswordStrong(password)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'كلمة السر ضعيفة',
                requirements: {
                    minLength: 8,
                    requiresUpperCase: true,
                    requiresLowerCase: true,
                    requiresNumbers: true,
                    requiresSpecialChars: true
                }
            }));
            return;
        }

        try {
            // التحقق من عدم وجود مستخدم بنفس الاسم أو البريد
            const existingUser = await User.findOne({
                $or: [{ username }, { email }]
            });

            if (existingUser) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'مستخدم موجود مسبقاً',
                    details: existingUser.username === username ? 
                            'اسم المستخدم مستخدم مسبقاً' : 'البريد الإلكتروني مستخدم مسبقاً'
                }));
                return;
            }

            // تشفير كلمة المرور وإنشاء المستخدم الجديد
            const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
            
            const newUser = await User.create({
                username,
                password: hashedPassword,
                email,
                phone: phone || '',
                fullName: fullName || '',
                role: 'user',
                balance: 0,
                status: 'active',
                orders: {
                    total: 0,
                    completed: 0,
                    pending: 0,
                    rejected: 0
                },
                lastLogin: new Date(),
                lastPasswordChange: new Date()
            });

            // إنشاء إشعار ترحيبي
            await Notification.create({
                id: Date.now(),
                userId: newUser._id,
                type: 'success',
                title: 'مرحباً بك!',
                message: 'تم إنشاء حسابك بنجاح. يمكنك الآن استخدام جميع ميزات المنصة.',
                relatedTo: 'system'
            });

            await logAction('system', 'user_register', { 
                username: newUser.username, 
                userId: newUser._id 
            }, clientIP);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'تم إنشاء الحساب بنجاح',
                user: {
                    id: newUser._id,
                    username: newUser.username,
                    email: newUser.email,
                    role: newUser.role
                }
            }));

        } catch (error) {
            console.error('خطأ في إنشاء المستخدم:', error);
            await logAction('system', 'register_error', { error: error.message }, clientIP);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في إنشاء الحساب' }));
        }
        return;
    }

    // ==================== المسارات المحمية (تحتاج مصادقة) ====================
    const username = checkAuth(req);
    if (!username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'غير مصرح: يلزم تسجيل الدخول' }));
      return;
    }

    // الحصول على بيانات المستخدم
    if (pathname === '/api/user/profile' && method === 'GET') {
        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            // إرجاع بيانات المستخدم بدون كلمة السر
            const userData = {
                id: user._id,
                username: user.username,
                email: user.email,
                phone: user.phone,
                fullName: user.fullName,
                avatar: user.avatar,
                role: user.role,
                balance: user.balance,
                totalSpent: user.totalSpent,
                status: user.status,
                orders: user.orders,
                lastLogin: user.lastLogin,
                lastPasswordChange: user.lastPasswordChange,
                createdAt: user.createdAt
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(userData));

        } catch (error) {
            console.error('خطأ في جلب بيانات المستخدم:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في جلب البيانات' }));
        }
        return;
    }

    // تحديث بيانات المستخدم
    if (pathname === '/api/user/profile' && method === 'PUT') {
        const body = await readBody(req);
        const updateData = JSON.parse(body || '{}');

        try {
            // منع تحديث بعض الحقول
            delete updateData.username;
            delete updateData.email;
            delete updateData.role;
            delete updateData.balance;
            delete updateData.status;

            const updatedUser = await User.findOneAndUpdate(
                { username },
                { 
                    ...updateData,
                    updatedAt: new Date()
                },
                { new: true }
            );

            if (!updatedUser) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            await logAction(username, 'profile_update', { 
                updatedFields: Object.keys(updateData) 
            }, clientIP);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'تم تحديث البيانات بنجاح',
                user: {
                    username: updatedUser.username,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    fullName: updatedUser.fullName,
                    avatar: updatedUser.avatar
                }
            }));

        } catch (error) {
            console.error('خطأ في تحديث بيانات المستخدم:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في تحديث البيانات' }));
        }
        return;
    }

    // ==================== نظام الملف الشخصي المتقدم ====================

    // تغيير كلمة السر (محدث مع تشفير)
    if (method === 'PUT' && pathname === '/api/user/change-password') {
        const body = await readBody(req);
        const { currentPassword, newPassword } = JSON.parse(body || '{}');

        if (!currentPassword || !newPassword) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'جميع الحقول مطلوبة' }));
            return;
        }

        // التحقق من قوة كلمة السر الجديدة
        if (!isPasswordStrong(newPassword)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'كلمة السر الجديدة ضعيفة',
                requirements: {
                    minLength: 8,
                    requiresUpperCase: true,
                    requiresLowerCase: true,
                    requiresNumbers: true,
                    requiresSpecialChars: true
                }
            }));
            return;
        }

        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            // التحقق من كلمة السر الحالية
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
            if (!isCurrentPasswordValid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'كلمة السر الحالية غير صحيحة' }));
                return;
            }

            // تحديث كلمة السر
            const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            user.password = hashedNewPassword;
            user.lastPasswordChange = new Date();
            user.updatedAt = new Date();
            await user.save();

            await logAction(username, 'password_change', {}, clientIP);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'تم تغيير كلمة السر بنجاح'
            }));

        } catch (error) {
            console.error('خطأ في تغيير كلمة السر:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في تغيير كلمة السر' }));
        }
        return;
    }

    // رفع الصورة الشخصية
    if (method === 'POST' && pathname === '/api/user/upload-avatar') {
        const body = await readBody(req);
        const { avatar } = JSON.parse(body || '{}');

        if (!avatar) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'صورة غير مرفوعة' }));
            return;
        }

        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            // حفظ الصورة
            user.avatar = avatar;
            user.updatedAt = new Date();
            await user.save();

            await logAction(username, 'avatar_upload', {}, clientIP);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'تم تحديث الصورة الشخصية بنجاح',
                avatar: user.avatar
            }));

        } catch (error) {
            console.error('خطأ في رفع الصورة:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في رفع الصورة' }));
        }
        return;
    }

    // إنشاء إشعار جديد
if (pathname === '/api/user/notifications' && method === 'POST') {
    try {
        const body = await readBody(req);
        const { title, message, type } = JSON.parse(body || '{}');

        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
            return;
        }

        // إنشاء الإشعار
        const notification = await Notification.create({
            userId: user._id,
            type: type || 'info',
            title: title || 'إشعار جديد',
            message: message || 'لا يوجد محتوى',
            read: false,
            relatedTo: 'order'
        });

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notification));

    } catch (error) {
        console.error('خطأ في إنشاء الإشعار:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create notification' }));
    }
    return;
}

    // الحصول على معاملات المستخدم
    if (method === 'GET' && pathname === '/api/user/transactions') {
        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            const transactions = await Transaction.find({ username })
                .sort({ createdAt: -1 })
                .limit(50);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));

        } catch (error) {
            console.error('خطأ في جلب المعاملات:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في جلب المعاملات' }));
        }
        return;
    }

    // طلب شحن رصيد
    if (method === 'POST' && pathname === '/api/user/deposit') {
        const body = await readBody(req);
        const { amount, method, details } = JSON.parse(body || '{}');

        if (!amount || !method || amount <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'بيانات غير صحيحة' }));
            return;
        }

        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
                return;
            }

            // إنشاء معاملة جديدة
            const maxIdTransaction = await Transaction.findOne().sort('-id').exec();
            const newId = (maxIdTransaction?.id || 0) + 1;

            const transaction = await Transaction.create({
                id: newId,
                userId: user._id,
                username: user.username,
                type: 'deposit',
                amount: parseFloat(amount),
                method: method,
                status: 'pending',
                details: details || {},
                userNote: `طلب شحن رصيد بقيمة $${amount}`
            });

            // إرسال إشعار للأدمن
            await Notification.create({
                id: Date.now(),
                userId: user._id,
                type: 'info',
                title: 'طلب شحن رصيد جديد',
                message: `المستخدم ${username} طلب شحن رصيد بقيمة $${amount}`,
                relatedTo: 'transaction',
                relatedId: transaction.id
            });

            await logAction(username, 'deposit_request', { amount, method }, clientIP);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'تم إرسال طلب الشحن بنجاح',
                transaction: transaction
            }));

        } catch (error) {
            console.error('خطأ في طلب الشحن:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في طلب الشحن' }));
        }
        return;
    }

    // طلبات المستخدم الشخصية
    if (pathname === '/api/user/orders' && method === 'GET') {
      try {
        const userOrders = await Order.find({ username }).sort({ createdAt: -1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userOrders));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load user orders' }));
      }
      return;
    }

    // تسجيل الخروج
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const token = req.headers['x-auth-token'];
      if (token) sessions.delete(token);
      await logAction(username, 'logout', {}, clientIP);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'تم تسجيل الخروج بنجاح' }));
      return;
                            }
    // ==================== مسارات الأدمن ====================
    
    // التحقق من صلاحيات الأدمن
    const currentUser = await User.findOne({ username });
    const isAdmin = currentUser && currentUser.role === 'admin';

    if (!isAdmin && pathname.startsWith('/api/admin')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ممنوع الوصول: يلزم صلاحيات أدمن' }));
        return;
    }

    // الإحصائيات
    if (pathname === '/api/stats' && method === 'GET') {
      try {
        const totalServices = await Service.countDocuments();
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        
        // حساب متوسط السعر
        const services = await Service.find({});
        const priceValues = services.map(s => {
          if (s.type === 'fixed') return parseFloat(s.price) || 0;
          if (s.type === 'quantity') return parseFloat(s.rate) || 0;
          return 0;
        }).filter(v => v > 0);
        
        const avgPrice = priceValues.length > 0 
          ? (priceValues.reduce((a, b) => a + b, 0) / priceValues.length).toFixed(2)
          : 0;

        const stats = {
          totalServices,
          totalOrders,
          pendingOrders,
          avgPrice: parseFloat(avgPrice)
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      } catch (error) {
        console.error('Stats error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load stats' }));
      }
      return;
    }

    // جميع الطلبات (للأدمن)
    if (pathname === '/api/orders' && method === 'GET') {
      try {
        const orders = await Order.find({}).sort({ createdAt: -1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(orders));
      } catch (error) {
        console.error('Orders error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load orders' }));
      }
      return;
    }

    
    // تحديث حالة الطلب مع نظام الخصم
if (pathname.startsWith('/api/orders/') && method === 'PUT') {
    try {
        const id = parseInt(pathname.split('/').pop(), 10);
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        const order = await Order.findOne({ id });
        if (!order) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Order not found' }));
            return;
        }

        // إذا تم تغيير الحالة إلى processing وكانت pending، قم بخصم المبلغ
        if (data.status === 'processing' && order.status === 'pending') {
            const user = await User.findOne({ username: order.username });
            if (user) {
                // التحقق من أن الرصيد كافي وغير مجمد
                if (user.balanceFrozen) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'لا يمكن معالجة الطلب - الرصيد مجمد' }));
                    return;
                }
                
                if (user.balance < order.price) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'رصيد المستخدم غير كافي' }));
                    return;
                }

                // خصم المبلغ من رصيد المستخدم
                user.balance -= order.price;
                user.totalSpent += order.price;
                
                // تحديث إحصائيات الطلبات
                user.orders.total = (user.orders.total || 0) + 1;
                user.orders.pending = (user.orders.pending || 0) + 1;
                
                await user.save();

                // تسجيل المعاملة
                const maxIdTransaction = await Transaction.findOne().sort('-id').exec();
                const newTransactionId = (maxIdTransaction?.id || 0) + 1;

                await Transaction.create({
                    id: newTransactionId,
                    userId: user._id,
                    username: user.username,
                    type: 'payment',
                    amount: -order.price,
                    method: 'system',
                    status: 'completed',
                    userNote: `دفع مقابل الطلب #${order.id}`,
                    createdAt: new Date()
                });

                // إرسال إشعار للمستخدم
                await Notification.create({
                    id: Date.now(),
                    userId: user._id,
                    type: 'info',
                    title: 'تم خصم المبلغ',
                    message: `تم خصم $${order.price.toFixed(2)} من رصيدك مقابل الطلب #${order.id}`,
                    relatedTo: 'order',
                    relatedId: order.id
                });

                console.log(`✅ تم خصم $${order.price} من رصيد ${user.username}`);
            }
        }

        // إذا تم إلغاء الطلب أو رفضه، إرجاع المبلغ
        if ((data.status === 'cancelled' || data.status === 'rejected') && 
            (order.status === 'processing' || order.status === 'pending')) {
            const user = await User.findOne({ username: order.username });
            if (user && order.status === 'processing') {
                // إرجاع المبلغ للمستخدم
                user.balance += order.price;
                user.totalSpent -= order.price;
                await user.save();

                // تسجيل معاملة الإرجاع
                const maxIdTransaction = await Transaction.findOne().sort('-id').exec();
                const newTransactionId = (maxIdTransaction?.id || 0) + 1;

                await Transaction.create({
                    id: newTransactionId,
                    userId: user._id,
                    username: user.username,
                    type: 'refund',
                    amount: order.price,
                    method: 'system',
                    status: 'completed',
                    userNote: `استرجاع مبلغ الطلب #${order.id}`,
                    createdAt: new Date()
                });

                // إرسال إشعار للمستخدم
                await Notification.create({
                    id: Date.now(),
                    userId: user._id,
                    type: 'info',
                    title: 'تم استرجاع المبلغ',
                    message: `تم إرجاع $${order.price.toFixed(2)} إلى رصيدك للطلب #${order.id}`,
                    relatedTo: 'order',
                    relatedId: order.id
                });
            }
        }

        // تحديث حالة الطلب
        const updatedOrder = await Order.findOneAndUpdate(
            { id },
            { 
                status: data.status,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (updatedOrder) {
    // إرسال إشعار بتغيير حالة الطلب
    const user = await User.findOne({ username: order.username });
    if (user) {
        try {
            await Notification.create({
                id: Date.now(), // ✅ تأكد من استخدام Date.now() فقط
                userId: user._id,
                type: data.status === 'completed' ? 'success' : 
                      data.status === 'rejected' ? 'error' : 'info',
                title: `تم تحديث حالة الطلب #${order.id}`,
                message: `حالة الطلب #${order.id} أصبحت: ${getOrderStatusText(data.status)}`,
                relatedTo: 'order',
                relatedId: order.id,
                read: false,
                createdAt: new Date()
            });
            console.log(`✅ تم إرسال إشعار للمستخدم ${order.username} بتحديث حالة الطلب #${order.id}`);
        } catch (error) {
            console.error('❌ خطأ في إرسال إشعار تحديث الحالة:', error);
        }

        // تحديث إحصائيات المستخدم
        if (data.status === 'completed') {
            user.orders.completed = (user.orders.completed || 0) + 1;
            user.orders.pending = Math.max(0, (user.orders.pending || 0) - 1);
        } else if (data.status === 'rejected') {
            user.orders.rejected = (user.orders.rejected || 0) + 1;
            user.orders.pending = Math.max(0, (user.orders.pending || 0) - 1);
        }
        await user.save();
    }

    await logAction(username, 'order_update', { id, status: data.status }, clientIP);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updatedOrder));
} else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Order not found' }));
}
            
    } catch (error) {
        console.error('Update order error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update order' }));
    }
    return;
}

// دالة مساعدة للحصول على نص حالة الطلب
function getOrderStatusText(status) {
    const statusMap = {
        'pending': 'قيد الانتظار',
        'processing': 'قيد التنفيذ', 
        'completed': 'مكتمل',
        'rejected': 'مرفوض',
        'cancelled': 'ملغي'
    };
    return statusMap[status] || status;
                  }

    // السجلات
    if (pathname === '/api/logs' && method === 'GET') {
      try {
        const logs = await Log.find({}).sort({ createdAt: -1 }).limit(100);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(logs));
      } catch (error) {
        console.error('Logs error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load logs' }));
      }
      return;
    }

    // تحديث البيانات
    if (pathname === '/api/admin/refresh-data' && method === 'POST') {
      try {
        await logAction(username, 'data_refresh', {}, clientIP);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'تم تحديث البيانات بنجاح',
          refreshed: true
        }));
      } catch (error) {
        console.error('Refresh error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to refresh data' }));
      }
      return;
    }

    // إدارة الخدمات
    if (pathname.startsWith('/api/services') && method === 'POST') {
      try {
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        const maxIdService = await Service.findOne().sort('-id').exec();
        const newId = (maxIdService?.id || 0) + 1;
        
        const newService = await Service.create({
          id: newId,
          name: data.name,
          category: data.category,
          type: data.type,
          rate: data.rate ? parseFloat(data.rate) : undefined,
          price: data.price ? parseFloat(data.price) : undefined,
          min: data.min ? parseInt(data.min, 10) : undefined,
          max: data.max ? parseInt(data.max, 10) : undefined,
        });

        await logAction(username, 'service_create', { id: newService.id, name: newService.name }, clientIP);
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newService));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create service' }));
      }
      return;
    }

    if (pathname.startsWith('/api/services/') && method === 'PUT') {
      try {
        const id = parseInt(pathname.split('/').pop(), 10);
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        const updatedService = await Service.findOneAndUpdate(
          { id },
          {
            ...data,
            rate: data.rate ? parseFloat(data.rate) : undefined,
            price: data.price ? parseFloat(data.price) : undefined,
            min: data.min ? parseInt(data.min, 10) : undefined,
            max: data.max ? parseInt(data.max, 10) : undefined,
          },
          { new: true }
        );

        if (updatedService) {
          await logAction(username, 'service_update', { id, changes: data }, clientIP);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updatedService));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service not found' }));
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update service' }));
      }
      return;
    }

    if (pathname.startsWith('/api/services/') && method === 'DELETE') {
      try {
        const id = parseInt(pathname.split('/').pop(), 10);
        const deletedService = await Service.findOneAndDelete({ id });

        if (deletedService) {
          await logAction(username, 'service_delete', { id }, clientIP);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service not found' }));
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to delete service' }));
      }
      return;
    }

    // ==================== نظام الإشعارات ====================

// الحصول على إشعارات المستخدم
if (pathname === '/api/user/notifications' && method === 'GET') {
    try {
        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
            return;
        }

        const notifications = await Notification.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(20);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notifications));

    } catch (error) {
        console.error('خطأ في جلب الإشعارات:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'خطأ في جلب الإشعارات' }));
    }
    return;
}

// تحديث حالة الإشعار كمقروء
if (pathname.startsWith('/api/user/notifications/') && method === 'PUT') {
    try {
        const notificationId = pathname.split('/').pop();
        const updatedNotification = await Notification.findByIdAndUpdate(
            notificationId,
            { read: true },
            { new: true }
        );

        if (updatedNotification) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updatedNotification));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'الإشعار غير موجود' }));
        }
    } catch (error) {
        console.error('خطأ في تحديث الإشعار:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'خطأ في تحديث الإشعار' }));
    }
    return;
}


    // ==================== نظام إدارة المستخدمين (للأدمن فقط) ====================

// الحصول على جميع المستخدمين
if (pathname === '/api/admin/users' && method === 'GET') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const users = await User.find({})
            .select('-password') // استبعاد كلمة السر
            .sort({ createdAt: -1 });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(users));
    } catch (error) {
        console.error('خطأ في جلب المستخدمين:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load users' }));
    }
    return;
}

// الحصول على مستخدم معين
if (pathname.startsWith('/api/admin/users/') && method === 'GET') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const userId = pathname.split('/').pop();
        const user = await User.findById(userId).select('-password');
        
        if (user) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(user));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User not found' }));
        }
    } catch (error) {
        console.error('خطأ في جلب المستخدم:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load user' }));
    }
    return;
}

// تحديث بيانات المستخدم
// تحديث بيانات المستخدم (مبسط)
if (pathname.startsWith('/api/admin/users/') && method === 'PUT') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const userId = pathname.split('/').pop();
        const body = await readBody(req);
        const updateData = JSON.parse(body || '{}');
        
        console.log('🔄 تحديث المستخدم:', userId, updateData);
        
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID مطلوب' }));
            return;
        }

        // البحث عن المستخدم
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
            return;
        }

        // تحديث الحقول الأساسية
        if (updateData.username) user.username = updateData.username;
        if (updateData.email) user.email = updateData.email;
        if (updateData.fullName !== undefined) user.fullName = updateData.fullName;
        if (updateData.phone !== undefined) user.phone = updateData.phone;
        if (updateData.balance !== undefined) user.balance = parseFloat(updateData.balance);
        if (updateData.status) user.status = updateData.status;
        if (updateData.balanceFrozen !== undefined) user.balanceFrozen = Boolean(updateData.balanceFrozen);
        
        // إذا كانت هناك كلمة سر جديدة
        if (updateData.newPassword) {
            user.password = await bcrypt.hash(updateData.newPassword, SALT_ROUNDS);
            user.lastPasswordChange = new Date();
        }
        
        user.updatedAt = new Date();
        await user.save();

        // إرجاع البيانات المحدثة
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('❌ خطأ في تحديث المستخدم:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update user: ' + error.message }));
    }
    return;
}
// تجميد/فك تجميد الرصيد
// 🔧 إصلاح كامل لتجميد الرصيد
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/freeze') && method === 'PUT') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const pathParts = pathname.split('/');
        const userId = pathParts[4]; // /api/admin/users/{id}/freeze
        
        console.log(`🔄 تجميد رصيد المستخدم: ${userId}`);
        
        const body = await readBody(req);
        const { freeze, reason } = JSON.parse(body || '{}');
        
        // التحقق من صحة البيانات
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID مطلوب' }));
            return;
        }

        // البحث عن المستخدم أولاً للتأكد من وجوده
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
            return;
        }

        // تحديث حالة التجميد
        user.balanceFrozen = Boolean(freeze);
        user.freezeReason = reason || '';
        user.updatedAt = new Date();
        
        await user.save();

        await logAction(username, freeze ? 'admin_freeze_balance' : 'admin_unfreeze_balance', { 
            userId: userId,
            reason: reason
        }, clientIP);
        
        // إرسال إشعار للمستخدم
        await Notification.create({
            userId: user._id,
            type: freeze ? 'warning' : 'info',
            title: freeze ? 'تم تجميد رصيدك' : 'تم فك تجميد رصيدك',
            message: reason || (freeze ? 'تم تجميد رصيدك من قبل الإدارة' : 'تم فك تجميد رصيدك من قبل الإدارة'),
            relatedTo: 'balance'
        });

        // إرجاع بيانات المستخدم المحدثة
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('❌ خطأ في تجميد/فك تجميد الرصيد:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update balance status: ' + error.message }));
    }
    return;
}
// تغيير حالة الحساب
// 🔧 إصلاح كامل لتغيير حالة الحساب
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/status') && method === 'PUT') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const pathParts = pathname.split('/');
        const userId = pathParts[4]; // /api/admin/users/{id}/status
        
        console.log(`🔄 تغيير حالة المستخدم: ${userId}`);
        
        const body = await readBody(req);
        const { status, reason } = JSON.parse(body || '{}');
        
        // التحقق من صحة البيانات
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID مطلوب' }));
            return;
        }

        const validStatuses = ['active', 'suspended', 'banned'];
        if (!validStatuses.includes(status)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'حالة غير صالحة' }));
            return;
        }

        // البحث عن المستخدم أولاً
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
            return;
        }

        // تحديث الحالة
        user.status = status;
        if (status === 'banned') {
            user.banReason = reason || '';
        } else {
            user.banReason = '';
        }
        user.updatedAt = new Date();
        
        await user.save();

        await logAction(username, 'admin_user_status_change', { 
            userId: userId,
            newStatus: status,
            reason: reason
        }, clientIP);
        
        // إرسال إشعار للمستخدم
        await Notification.create({
            userId: user._id,
            type: status === 'banned' ? 'error' : 'success',
            title: status === 'banned' ? 'تم حظر حسابك' : 'تم فك حظر حسابك',
            message: reason || (status === 'banned' ? 'تم حظر حسابك من قبل الإدارة' : 'تم فك حظر حسابك من قبل الإدارة'),
            relatedTo: 'account'
        });

        // إرجاع بيانات المستخدم المحدثة
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('❌ خطأ في تغيير حالة الحساب:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update user status: ' + error.message }));
    }
    return;
}
    
    // --- المسار غير موجود ---
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

// ==================== تشغيل السيرفر ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
