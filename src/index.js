require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
 
const db = require('./db');
const texts = require('./texts');
const { isTikTokUrl, extractVideoId, formatCountdown, parseRefFromStart } = require('./utils');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL;

const BOT_USERNAME = process.env.BOT_USERNAME || ''; // اختياري

const FREE_OPTIONS = (process.env.FREE_OPTIONS || '1000,2000')
  .split(',')
  .map(n => parseInt(n.trim(), 10))
  .filter(Number.isFinite);

const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '15', 10);
const COUNTDOWN_MINUTES = parseInt(process.env.COUNTDOWN_MINUTES || '15', 10);

const POST_CONFIRM_OFFER_DELAY_SEC = parseInt(process.env.POST_CONFIRM_OFFER_DELAY_SEC || '60', 10);
const POST_OFFER_REMINDER_DELAY_SEC = parseInt(process.env.POST_OFFER_REMINDER_DELAY_SEC || '120', 10);

if (!BOT_TOKEN || !ADMIN_ID || !SITE_URL) {
  throw new Error('Missing env variables: BOT_TOKEN / ADMIN_TELEGRAM_ID / SITE_URL');
}

const bot = new Telegraf(BOT_TOKEN);

// state: userId -> { step, kind, amount, url, videoId }
const session = new Map();

// countdown: userId -> { intervalId, chatId, messageId, endsAt }
const countdowns = new Map();

// offer flow: userId -> { offerTimer, reminderTimer, engaged }
const postOffer = new Map();

function resolvedBotUsername() {
  // الأفضل: env BOT_USERNAME. بديل: bot.botInfo.username بعد launch
  return BOT_USERNAME || bot.botInfo?.username || '';
}

function inviteLinkFor(userId) {
  const u = resolvedBotUsername();
  if (!u) return `https://t.me/your_bot_username?start=ref_${userId}`;
  return `https://t.me/${u}?start=ref_${userId}`;
}

function kbConfirm() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تأكيد الطلب', 'CONFIRM')],
    [Markup.button.callback('إلغاء', 'CANCEL')]
  ]);
}

function kbChooseFreeAmount() {
  return Markup.inlineKeyboard(FREE_OPTIONS.map(n => [Markup.button.callback(`${n} مشاهدة مجاناً`, `FREE_${n}`)]));
}

function kbChooseBonusOrSite() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('1000 مشاهدة مكافأة', 'BONUS_1000')],
    [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)]
  ]);
}

function kbSiteAndInvite(userId) {
  return Markup.inlineKeyboard([
    [Markup.button.url('زيارة الموقع الرسمي', SITE_URL)],
    [Markup.button.url('رابط دعوتي', inviteLinkFor(userId))]
  ]);
}

function stopCountdown(userId) {
  const k = String(userId);
  const c = countdowns.get(k);
  if (c?.intervalId) clearInterval(c.intervalId);
  countdowns.delete(k);
}

function clearPostOffer(userId) {
  const k = String(userId);
  const o = postOffer.get(k);
  if (o?.offerTimer) clearTimeout(o.offerTimer);
  if (o?.reminderTimer) clearTimeout(o.reminderTimer);
  postOffer.delete(k);
}

function markEngaged(userId) {
  const k = String(userId);
  const o = postOffer.get(k);
  if (o) o.engaged = true;
}

async function startCountdown(ctx, userId) {
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
          `✅ انتهت مدة المتابعة.\nإذا بدك كميات أكبر أو عروض، الموقع الرسمي أفضل:\n${SITE_URL}`
        );
      } catch {}
      stopCountdown(userId);
      return;
    }

    try {
      await ctx.telegram.editMessageText(
        chatId,
        messageId,
        undefined,
        `⏳ المتابعة: ${formatCountdown(remain)}\nالطلب قيد التنفيذ.`
      );
    } catch {
      stopCountdown(userId);
    }
  }, 20_000);

  countdowns.set(String(userId), { intervalId, chatId, messageId, endsAt });
}

async function schedulePostConfirmOffer(ctx, userId) {
  // تنظيف أي جدولة قديمة
  clearPostOffer(userId);

  const k = String(userId);
  const inviteLink = inviteLinkFor(userId);

  const offerTimer = setTimeout(async () => {
    // أرسل العرض بعد دقيقة
    try {
      await ctx.telegram.sendMessage(
        ctx.chat.id,
        texts.offerAfterOneMinute(ctx, SITE_URL, inviteLink),
        kbSiteAndInvite(userId)
      );
    } catch {}

    // جدولة التذكير بعد دقيقتين إذا لم يحدث تفاعل
    const reminderTimer = setTimeout(async () => {
      const o = postOffer.get(k);
      if (!o || o.engaged) return;
      try {
        await ctx.telegram.sendMessage(ctx.chat.id, texts.offerReminder(ctx));
      } catch {}
    }, POST_OFFER_REMINDER_DELAY_SEC * 1000);

    const o = postOffer.get(k);
    if (o) o.reminderTimer = reminderTimer;
  }, POST_CONFIRM_OFFER_DELAY_SEC * 1000);

  postOffer.set(k, { offerTimer, reminderTimer: null, engaged: false });
}

// أي تفاعل من المستخدم بعد العرض يعتبر رد (حتى رسالة عادية)
bot.on('message', (ctx, next) => {
  const userId = String(ctx.from.id);
  markEngaged(userId);
  return next();
});

// /start
bot.start(async (ctx) => {
  const userId = db.upsertUser(ctx.from);

  // التقاط referral param (إصلاح المشكلة)
  const referrerId = parseRefFromStart(ctx);
  if (referrerId) {
    db.recordReferralStart(referrerId, userId);
  }

  // إذا في طلب قيد التنفيذ
  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.pending(ctx, PENDING_MINUTES, SITE_URL), kbSiteAndInvite(userId));
    return;
  }

  const user = db.getUser(userId);
  const inviteLink = inviteLinkFor(userId);

  // إذا استخدم المجاني سابقاً: لا طلب مجاني مرة ثانية
  // إذا لديه مكافآت: نعطيه خيار 5000
  if (user.free_used !== 0) {
    if ((user.bonus_tokens || 0) > 0) {
      session.set(userId, { step: 'choose_amount', kind: 'bonus', amount: 5000, url: null, videoId: null });
      await ctx.reply(
        `يا ${ctx.from.first_name || 'صديقي'}، عندك ${(user.bonus_tokens || 0)} مكافأة جاهزة (كل وحدة = 1000).\nاختر "1000 مشاهدة مكافأة" وابعث رابط الفيديو.`,
        kbChooseBonusOrSite()
      );
      return;
    }

    // لا مكافآت: اعتذار + ترويج + دعوة
    await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLink), kbSiteAndInvite(userId));
    return;
  }

  // أول مرة: عرض مجاني
  session.set(userId, { step: 'choose_amount', kind: 'free', amount: null, url: null, videoId: null });
  await ctx.reply(texts.startFree(ctx, FREE_OPTIONS), kbChooseFreeAmount());
});

// اختيار مجاني
bot.action(/^FREE_(\d+)$/, async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSiteAndInvite(userId));
    return;
  }

  const user = db.getUser(userId);
  if (user.free_used !== 0) {
    await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLinkFor(userId)), kbSiteAndInvite(userId));
    return;
  }

  const amount = parseInt(ctx.match[1], 10);
  session.set(userId, { step: 'await_link', kind: 'free', amount, url: null, videoId: null });
  await ctx.reply(texts.askLink(ctx));
});

// اختيار مكافأة
bot.action('BONUS_5000', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSiteAndInvite(userId));
    return;
  }

  const user = db.getUser(userId);
  if ((user.bonus_tokens || 0) <= 0) {
    await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLinkFor(userId)), kbSiteAndInvite(userId));
    return;
  }

  session.set(userId, { step: 'await_link', kind: 'bonus', amount: 5000, url: null, videoId: null });
  await ctx.reply(texts.askLink(ctx));
});

// استقبال الرابط
bot.on('text', async (ctx) => {
  const userId = db.upsertUser(ctx.from);

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.blocked(ctx, SITE_URL), kbSiteAndInvite(userId));
    return;
  }

  const state = session.get(userId);
  if (!state || state.step !== 'await_link') {
    // إذا هو مستخدم قديم ويحاول يطلب من نفسه بدون flow
    const user = db.getUser(userId);
    if (user.free_used !== 0 && (user.bonus_tokens || 0) <= 0) {
      await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLinkFor(userId)), kbSiteAndInvite(userId));
      return;
    }
    await ctx.reply(`اضغط /start حتى نمشيها خطوة خطوة.`);
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
  await ctx.reply(texts.preview(ctx, state.amount, url, videoId), kbConfirm());
});

// تأكيد
bot.action('CONFIRM', async (ctx) => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    await ctx.reply(texts.pending(ctx, PENDING_MINUTES, SITE_URL), kbSiteAndInvite(userId));
    return;
  }

  const state = session.get(userId);
  if (!state || state.step !== 'await_confirm' || !state.url) {
    await ctx.reply(`صار خلل بسيط. اضغط /start ونعيدها بسرعة.`);
    return;
  }

  const user = db.getUser(userId);

  // منع طلب مجاني ثانية
  if (state.kind === 'free' && user.free_used !== 0) {
    await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLinkFor(userId)), kbSiteAndInvite(userId));
    session.delete(userId);
    return;
  }

  // منع مكافأة إذا لا يوجد tokens
  if (state.kind === 'bonus' && (user.bonus_tokens || 0) <= 0) {
    await ctx.reply(texts.noMoreFree(ctx, SITE_URL, inviteLinkFor(userId)), kbSiteAndInvite(userId));
    session.delete(userId);
    return;
  }

  // قبل الإدخال: هل لديه طلبات سابقاً؟ لتأهيل الدعوة (أول طلب مؤكد فقط)
  const hadAnyBefore = db.hasAnyRequest(userId);

  const reqId = db.createRequest(userId, state.url, state.videoId, state.amount, state.kind);

  if (state.kind === 'free') db.setFreeUsed(userId);
  if (state.kind === 'bonus') db.consumeBonusToken(userId);

  // إشعار الأدمن بطلب جديد
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

  // تأهيل الدعوة (خيار A): نجاح عند أول طلب مؤكد للمدعو
  if (!hadAnyBefore) {
    const r = db.getReferralByReferredId(userId);
    if (r && r.qualified === 0) {
      db.qualifyReferral(r.id);
      db.addBonusToken(r.referrer_id, 1);

      // إشعار الأدمن بنجاح الدعوة
      const refAdmin =
`نجاح دعوة ✅
الداعي: ${r.referrer_id}
المدعو: ${userId}

اسم المدعو: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
username المدعو: @${ctx.from.username || 'N/A'}

مكافأة الداعي: +1000 (توكن)
`;
      await bot.telegram.sendMessage(ADMIN_ID, refAdmin);

      // إشعار الداعي
      const refUser = db.getUser(r.referrer_id);
      const tokensNow = (refUser?.bonus_tokens || 0);

      try {
        await bot.telegram.sendMessage(
          r.referrer_id,
          texts.referralSuccessToReferrer(refUser?.first_name || 'صديقي', tokensNow)
        );
      } catch {}
    }
  }

  // الآن حسب طلبك: لا نرسل تسويق فوراً
  await ctx.reply(texts.confirmedOnly(ctx));
  await startCountdown(ctx, userId);

  // جدولة العرض بعد دقيقة + تذكير بعد دقيقتين لو ما رد
  await schedulePostConfirmOffer(ctx, userId);

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
