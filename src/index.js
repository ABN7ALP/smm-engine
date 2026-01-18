require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { makePool, migrate, upsertUser, getPending, createRequest, setRequestStatus } = require('./db');
const { checkRateLimit, checkCooldown, markFreeUsed } = require('./services/antiAbuse');
const { isTikTokUrl, extractVideoKey, resolveRedirect } = require('./services/tiktok');
const { msg, humanMs } = require('./ui/texts');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL || 'https://example.com';
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000').split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '10', 10);
const COOLDOWN_HOURS = parseInt(process.env.COOLDOWN_HOURS || '24', 10);
const MAX_MSG_PER_MIN = parseInt(process.env.MAX_MSG_PER_MIN || '12', 10);

if (!BOT_TOKEN) throw new Error('Missing BOT_TOKEN');
if (!ADMIN_TELEGRAM_ID) throw new Error('Missing ADMIN_TELEGRAM_ID');

const bot = new Telegraf(BOT_TOKEN);
const pool = makePool();

// session خفيف بالذاكرة للحالات
const session = new Map(); // id -> { step, amount, url, key }

function kbChooseAmount() {
  return Markup.inlineKeyboard(FREE_OPTIONS.map(n => [Markup.button.callback(`${n} مشاهدة مجاناً`, `AMOUNT_${n}`)]));
}
function kbConfirm() {
  return Markup.inlineKeyboard([[Markup.button.callback('تأكيد', 'CONFIRM'), Markup.button.callback('إلغاء', 'CANCEL')]]);
}
function kbYesNo() {
  return Markup.inlineKeyboard([[Markup.button.callback('نعم', 'YES_MORE'), Markup.button.callback('لا', 'NO_MORE')]]);
}
function kbSite() {
  return Markup.inlineKeyboard([[Markup.button.url('افتح الموقع', SITE_URL)]]);
}

async function guard(ctx) {
  const telegramId = await upsertUser(pool, ctx.from);

  const rl = await checkRateLimit(pool, telegramId, MAX_MSG_PER_MIN);
  if (!rl.ok) {
    await ctx.reply(msg.rateLimited(ctx, humanMs(rl.waitMs)));
    return { ok: false, telegramId };
  }
  return { ok: true, telegramId };
}

bot.start(async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;

  const pending = await getPending(pool, g.telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(msg.pending(ctx, PENDING_MINUTES), kbSite());
    return;
  }

  // cooldown يومي للهدايا
  const cd = await checkCooldown(pool, g.telegramId, COOLDOWN_HOURS);
  if (!cd.ok) {
    await ctx.reply(msg.cooldown(ctx, humanMs(cd.remainingMs)), kbSite());
    return;
  }

  session.set(g.telegramId.toString(), { step: 'choose_amount', amount: null, url: null, key: null });
  await ctx.reply(msg.chooseAmount(ctx, FREE_OPTIONS), kbChooseAmount());
});

bot.action(/^AMOUNT_(\d+)$/, async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();

  const pending = await getPending(pool, g.telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(msg.pending(ctx, PENDING_MINUTES), kbSite());
    return;
  }

  const cd = await checkCooldown(pool, g.telegramId, COOLDOWN_HOURS);
  if (!cd.ok) {
    await ctx.reply(msg.cooldown(ctx, humanMs(cd.remainingMs)), kbSite());
    return;
  }

  const amount = parseInt(ctx.match[1], 10);
  session.set(g.telegramId.toString(), { step: 'await_url', amount, url: null, key: null });
  await ctx.reply(msg.sendUrl(ctx));
});

bot.on('text', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;

  const pending = await getPending(pool, g.telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(msg.blockedNew(ctx), kbSite());
    return;
  }

  const s = session.get(g.telegramId.toString());
  if (!s || s.step !== 'await_url') {
    await ctx.reply(`اضغط /start ونمشيها خطوة خطوة.`, kbChooseAmount());
    return;
  }

  const raw = (ctx.message.text || '').trim();
  if (!isTikTokUrl(raw)) {
    await ctx.reply(msg.invalidUrl());
    return;
  }

  // resolve redirect لتقوية دعم vt/vm
  const resolved = await resolveRedirect(raw, 3);
  const key = extractVideoKey(resolved);

  session.set(g.telegramId.toString(), { ...s, step: 'await_confirm', url: resolved, key });
  await ctx.reply(msg.preview(ctx, s.amount, resolved, key), kbConfirm());
});

bot.action('CANCEL', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();
  session.delete(g.telegramId.toString());
  await ctx.reply(`تمام يا صاحبي. إذا بدك نرجع من البداية اضغط /start.`);
});

bot.action('CONFIRM', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();

  const pending = await getPending(pool, g.telegramId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(msg.pending(ctx, PENDING_MINUTES), kbSite());
    return;
  }

  const cd = await checkCooldown(pool, g.telegramId, COOLDOWN_HOURS);
  if (!cd.ok) {
    await ctx.reply(msg.cooldown(ctx, humanMs(cd.remainingMs)), kbSite());
    return;
  }

  const s = session.get(g.telegramId.toString());
  if (!s || s.step !== 'await_confirm' || !s.url || !s.amount) {
    await ctx.reply(`صار عدم تطابق بسيط. اضغط /start ونعيدها بسرعة.`);
    return;
  }

  const requestId = await createRequest(pool, g.telegramId, s.url, s.key, s.amount);
  await markFreeUsed(pool, g.telegramId);

  // رسالة للأدمن + زر تم التنفيذ
  const adminText =
`طلب جديد رقم: ${requestId}
المستخدم: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
username: @${ctx.from.username || 'N/A'}
telegram_id: ${ctx.from.id}

الرابط: ${s.url}
video_id: ${s.key || 'N/A'}
الكمية: ${s.amount}
`;
  const adminKb = Markup.inlineKeyboard([
    [Markup.button.callback(`تم التنفيذ ✅ (${requestId})`, `ADMIN_DONE_${requestId}`)],
    [Markup.button.callback(`إلغاء الطلب ⛔ (${requestId})`, `ADMIN_CANCEL_${requestId}`)]
  ]);

  await ctx.telegram.sendMessage(ADMIN_TELEGRAM_ID, adminText, adminKb);

  session.set(g.telegramId.toString(), { step: 'idle', amount: null, url: null, key: null });
  await ctx.reply(msg.confirmed(ctx), kbYesNo());
});

bot.action('YES_MORE', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();
  await ctx.reply(`تمام. هذا رابط الموقع (فيه عروض وطلبات أكثر):`, kbSite());
});

bot.action('NO_MORE', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();
  await ctx.reply(`ولا يهمك. بس تذكير سريع: في عروض مجانية على بعض خدمات تيك توك بالموقع.\nبدك أبعت الرابط؟`,
    Markup.inlineKeyboard([
      [Markup.button.callback('نعم ابعت', 'SEND_SITE')],
      [Markup.button.callback('مو هلق', 'CLOSE')]
    ])
  );
});

bot.action('SEND_SITE', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();
  await ctx.reply(`تفضل:`, kbSite());
});

bot.action('CLOSE', async (ctx) => {
  const g = await guard(ctx);
  if (!g.ok) return;
  await ctx.answerCbQuery();
  await ctx.reply(`تمام. بأي وقت بدك ترجع اضغط /start.`);
});

// أزرار الأدمن (داخل تيليجرام)
bot.action(/^ADMIN_DONE_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (String(ctx.from.id) !== String(ADMIN_TELEGRAM_ID)) return;

  const id = ctx.match[1];
  await setRequestStatus(pool, id, 'done');
  await ctx.reply(`تم تحويل الطلب ${id} إلى DONE.`);
});

bot.action(/^ADMIN_CANCEL_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (String(ctx.from.id) !== String(ADMIN_TELEGRAM_ID)) return;

  const id = ctx.match[1];
  await setRequestStatus(pool, id, 'cancelled');
  await ctx.reply(`تم إلغاء الطلب ${id}.`);
});

bot.catch((e) => console.error('bot error', e));

(async () => {
  await migrate(pool);
  await bot.launch();
  console.log('Bot running');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
