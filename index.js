// =================================================================
//  SMM Engine - نظام متكامل 100% (مصحح ومرتب)
// =================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const { exec } = require('child_process');
const mongoose = require('mongoose');
const metascraper = require('metascraper')([
  require('metascraper-url')(),
  require('metascraper-title')(),
  require('metascraper-description')(),
  require('metascraper-image')()
]);

// ==================== إعدادات الاتصال بقاعدة البيانات ====================
const MONGODB_URI = "mongodb+srv://ds132z1998_db_user:AL2sG3m1yB6BaoRY@cluster1.ehjwrgc.mongodb.net/smmdb?retryWrites=true&w=majority";

/**
 * الاتصال بقاعدة البيانات MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✅ تم الاتصال بقاعدة البيانات MongoDB بنجاح');
  } catch (error) {
    console.log('❌ خطأ في الاتصال بقاعدة البيانات:', error.message);
    process.exit(1); // إيقاف التطبيق إذا فشل الاتصال
  }
}

connectDB();

// ==================== نماذج قاعدة البيانات ====================

/**
 * نموذج المستخدم - تخزين بيانات المستخدمين
 */
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: String,
    fullName: String,
    avatar: { type: String, default: '/assets/default-avatar.png' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    balance: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'suspended', 'banned'], default: 'active' },
    banReason: String,
    balanceFrozen: { type: Boolean, default: false },
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
  meta: Object
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

// ==================== نظام المصادقة وإدارة الجلسات ====================
const sessions = new Map();

/**
 * إنشاء جلسة جديدة للمستخدم
 */
function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  const ttl = 240 * 60 * 1000; // 4 ساعات
  sessions.set(token, { username, expires: Date.now() + ttl });
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
  
  return session.username;
}

// تنظيف الجلسات المنتهية كل 10 دقائق
setInterval(() => {
  sessions.forEach((session, token) => {
    if (Date.now() > session.expires) sessions.delete(token);
  });
}, 10 * 60 * 1000);

// ==================== نظام السجلات والكاش ====================

/**
 * تسجيل إجراء في النظام
 */
async function logAction(user, action, meta = {}) {
  try {
    const maxIdLog = await Log.findOne().sort('-id').exec();
    const newId = (maxIdLog?.id || 0) + 1;
    
    await Log.create({
      id: newId,
      user,
      action,
      meta,
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
      await User.create({
        username: 'admin',
        password: 'admin123',
        email: 'admin@smm.com',
        role: 'admin',
        balance: 0,
        status: 'active'
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

    // إنشاء طلب جديد
    if (method === 'POST' && pathname === '/api/orders') {
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
        
        const order = await Order.create({
          id: newId,
          serviceId: data.serviceId,
          link: data.link,
          quantity: data.quantity,
          price: data.price,
          status: 'pending',
          username: data.username || 'public'
        });

        await logAction(data.username || 'public', 'order_create', { id: order.id });
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order));
      } catch (error) {
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

    // تسجيل الدخول
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body || '{}');
      
      try {
        const user = await User.findOne({ username, password, status: 'active' });
        
        if (user) {
          const token = createSession(username);
          await logAction(username, 'login');
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            token, 
            username,
            role: user.role,
            balance: user.balance
          }));
        } else {
          // التحقق إذا الحساب محظور
          const bannedUser = await User.findOne({ username, password, status: 'banned' });
          if (bannedUser) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'الحساب محظور', 
              reason: bannedUser.banReason || 'يرجى الاتصال بالدعم'
            }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'اسم المستخدم أو كلمة السر غير صحيحة' }));
          }
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'خطأ في الخادم' }));
      }
      return;
    }

    // ==================== نظام المستخدمين ====================

    // تسجيل مستخدم جديد
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
        if (password.length < 6) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'كلمة السر يجب أن تكون 6 أحرف على الأقل' }));
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

            // إنشاء المستخدم الجديد
            const newUser = await User.create({
                username,
                password,
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
                lastLogin: new Date()
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
            });

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
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'خطأ في إنشاء الحساب' }));
        }
        return;
    }

    // ==================== المسارات المحمية (تحتاج مصادقة) ====================
    const username = checkAuth(req);
    if (!username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Authentication required' }));
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
            });

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

// تغيير كلمة السر
if (method === 'PUT' && pathname === '/api/user/change-password') {
    const username = checkAuth(req);
    if (!username) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'غير مصرح' }));
        return;
    }

    const body = await readBody(req);
    const { currentPassword, newPassword } = JSON.parse(body || '{}');

    if (!currentPassword || !newPassword) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'جميع الحقول مطلوبة' }));
        return;
    }

    if (newPassword.length < 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل' }));
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
        if (user.password !== currentPassword) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'كلمة السر الحالية غير صحيحة' }));
            return;
        }

        // تحديث كلمة السر
        user.password = newPassword;
        user.updatedAt = new Date();
        await user.save();

        await logAction(username, 'password_change');

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
    const username = checkAuth(req);
    if (!username) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'غير مصرح' }));
        return;
    }

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

        await logAction(username, 'avatar_upload');

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

// الحصول على معاملات المستخدم
if (method === 'GET' && pathname === '/api/user/transactions') {
    const username = checkAuth(req);
    if (!username) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'غير مصرح' }));
        return;
    }

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
    const username = checkAuth(req);
    if (!username) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'غير مصرح' }));
        return;
    }

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

        await logAction(username, 'deposit_request', { amount, method });

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
      sessions.delete(req.headers['x-auth-token']);
      await logAction(username, 'logout');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // ==================== مسارات الأدمن ====================
    
    // التحقق من صلاحيات الأدمن
    const currentUser = await User.findOne({ username });
    const isAdmin = currentUser && currentUser.role === 'admin';

    if (!isAdmin && pathname.startsWith('/api/admin')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
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

    // تحديث حالة الطلب
    if (pathname.startsWith('/api/orders/') && method === 'PUT') {
      try {
        const id = parseInt(pathname.split('/').pop(), 10);
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        const updatedOrder = await Order.findOneAndUpdate(
          { id },
          { 
            status: data.status,
            updatedAt: new Date()
          },
          { new: true }
        );

        if (updatedOrder) {
          await logAction(username, 'order_update', { id, status: data.status });
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
        await logAction(username, 'data_refresh');
        
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

        await logAction(username, 'service_create', { id: newService.id, name: newService.name });
        
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
          await logAction(username, 'service_update', { id, changes: data });
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
          await logAction(username, 'service_delete', { id });
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


    if (pathname.startsWith('/api/services/') && method === 'DELETE') {
  try {
    const id = parseInt(pathname.split('/').pop(), 10);
    const deletedService = await Service.findOneAndDelete({ id });

    if (deletedService) {
      await logAction(username, 'service_delete', { id });
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

// ==================== مسارات إدارة المستخدمين للأدمن ====================

// الحصول على جميع المستخدمين
if (pathname === '/api/admin/users' && method === 'GET') {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(users));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'فشل في تحميل المستخدمين' }));
  }
  return;
}

// تحديث بيانات مستخدم
if (pathname.startsWith('/api/admin/users/') && method === 'PUT') {
  try {
    const userId = pathname.split('/').pop();
    const body = await readBody(req);
    const data = JSON.parse(body || '{}');
    
    // منع تحديث بعض الحقول الحساسة
    delete data.password;
    delete data.role;
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { ...data, updatedAt: new Date() },
      { new: true }
    ).select('-password');
    
    if (updatedUser) {
      await logAction(username, 'user_update', { userId, changes: data });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updatedUser));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'فشل في تحديث المستخدم' }));
  }
  return;
}

// حظر/فك حظر مستخدم
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/ban') && method === 'PUT') {
  try {
    const userId = pathname.split('/')[4];
    const body = await readBody(req);
    const { status, banReason } = JSON.parse(body || '{}');
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        status: status,
        banReason: banReason || '',
        updatedAt: new Date()
      },
      { new: true }
    ).select('-password');
    
    if (updatedUser) {
      await logAction(username, 'user_ban', { userId, status, banReason });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updatedUser));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'فشل في تحديث حالة المستخدم' }));
  }
  return;
}

// تجميد/فك تجميد رصيد
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/freeze') && method === 'PUT') {
  try {
    const userId = pathname.split('/')[4];
    const body = await readBody(req);
    const { balanceFrozen, freezeReason } = JSON.parse(body || '{}');
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        balanceFrozen: balanceFrozen,
        freezeReason: freezeReason || '',
        updatedAt: new Date()
      },
      { new: true }
    ).select('-password');
    
    if (updatedUser) {
      await logAction(username, 'user_freeze', { userId, balanceFrozen, freezeReason });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updatedUser));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'فشل في تجميد الرصيد' }));
  }
  return;
}

// تعديل رصيد المستخدم
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/balance') && method === 'PUT') {
  try {
    const userId = pathname.split('/')[4];
    const body = await readBody(req);
    const { balance, action, amount, note } = JSON.parse(body || '{}');
    
    const user = await User.findById(userId);
    if (!user) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'المستخدم غير موجود' }));
      return;
    }
    
    let newBalance = user.balance;
    if (action === 'add') {
      newBalance += parseFloat(amount);
    } else if (action === 'subtract') {
      newBalance -= parseFloat(amount);
    } else if (action === 'set') {
      newBalance = parseFloat(balance);
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { 
        balance: newBalance,
        updatedAt: new Date()
      },
      { new: true }
    ).select('-password');
    
    if (updatedUser) {
      // تسجيل المعاملة
      const maxIdTransaction = await Transaction.findOne().sort('-id').exec();
      const newId = (maxIdTransaction?.id || 0) + 1;
      
      await Transaction.create({
        id: newId,
        userId: userId,
        username: user.username,
        type: action === 'add' ? 'deposit' : 'withdraw',
        amount: parseFloat(amount),
        method: 'system',
        status: 'completed',
        details: {
          adminNote: note || `تعديل رصيد بواسطة الأدمن: ${action} ${amount}`
        },
        adminNote: note || `تعديل يدوي بواسطة ${username}`,
        processedAt: new Date(),
        processedBy: username
      });
      
      await logAction(username, 'user_balance_update', { 
        userId, 
        oldBalance: user.balance, 
        newBalance, 
        action,
        amount 
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(updatedUser));
    }
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'فشل في تعديل الرصيد' }));
  }
  return;
}

// --- المسار غير موجود ---
res.writeHead(404, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ error: 'API Endpoint Not Found' }));
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
