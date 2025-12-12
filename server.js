const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");
const sitesConfig = require("./config/sites.json");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const startUcuzWatcher = require("./watchers/ucuzpanel");

// شغّل الموقع الرئيسي
startUcuzWatcher(sitesConfig.ucuzpanel, bot, CHAT_ID);

console.log("🚀 Service Watcher Running…");
