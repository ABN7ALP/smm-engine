function name(ctx) {
  return (ctx.from?.first_name || 'صديقي').trim();
}

function inviteExplain(siteUrl, inviteLink) {
  return `شروط مكافأة الدعوة بسيطة وواضحة:
1) صديقك يدخل البوت من رابط دعوتك
2) يطلب مشاهدات ويضغط "تأكيد الطلب"
بعدها مباشرة: تعتبر الدعوة ناجحة وتاخد مكافأة 5000 مشاهدة.

رابط دعوتك:
${inviteLink}

ولو حابب خيارات أكثر وخدمات أسرع:
${siteUrl}`;
}

module.exports = {
  startFree(ctx, options) {
    return `أهلاً ${name(ctx)}.

عندي لك تجربة مجانية محترمة لرفع مشاهدات تيك توك:
اختر الآن: ${options.join(' أو ')} مشاهدة مجاناً.

بدون تسجيل.
بدون دفع.
وبأسلوب آمن.

اختر الكمية من الأزرار بالأسفل.`;
  },

  startAfterFreeNoBonus(ctx, siteUrl, inviteLink) {
    return `يا ${name(ctx)}، عرضك المجاني خلص.

بس لا تشيل هم:
- إذا بدك كميات أكبر بسرعة: الموقع الرسمي يعطيك خيارات أقوى
- وإذا بدك تكمل مجاناً: ادعُ أصدقاءك برابطك، وكل دعوة ناجحة تعطيك 5000 مشاهدة

${inviteExplain(siteUrl, inviteLink)}`;
  },

  startAfterFreeHasBonus(ctx, tokens, siteUrl, inviteLink) {
    return `يا ${name(ctx)}، عرضك المجاني خلص.

بس أنت وضعك ممتاز:
عندك ${tokens} مكافأة/مكافآت جاهزة (كل وحدة = 5000 مشاهدة).

تقدر تطلب 5000 مشاهدة الآن، أو تدخل الموقع لخدمات أكبر.

${inviteExplain(siteUrl, inviteLink)}`;
  },

  askLink(ctx) {
    return `تمام ${name(ctx)}.
أرسل رابط فيديو تيك توك الآن.`;
  },

  invalidLink() {
    return `الرابط غير صالح.
أرسله كرابط تيك توك مباشر مثل:
https://www.tiktok.com/@user/video/123456789`;
  },

  preview(ctx, amount, url, videoId) {
    return `راجع الطلب يا ${name(ctx)}:

الرابط:
${url}

معرف الفيديو:
${videoId || 'غير ظاهر'}

الكمية:
${amount} مشاهدة

وقت التنفيذ المتوقع:
5 إلى 10 دقائق

إذا كل شيء صحيح: أكد الطلب الآن.`;
  },

  confirmed(ctx) {
    return `تم يا ${name(ctx)}.
دخلنا طلبك بالتنفيذ الآن.

ستلاحظ الزيادة خلال 5 إلى 10 دقائق غالباً.
والآن سأترك لك عدّاد متابعة بسيط.`;
  },

  pending(ctx, minutes, siteUrl) {
    return `يا ${name(ctx)} طلبك قيد التنفيذ.
تقريباً خلال ${minutes} دقيقة بيكون خلص.

لو بدك كميات أكبر فوراً:
${siteUrl}`;
  },

  blocked(ctx, siteUrl) {
    return `يا ${name(ctx)} خلّينا نخلص الطلب الحالي أول.

إذا بدك كميات أكبر أو طلبات متعددة:
${siteUrl}`;
  },

  upsellAfterConfirm(ctx, siteUrl, inviteLink) {
    return `بدك تكمل بزيادة أقوى؟

- خدمات أكثر بالموقع الرسمي:
${siteUrl}

- أو كمل مجاناً عبر الدعوات:
${inviteLink}`;
  },

  referralSuccessToReferrer(ctx, tokens) {
    return `مبروك يا ${name(ctx)}.
دعوتك نجحت، وانضافت لك مكافأة 5000 مشاهدة.

صار عندك الآن ${tokens} مكافأة/مكافآت.
اضغط /start واختر "5000 مشاهدة مكافأة" وابعث رابط الفيديو.`;
  }
};
