// server.js
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const sitesConfig = require("./config/sites.json");
const connectDB = require("./db"); // استيراد دالة الاتصال

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
sitesConfig.ucuzpanel.key = process.env.UCUZ_KEY;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// تأكد من الاتصال بقاعدة البيانات قبل بدء المراقب
connectDB().then(() => {
    bot.sendMessage(CHAT_ID, "✔️ البوت اشتغل ورابط مع السيرفر وقاعدة البيانات بنجاح!");

    const startUcuzWatcher = require("./watchers/ucuzpanel");

    // شغّل الموقع الرئيسي
    startUcuzWatcher(sitesConfig.ucuzpanel, bot, CHAT_ID);

    console.log("🚀 Service Watcher Running…");
}).catch(err => {
    console.error("Application failed to start", err);
    bot.sendMessage(CHAT_ID, "❌ فشل تشغيل البوت! لا يمكن الاتصال بقاعدة البيانات.");
});
