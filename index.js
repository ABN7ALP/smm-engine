require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { initDb } = require('./db');
const {
  startPitch,
  pendingMsg,
  askUrlMsg,
  invalidUrlMsg,
  previewMsg,
  afterConfirmMsg,
  upsellNoMsg,
  blockedNewUrlMsg
} = require('./texts');
const { isTikTokUrl, normalizeUrl, extractVideoKey } = require('./utils');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL || 'https://example.com';
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000')
  .split(',')
  .map(x => parseInt(x.trim(), 10))
  .filter(n => Number.isFinite(n));
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '10', 10);

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
if (!ADMIN_TELEGRAM_ID) throw new Error('Missing ADMIN_TELEGRAM_ID');

const bot = new Telegraf(BOT_TOKEN);
const db = initDb();

// جلسة بسيطة داخل الذاكرة لاختيار الكمية قبل الرابط
// (على Railway غالباً instance واحدة. لو بدك multi-instance نعملها DB session)
const mem = new Map(); // telegram_id => { chosenAmount, awaitingUrl, awaitingConfirm, lastPreview: {url, key} }

function now() { return Date.now(); }

function upsertUser(ctx) {
  const telegramId = String(ctx.from.id);
  const firstName = ctx.from.first_name || '';
  const username = ctx.from.username || '';

  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, first_name, username, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name=excluded.first_name,
      username=excluded.username,
      last_seen_at=excluded.last_seen_at
  `);
  stmt.run(telegramId, firstName, username, now());
  return telegramId;
}

function getPendingRequest(telegramId) {
  const since = now() - PENDING_MINUTES * 60 * 1000;
  const stmt = db.prepare(`
    SELECT * FROM requests
    WHERE telegram_id=? AND status='pending' AND created_at>=?
    ORDER BY id DESC LIMIT 1
  `);
  return stmt.get(telegramId, since);
}

function createRequest(telegramId, url, key, amount) {
  const ts = now();
  const stmt = db.prepare(`
    INSERT INTO requests (telegram_id, video_url, video_key, amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `);
  const info = stmt.run(telegramId, url, key, amount, ts, ts);
  return info.lastInsertRowid;
}

function cancelPending(telegramId) {
  const ts = now();
  const stmt = db.prepare(`
    UPDATE requests SET status='cancelled', updated_at=?
    WHERE telegram_id=? AND status='pending'
  `);
  stmt.run(ts, telegramId);
}

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`500 مشاهدة مجاناً`, 'AMOUNT_500')],
    [Markup.button.callback(`1000 مشاهدة مجاناً`, 'AMOUNT_1000')]
  ]);
}

function yesNoKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('نعم', 'YES_MORE')],
    [Markup.button.callback('لا', 'NO_MORE')]
  ]);
}

function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تأكيد', 'CONFIRM')],
    [Markup.button.callback('إلغاء', 'CANCEL')]
  ]);
}

function siteKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.url('افتح الموقع', SITE_URL)]
  ]);
}

bot.start(async (ctx) => {
  const telegramId = upsertUser(ctx);

  const pending = getPendingRequest(telegramId);
  if (pending) {
    await ctx.reply(pendingMsg(ctx, PENDING_MINUTES), siteKeyboard());
    return;
  }

  mem.set(telegramId, { chosenAmount: null, awaitingUrl: false, awaitingConfirm: false, lastPreview: null });

  await ctx.reply(
    `اختار كمية المشاهدات المجانية أولاً:`,
    mainMenuKeyboard()
  );
});

bot.action(/^AMOUNT_(\d+)$/, async (ctx) => {
  const telegramId = upsertUser(ctx);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(telegramId);
  if (pending) {
    await ctx.reply(pendingMsg(ctx, PENDING_MINUTES), siteKeyboard());
    return;
  }

  const amount = parseInt(ctx.match[1], 10);
  const state = mem.get(telegramId) || {};
  state.chosenAmount = amount;
  state.awaitingUrl = true;
  state.awaitingConfirm = false;
  state.lastPreview = null;
  mem.set(telegramId, state);

  await ctx.reply(askUrlMsg(ctx));
});

bot.on('text', async (ctx) => {
  const telegramId = upsertUser(ctx);
  const text = (ctx.message.text || '').trim();

  // إذا فيه طلب pending: امنع إرسال روابط جديدة
  const pending = getPendingRequest(telegramId);
  if (pending) {
    // لو حاول يرسل رابط أو أي شيء، أعطيه رسالة ودية + الموقع
    await ctx.reply(blockedNewUrlMsg(ctx), siteKeyboard());
    return;
  }

  const state = mem.get(telegramId);
  if (!state || !state.awaitingUrl) {
    // إذا كتب بدون تسلسل، ارجعه لاختيار الكمية
    await ctx.reply(`ابدأ من هون: اختار كمية المشاهدات المجانية.`, mainMenuKeyboard());
    return;
  }

  // تحقق الرابط
  if (!isTikTokUrl(text)) {
    await ctx.reply(invalidUrlMsg(ctx));
    return;
  }

  const url = normalizeUrl(text);
  const key = extractVideoKey(url);

  state.awaitingUrl = false;
  state.awaitingConfirm = true;
  state.lastPreview = { url, key };
  mem.set(telegramId, state);

  await ctx.reply(previewMsg(ctx, state.chosenAmount, url, key), confirmKeyboard());
});

bot.action('CANCEL', async (ctx) => {
  const telegramId = upsertUser(ctx);
  await ctx.answerCbQuery();

  cancelPending(telegramId); // احتياط
  mem.delete(telegramId);

  await ctx.reply(`تمام، تم إلغاء العملية. إذا بدك نعيد من جديد اضغط /start`);
});

bot.action('CONFIRM', async (ctx) => {
  const telegramId = upsertUser(ctx);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(telegramId);
  if (pending) {
    await ctx.reply(pendingMsg(ctx, PENDING_MINUTES), siteKeyboard());
    return;
  }

  const state = mem.get(telegramId);
  if (!state || !state.awaitingConfirm || !state.lastPreview) {
    await ctx.reply(`صار لخبطة بسيطة. اضغط /start ونعيدها بسرعة.`);
    return;
  }

  const { url, key } = state.lastPreview;
  const amount = state.chosenAmount || FREE_OPTIONS[0];

  const requestId = createRequest(telegramId, url, key, amount);

  // أرسل للآدمن
  const u = ctx.from;
  const adminMsg =
`طلب جديد (ID: ${requestId})
المستخدم: ${u.first_name || ''} ${u.last_name || ''}
username: @${u.username || 'N/A'}
telegram_id: ${u.id}

الرابط: ${url}
video_id: ${key || 'N/A'}
الكمية: ${amount}
الوقت: ${new Date().toISOString()}
`;
  await ctx.telegram.sendMessage(ADMIN_TELEGRAM_ID, adminMsg);

  // رد للمستخدم + سؤال upsell
  mem.set(telegramId, { chosenAmount: null, awaitingUrl: false, awaitingConfirm: false, lastPreview: null });

  await ctx.reply(afterConfirmMsg(ctx), yesNoKeyboard());
});

bot.action('YES_MORE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`تمام. هذا رابط الموقع وفيه عروض وطلبات أكثر:`, siteKeyboard());
});

bot.action('NO_MORE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(upsellNoMsg(ctx), Markup.inlineKeyboard([
    [Markup.button.callback('نعم ابعت الرابط', 'SEND_SITE')],
    [Markup.button.callback('مو هلق', 'CLOSE')]
  ]));
});

bot.action('SEND_SITE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`تفضل:`, siteKeyboard());
});

bot.action('CLOSE', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`تمام. بأي وقت بدك ترجع اضغط /start.`);
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

bot.launch().then(() => {
  console.log('Bot started.');
});

// إيقاف نظيف
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
