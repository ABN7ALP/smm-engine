// =================================================================
//  SMM Engine - ظ†ط¸ط§ظ… ظ…طھظƒط§ظ…ظ„ 100% (ظ…طµط­ط­ ظˆظ…ط±طھط¨ ظˆظ…ط¤ظ…ظ†)
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

// ==================== ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط£ظ…ط§ظ† ====================
const SALT_ROUNDS = 12;
const SESSION_DURATION = 4 * 60 * 60 * 1000; // 4 ط³ط§ط¹ط§طھ
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_TIMEOUT = 15 * 60 * 1000; // 15 ط¯ظ‚ظٹظ‚ط©

// ==================== ط¥ط¹ط¯ط§ط¯ط§طھ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ====================
const MONGODB_URI = "mongodb+srv://ds132z1998_db_user:AL2sG3m1yB6BaoRY@cluster1.ehjwrgc.mongodb.net/smmdb?retryWrites=true&w=majority";

// طھط®ط²ظٹظ† ظ…ط­ط§ظˆظ„ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط§ظ„ظپط§ط´ظ„ط©
const loginAttempts = new Map();

/**
 * ط§ظ„ط§طھطµط§ظ„ ط¨ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ MongoDB
 */
async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('âœ… طھظ… ط§ظ„ط§طھطµط§ظ„ ط¨ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ MongoDB ط¨ظ†ط¬ط§ط­');
  } catch (error) {
    console.log('â‌Œ ط®ط·ط£ ظپظٹ ط§ظ„ط§طھطµط§ظ„ ط¨ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ:', error.message);
    process.exit(1);
  }
}

connectDB();

/**
 * ط¥ط¹ط§ط¯ط© طھط¹ظٹظٹظ† ظƒظ„ظ…ط© ط³ط± ط§ظ„ط£ط¯ظ…ظ† (طھط´ط؛ظٹظ„ ظ…ط±ط© ظˆط§ط­ط¯ط© ظپظ‚ط·)
 */
async function resetAdminPassword() {
  try {
    const newPassword = "Admin123!"; // ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط¬ط¯ظٹط¯ط© ط§ظ„ظ‚ظˆظٹط©
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    await User.findOneAndUpdate(
      { username: 'admin' },
      { 
        password: hashedPassword,
        lastPasswordChange: new Date()
      }
    );
    
    console.log('ًں”‘ طھظ… طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط³ط± ط§ظ„ط£ط¯ظ…ظ†:', newPassword);
  } catch (error) {
    console.log('â‌Œ ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ط³ط±:', error.message);
  }
}

// ط§ط³طھط¯ط¹ط§ط، ط§ظ„ط¯ط§ظ„ط© ظ…ط±ط© ظˆط§ط­ط¯ط© ط«ظ… طھط¹ظ„ظٹظ‚ظ‡ط§
//resetAdminPassword();
// ==================== ظ†ظ…ط§ط°ط¬ ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ====================

/**
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ظ…ط³طھط®ط¯ظ… - طھط®ط²ظٹظ† ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†
 */
const userSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 30,
        match: /^[a-zA-Z0-9_]+$/ // ظپظ‚ط· ط£ط­ط±ظپ ط¥ظ†ط¬ظ„ظٹط²ظٹط© ظˆط£ط±ظ‚ط§ظ… ظˆط´ط±ط·ط© ط³ظپظ„ظٹط©
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
    
    // ط§ظ„ط¥ط­طµط§ط¦ظٹط§طھ
    orders: {
        total: { type: Number, default: 0 },
        completed: { type: Number, default: 0 },
        pending: { type: Number, default: 0 },
        rejected: { type: Number, default: 0 }
    },
    
    // ط§ظ„طھظˆط§ط±ظٹط®
    lastLogin: Date,
    lastPasswordChange: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

/**
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ط®ط¯ظ…ط© - طھط®ط²ظٹظ† ط®ط¯ظ…ط§طھ SMM
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
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ط·ظ„ط¨ - طھط®ط²ظٹظ† ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†
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
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ط³ط¬ظ„ - طھط®ط²ظٹظ† ط³ط¬ظ„ط§طھ ط§ظ„ظ†ط¸ط§ظ…
 */
const logSchema = new mongoose.Schema({
  id: { type: Number, unique: true },
  user: String,
  action: String,
  meta: Object,
  ip: String
}, { timestamps: true });

/**
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ظ…ط¹ط§ظ…ظ„ط© - طھط®ط²ظٹظ† ظ…ط¹ط§ظ…ظ„ط§طھ ط§ظ„ط±طµظٹط¯
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
 * ظ†ظ…ظˆط°ط¬ ط§ظ„ط¥ط´ط¹ط§ط± - طھط®ط²ظٹظ† ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†
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

// ==================== طھط¹ط±ظٹظپ ط§ظ„ظ†ظ…ط§ط°ط¬ ====================
const User = mongoose.model('User', userSchema);
const Service = mongoose.model('Service', serviceSchema);
const Order = mongoose.model('Order', orderSchema);
const Log = mongoose.model('Log', logSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Notification = mongoose.model('Notification', notificationSchema);

// ==================== ط§ظ„ط¯ظˆط§ظ„ ط§ظ„ظ…ط³ط§ط¹ط¯ط© ====================

/**
 * ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط§ظ„ظˆظ‚طھ ط§ظ„ط­ط§ظ„ظٹ ط¨طµظٹط؛ط© ISO
 */
function nowISO() { 
    return new Date().toISOString(); 
}

/**
 * ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµط­ط© ط§ظ„ط±ط§ط¨ط·
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
 * ظ‚ط±ط§ط،ط© body ط§ظ„ط·ظ„ط¨
 */
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
  });
}

/**
 * ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‚ظˆط© ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±
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
 * ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ IP ط§ظ„ط¹ظ…ظٹظ„
 */
function getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           'unknown';
}

// ==================== ظ†ط¸ط§ظ… ط§ظ„ظ…طµط§ط¯ظ‚ط© ظˆط¥ط¯ط§ط±ط© ط§ظ„ط¬ظ„ط³ط§طھ ====================
const sessions = new Map();

/**
 * ط¥ظ†ط´ط§ط، ط¬ظ„ط³ط© ط¬ط¯ظٹط¯ط© ظ„ظ„ظ…ط³طھط®ط¯ظ…
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
 * ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµط­ط© ط§ظ„طھظˆظƒظ†
 */
function checkAuth(req) {
  const token = req.headers['x-auth-token'] || null;
  if (!token) return null;
  
  const session = sessions.get(token);
  if (!session || Date.now() > session.expires) {
    if (session) sessions.delete(token);
    return null;
  }
  
  // طھط¬ط¯ظٹط¯ ظ…ط¯ط© ط§ظ„ط¬ظ„ط³ط© ط¹ظ†ط¯ ط§ظ„ظ†ط´ط§ط·
  session.expires = Date.now() + SESSION_DURATION;
  return session.username;
}

/**
 * ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ…ط­ط§ظˆظ„ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„
 */
function checkLoginAttempts(username, ip) {
    const key = `${username}_${ip}`;
    const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
    
    // ط¥ط°ط§ طھط¬ط§ظˆط² ط§ظ„ط­ط¯ ط§ظ„ظ…ط³ظ…ظˆط­ ظˆظƒط§ظ† ط§ظ„ظˆظ‚طھ ظ„ظ… ظٹظ†طھظ‡ ط¨ط¹ط¯
    if (attempts.count >= MAX_LOGIN_ATTEMPTS && 
        Date.now() - attempts.lastAttempt < LOGIN_TIMEOUT) {
        return false;
    }
    
    // ط¥ط°ط§ ط§ظ†طھظ‡ظ‰ ط§ظ„ظˆظ‚طھطŒ ط¥ط¹ط§ط¯ط© طھط¹ظٹظٹظ† ط§ظ„ط¹ط¯ط§ط¯
    if (Date.now() - attempts.lastAttempt >= LOGIN_TIMEOUT) {
        attempts.count = 0;
    }
    
    return true;
}

/**
 * طھط³ط¬ظٹظ„ ظ…ط­ط§ظˆظ„ط© طھط³ط¬ظٹظ„ ط¯ط®ظˆظ„ ظپط§ط´ظ„ط©
 */
function recordFailedLogin(username, ip) {
    const key = `${username}_${ip}`;
    const attempts = loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
    
    attempts.count++;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(key, attempts);
}

/**
 * ظ…ط³ط­ ظ…ط­ط§ظˆظ„ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط§ظ„ظ†ط§ط¬ط­ط©
 */
function clearLoginAttempts(username, ip) {
    const key = `${username}_${ip}`;
    loginAttempts.delete(key);
}

// طھظ†ط¸ظٹظپ ط§ظ„ط¬ظ„ط³ط§طھ ظˆط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ظ…ظ†طھظ‡ظٹط© ظƒظ„ 10 ط¯ظ‚ط§ط¦ظ‚
setInterval(() => {
  const now = Date.now();
  
  // طھظ†ط¸ظٹظپ ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„ظ…ظ†طھظ‡ظٹط©
  sessions.forEach((session, token) => {
    if (now > session.expires) sessions.delete(token);
  });
  
  // طھظ†ط¸ظٹظپ ظ…ط­ط§ظˆظ„ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط§ظ„ظ…ظ†طھظ‡ظٹط©
  loginAttempts.forEach((attempts, key) => {
    if (now - attempts.lastAttempt >= LOGIN_TIMEOUT) {
      loginAttempts.delete(key);
    }
  });
}, 10 * 60 * 1000);

// ==================== ظ†ط¸ط§ظ… ط§ظ„ط³ط¬ظ„ط§طھ ظˆط§ظ„ظƒط§ط´ ====================

/**
 * طھط³ط¬ظٹظ„ ط¥ط¬ط±ط§ط، ظپظٹ ط§ظ„ظ†ط¸ط§ظ…
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
    console.log('â‌Œ ط®ط·ط£ ظپظٹ ط­ظپط¸ ط§ظ„ط³ط¬ظ„:', error.message);
  }
}

const previewCache = new Map();
const PREVIEW_TTL = 10 * 60 * 1000; // 10 ط¯ظ‚ط§ط¦ظ‚

// ==================== طھظ‡ظٹط¦ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ====================

/**
 * ط¥ظ†ط´ط§ط، ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط© ط¹ظ†ط¯ ط§ظ„طھط´ط؛ظٹظ„ ط§ظ„ط£ظˆظ„
 */
async function initializeDefaultData() {
  try {
    // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظˆط¬ظˆط¯ ط®ط¯ظ…ط§طھ
    const serviceCount = await Service.countDocuments();
    if (serviceCount === 0) {
      console.log('ًں”§ ط¬ط§ط±ظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط®ط¯ظ…ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط©...');
      
      const defaultServices = [
        { id: 1, name: "ظ…طھط§ط¨ط¹ظٹظ† ط§ظ†ط³طھط¬ط±ط§ظ…", category: "ط§ظ†ط³طھط§", type: "quantity", rate: 5, min: 100, max: 10000 },
        { id: 2, name: "ظ„ط§ظٹظƒط§طھ ط§ظ†ط³طھط¬ط±ط§ظ…", category: "ط§ظ†ط³طھط§", type: "quantity", rate: 2, min: 100, max: 5000 },
        { id: 3, name: "ظ…ط´ط§ظ‡ط¯ط§طھ ظٹظˆطھظٹظˆط¨", category: "ظٹظˆطھظٹظˆط¨", type: "quantity", rate: 3, min: 1000, max: 50000 },
        { id: 4, name: "ط¥ط¹ط¬ط§ط¨ط§طھ ظپظٹط³ط¨ظˆظƒ", category: "ظپظٹط³ ط¨ظˆظƒ", type: "quantity", rate: 4, min: 100, max: 10000 }
      ];
      
      await Service.insertMany(defaultServices);
      console.log('âœ… طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط®ط¯ظ…ط§طھ ط§ظ„ط§ظپطھط±ط§ط¶ظٹط©');
    }

    // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظˆط¬ظˆط¯ ط£ط¯ظ…ظ†
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
        fullName: 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…'
      });
      console.log('âœ… طھظ… ط¥ظ†ط´ط§ط، ط­ط³ط§ط¨ ط§ظ„ط£ط¯ظ…ظ†');
    }
  } catch (error) {
    console.log('â‌Œ ط®ط·ط£ ظپظٹ طھظ‡ظٹط¦ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ:', error.message);
  }
}

// طھط´ط؛ظٹظ„ ط§ظ„طھظ‡ظٹط¦ط© ط¨ط¹ط¯ ط§ظ„ط§طھطµط§ظ„ ط¨ظ‚ط§ط¹ط¯ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ
mongoose.connection.once('open', async () => {
  console.log('ًں“ٹ ط¬ط§ط±ظٹ طھظ‡ظٹط¦ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ...');
  await initializeDefaultData();
});

// ==================== ط§ظ„ط³ظٹط±ظپط± ط§ظ„ط±ط¦ظٹط³ظٹ ====================
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;
    const method = req.method;
    const clientIP = getClientIP(req);

    // ==================== ط§ظ„ظ…ط³ط§ط±ط§طھ ط§ظ„ط¹ط§ظ…ط© (ظ„ط§ طھط­طھط§ط¬ ظ…طµط§ط¯ظ‚ط©) ====================

    // ط®ط¯ظ…ط© ط§ظ„ظ…ظ„ظپط§طھ ط§ظ„ط«ط§ط¨طھط©
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

    // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط·ظ„ط¨ ط¹ط§ظ… (ظ„ظ„ط¹ط±ط¶ ط§ظ„ط¹ط§ظ…)
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

    // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط§ظ„ط®ط¯ظ…ط§طھ
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
    
    
    // ط¥ظ†ط´ط§ط، ط·ظ„ط¨ ط¬ط¯ظٹط¯ ظ…ط¹ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ
if (method === 'POST' && pathname === '/api/orders') {
  console.log('ًںژ¯ طھظ… ط§ط³طھظ„ط§ظ… ط·ظ„ط¨ ط¬ط¯ظٹط¯ ظ…ظ†:', checkAuth(req) || 'ظ…ط³طھط®ط¯ظ… ط¹ط§ظ…');
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
        
        // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط§ظ„ظ…ط³طھط®ط¯ظ… ط¥ط°ط§ ظƒط§ظ† ظ…ط³ط¬ظ„ط§ظ‹
let username = 'public';
let userId = null;

const authUsername = checkAuth(req);
console.log(`ًں”چ authUsername: ${authUsername}`); // <-- ط£ط¶ظپ ظ‡ط°ط§

if (authUsername) {
    const user = await User.findOne({ username: authUsername });
    if (user) {
        username = user.username;
        userId = user._id.toString(); // âœ… طھط£ظƒط¯ ظ…ظ† طھط­ظˆظٹظ„ظ‡ ظ„ظ€ string
        console.log(`ًں”چ طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ ط§ظ„ظ…ط³طھط®ط¯ظ…: ${username}, userId: ${userId}`);
        
        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط±طµظٹط¯ ط¥ط°ط§ ظƒط§ظ† ط§ظ„ط·ظ„ط¨ ظ…ط¯ظپظˆط¹
        if (user.balanceFrozen) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ظ„ط§ ظٹظ…ظƒظ† ط¥ظ†ط´ط§ط، ط·ظ„ط¨ - ط§ظ„ط±طµظٹط¯ ظ…ط¬ظ…ط¯' }));
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

// ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ… ط¥ط°ط§ ظƒط§ظ† ظ…ط³ط¬ظ„ط§ظ‹
console.log(`ًں”چ debugging - userId: ${userId}, username: ${username}`);

if (userId) {
    console.log(`ًں”چ ط¬ط§ط±ظٹ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ…: ${username}`);
    try {
        const notification = await Notification.create({
            id: Date.now(),
            userId: userId,
            type: 'success', 
            title: 'طھظ… ط¥ظ†ط´ط§ط، ط·ظ„ط¨ ط¬ط¯ظٹط¯',
            message: `طھظ… ط¥ظ†ط´ط§ط، ط·ظ„ط¨ظƒ #${order.id} ط¨ظ†ط¬ط§ط­. ط³ظٹطھظ… ظ…ط¹ط§ظ„ط¬طھظ‡ ظ‚ط±ظٹط¨ط§ظ‹.`,
            relatedTo: 'order',
            relatedId: order.id,
            read: false,
            createdAt: new Date()
        });
        console.log(`âœ… طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط± ط¨ظ†ط¬ط§ط­:`, notification);
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط±:', error);
    }

    // طھط­ط¯ظٹط« ط¥ط­طµط§ط¦ظٹط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
    const user = await User.findOne({ username: authUsername });
    if (user) {
        user.orders.total = (user.orders.total || 0) + 1;
        user.orders.pending = (user.orders.pending || 0) + 1;
        await user.save();
    }
} else {
    console.log('ًں”چ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ط³ط¬ظ„ ط¯ط®ظˆظ„ - ظ„ط§ ط¥ط´ط¹ط§ط±ط§طھ');
}

// ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ط£ط¯ظ…ظ†
try {
    const adminUsers = await User.find({ role: 'admin' });
    for (let i = 0; i < adminUsers.length; i++) {
        const admin = adminUsers[i];
        await Notification.create({
            id: Date.now() + i, // âœ… ظ†ط³طھط®ط¯ظ… index ظ„طھط¬ظ†ط¨ ط§ظ„طھظƒط±ط§ط±
            userId: admin._id,
            type: 'info',
            title: 'ط·ظ„ط¨ ط¬ط¯ظٹط¯',
            message: `طھظ… ط¥ظ†ط´ط§ط، ط·ظ„ط¨ ط¬ط¯ظٹط¯ #${order.id} ظ…ظ† ظ‚ط¨ظ„ ${username}`,
            relatedTo: 'order',
            relatedId: order.id,
            read: false,
            createdAt: new Date()
        });
    }
    console.log(`âœ… طھظ… ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط±ط§طھ ظ„ظ„ط£ط¯ظ…ظ† ط¨ط®طµظˆطµ ط§ظ„ط·ظ„ط¨ #${order.id}`);
} catch (error) {
    console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ط£ط¯ظ…ظ†:', error);
}
        
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(order));
    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط·ظ„ط¨:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create order' }));
    }
    return;
}
    // ظ…ط¹ط§ظٹظ†ط© ط§ظ„ط±ط§ط¨ط·
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

    // طھط­ظ„ظٹظ„ ط§ظ„ط±ط§ط¨ط·
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

    // طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ (ظ…ط­ط¯ط« ظ…ط¹ ظ†ط¸ط§ظ… ط§ظ„ط£ظ…ط§ظ†)
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body || '{}');
      
      // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ…ط­ط§ظˆظ„ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„
      if (!checkLoginAttempts(username, clientIP)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'طھظ… طھط¬ط§ظˆط² ط¹ط¯ط¯ ط§ظ„ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ظ…ط³ظ…ظˆط­ط©. ط§ظ„ط±ط¬ط§ط، ط§ظ„ظ…ط­ط§ظˆظ„ط© ط¨ط¹ط¯ 15 ط¯ظ‚ظٹظ‚ط©.' 
        }));
        return;
      }
      
      try {
        const user = await User.findOne({ username, status: 'active' });
        
        if (user && await bcrypt.compare(password, user.password)) {
          // طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ظ†ط§ط¬ط­
          const token = createSession(username, clientIP);
          await logAction(username, 'login_success', {}, clientIP);
          clearLoginAttempts(username, clientIP);
          
          // طھط­ط¯ظٹط« ط¢ط®ط± طھط³ط¬ظٹظ„ ط¯ط®ظˆظ„
          await User.updateOne({ username }, { lastLogin: new Date() });
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            token, 
            username,
            role: user.role,
            balance: user.balance,
            message: 'طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ط¨ظ†ط¬ط§ط­'
          }));
        } else {
          // طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„ ظپط§ط´ظ„
          recordFailedLogin(username, clientIP);
          await logAction(username, 'login_failed', { reason: 'invalid_credentials' }, clientIP);
          
            // ط§ظ„طھط­ظ‚ظ‚ ط¥ط°ط§ ط§ظ„ط­ط³ط§ط¨ ظ…ط­ط¸ظˆط±
          const bannedUser = await User.findOne({ username, status: 'banned' });
          if (bannedUser) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'ط§ظ„ط­ط³ط§ط¨ ظ…ط­ط¸ظˆط±', 
              reason: bannedUser.banReason || 'ظٹط±ط¬ظ‰ ط§ظ„ط§طھطµط§ظ„ ط¨ط§ظ„ط¯ط¹ظ…'
            }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ… ط£ظˆ ظƒظ„ظ…ط© ط§ظ„ط³ط± ط؛ظٹط± طµط­ظٹط­ط©',
              remainingAttempts: MAX_LOGIN_ATTEMPTS - (loginAttempts.get(`${username}_${clientIP}`)?.count || 0)
            }));
          }
        }
      } catch (error) {
        await logAction('system', 'login_error', { error: error.message }, clientIP);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط§ظ„ط®ط§ط¯ظ…' }));
      }
      return;
    }

    // ==================== ظ†ط¸ط§ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ† ====================

    // طھط³ط¬ظٹظ„ ظ…ط³طھط®ط¯ظ… ط¬ط¯ظٹط¯ (ظ…ط­ط¯ط« ظ…ط¹ طھط´ظپظٹط± ظƒظ„ظ…ط§طھ ط§ظ„ظ…ط±ظˆط±)
    if (method === 'POST' && pathname === '/api/auth/register') {
        const body = await readBody(req);
        const { username, password, email, phone, fullName } = JSON.parse(body || '{}');
        
        if (!username || !password || !email) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…طŒ ظƒظ„ظ…ط© ط§ظ„ط³ط±طŒ ظˆط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ظ…ط·ظ„ظˆط¨ط©' }));
            return;
        }

        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµط­ط© ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'طµظٹط؛ط© ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ط؛ظٹط± طµط­ظٹط­ط©' }));
            return;
        }

        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‚ظˆط© ظƒظ„ظ…ط© ط§ظ„ط³ط±
        if (!isPasswordStrong(password)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'ظƒظ„ظ…ط© ط§ظ„ط³ط± ط¶ط¹ظٹظپط©',
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
            // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط¹ط¯ظ… ظˆط¬ظˆط¯ ظ…ط³طھط®ط¯ظ… ط¨ظ†ظپط³ ط§ظ„ط§ط³ظ… ط£ظˆ ط§ظ„ط¨ط±ظٹط¯
            const existingUser = await User.findOne({
                $or: [{ username }, { email }]
            });

            if (existingUser) {
                res.writeHead(409, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'ظ…ط³طھط®ط¯ظ… ظ…ظˆط¬ظˆط¯ ظ…ط³ط¨ظ‚ط§ظ‹',
                    details: existingUser.username === username ? 
                            'ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ… ظ…ط³طھط®ط¯ظ… ظ…ط³ط¨ظ‚ط§ظ‹' : 'ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ظ…ط³طھط®ط¯ظ… ظ…ط³ط¨ظ‚ط§ظ‹'
                }));
                return;
            }

            // طھط´ظپظٹط± ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± ظˆط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¬ط¯ظٹط¯
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

            // ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± طھط±ط­ظٹط¨ظٹ
            await Notification.create({
                id: Date.now(),
                userId: newUser._id,
                type: 'success',
                title: 'ظ…ط±ط­ط¨ط§ظ‹ ط¨ظƒ!',
                message: 'طھظ… ط¥ظ†ط´ط§ط، ط­ط³ط§ط¨ظƒ ط¨ظ†ط¬ط§ط­. ظٹظ…ظƒظ†ظƒ ط§ظ„ط¢ظ† ط§ط³طھط®ط¯ط§ظ… ط¬ظ…ظٹط¹ ظ…ظٹط²ط§طھ ط§ظ„ظ…ظ†طµط©.',
                relatedTo: 'system'
            });

            await logAction('system', 'user_register', { 
                username: newUser.username, 
                userId: newUser._id 
            }, clientIP);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط­ط³ط§ط¨ ط¨ظ†ط¬ط§ط­',
                user: {
                    id: newUser._id,
                    username: newUser.username,
                    email: newUser.email,
                    role: newUser.role
                }
            }));

        } catch (error) {
            console.error('ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
            await logAction('system', 'register_error', { error: error.message }, clientIP);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط­ط³ط§ط¨' }));
        }
        return;
    }

    // ==================== ط§ظ„ظ…ط³ط§ط±ط§طھ ط§ظ„ظ…ط­ظ…ظٹط© (طھط­طھط§ط¬ ظ…طµط§ط¯ظ‚ط©) ====================
    const username = checkAuth(req);
    if (!username) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'ط؛ظٹط± ظ…طµط±ط­: ظٹظ„ط²ظ… طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„' }));
      return;
    }

    // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
    if (pathname === '/api/user/profile' && method === 'GET') {
        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
                return;
            }

            // ط¥ط±ط¬ط§ط¹ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط¨ط¯ظˆظ† ظƒظ„ظ…ط© ط§ظ„ط³ط±
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
            console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¨ظٹط§ظ†ط§طھ' }));
        }
        return;
    }

    // طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
    if (pathname === '/api/user/profile' && method === 'PUT') {
        const body = await readBody(req);
        const updateData = JSON.parse(body || '{}');

        try {
            // ظ…ظ†ط¹ طھط­ط¯ظٹط« ط¨ط¹ط¶ ط§ظ„ط­ظ‚ظˆظ„
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
                res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
                return;
            }

            await logAction(username, 'profile_update', { 
                updatedFields: Object.keys(updateData) 
            }, clientIP);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ ط¨ظ†ط¬ط§ط­',
                user: {
                    username: updatedUser.username,
                    email: updatedUser.email,
                    phone: updatedUser.phone,
                    fullName: updatedUser.fullName,
                    avatar: updatedUser.avatar
                }
            }));

        } catch (error) {
            console.error('ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ' }));
        }
        return;
    }

    // ==================== ظ†ط¸ط§ظ… ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ ط§ظ„ظ…طھظ‚ط¯ظ… ====================

    // طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط± (ظ…ط­ط¯ط« ظ…ط¹ طھط´ظپظٹط±)
    if (method === 'PUT' && pathname === '/api/user/change-password') {
        const body = await readBody(req);
        const { currentPassword, newPassword } = JSON.parse(body || '{}');

        if (!currentPassword || !newPassword) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط¬ظ…ظٹط¹ ط§ظ„ط­ظ‚ظˆظ„ ظ…ط·ظ„ظˆط¨ط©' }));
            return;
        }

        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظ‚ظˆط© ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط¬ط¯ظٹط¯ط©
        if (!isPasswordStrong(newPassword)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                error: 'ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط¬ط¯ظٹط¯ط© ط¶ط¹ظٹظپط©',
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
                res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
                return;
            }

            // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط­ط§ظ„ظٹط©
            const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
            if (!isCurrentPasswordValid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط­ط§ظ„ظٹط© ط؛ظٹط± طµط­ظٹط­ط©' }));
                return;
            }

            // طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ط³ط±
            const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
            user.password = hashedNewPassword;
            user.lastPasswordChange = new Date();
            user.updatedAt = new Date();
            await user.save();

            await logAction(username, 'password_change', {}, clientIP);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'طھظ… طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط± ط¨ظ†ط¬ط§ط­'
            }));

        } catch (error) {
            console.error('ط®ط·ط£ ظپظٹ طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط±:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط±' }));
        }
        return;
    }

    // ط±ظپط¹ ط§ظ„طµظˆط±ط© ط§ظ„ط´ط®طµظٹط©
    // ط±ظپط¹ ط§ظ„طµظˆط±ط© ط§ظ„ط´ط®طµظٹط©
if (pathname === '/api/user/upload-avatar' && method === 'POST') {
    try {
        const body = await readBody(req);
        const { avatar } = JSON.parse(body || '{}');

        if (!avatar) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'طµظˆط±ط© ط؛ظٹط± ظ…ط±ظپظˆط¹ط©' }));
            return;
        }

        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // ط­ظپط¸ ط§ظ„طµظˆط±ط© (ظپظٹ ط­ط§ظ„طھظ†ط§ ظ†ط®ط²ظ†ظ‡ط§ ظƒظ€ base64 ظ…ط¨ط§ط´ط±ط©)
        user.avatar = avatar;
        user.updatedAt = new Date();
        await user.save();

        await logAction(username, 'avatar_upload', {}, clientIP);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„طµظˆط±ط© ط§ظ„ط´ط®طµظٹط© ط¨ظ†ط¬ط§ط­',
            avatar: user.avatar
        }));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط±ظپط¹ ط§ظ„طµظˆط±ط©:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط±ظپط¹ ط§ظ„طµظˆط±ط©' }));
    }
    return;
}

    // ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط¬ط¯ظٹط¯
if (pathname === '/api/user/notifications' && method === 'POST') {
    try {
        const body = await readBody(req);
        const { title, message, type, relatedTo, relatedId } = JSON.parse(body || '{}');

        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // âœ… ط¥طµظ„ط§ط­: ط¥ظ†ط´ط§ط، ID ظپط±ظٹط¯ ط¨ط¯ظ„ null
        const maxIdNotification = await Notification.findOne().sort('-id').exec();
        const newId = (maxIdNotification?.id || 0) + 1;

        // ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط±
        const notification = await Notification.create({
            id: newId, // âœ… ط¥ط¶ط§ظپط© ID ظپط±ظٹط¯
            userId: user._id,
            type: type || 'info',
            title: title || 'ط¥ط´ط¹ط§ط± ط¬ط¯ظٹط¯',
            message: message || 'ظ„ط§ ظٹظˆط¬ط¯ ظ…ط­طھظˆظ‰',
            read: false,
            relatedTo: relatedTo || 'order',
            relatedId: relatedId || null
        });

        console.log(`âœ… طھظ… ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط¬ط¯ظٹط¯ #${newId} ظ„ظ„ظ…ط³طھط®ط¯ظ… ${username}`);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notification));

    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط±:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create notification' }));
    }
    return;
}
// ==================== APIs ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ ط§ظ„ظ…ظپظ‚ظˆط¯ط© ====================

// ط±ظپط¹ ط§ظ„طµظˆط±ط© ط§ظ„ط´ط®طµظٹط©
if (pathname === '/api/user/upload-avatar' && method === 'POST') {
    try {
        const body = await readBody(req);
        const { avatar } = JSON.parse(body || '{}');

        if (!avatar) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'طµظˆط±ط© ط؛ظٹط± ظ…ط±ظپظˆط¹ط©' }));
            return;
        }

        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // ط­ظپط¸ ط§ظ„طµظˆط±ط©
        user.avatar = avatar;
        user.updatedAt = new Date();
        await user.save();

        await logAction(username, 'avatar_upload', {}, clientIP);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„طµظˆط±ط© ط§ظ„ط´ط®طµظٹط© ط¨ظ†ط¬ط§ط­',
            avatar: user.avatar
        }));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط±ظپط¹ ط§ظ„طµظˆط±ط©:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط±ظپط¹ ط§ظ„طµظˆط±ط©' }));
    }
    return;
}

// ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط´ط®طµظٹط©
if (pathname === '/api/user/orders' && method === 'GET') {
    try {
        const userOrders = await Order.find({ username }).sort({ createdAt: -1 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userOrders));
    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load user orders' }));
    }
    return;
}

// ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ظ…ط¹ط§ظ…ظ„ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
if (pathname === '/api/user/transactions' && method === 'GET') {
    try {
        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        const transactions = await Transaction.find({ username: user.username })
            .sort({ createdAt: -1 })
            .limit(50);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(transactions));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ' }));
    }
    return;
}

// طھط­ط¯ظٹط« ط§ظ„ظ…ظ„ظپ ط§ظ„ط´ط®طµظٹ
if (pathname === '/api/user/profile' && method === 'PUT') {
    try {
        const body = await readBody(req);
        const updateData = JSON.parse(body || '{}');

        // ظ…ظ†ط¹ طھط­ط¯ظٹط« ط¨ط¹ط¶ ط§ظ„ط­ظ‚ظˆظ„
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
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        await logAction(username, 'profile_update', { 
            updatedFields: Object.keys(updateData) 
        }, clientIP);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ ط¨ظ†ط¬ط§ط­',
            user: {
                username: updatedUser.username,
                email: updatedUser.email,
                phone: updatedUser.phone,
                fullName: updatedUser.fullName,
                avatar: updatedUser.avatar
            }
        }));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ' }));
    }
    return;
}

// طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط±
if (pathname === '/api/user/change-password' && method === 'PUT') {
    try {
        const body = await readBody(req);
        const { currentPassword, newPassword } = JSON.parse(body || '{}');

        if (!currentPassword || !newPassword) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط¬ظ…ظٹط¹ ط§ظ„ط­ظ‚ظˆظ„ ظ…ط·ظ„ظˆط¨ط©' }));
            return;
        }

        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط­ط§ظ„ظٹط©
        const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
        if (!isCurrentPasswordValid) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ظƒظ„ظ…ط© ط§ظ„ط³ط± ط§ظ„ط­ط§ظ„ظٹط© ط؛ظٹط± طµط­ظٹط­ط©' }));
            return;
        }

        // طھط­ط¯ظٹط« ظƒظ„ظ…ط© ط§ظ„ط³ط±
        const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        user.password = hashedNewPassword;
        user.lastPasswordChange = new Date();
        user.updatedAt = new Date();
        await user.save();

        await logAction(username, 'password_change', {}, clientIP);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: true,
            message: 'طھظ… طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط± ط¨ظ†ط¬ط§ط­'
        }));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط±:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط؛ظٹظٹط± ظƒظ„ظ…ط© ط§ظ„ط³ط±' }));
    }
    return;
}
    // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ظ…ط¹ط§ظ…ظ„ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
    if (method === 'GET' && pathname === '/api/user/transactions') {
        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
                return;
            }

            const transactions = await Transaction.find({ username })
                .sort({ createdAt: -1 })
                .limit(50);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(transactions));

        } catch (error) {
            console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط¹ط§ظ…ظ„ط§طھ' }));
        }
        return;
    }

    // ط·ظ„ط¨ ط´ط­ظ† ط±طµظٹط¯
    if (method === 'POST' && pathname === '/api/user/deposit') {
        const body = await readBody(req);
        const { amount, method, details } = JSON.parse(body || '{}');

        if (!amount || !method || amount <= 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط¨ظٹط§ظ†ط§طھ ط؛ظٹط± طµط­ظٹط­ط©' }));
            return;
        }

        try {
            const user = await User.findOne({ username });
            if (!user) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
                return;
            }

            // ط¥ظ†ط´ط§ط، ظ…ط¹ط§ظ…ظ„ط© ط¬ط¯ظٹط¯ط©
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
                userNote: `ط·ظ„ط¨ ط´ط­ظ† ط±طµظٹط¯ ط¨ظ‚ظٹظ…ط© $${amount}`
            });

            // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ط£ط¯ظ…ظ†
            await Notification.create({
                id: Date.now(),
                userId: user._id,
                type: 'info',
                title: 'ط·ظ„ط¨ ط´ط­ظ† ط±طµظٹط¯ ط¬ط¯ظٹط¯',
                message: `ط§ظ„ظ…ط³طھط®ط¯ظ… ${username} ط·ظ„ط¨ ط´ط­ظ† ط±طµظٹط¯ ط¨ظ‚ظٹظ…ط© $${amount}`,
                relatedTo: 'transaction',
                relatedId: transaction.id
            });

            await logAction(username, 'deposit_request', { amount, method }, clientIP);

            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                message: 'طھظ… ط¥ط±ط³ط§ظ„ ط·ظ„ط¨ ط§ظ„ط´ط­ظ† ط¨ظ†ط¬ط§ط­',
                transaction: transaction
            }));

        } catch (error) {
            console.error('ط®ط·ط£ ظپظٹ ط·ظ„ط¨ ط§ظ„ط´ط­ظ†:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط·ظ„ط¨ ط§ظ„ط´ط­ظ†' }));
        }
        return;
    }

    // ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط´ط®طµظٹط©
    // ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط´ط®طµظٹط©
if (pathname === '/api/user/orders' && method === 'GET') {
    try {
        const userOrders = await Order.find({ username }).sort({ createdAt: -1 });
        console.log(`ًں“¦ ط¬ظ„ط¨ ${userOrders.length} ط·ظ„ط¨ ظ„ظ„ظ…ط³طھط®ط¯ظ… ${username}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(userOrders));
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط·ظ„ط¨ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load user orders' }));
    }
    return;
}

// طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ (ظ„ظ„ط£ط¯ظ…ظ†)
if (pathname.startsWith('/api/orders/') && method === 'PUT') {
    try {
        const id = parseInt(pathname.split('/').pop(), 10);
        const body = await readBody(req);
        const data = JSON.parse(body || '{}');
        
        console.log(`ًں”„ طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ #${id} ط¥ظ„ظ‰: ${data.status}`);
        
        const order = await Order.findOne({ id });
        if (!order) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Order not found' }));
            return;
        }

        const updatedOrder = await Order.findOneAndUpdate(
            { id },
            { 
                status: data.status,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (updatedOrder) {
            console.log(`âœ… طھظ… طھط­ط¯ظٹط« ط§ظ„ط·ظ„ط¨ #${id} ط¨ظ†ط¬ط§ط­`);
            
            // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ… ط¥ط°ط§ ظƒط§ظ† ظ…ط³ط¬ظ„
            if (order.username !== 'public') {
                const user = await User.findOne({ username: order.username });
                if (user) {
                    await Notification.create({
                        userId: user._id,
                        type: data.status === 'completed' ? 'success' : 'info',
                        title: `طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ #${order.id}`,
                        message: `ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ط£طµط¨ط­طھ: ${getOrderStatusText(data.status)}`,
                        relatedTo: 'order',
                        relatedId: order.id
                    });
                    console.log(`ًں“¢ طھظ… ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ… ${order.username}`);
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(updatedOrder));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Order not found' }));
        }
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ط·ظ„ط¨:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update order' }));
    }
    return;
}

    // طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬
    if (method === 'POST' && pathname === '/api/auth/logout') {
      const token = req.headers['x-auth-token'];
      if (token) sessions.delete(token);
      await logAction(username, 'logout', {}, clientIP);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: 'طھظ… طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬ ط¨ظ†ط¬ط§ط­' }));
      return;
                            }
    // ==================== ظ…ط³ط§ط±ط§طھ ط§ظ„ط£ط¯ظ…ظ† ====================
    
    // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµظ„ط§ط­ظٹط§طھ ط§ظ„ط£ط¯ظ…ظ†
    const currentUser = await User.findOne({ username });
    const isAdmin = currentUser && currentUser.role === 'admin';

    if (!isAdmin && pathname.startsWith('/api/admin')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ظ…ظ…ظ†ظˆط¹ ط§ظ„ظˆطµظˆظ„: ظٹظ„ط²ظ… طµظ„ط§ط­ظٹط§طھ ط£ط¯ظ…ظ†' }));
        return;
    }

    // ط§ظ„ط¥ط­طµط§ط¦ظٹط§طھ
    if (pathname === '/api/stats' && method === 'GET') {
      try {
        const totalServices = await Service.countDocuments();
        const totalOrders = await Order.countDocuments();
        const pendingOrders = await Order.countDocuments({ status: 'pending' });
        
        // ط­ط³ط§ط¨ ظ…طھظˆط³ط· ط§ظ„ط³ط¹ط±
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

    // ط¬ظ…ظٹط¹ ط§ظ„ط·ظ„ط¨ط§طھ (ظ„ظ„ط£ط¯ظ…ظ†)
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

    
    // طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ ظ…ط¹ ظ†ط¸ط§ظ… ط§ظ„ط®طµظ…
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

        // ط¥ط°ط§ طھظ… طھط؛ظٹظٹط± ط§ظ„ط­ط§ظ„ط© ط¥ظ„ظ‰ processing ظˆظƒط§ظ†طھ pendingطŒ ظ‚ظ… ط¨ط®طµظ… ط§ظ„ظ…ط¨ظ„ط؛
        if (data.status === 'processing' && order.status === 'pending') {
            const user = await User.findOne({ username: order.username });
            if (user) {
                // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط£ظ† ط§ظ„ط±طµظٹط¯ ظƒط§ظپظٹ ظˆط؛ظٹط± ظ…ط¬ظ…ط¯
                if (user.balanceFrozen) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'ظ„ط§ ظٹظ…ظƒظ† ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ط·ظ„ط¨ - ط§ظ„ط±طµظٹط¯ ظ…ط¬ظ…ط¯' }));
                    return;
                }
                
                if (user.balance < order.price) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'ط±طµظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظƒط§ظپظٹ' }));
                    return;
                }

                // ط®طµظ… ط§ظ„ظ…ط¨ظ„ط؛ ظ…ظ† ط±طµظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ…
                user.balance -= order.price;
                user.totalSpent += order.price;
                
                // طھط­ط¯ظٹط« ط¥ط­طµط§ط¦ظٹط§طھ ط§ظ„ط·ظ„ط¨ط§طھ
                user.orders.total = (user.orders.total || 0) + 1;
                user.orders.pending = (user.orders.pending || 0) + 1;
                
                await user.save();

                // طھط³ط¬ظٹظ„ ط§ظ„ظ…ط¹ط§ظ…ظ„ط©
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
                    userNote: `ط¯ظپط¹ ظ…ظ‚ط§ط¨ظ„ ط§ظ„ط·ظ„ط¨ #${order.id}`,
                    createdAt: new Date()
                });

                // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ…
                await Notification.create({
                    id: Date.now(),
                    userId: user._id,
                    type: 'info',
                    title: 'طھظ… ط®طµظ… ط§ظ„ظ…ط¨ظ„ط؛',
                    message: `طھظ… ط®طµظ… $${order.price.toFixed(2)} ظ…ظ† ط±طµظٹط¯ظƒ ظ…ظ‚ط§ط¨ظ„ ط§ظ„ط·ظ„ط¨ #${order.id}`,
                    relatedTo: 'order',
                    relatedId: order.id
                });

                console.log(`âœ… طھظ… ط®طµظ… $${order.price} ظ…ظ† ط±طµظٹط¯ ${user.username}`);
            }
        }

        // ط¥ط°ط§ طھظ… ط¥ظ„ط؛ط§ط، ط§ظ„ط·ظ„ط¨ ط£ظˆ ط±ظپط¶ظ‡طŒ ط¥ط±ط¬ط§ط¹ ط§ظ„ظ…ط¨ظ„ط؛
        if ((data.status === 'cancelled' || data.status === 'rejected') && 
            (order.status === 'processing' || order.status === 'pending')) {
            const user = await User.findOne({ username: order.username });
            if (user && order.status === 'processing') {
                // ط¥ط±ط¬ط§ط¹ ط§ظ„ظ…ط¨ظ„ط؛ ظ„ظ„ظ…ط³طھط®ط¯ظ…
                user.balance += order.price;
                user.totalSpent -= order.price;
                await user.save();

                // طھط³ط¬ظٹظ„ ظ…ط¹ط§ظ…ظ„ط© ط§ظ„ط¥ط±ط¬ط§ط¹
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
                    userNote: `ط§ط³طھط±ط¬ط§ط¹ ظ…ط¨ظ„ط؛ ط§ظ„ط·ظ„ط¨ #${order.id}`,
                    createdAt: new Date()
                });

                // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ…
                await Notification.create({
                    id: Date.now(),
                    userId: user._id,
                    type: 'info',
                    title: 'طھظ… ط§ط³طھط±ط¬ط§ط¹ ط§ظ„ظ…ط¨ظ„ط؛',
                    message: `طھظ… ط¥ط±ط¬ط§ط¹ $${order.price.toFixed(2)} ط¥ظ„ظ‰ ط±طµظٹط¯ظƒ ظ„ظ„ط·ظ„ط¨ #${order.id}`,
                    relatedTo: 'order',
                    relatedId: order.id
                });
            }
        }

        // طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨
        const updatedOrder = await Order.findOneAndUpdate(
            { id },
            { 
                status: data.status,
                updatedAt: new Date()
            },
            { new: true }
        );

        if (updatedOrder) {
    // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ط¨طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨
    const user = await User.findOne({ username: order.username });
    if (user) {
        try {
            await Notification.create({
                id: Date.now(), // âœ… طھط£ظƒط¯ ظ…ظ† ط§ط³طھط®ط¯ط§ظ… Date.now() ظپظ‚ط·
                userId: user._id,
                type: data.status === 'completed' ? 'success' : 
                      data.status === 'rejected' ? 'error' : 'info',
                title: `طھظ… طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ #${order.id}`,
                message: `ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ #${order.id} ط£طµط¨ط­طھ: ${getOrderStatusText(data.status)}`,
                relatedTo: 'order',
                relatedId: order.id,
                read: false,
                createdAt: new Date()
            });
            console.log(`âœ… طھظ… ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ… ${order.username} ط¨طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨ #${order.id}`);
        } catch (error) {
            console.error('â‌Œ ط®ط·ط£ ظپظٹ ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©:', error);
        }

        // طھط­ط¯ظٹط« ط¥ط­طµط§ط¦ظٹط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
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

// ط¯ط§ظ„ط© ظ…ط³ط§ط¹ط¯ط© ظ„ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ظ†طµ ط­ط§ظ„ط© ط§ظ„ط·ظ„ط¨
function getOrderStatusText(status) {
    const statusMap = {
        'pending': 'ظ‚ظٹط¯ ط§ظ„ط§ظ†طھط¸ط§ط±',
        'processing': 'ظ‚ظٹط¯ ط§ظ„طھظ†ظپظٹط°', 
        'completed': 'ظ…ظƒطھظ…ظ„',
        'rejected': 'ظ…ط±ظپظˆط¶',
        'cancelled': 'ظ…ظ„ط؛ظٹ'
    };
    return statusMap[status] || status;
                  }

    // ط§ظ„ط³ط¬ظ„ط§طھ
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

    // طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ
    if (pathname === '/api/admin/refresh-data' && method === 'POST') {
      try {
        await logAction(username, 'data_refresh', {}, clientIP);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'طھظ… طھط­ط¯ظٹط« ط§ظ„ط¨ظٹط§ظ†ط§طھ ط¨ظ†ط¬ط§ط­',
          refreshed: true
        }));
      } catch (error) {
        console.error('Refresh error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to refresh data' }));
      }
      return;
    }

    // ط¥ط¯ط§ط±ط© ط§ظ„ط®ط¯ظ…ط§طھ
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

    // ==================== ظ†ط¸ط§ظ… ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ====================

// ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
if (pathname === '/api/user/notifications' && method === 'GET') {
    try {
        const user = await User.findOne({ username });
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        const notifications = await Notification.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(20);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(notifications));

    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ' }));
    }
    return;
}

// طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„ط¥ط´ط¹ط§ط± ظƒظ…ظ‚ط±ظˆط،
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
            res.end(JSON.stringify({ error: 'ط§ظ„ط¥ط´ط¹ط§ط± ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
        }
    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط±:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط±' }));
    }
    return;
}


    // ==================== ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ† (ظ„ظ„ط£ط¯ظ…ظ† ظپظ‚ط·) ====================

// ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ط¬ظ…ظٹط¹ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†
if (pathname === '/api/admin/users' && method === 'GET') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const users = await User.find({})
            .select('-password') // ط§ط³طھط¨ط¹ط§ط¯ ظƒظ„ظ…ط© ط§ظ„ط³ط±
            .sort({ createdAt: -1 });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(users));
    } catch (error) {
        console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط³طھط®ط¯ظ…ظٹظ†:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load users' }));
    }
    return;
}

// ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ ظ…ط³طھط®ط¯ظ… ظ…ط¹ظٹظ†
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
        console.error('ط®ط·ط£ ظپظٹ ط¬ظ„ط¨ ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to load user' }));
    }
    return;
}

// طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ…
// طھط­ط¯ظٹط« ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… (ظ…ط¨ط³ط·)
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
        
        console.log('ًں”„ طھط­ط¯ظٹط« ط§ظ„ظ…ط³طھط®ط¯ظ…:', userId, updateData);
        
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID ظ…ط·ظ„ظˆط¨' }));
            return;
        }

        // ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ظ…ط³طھط®ط¯ظ…
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // طھط­ط¯ظٹط« ط§ظ„ط­ظ‚ظˆظ„ ط§ظ„ط£ط³ط§ط³ظٹط©
        if (updateData.username) user.username = updateData.username;
        if (updateData.email) user.email = updateData.email;
        if (updateData.fullName !== undefined) user.fullName = updateData.fullName;
        if (updateData.phone !== undefined) user.phone = updateData.phone;
        if (updateData.balance !== undefined) user.balance = parseFloat(updateData.balance);
        if (updateData.status) user.status = updateData.status;
        if (updateData.balanceFrozen !== undefined) user.balanceFrozen = Boolean(updateData.balanceFrozen);
        
        // ط¥ط°ط§ ظƒط§ظ†طھ ظ‡ظ†ط§ظƒ ظƒظ„ظ…ط© ط³ط± ط¬ط¯ظٹط¯ط©
        if (updateData.newPassword) {
            user.password = await bcrypt.hash(updateData.newPassword, SALT_ROUNDS);
            user.lastPasswordChange = new Date();
        }
        
        user.updatedAt = new Date();
        await user.save();

        // ط¥ط±ط¬ط§ط¹ ط§ظ„ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط­ط¯ط«ط©
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ طھط­ط¯ظٹط« ط§ظ„ظ…ط³طھط®ط¯ظ…:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update user: ' + error.message }));
    }
    return;
}
// طھط¬ظ…ظٹط¯/ظپظƒ طھط¬ظ…ظٹط¯ ط§ظ„ط±طµظٹط¯
// ًں”§ ط¥طµظ„ط§ط­ ظƒط§ظ…ظ„ ظ„طھط¬ظ…ظٹط¯ ط§ظ„ط±طµظٹط¯
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/freeze') && method === 'PUT') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const pathParts = pathname.split('/');
        const userId = pathParts[4]; // /api/admin/users/{id}/freeze
        
        console.log(`ًں”„ طھط¬ظ…ظٹط¯ ط±طµظٹط¯ ط§ظ„ظ…ط³طھط®ط¯ظ…: ${userId}`);
        
        const body = await readBody(req);
        const { freeze, reason } = JSON.parse(body || '{}');
        
        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµط­ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID ظ…ط·ظ„ظˆط¨' }));
            return;
        }

        // ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ظ…ط³طھط®ط¯ظ… ط£ظˆظ„ط§ظ‹ ظ„ظ„طھط£ظƒط¯ ظ…ظ† ظˆط¬ظˆط¯ظ‡
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // طھط­ط¯ظٹط« ط­ط§ظ„ط© ط§ظ„طھط¬ظ…ظٹط¯
        user.balanceFrozen = Boolean(freeze);
        user.freezeReason = reason || '';
        user.updatedAt = new Date();
        
        await user.save();

        await logAction(username, freeze ? 'admin_freeze_balance' : 'admin_unfreeze_balance', { 
            userId: userId,
            reason: reason
        }, clientIP);
        
        // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ…
        await Notification.create({
            userId: user._id,
            type: freeze ? 'warning' : 'info',
            title: freeze ? 'طھظ… طھط¬ظ…ظٹط¯ ط±طµظٹط¯ظƒ' : 'طھظ… ظپظƒ طھط¬ظ…ظٹط¯ ط±طµظٹط¯ظƒ',
            message: reason || (freeze ? 'طھظ… طھط¬ظ…ظٹط¯ ط±طµظٹط¯ظƒ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط¥ط¯ط§ط±ط©' : 'طھظ… ظپظƒ طھط¬ظ…ظٹط¯ ط±طµظٹط¯ظƒ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط¥ط¯ط§ط±ط©'),
            relatedTo: 'balance'
        });

        // ط¥ط±ط¬ط§ط¹ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ط­ط¯ط«ط©
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ طھط¬ظ…ظٹط¯/ظپظƒ طھط¬ظ…ظٹط¯ ط§ظ„ط±طµظٹط¯:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update balance status: ' + error.message }));
    }
    return;
}
// طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط³ط§ط¨
// ًں”§ ط¥طµظ„ط§ط­ ظƒط§ظ…ظ„ ظ„طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط³ط§ط¨
if (pathname.startsWith('/api/admin/users/') && pathname.includes('/status') && method === 'PUT') {
    if (!isAdmin) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Access denied' }));
        return;
    }

    try {
        const pathParts = pathname.split('/');
        const userId = pathParts[4]; // /api/admin/users/{id}/status
        
        console.log(`ًں”„ طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ظ…ط³طھط®ط¯ظ…: ${userId}`);
        
        const body = await readBody(req);
        const { status, reason } = JSON.parse(body || '{}');
        
        // ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† طµط­ط© ط§ظ„ط¨ظٹط§ظ†ط§طھ
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'User ID ظ…ط·ظ„ظˆط¨' }));
            return;
        }

        const validStatuses = ['active', 'suspended', 'banned'];
        if (!validStatuses.includes(status)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط­ط§ظ„ط© ط؛ظٹط± طµط§ظ„ط­ط©' }));
            return;
        }

        // ط§ظ„ط¨ط­ط« ط¹ظ† ط§ظ„ظ…ط³طھط®ط¯ظ… ط£ظˆظ„ط§ظ‹
        const user = await User.findById(userId);
        if (!user) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'ط§ظ„ظ…ط³طھط®ط¯ظ… ط؛ظٹط± ظ…ظˆط¬ظˆط¯' }));
            return;
        }

        // طھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط©
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
        
        // ط¥ط±ط³ط§ظ„ ط¥ط´ط¹ط§ط± ظ„ظ„ظ…ط³طھط®ط¯ظ…
        await Notification.create({
            userId: user._id,
            type: status === 'banned' ? 'error' : 'success',
            title: status === 'banned' ? 'طھظ… ط­ط¸ط± ط­ط³ط§ط¨ظƒ' : 'طھظ… ظپظƒ ط­ط¸ط± ط­ط³ط§ط¨ظƒ',
            message: reason || (status === 'banned' ? 'طھظ… ط­ط¸ط± ط­ط³ط§ط¨ظƒ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط¥ط¯ط§ط±ط©' : 'طھظ… ظپظƒ ط­ط¸ط± ط­ط³ط§ط¨ظƒ ظ…ظ† ظ‚ط¨ظ„ ط§ظ„ط¥ط¯ط§ط±ط©'),
            relatedTo: 'account'
        });

        // ط¥ط±ط¬ط§ط¹ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ظ…ط­ط¯ط«ط©
        const updatedUser = await User.findById(userId).select('-password');
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedUser));
        
    } catch (error) {
        console.error('â‌Œ ط®ط·ط£ ظپظٹ طھط؛ظٹظٹط± ط­ط§ظ„ط© ط§ظ„ط­ط³ط§ط¨:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update user status: ' + error.message }));
    }
    return;
}
    
    // --- ط§ظ„ظ…ط³ط§ط± ط؛ظٹط± ظ…ظˆط¬ظˆط¯ ---
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

// ==================== طھط´ط؛ظٹظ„ ط§ظ„ط³ظٹط±ظپط± ====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ًںڑ€ Server running on http://localhost:${PORT}`));
