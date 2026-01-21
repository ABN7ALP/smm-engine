require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const {
  upsertUser,
  getUser,
  setReferredByIfEmpty,
  getPendingRequest,
  createRequest,
  markRequestSiteVisitedByUser,
  hasAnyRequest,
  getCredits,
  addCredits,
  deductCredits,
  markUsedFree,
  qualifyReferralIfPossible
} = require('./db');

const { isTikTokUrl, extractVideoId, clampInt, parseStartRef } = require('./utils');
const texts = require('./texts');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || '');
const SITE_URL = String(process.env.SITE_URL || '');

const PENDING_MINUTES = clampInt(process.env.PENDING_MINUTES || 10, 1, 120);
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '500,1000')
  .split(',')
  .map(n => parseInt(n.trim(), 10))
  .filter(Number.isFinite);

const REF_REWARD_AMOUNT = clampInt(process.env.REF_REWARD_AMOUNT || 5000, 1000, 50000);
const COUNTDOWN_MAX_MINUTES = clampInt(process.env.COUNTDOWN_MAX_MINUTES || 15, 1, 60);

if (!BOT_TOKEN || !ADMIN_ID || !SITE_URL) {
  throw new Error('Missing env variables: BOT_TOKEN / ADMIN_TELEGRAM_ID / SITE_URL');
}

const bot = new Telegraf(BOT_TOKEN);

// Lightweight in-memory session & countdown timers
const session = new Map(); // userId -> { step, amount, url, videoId, redeemingReward }
const countdowns = new Map(); // userId -> { intervalId, messageChatId, messageId, startedAt, maxMinutes }

let BOT_USERNAME = null;

function kbAmount(options) {
  return Markup.inlineKeyboard(
    options.map(n => [Markup.button.callback(`${n} مشاهدة`, `AMOUNT_${n}`)])
  );
}

function kbConfirm() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('تأكيد الطلب', 'CONFIRM')],
    [Markup.button.callback('إلغاء', 'CANCEL')]
  ]);
}

function kbYesNo() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('نعم', 'YES_MORE')],
    [Markup.button.callback('لا', 'NO_MORE')]
  ]);
}

function kbSiteAndVisit() {
  // URL button + callback button (manual confirmation)
  return Markup.inlineKeyboard([
    [Markup.button.url('فتح الموقع', SITE_URL)],
    [Markup.button.callback('أكدت زيارة الموقع', 'SITE_VISITED')]
  ]);
}

function kbSiteOnly() {
  return Markup.inlineKeyboard([[Markup.button.url('فتح الموقع', SITE_URL)]]);
}

function kbStartOptions(hasCredits, rewardAmount) {
  const rows = [];
  if (hasCredits) {
    rows.push([Markup.button.callback(`استلم ${rewardAmount} مشاهدة (رصيد دعوات)`, 'REDEEM_REWARD')]);
  }
  rows.push([Markup.button.callback('بدء طلب مشاهدات', 'BEGIN_FLOW')]);
  return Markup.inlineKeyboard(rows);
}

function stopCountdown(userId) {
  const c = countdowns.get(userId);
  if (!c) return;
  clearInterval(c.intervalId);
  countdowns.delete(userId);
}

async function startCountdown(ctx, userId) {
  stopCountdown(userId);

  const maxMinutes = COUNTDOWN_MAX_MINUTES;
  const startedAt = Date.now();

  const firstText = `${texts.countdownLine(maxMinutes)}\n\n${texts.siteVisitPrompt(ctx)}`;
  const msg = await ctx.reply(firstText, kbSiteAndVisit());

  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  const intervalId = setInterval(async () => {
    try {
      const elapsedMs = Date.now() - startedAt;
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const remaining = Math.max(0, maxMinutes - elapsedMinutes);

      if (remaining <= 0) {
        const finalText = `${texts.countdownLine(0)}\n\n${texts.countdownDoneHint()}\n\n${texts.siteVisitPrompt(ctx)}`;
        await bot.telegram.editMessageText(chatId, messageId, undefined, finalText, {
          reply_markup: kbSiteAndVisit().reply_markup
        });
        stopCountdown(userId);
        return;
      }

      const newText = `${texts.countdownLine(remaining)}\n\n${texts.siteVisitPrompt(ctx)}`;
      await bot.telegram.editMessageText(chatId, messageId, undefined, newText, {
        reply_markup: kbSiteAndVisit().reply_markup
      });
    } catch {
      // If editing fails (message too old, deleted, etc.) stop gracefully
      stopCountdown(userId);
    }
  }, 60_000);

  countdowns.set(userId, { intervalId, messageChatId: chatId, messageId, startedAt, maxMinutes });
}

async function notifyAdmin(text) {
  try {
    await bot.telegram.sendMessage(ADMIN_ID, text);
  } catch {
    // ignore
  }
}

function buildInviteLink(userId) {
  if (!BOT_USERNAME) return null;
  return `https://t.me/${BOT_USERNAME}?start=ref_${userId}`;
}

async function handleStart(ctx) {
  const userId = upsertUser(ctx.from);

  // Attach referral if payload exists
  const payload = ctx.startPayload ? String(ctx.startPayload) : '';
  const referrerId = parseStartRef(payload);
  if (referrerId) {
    const applied = setReferredByIfEmpty(userId, referrerId);
    if (applied) {
      await notifyAdmin(`Referral pending: referrer=${referrerId} referred=${userId} (@${ctx.from.username || 'N/A'})`);
    }
  }

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSiteOnly());
  }

  const user = getUser(userId);
  const credits = getCredits(userId);

  // If has reward credits, show option to redeem
  if (credits >= REF_REWARD_AMOUNT) {
    session.set(userId, { step: 'idle' });
    return ctx.reply(
      texts.startWithCredits(ctx, credits, REF_REWARD_AMOUNT),
      kbStartOptions(true, REF_REWARD_AMOUNT)
    );
  }

  // If never used free, allow free flow
  if (user && Number(user.has_used_free) === 0) {
    session.set(userId, { step: 'amount', redeemingReward: false });
    return ctx.reply(texts.startFirstTime(ctx, FREE_OPTIONS), kbAmount(FREE_OPTIONS));
  }

  // Otherwise: free ended, no credits -> marketing + referral explain
  const inviteLink = buildInviteLink(userId) || '(سيظهر رابط الدعوة بعد أول تشغيل ناجح للبوت)';
  await ctx.reply(texts.startAfterFreeEnded(ctx, SITE_URL), kbSiteOnly());
  return ctx.reply(texts.referralExplain(ctx, inviteLink, REF_REWARD_AMOUNT, SITE_URL), kbSiteOnly());
}

bot.start(handleStart);

// Optional: allow /start without payload to act as restart
bot.command('start', handleStart);

// Begin flow button (if user has credits screen)
bot.action('BEGIN_FLOW', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSiteOnly());

  const user = getUser(userId);
  const credits = getCredits(userId);

  // Decide what to offer
  if (credits >= REF_REWARD_AMOUNT) {
    session.set(userId, { step: 'amount', redeemingReward: true });
    return ctx.reply(`اختر الآن: هل تريد استبدال ${REF_REWARD_AMOUNT} مشاهدة من رصيد الدعوات؟`, Markup.inlineKeyboard([
      [Markup.button.callback(`نعم، استبدال ${REF_REWARD_AMOUNT}`, 'REDEEM_REWARD')],
      [Markup.button.callback('لا، الرجوع', 'BACK_HOME')]
    ]));
  }

  if (user && Number(user.has_used_free) === 0) {
    session.set(userId, { step: 'amount', redeemingReward: false });
    return ctx.reply(texts.startFirstTime(ctx, FREE_OPTIONS), kbAmount(FREE_OPTIONS));
  }

  const inviteLink = buildInviteLink(userId) || '(غير متاح حالياً)';
  await ctx.reply(texts.startAfterFreeEnded(ctx, SITE_URL), kbSiteOnly());
  return ctx.reply(texts.referralExplain(ctx, inviteLink, REF_REWARD_AMOUNT, SITE_URL), kbSiteOnly());
});

bot.action('BACK_HOME', async (ctx) => {
  await ctx.answerCbQuery();
  return handleStart(ctx);
});

// Redeem reward (5000) path
bot.action('REDEEM_REWARD', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSiteOnly());

  const credits = getCredits(userId);
  if (credits < REF_REWARD_AMOUNT) {
    return ctx.reply(`رصيدك الحالي ${credits}. تحتاج ${REF_REWARD_AMOUNT} للاستبدال.`, kbSiteOnly());
  }

  session.set(userId, { step: 'link', amount: REF_REWARD_AMOUNT, redeemingReward: true });
  return ctx.reply(texts.askLink(ctx));
});

// Choose amount (free options OR reward amount)
bot.action(/^AMOUNT_(\d+)/, async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSiteOnly());

  const chosen = parseInt(ctx.match[1], 10);
  const user = getUser(userId);

  // Only allow free amounts if has not used free
  if (chosen !== REF_REWARD_AMOUNT) {
    if (!user || Number(user.has_used_free) !== 0) {
      const inviteLink = buildInviteLink(userId) || '(غير متاح حالياً)';
      await ctx.reply(texts.startAfterFreeEnded(ctx, SITE_URL), kbSiteOnly());
      return ctx.reply(texts.referralExplain(ctx, inviteLink, REF_REWARD_AMOUNT, SITE_URL), kbSiteOnly());
    }
    if (!FREE_OPTIONS.includes(chosen)) {
      return ctx.reply('خيار غير صالح. اضغط /start من جديد.');
    }
    session.set(userId, { step: 'link', amount: chosen, redeemingReward: false });
    return ctx.reply(texts.askLink(ctx));
  }

  // Reward amount selection (if you ever expose it in amount keyboard)
  const credits = getCredits(userId);
  if (credits < REF_REWARD_AMOUNT) {
    return ctx.reply(`رصيدك غير كافي. رصيدك الحالي ${credits}.`, kbSiteOnly());
  }
  session.set(userId, { step: 'link', amount: REF_REWARD_AMOUNT, redeemingReward: true });
  return ctx.reply(texts.askLink(ctx));
});

// Receive link
bot.on('text', async (ctx) => {
  const userId = upsertUser(ctx.from);

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    return ctx.reply(texts.blocked(ctx), kbSiteOnly());
  }

  const st = session.get(userId);
  if (!st || st.step !== 'link') {
    return ctx.reply('اضغط /start للبدء.');
  }

  const msgText = (ctx.message.text || '').trim();
  if (!isTikTokUrl(msgText)) {
    return ctx.reply(texts.invalidLink());
  }

  const url = msgText;
  const videoId = extractVideoId(url);

  session.set(userId, { step: 'confirm', amount: st.amount, url, videoId, redeemingReward: !!st.redeemingReward });
  return ctx.reply(texts.preview(ctx, st.amount, url, videoId), kbConfirm());
});

// Confirm
bot.action('CONFIRM', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const pending = getPendingRequest(userId, PENDING_MINUTES);
  if (pending) return ctx.reply(texts.pending(ctx, PENDING_MINUTES), kbSiteOnly());

  const st = session.get(userId);
  if (!st || st.step !== 'confirm') {
    return ctx.reply('صار عدم تطابق بسيط. اضغط /start وابدأ من جديد.');
  }

  // If redeeming reward, deduct credits now
  if (st.redeemingReward) {
    const ok = deductCredits(userId, REF_REWARD_AMOUNT);
    if (!ok) {
      return ctx.reply('رصيد الدعوات غير كافٍ للاستبدال حالياً. اضغط /start.');
    }
  } else {
    // Mark that user consumed the one-time free (only when they confirm)
    markUsedFree(userId);
  }

  const reqId = createRequest(userId, st.url, st.videoId, st.amount);

  // Notify admin
  await notifyAdmin(
`طلب جديد:
ID: ${reqId}
User: ${ctx.from.first_name || ''} ${ctx.from.last_name || ''}
Username: @${ctx.from.username || 'N/A'}
telegram_id: ${userId}

Link: ${st.url}
VideoID: ${st.videoId || 'N/A'}
Amount: ${st.amount}
RedeemReward: ${st.redeemingReward ? 'YES' : 'NO'}`
  );

  session.set(userId, { step: 'idle' });

  // Start countdown tracker message (15 minutes max)
  await ctx.reply(texts.confirmed(ctx));
  await startCountdown(ctx, userId);

  // Post-confirm marketing + referral link
  const inviteLink = buildInviteLink(userId);
  if (inviteLink) {
    await ctx.reply(texts.referralExplain(ctx, inviteLink, REF_REWARD_AMOUNT, SITE_URL), kbSiteOnly());
  }

  return ctx.reply(texts.afterConfirmQuestion(ctx), kbYesNo());
});

// Cancel
bot.action('CANCEL', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();
  session.delete(userId);
  return ctx.reply('تم الإلغاء. إذا حابب نعيد، اضغط /start');
});

// Upsell choices
bot.action('YES_MORE', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply('تفضل الموقع الرسمي:', kbSiteOnly());
});

bot.action('NO_MORE', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const inviteLink = buildInviteLink(userId);
  if (inviteLink) {
    return ctx.reply(texts.referralExplain(ctx, inviteLink, REF_REWARD_AMOUNT, SITE_URL), kbSiteOnly());
  }
  return ctx.reply('تمام. للمزيد من العروض استخدم الموقع الرسمي:', kbSiteOnly());
});

// Site visited callback (counts for referral qualification)
bot.action('SITE_VISITED', async (ctx) => {
  const userId = upsertUser(ctx.from);
  await ctx.answerCbQuery();

  // mark visited on latest request
  const reqId = markRequestSiteVisitedByUser(userId);

  // Try qualify referral
  const q = qualifyReferralIfPossible(userId);
  if (q.qualified) {
    // Add credits to referrer
    addCredits(q.referrerId, REF_REWARD_AMOUNT);

    // Notify referrer
    try {
      await bot.telegram.sendMessage(q.referrerId, `نجحت دعوتك.
تم إضافة ${REF_REWARD_AMOUNT} مشاهدة لرصيدك.
اضغط /start لاستبدالها.`);
    } catch { /* ignore */ }

    // Notify admin
    await notifyAdmin(`Referral qualified: referrer=${q.referrerId} referred=${userId} req=${reqId || 'N/A'} reward=${REF_REWARD_AMOUNT}`);

    return ctx.reply('تم تسجيل زيارة الموقع. شكراً.');
  }

  // If not qualified yet, explain what's missing
  if (!hasAnyRequest(userId)) {
    return ctx.reply('تم تسجيل الزيارة، لكن يلزم إنشاء طلب داخل البوت حتى تُحتسب الدعوة.');
  }

  return ctx.reply('تم تسجيل الزيارة. إذا كنت بدأت من رابط دعوة وتم إنشاء طلب، ستُحتسب الدعوة تلقائياً.');
});

// Startup: get bot username for referral links
(async () => {
  const me = await bot.telegram.getMe();
  BOT_USERNAME = me.username || null;

  await bot.launch();
  console.log('Bot is running');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
