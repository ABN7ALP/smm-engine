function name(ctx) {
  return (ctx.from?.first_name || 'صديقي').trim();
}

function minutesText(n) {
  return `${n} دقيقة`;
}

module.exports = {
  startFirstTime(ctx, options) {
    return `أهلاً ${name(ctx)}.

فيك تحصل على تجربة مجانية لمشاهدات تيك توك:
${options.join(' أو ')} مشاهدة.

اختر الكمية الآن، ثم أرسل رابط الفيديو.`;
  },

  startWithCredits(ctx, credits, rewardAmount) {
    return `أهلاً ${name(ctx)}.

عندك رصيد دعوات جاهز: ${credits} مشاهدة.
تقدر تستبدل الآن ${rewardAmount} مشاهدة مباشرة إذا بتحب.`;
  },

  startAfterFreeEnded(ctx, siteUrl) {
    return `يا ${name(ctx)}، خلصت التجربة المجانية الأولى.

إذا بدك كميات أكبر وعروض مستمرة، الأفضل تستخدم الموقع الرسمي:
${siteUrl}

ولو بتحب ترجع تحصل على 5000 مشاهدة داخل البوت:
ادعُ أصدقاءك من رابط الدعوة الخاص فيك.
عند نجاح الدعوة (الصديق يبدأ عبر رابطك + يطلب مشاهدات + يؤكد زيارة الموقع) بتستلم 5000 مشاهدة وتطلب من جديد.`;
  },

  askLink(ctx) {
    return `تمام ${name(ctx)}.
أرسل رابط فيديو تيك توك الآن.`;
  },

  invalidLink() {
    return `الرابط غير صالح.
أرسل رابط تيك توك مباشر مثل:
https://www.tiktok.com/@user/video/123456789`;
  },

  preview(ctx, amount, url, videoId) {
    return `راجع الطلب يا ${name(ctx)}:

الرابط:
${url}

معرّف الفيديو:
${videoId || 'غير ظاهر'}

الكمية:
${amount} مشاهدة

وقت التنفيذ المتوقع:
5 إلى 10 دقائق

إذا كل شيء صحيح، أكد الطلب.`;
  },

  confirmed(ctx) {
    return `تم تسجيل طلبك يا ${name(ctx)}.
بدأ التنفيذ الآن.

سأعرض لك عدّاد متابعة لمدة 15 دقيقة كحد أقصى.`;
  },

  pending(ctx, minutes) {
    return `يا ${name(ctx)}، طلبك السابق ما زال قيد التنفيذ.
المدة المتبقية تقريباً: ${minutesText(minutes)}.

إذا بدك أكثر من طلب أو كميات أكبر فوراً: افتح الموقع.`;
  },

  blocked(ctx) {
    return `يا ${name(ctx)}، خلّينا نخلص الطلب الحالي أول.
إذا بدك كميات أكبر أو طلبات متعددة: الموقع يعطيك خيارات أوسع.`;
  },

  afterConfirmQuestion(ctx) {
    return `هل تريد مشاهدات أكثر بعد انتهاء طلبك؟`;
  },

  referralExplain(ctx, inviteLink, rewardAmount, siteUrl) {
    return `رابط دعوتك الخاص:
${inviteLink}

شروط نجاح الدعوة للحصول على ${rewardAmount} مشاهدة:
1) صديقك يبدأ البوت من رابطك.
2) يطلب مشاهدات (ينشئ طلب داخل البوت).
3) يفتح الموقع ويضغط زر "أكدت زيارة الموقع" داخل البوت.

عند تحقق الشروط سيتم:
- إضافة ${rewardAmount} مشاهدة لرصيدك.
- إشعارك وإشعار الأدمن بنجاح الدعوة.

الموقع:
${siteUrl}`;
  },

  referralSuccess(ctx, rewardAmount) {
    return `تمت الموافقة على دعوتك بنجاح.
تم إضافة ${rewardAmount} مشاهدة لرصيدك.

تقدر الآن تطلب ${rewardAmount} مشاهدة من داخل البوت عبر /start.`;
  },

  countdownLine(remainingMinutes) {
    return `متابعة الطلب: متبقي تقريباً ${minutesText(remainingMinutes)} (سأحدّث هذا لمدة 15 دقيقة كحد أقصى).`;
  },

  countdownDoneHint() {
    return `إذا وصلت 15 دقيقة ومازال الطلب قيد التنفيذ، هذا طبيعي أحياناً حسب الضغط. للمزيد من السرعة والعروض استخدم الموقع.`;
  },

  siteVisitPrompt(ctx) {
    return `حتى نحسب الدعوات بشكل صحيح:
بعد ما تفتح الموقع، اضغط زر "أكدت زيارة الموقع" هنا.`;
  }
};
