require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const { upsertUser, getPendingRequest, createRequest } = require('./db');
const { isTikTokUrl, extractVideoId } = require('./utils');
const texts = require('./texts');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL;
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '10');
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000')
  .split(',')
  .map(n => parseInt(n.trim()));

if (!BOT_TOKEN || !ADMIN_ID || !SITE_URL) {
  throw new Error('Missing env variables');
}

const bot = new Telegraf(BOT_TOKEN);
const session = new Map();

/* Keyboards */
const kbAmount = Markup.inlineKeyboard(
  FREE_OPTIONS.map(n => [Markup.button.callback(`${n} مشاهدة مجاناً`, `AMOUNT_${n}`)])
);

const kbConfirm = Markup.inlineKeyboard([
  [Markup.button.callback('تأكيد الطلب', 'CONFIRM')],
  [Markup.button.callback('إلغاء', 'CANCEL')]
]);

const kbYesNo = Markup.inlineKeyboard([
  [Markup.button.callback('نعم', 'YES')],
  [Markup.button.callback('لا', 'NO')]
]);

const kbSite = Markup.inlineKeyboard([
  [Markup.button.url('زيارة الموقع', SITE_URL)]
]);

/* Start */
bot.start(async ctx => {
  const userId = upsertUser(ctx.from);

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSite);
  }

  session.set(userId, { step: 'amount' });
  ctx.reply(texts.start(ctx, FREE_OPTIONS), kbAmount);
});

/* Choose amount */
bot.action(/^AMOUNT_(\d+)/, async ctx => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  session.set(userId, {
    step: 'link',
    amount: parseInt(ctx.match[1])
  });

  ctx.reply(texts.askLink(ctx));
});

/* Receive link */
bot.on('text', async ctx => {
  const userId = upsertUser(ctx.from);
  const state = session.get(userId);

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    return ctx.reply(texts.blocked(ctx), kbSite);
  }

  if (!state || state.step !== 'link') {
    return ctx.reply('اضغط /start للبدء.');
  }

  if (!isTikTokUrl(ctx.message.text)) {
    return ctx.reply(texts.invalidLink());
  }

  const url = ctx.message.text.trim();
  const videoId = extractVideoId(url);

  session.set(userId, {
    step: 'confirm',
    amount: state.amount,
    url,
    videoId
  });

  ctx.reply(texts.preview(ctx, state.amount, url, videoId), kbConfirm);
});

/* Confirm */
bot.action('CONFIRM', async ctx => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const state = session.get(userId);
  if (!state) return;

  const reqId = createRequest(userId, state.url, state.videoId, state.amount);

  // notify admin
  bot.telegram.sendMessage(
    ADMIN_ID,
    `طلب جديد 🔔
ID: ${reqId}
User: ${ctx.from.first_name}
Username: @${ctx.from.username || 'N/A'}
Link: ${state.url}
Amount: ${state.amount}`
  );

  session.delete(userId);
  ctx.reply(texts.confirmed(ctx), kbYesNo);
});

/* Upsell */
bot.action('YES', ctx => {
  ctx.answerCbQuery();
  ctx.reply('تفضل الموقع 👇', kbSite);
});

bot.action('NO', ctx => {
  ctx.answerCbQuery();
  ctx.reply(texts.upsell(ctx), kbSite);
});

/* Cancel */
bot.action('CANCEL', ctx => {
  ctx.answerCbQuery();
  session.delete(String(ctx.from.id));
  ctx.reply('تم الإلغاء. إذا حابب نعيد، اضغط /start');
});

bot.launch();
console.log('Bot is running');
