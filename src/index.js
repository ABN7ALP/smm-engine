require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { upsertUser, getPendingRequest, createRequest } = require('./db');

// ================== الإعدادات ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL || 'https://example.com';
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '10', 10);
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000')
  .split(',')
  .map(n => parseInt(n.trim(), 10))
  .filter(Boolean);

if (!BOT_TOKEN) throw new Error('BOT_TOKEN missing');
if (!ADMIN_TELEGRAM_ID) throw new Error('ADMIN_TELEGRAM_ID missing');

const bot = new Telegraf(BOT_TOKEN);

// ================== جلسة خفيفة ==================
const sessions = new Map();
// telegramId => { step, amount, url, videoId }

// ================== أدوات ==================
function nameOf(ctx) {
  return ctx.from?.first_name || 'صاحبي';
}

function isTikTokUrl(text) {
  return text.includes('tiktok.com');
}

function extractVideoId(url) {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}

// ================== لوحات ==================
const amountKeyboard = Markup.inlineKeyboard(
  FREE_OPTIONS.map(n => [Markup.button.callback(`${n} مشاهدة مجاناً`, `AMOUNT_${n}`)])
);

const confirmKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('أكيد، نفّذ الطلب', 'CONFIRM')],
  [Markup.button.callback('إلغاء', 'CANCEL')]
]);

const yesNoKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('نعم أكيد', 'YES_MORE')],
  [Markup.button.callback('لا شكراً', 'NO_MORE')]
]);

const siteKeyboard = Markup.inlineKeyboard([
  [Markup.button.url('الدخول إلى الموقع 🚀', SITE_URL)]
]);

// ================== /start ==================
bot.start(async (ctx) => {
  const telegramId = upsertUser(ctx.from);

  const pending = getPendingRequest(telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(
      `يا ${nameOf(ctx)}، طلبك السابق لسه قيد التنفيذ ⏳\n` +
      `خلّينا نخلصه أول وبعدين نكمل براحتنا.\n\n` +
      `إذا حابب نتائج أسرع وكميات أكبر، الموقع مفتوح قدامك 👇`,
      siteKeyboard
    );
    return;
  }

  sessions.set(telegramId, { step: 'choose_amount' });

  await ctx.reply(
    `أهلاً يا ${nameOf(ctx)} 👋\n\n` +
    `حابب تكبر فيديوهاتك على تيك توك؟\n` +
    `نقدملك تجربة حقيقية 👌\n\n` +
    `اختار كمية مشاهدات *مجاناً* كبداية:`,
    { parse_mode: 'Markdown', ...amountKeyboard }
  );
});

// ================== اختيار الكمية ==================
bot.action(/^AMOUNT_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = upsertUser(ctx.from);

  const pending = getPendingRequest(telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(
      `لسه في طلب شغال يا ${nameOf(ctx)} 😉\n` +
      `لو بدك أكثر من طلب بنفس الوقت، الموقع هو الحل.`,
      siteKeyboard
    );
    return;
  }

  const amount = parseInt(ctx.match[1], 10);
  sessions.set(telegramId, { step: 'wait_url', amount });

  await ctx.reply(
    `تمام 👌\n\n` +
    `أرسل رابط فيديو تيك توك الآن،\n` +
    `وسأعرض لك التفاصيل قبل التنفيذ.`
  );
});

// ================== استقبال الرابط ==================
bot.on('text', async (ctx) => {
  const telegramId = upsertUser(ctx.from);
  const session = sessions.get(telegramId);

  const pending = getPendingRequest(telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(
      `خلّينا نكون أذكى يا ${nameOf(ctx)} 😄\n` +
      `طلبك الحالي شغال.\n` +
      `لو حابب توسّع شغلك، الموقع يعطيك حرية أكبر.`,
      siteKeyboard
    );
    return;
  }

  if (!session || session.step !== 'wait_url') {
    await ctx.reply(`ابدأ من هنا 👇`, amountKeyboard);
    return;
  }

  const url = ctx.message.text.trim();

  if (!isTikTokUrl(url)) {
    await ctx.reply(
      `الرابط ما شكله تيك توك 🤔\n` +
      `أرسل رابط مثل:\nhttps://www.tiktok.com/@user/video/123456`
    );
    return;
  }

  const videoId = extractVideoId(url);

  sessions.set(telegramId, {
    ...session,
    step: 'confirm',
    url,
    videoId
  });

  await ctx.reply(
    `🔥 تمام، هذه تفاصيل الطلب:\n\n` +
    `🎬 الفيديو: ${url}\n` +
    `🆔 المعرف: ${videoId || 'غير ظاهر'}\n` +
    `👁 المشاهدات: ${session.amount}\n` +
    `⏱ التنفيذ: خلال 5–10 دقائق\n\n` +
    `ننفّذ؟`,
    confirmKeyboard
  );
});

// ================== تأكيد ==================
bot.action('CONFIRM', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = upsertUser(ctx.from);
  const session = sessions.get(telegramId);

  if (!session || session.step !== 'confirm') {
    await ctx.reply(`صار خطأ بسيط، نعيد من البداية /start`);
    return;
  }

  const requestId = createRequest(
    telegramId,
    session.url,
    session.videoId,
    session.amount
  );

  // إشعار الأدمن
  await ctx.telegram.sendMessage(
    ADMIN_TELEGRAM_ID,
    `🚀 طلب جديد\n\n` +
    `👤 المستخدم: ${ctx.from.first_name}\n` +
    `🆔 Telegram ID: ${telegramId}\n\n` +
    `🎬 الرابط: ${session.url}\n` +
    `👁 الكمية: ${session.amount}\n` +
    `🧾 الطلب #: ${requestId}`
  );

  sessions.delete(telegramId);

  await ctx.reply(
    `تم التنفيذ يا ${nameOf(ctx)} ✅\n\n` +
    `طلبك دخل النظام، وخلال دقائق بتشوف النتيجة 👀\n\n` +
    `حابب تكمل وتكبر أكثر؟`,
    yesNoKeyboard
  );
});

// ================== إلغاء ==================
bot.action('CANCEL', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = String(ctx.from.id);
  sessions.delete(telegramId);
  await ctx.reply(`تمام 👍\nلو حابب نرجع، اضغط /start`);
});

// ================== تسويق ذكي ==================
bot.action('YES_MORE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `🔥 اختيار ذكي\n\n` +
    `في الموقع عندك:\n` +
    `• مشاهدات أكبر\n` +
    `• لايكات\n` +
    `• متابعين\n` +
    `• عروض مجانية أحياناً\n\n` +
    `ادخل وشوف بنفسك 👇`,
    siteKeyboard
  );
});

bot.action('NO_MORE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `ولا يهمك 👌\n\n` +
    `بس حابب ألفت نظرك:\n` +
    `في عروض مجانية لبعض خدمات تيك توك بالموقع.\n\n` +
    `تحب أبعث الرابط؟`,
    Markup.inlineKeyboard([
      [Markup.button.callback('ابعت الرابط', 'SEND_SITE')],
      [Markup.button.callback('لاحقاً', 'CLOSE')]
    ])
  );
});

bot.action('SEND_SITE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`تفضل 🚀`, siteKeyboard);
});

bot.action('CLOSE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`تمام 👍 بأي وقت حابب ترجع اضغط /start`);
});

// ================== تشغيل ==================
bot.launch();
console.log('Telegram bot is running...');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
