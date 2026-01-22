require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const db = require('./db');
const texts = require('./texts');
const { isTikTokUrl, extractVideoId, formatCountdown, parseStartRef } = require('./utils');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL;

const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000')
  .split(',')
  .map(n => parseInt(n.trim(), 10))
  .filter(Number.isFinite);

const COUNTDOWN_MINUTES = parseInt(process.env.COUNTDOWN_MINUTES || '15', 10);
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || String(COUNTDOWN_MINUTES), 10);

if (!BOT_TOKEN || !ADMIN_ID || !SITE_URL) {
  throw new Error('Missing env variables: BOT_TOKEN / ADMIN_TELEGRAM_ID / SITE_URL');
}

const bot = new Telegraf(BOT_TOKEN);

// Session in-memory: userId -> state
const session = new Map();

// Countdown timers in-memory: userId -> { intervalId, chatId, messageId, endsAt }
const countdowns = new Map();

function inviteLinkFor(userId) {
  const username = bot.botInfo?.username; // بعد launch يتوفر
  if (!username) return `رابط الدعوة سيتم تفعيله بعد تشغيل البوت.`;
  return `https://t.me/${username}?start=ref_${userId}`;
}

function kbSite() {
  return Markup.inlineKeyboard([[Markup.button.url('زيارة الموقع الرسمي', SITE_URL)]]);
}

function kbChooseFreeAmount() {
  return Markup.inlineKeyboard(
    FREE_OPTIONS.map(n => [Markup.button.callback(`${n} مشاهدة مجاناً`, `FREE_${n}`)])
  );
}

function kbChooseBonus() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('5000 مشاهدة مكافأة', 'BONUS_5000')],
    [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)]
  ]);
}

function kbConfirm() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تأكيد الطلب', 'CONFIRM')],
    [Markup.button.callback('إلغاء', 'CANCEL')]
  ]);
}

function kbAfterConfirm(userId) {
  const link = inviteLinkFor(userId);
  return Markup.inlineKeyboard([
    [Markup.button.url('الموقع الرسمي', SITE_URL)],
    [Markup.button.url('رابط دعوتي', link)]
  ]);
}

function stopCountdown(userId) {
  const key = String(userId);
  const c = countdowns.get(key);
  if (c?.intervalId) clearInterval(c.intervalId);
  countdowns.delete(key);
}

async function startCountdown(ctx, userId) {
  // إيقاف أي عداد سابق
  stopCountdown(userId);

  const chatId = ctx.chat.id;
  const endsAt = Date.now() + COUNTDOWN_MINUTES * 60 * 1000;

  const sent = await ctx.reply(`⏳ المتابعة: ${formatCountdown(endsAt - Date.now())}\nسأحدثه تلقائياً لمدة ${COUNTDOWN_MINUTES} دقيقة.`);

  const messageId = sent.message_id;

  const intervalId = setInterval(async () => {
    const remain = endsAt - Date.now();
    if (remain <= 0) {
      try {
        await ctx.telegram.editMessageText(
          chatId,
          messageId,
          undefined,
          `✅ انتهت مدة المتابعة.\nإذا احتجت كميات أكبر أو عروض، الموقع الرسمي أفضل.\n${SITE_URL}`
        );
      } catch {}
      stopCountdown(userId);
      return;
    }

    // تحديث كل 20 ثانية تقريباً (مقبول + لا يضغط على تيليجرام بقوة)
    try {
      await ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        `⏳ المتابعة: ${formatCountdown(remain)}\nالطلب قيد التنفيذ.`
      );
    } catch {
      // إذا فشل edit (مثلاً المستخدم حذف الرسالة) نوقف حتى لا نستهلك موارد
      stopCountdown(userId);
    }
  }, 20_000);

  countdowns.set(String(userId), { intervalId, chatId, messageId, endsAt });
}

// /start handler
bot.start(async (ctx) => {
  const userId = db.upsertUser(ctx.from);

  // Capture referral start payload
  const payload = ctx.startPayload ? String(ctx.startPayload).trim() : '';
  const referrerId = parseStartRef(payload);
  if (referrerId) {
    // سجل بداية الدعوة (إن لم يكن مسجلاً سابقاً)
    db.recordReferralStart(referrerId, userId);
  }

  // إذا في طلب pending
  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    const inviteLink = inviteLinkFor(userId);
    await ctx.reply(texts.pending(ctx, PENDING_MINUTES, SITE_URL), Markup.inlineKeyboard([
      [Markup.button.url('الموقع الرسمي', SITE_URL)],
      [Markup.button.url('رابط دعوتي', inviteLink)]
    ]));
    return;
  }

  const user = db.getUser(userId);
  const inviteLink = inviteLinkFor(userId);

  // إذا أول مرة: عرض مجاني
  if (user.free_used === 0) {
    session.set(userId, { step: 'choose_amount', kind: 'free', amount: null, url: null, videoId: null });
    await ctx.reply(texts.startFree(ctx, FREE_OPTIONS), kbChooseFreeAmount());
    return;
  }

  // إذا عنده مكافآت دعوة
  if ((user.bonus_tokens || 0) > 0) {
    session.set(userId, { step: 'choose_amount', kind: 'bonus', amount: 5000, url: null, videoId: null });
    await ctx.reply(texts.startAfterFreeHasBonus(ctx, user.bonus_tokens, SITE_URL, inviteLink), kbChooseBonus());
    return;
  }

  // لا مجاني ولا مكافآت: ترويج + دعوات
  await ctx.reply(texts.startAfterFreeNoBonus(ctx, SITE_URL, inviteLink), Markup.inlineKeyboard([
    [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
    [Markup.button.url('رابط دعوتي', inviteLink)]
  ]));
});

// اختيار مجاني
bot.action(/^FREE_(\d+)$/, async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSite());
    return;
  }

  const user = db.getUser(userId);
  if (user.free_used !== 0) {
    const inviteLink = inviteLinkFor(userId);
    await ctx.reply(texts.startAfterFreeNoBonus(ctx, SITE_URL, inviteLink), Markup.inlineKeyboard([
      [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
      [Markup.button.url('رابط دعوتي', inviteLink)]
    ]));
    return;
  }

  const amount = parseInt(ctx.match[1], 10);
  session.set(userId, { step: 'await_link', kind: 'free', amount, url: null, videoId: null });
  await ctx.reply(texts.askLink(ctx));
});

// اختيار مكافأة 5000
bot.action('BONUS_5000', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSite());
    return;
  }

  const user = db.getUser(userId);
  if ((user.bonus_tokens || 0) <= 0) {
    const inviteLink = inviteLinkFor(userId);
    await ctx.reply(texts.startAfterFreeNoBonus(ctx, SITE_URL, inviteLink), Markup.inlineKeyboard([
      [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
      [Markup.button.url('رابط دعوتي', inviteLink)]
    ]));
    return;
  }

  session.set(userId, { step: 'await_link', kind: 'bonus', amount: 5000, url: null, videoId: null });
  await ctx.reply(texts.askLink(ctx));
});

// استقبال الرابط
bot.on('text', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  const state = session.get(userId);

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSite());
    return;
  }

  if (!state || state.step !== 'await_link') {
    await ctx.reply(`ابدأ من /start حتى نمشيها خطوة خطوة.`);
    return;
  }

  const text = (ctx.message.text || '').trim();
  if (!isTikTokUrl(text)) {
    await ctx.reply(texts.invalidLink());
    return;
  }

  const url = text;
  const videoId = extractVideoId(url);

  session.set(userId, { ...state, step: 'await_confirm', url, videoId });

  await ctx.reply(
    texts.preview(ctx, state.amount, url, videoId),
    kbConfirm()
  );
});

// تأكيد الطلب
bot.action('CONFIRM', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.pending(ctx, PENDING_MINUTES, SITE_URL), kbSite());
    return;
  }

  const state = session.get(userId);
  if (!state || state.step !== 'await_confirm' || !state.url) {
    await ctx.reply(`صار خلل بسيط. اضغط /start ونعيدها بسرعة.`);
    return;
  }

  // تحقّق من أهلية النوع
  const user = db.getUser(userId);

  if (state.kind === 'free' && user.free_used !== 0) {
    const inviteLink = inviteLinkFor(userId);
    await ctx.reply(texts.startAfterFreeNoBonus(ctx, SITE_URL, inviteLink), Markup.inlineKeyboard([
      [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
      [Markup.button.url('رابط دعوتي', inviteLink)]
    ]));
    session.delete(userId);
    return;
  }

  if (state.kind === 'bonus' && (user.bonus_tokens || 0) <= 0) {
    const inviteLink = inviteLinkFor(userId);
    await ctx.reply(texts.startAfterFreeNoBonus(ctx, SITE_URL, inviteLink), Markup.inlineKeyboard([
      [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
      [Markup.button.url('رابط دعوتي', inviteLink)]
    ]));
    session.delete(userId);
    return;
  }

  // هل هذا أول طلب للمستخدم قبل الإدخال؟ (لاستخدامه بتأهيل referral)
  const hadAnyBefore = db.hasAnyRequest(userId);

  const reqId = db.createRequest(userId, state.url, state.videoId, state.amount, state.kind);

  // تحديث حالة المستخدم حسب نوع الطلب
  if (state.kind === 'free') {
    db.setFreeUsed(userId);
  } else if (state.kind === 'bonus') {
    db.consumeBonusToken(userId);
  }

  // إشعار الأدمن بطلب جديد + تفاصيل
  const adminMsg =
`طلب جديد
ID: ${reqId}
نوع: ${state.kind === 'free' ? 'مجاني' : 'مكافأة 5000'}
المستخدم: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
username: @${ctx.from.username || 'N/A'}
telegram_id: ${ctx.from.id}

الرابط: ${state.url}
video_id: ${state.videoId || 'N/A'}
الكمية: ${state.amount}
`;
  await bot.telegram.sendMessage(ADMIN_ID, adminMsg);

  // إذا المستخدم كان مدعو (referral موجود) وهذا أول طلب له: نؤهل الدعوة
  // (خيار A: النجاح عند أول طلب مؤكد للمدعو)
  if (!hadAnyBefore) {
    const r = db.getReferralByReferredId(userId);
    if (r && r.qualified === 0) {
      db.qualifyReferral(r.id);
      db.addBonusToken(r.referrer_id, 1);

      // إشعار الأدمن بنجاح الدعوة
      const refAdminMsg =
`نجاح دعوة ✅
الداعي: ${r.referrer_id}
المدعو: ${userId}

تفاصيل المدعو:
الاسم: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
username: @${ctx.from.username || 'N/A'}

مكافأة الداعي: +5000 (توكن واحد)
`;
      await bot.telegram.sendMessage(ADMIN_ID, refAdminMsg);

      // إشعار الداعي نفسه
      const refUser = db.getUser(r.referrer_id);
      const tokensNow = refUser ? (refUser.bonus_tokens || 0) : null;

      try {
        await bot.telegram.sendMessage(
          r.referrer_id,
          texts.referralSuccessToReferrer({ from: { first_name: refUser?.first_name || 'صديقنا' } }, tokensNow ?? 1)
        );
      } catch {
        // إذا الداعي مانع رسائل البوت، ما نقدر نرسله
      }
    }
  }

  // رسالة للمستخدم + عداد حي
  await ctx.reply(texts.confirmed(ctx));
  await startCountdown(ctx, userId);

  // رسالة متابعة (روابط)
  const inviteLink = inviteLinkFor(userId);
  await ctx.reply(texts.upsellAfterConfirm(ctx, SITE_URL, inviteLink), kbAfterConfirm(userId));

  session.delete(userId);
});

// إلغاء
bot.action('CANCEL', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();
  session.delete(userId);
  await ctx.reply(`تم الإلغاء. إذا بدك ترجع، اضغط /start.`);
});

bot.catch((err) => console.error('Bot error:', err));

bot.launch().then(() => {
  console.log('Bot is running');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
