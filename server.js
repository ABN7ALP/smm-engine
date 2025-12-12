// server.js
require('dotenv').config();
const TelegramBot = require("node-telegram-bot-api");
const sitesConfig = require("./config/sites.json");
const connectDB = require("./db");

// لا تقم بتفعيل وضع الاختبار الآن
const IS_TEST_MODE = false;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
bot.on('polling_error', (error) => console.log(error.code));

// استيراد المراقب العام الجديد
const startSiteWatcher = require("./watchers/site-watcher");

if (IS_TEST_MODE) {
    // ... (كود الاختبار يبقى كما هو)
} else {
    connectDB().then(() => {
        bot.sendMessage(CHAT_ID, "✔️ البوت اشتغل ورابط مع السيرفر وقاعدة البيانات بنجاح!");

        console.log("🚀 Starting watchers for all configured sites...");

        // حلقة المرور على كل المواقع في ملف الإعدادات
        for (const siteName in sitesConfig) {
            const config = sitesConfig[siteName];
            
            // جلب مفتاح الـ API من متغيرات البيئة
            const apiKey = process.env[config.keyEnvVar];

            if (!apiKey) {
                console.error(`API key for ${siteName} (${config.keyEnvVar}) is not defined! Skipping.`);
                bot.sendMessage(CHAT_ID, `❌ لم يتم العثور على مفتاح API للموقع ${siteName}. سيتم تخطيه.`);
                continue; // انتقل للموقع التالي
            }

            // إسناد المفتاح إلى الإعدادات
            config.key = apiKey;

            // تشغيل مراقب لهذا الموقع
            startSiteWatcher(siteName, config, bot, CHAT_ID);
        }

    }).catch(err => {
        console.error("Application failed to start", err);
        bot.sendMessage(CHAT_ID, "❌ فشل تشغيل البوت! لا يمكن الاتصال بقاعدة البيانات.");
    });
}
