require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const https = require('https');

const db = require('./db');
const { isTikTokUrl, extractVideoId } = require('./utils');
const texts = require('./texts');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID;
const SITE_URL = process.env.SITE_URL;
const PENDING_MINUTES = parseInt(process.env.PENDING_MINUTES || '10');
const COOLDOWN_HOURS = parseInt(process.env.COOLDOWN_HOURS || '24');
const MAX_MSG_PER_MIN = parseInt(process.env.MAX_MSG_PER_MIN || '12');
const FREE_OPTIONS = (process.env.FREE_OPTIONS || '5000,10000')
  .split(',')
  .map(n => parseInt(n.trim()));

if (!BOT_TOKEN || !ADMIN_ID || !SITE_URL) {
  throw new Error('Missing env variables');
}

const bot = new Telegraf(BOT_TOKEN);
const session = new Map();
const userRateLimits = new Map();

// ====== Keyboards ======
function kbAmount() {
  return Markup.inlineKeyboard(
    FREE_OPTIONS.map(n => [Markup.button.callback(`${n.toLocaleString()} مشاهدة مجاناً 🎁`, `AMOUNT_${n}`)])
  );
}

const kbConfirm = Markup.inlineKeyboard([
  [Markup.button.callback('✅ تأكيد الطلب', 'CONFIRM')],
  [Markup.button.callback('❌ إلغاء', 'CANCEL')]
]);

const kbReferral = (refCode) => Markup.inlineKeyboard([
  [Markup.button.url('🔗 رابط الدعوة الخاص بك', `https://t.me/${BOT_TOKEN.split(':')[0]}?start=${refCode}`)],
  [Markup.button.callback('📊 عرض دعواتك', 'SHOW_REFERRALS')]
]);

const kbVisitSite = Markup.inlineKeyboard([
  [Markup.button.url('🌐 زيارة الموقع', SITE_URL)],
  [Markup.button.callback('✅ تحققت من الموقع', 'VERIFIED_SITE')]
]);

const kbYesNo = Markup.inlineKeyboard([
  [Markup.button.callback('✅ نعم', 'YES')],
  [Markup.button.callback('❌ لا', 'NO')]
]);

// ====== Helper Functions ======
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = userRateLimits.get(userId) || [];
  const recentMsgs = userLimit.filter(t => now - t < 60000);
  
  if (recentMsgs.length >= MAX_MSG_PER_MIN) {
    return false;
  }
  
  userRateLimits.set(userId, [...recentMsgs, now]);
  return true;
}

async function fetchVideoInfo(url) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const opts = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0' }
      };
      
      https.get(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const match = data.match(/"desc":"([^"]+)"/);
            const desc = match ? match[1] : 'بدون وصف';
            resolve({ desc });
          } catch {
            resolve({ desc: 'بدون وصف' });
          }
        });
      }).on('error', () => resolve({ desc: 'بدون وصف' }));
    } catch {
      resolve({ desc: 'بدون وصف' });
    }
  });
}

async function notifyAdmin(ctx, reqId, state) {
  const msgText = `
🔔 طلب جديد

👤 المستخدم: ${ctx.from.first_name} ${ctx.from.last_name || ''}
🆔 Username: @${ctx.from.username || 'N/A'}
📱 Telegram ID: ${ctx.from.id}

📎 الرابط: ${state.url}
🎯 معرف الفيديو: ${state.videoId}
👁️ الكمية: ${state.amount.toLocaleString()} مشاهدة
⏱️ الحالة: قيد الانتظار

🔗 ID الطلب: #${reqId}
`;

  try {
    const msg = await bot.telegram.sendMessage(ADMIN_ID, msgText);
    db.logToAdmin(reqId, String(ctx.from.id), ctx.from.first_name, ctx.from.username || 'N/A', state.url, state.amount, 'pending', 0, msg.message_id);
    return msg.message_id;
  } catch (err) {
    console.error('Error notifying admin:', err);
  }
}

// ====== Middleware ======
bot.use(async (ctx, next) => {
  if (!checkRateLimit(String(ctx.from.id))) {
    return ctx.reply('⏸️ بطيء شوية! حاول بعد شوية');
  }
  return next();
});

// ====== Commands ======
bot.start(async ctx => {
  const userId = db.upsertUser(ctx.from, ctx.startPayload);
  const refCode = db.getReferralCode(userId);
  
  db.logInteraction(userId, 'start', { referralPayload: ctx.startPayload });

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    return ctx.reply(texts.pending(ctx, PENDING_MINUTES, refCode), kbVisitSite);
  }

  session.set(userId, { step: 'amount' });
  ctx.reply(texts.start(ctx, FREE_OPTIONS), kbAmount());
});

bot.command('referrals', async ctx => {
  const userId = db.upsertUser(ctx.from);
  const refCode = db.getReferralCode(userId);
  const pending = db.getPendingReferrals(userId);
  const completed = db.getCompletedReferrals(userId);

  let msg = `📊 احصائية دعواتك\n\n`;
  msg += `🔗 رابط دعوتك الخاص:\n\`${refCode}\`\n\n`;
  msg += `✅ الدعوات المكتملة: ${completed.length}\n`;
  msg += `⏳ الدعوات المعلقة: ${pending.length}\n\n`;

  if (completed.length > 0) {
    msg += `✅ *المكتملة:*\n`;
    completed.forEach(ref => {
      msg += `• ${ref.full_name} (@${ref.username})\n`;
    });
    msg += '\n';
  }

  if (pending.length > 0) {
    msg += `⏳ *المعلقة (تنتظر أول طلب):*\n`;
    pending.forEach(ref => {
      msg += `• ${ref.full_name} (@${ref.username})\n`;
    });
  }

  ctx.reply(msg, kbReferral(refCode));
});

// ====== Amount Selection ======
bot.action(/^AMOUNT_(\d+)/, async ctx => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  session.set(userId, {
    step: 'link',
    amount: parseInt(ctx.match[1])
  });

  ctx.reply(texts.askLink(ctx));
});

// ====== Link Submission ======
bot.on('text', async ctx => {
  const userId = db.upsertUser(ctx.from);
  const state = session.get(userId);

  const pending = db.getPendingRequest(userId, PENDING_MINUTES);
  if (pending) {
    db.logInteraction(userId, 'blocked_pending', {});
    return ctx.reply(texts.blocked(ctx), kbVisitSite);
  }

  if (!state || state.step !== 'link') {
    return ctx.reply('اضغط /start للبدء 🚀');
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

// ====== Confirmation ======
bot.action('CONFIRM', async ctx => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  const state = session.get(userId);
  if (!state) return ctx.reply('حصل خطأ. اضغط /start');

  const reqId = db.createRequest(userId, state.url, state.videoId, state.amount);
  const messageId = await notifyAdmin(ctx, reqId, state);
  
  db.logInteraction(userId, 'request_created', { requestId: reqId, amount: state.amount });

  session.delete(userId);

  // Progress message
  let progressMsg = await ctx.reply(texts.confirmed(ctx, 0));

  // Simulate progress
  const progressSteps = [10, 25, 45, 65, 80, 90, 100];
  let step = 0;

  const progressInterval = setInterval(async () => {
    if (step >= progressSteps.length) {
      clearInterval(progressInterval);
      
      // Completion
      db.completeRequest(reqId);
      db.updateAdminLogStatus(reqId, 'completed', 100);
      
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          undefined,
          texts.confirmed(ctx, 100),
          Markup.inlineKeyboard([[Markup.button.callback('🎁 أرغب بـ 5000 مشاهدة إضافية', 'BONUS_OFFER')]])
        );
      } catch (err) {
        console.error('Error editing progress:', err);
      }
      
      return;
    }

    const progress = progressSteps[step];
    db.updateRequestProgress(reqId, progress);
    
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        undefined,
        texts.confirmed(ctx, progress)
      );
    } catch (err) {
      console.error('Error updating progress:', err);
    }

    step++;
  }, 2000);
});

// ====== Bonus Offer ======
bot.action('BONUS_OFFER', async ctx => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  ctx.reply(
    texts.bonusConditions(ctx),
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ شرط 1: زيارة الموقع', 'COND_1')],
      [Markup.button.callback('✅ شرط 2: دعوة صديق', 'COND_2')]
    ])
  );
});

bot.action('COND_1', async ctx => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  session.set(userId, { step: 'verify_site' });
  ctx.reply(texts.visitSite(ctx), kbVisitSite);
});

bot.action('VERIFIED_SITE', async ctx => {
  const userId = db.upsertUser(ctx.from);
  await ctx.answerCbQuery();

  db.logInteraction(userId, 'site_verified', {});
  session.set(userId, { step: 'main', siteVerified: true });

  ctx.reply(
    texts.siteVerified(ctx),
    Markup.inlineKeyboard([
      [Markup.button.callback('🎁 قدم طلب جديد', 'NEW_REQUEST')],
      [Markup.button.callback('📊 شوف دعواتك', 'SHOW_REFERRALS')]
    ])
  );
});

bot.action('COND_2', async ctx => {
  const userId = db.upsertUser(ctx.from);
  const refCode = db.getReferralCode(userId);
  await ctx.answerCbQuery();

  session.set(userId, { step: 'referral' });
  ctx.reply(texts.inviteFriend(ctx, refCode), kbReferral(refCode));
});

bot.action('SHOW_REFERRALS', async ctx => {
  const userId = db.upsertUser(ctx.from);
  const refCode = db.getReferralCode(userId);
  const pending = db.getPendingReferrals(userId);
  const completed = db.getCompletedReferrals(userId);

  await ctx.answerCbQuery();

  let msg = `📊 *احصائيات دعواتك*\n\n`;
  msg += `✅ مكتملة: ${completed.length}\n`;
  msg += `⏳ معلقة: ${pending.length}\n`;
  msg += `🎁 مكافآت مكتسبة: ${completed.length * 5000} مشاهدة\n\n`;

  if (completed.length > 0) {
    msg += `*✅ المكتملة:*\n`;
    completed.forEach(ref => {
      msg += `• ${ref.full_name}\n`;
    });
  }

  if (pending.length > 0) {
    msg += `\n*⏳ المعلقة:*\n`;
    pending.forEach(ref => {
      msg += `• ${ref.full_name} (جاري...)\n`;
    });
  }

  ctx.reply(msg);
});

// ====== Cleanup ======
bot.action('CANCEL', ctx => {
  ctx.answerCbQuery();
  session.delete(String(ctx.from.id));
  ctx.reply('تم الإلغاء ❌. اضغط /start للبدء من جديد');
});

bot.action('YES', ctx => {
  ctx.answerCbQuery();
  ctx.reply('شكراً! 🙏 زيارتك تساعدنا كثير', kbVisitSite);
});

bot.action('NO', ctx => {
  ctx.answerCbQuery();
  ctx.reply(texts.upsell(ctx), kbVisitSite);
});

bot.launch();
console.log('✅ Bot is running with AI features');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
