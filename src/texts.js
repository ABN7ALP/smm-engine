function name(ctx) {
  return ctx.from?.first_name || 'صديقي';
}

function fullName(ctx) {
  return `${ctx.from?.first_name || ''} ${ctx.from?.last_name || ''}`.trim();
}

module.exports = {
  start(ctx, options) {
    const name_ = name(ctx);
    const opts = options.join(' أو ');
    return `👋 أهلاً بك يا ${name_}!

🔥 عرض حصري لك اليوم فقط

تبي تزيد مشاهدات فيديوهاتك على تيك توك؟
نحن نعطيك *مشاهدات حقيقية* مجاناً كأول تجربة! 

🎁 اختر هديتك المجانية:
${opts} مشاهدة

✨ المميزات:
• بدون تسجيل معقد
• بدون دفع
• مشاهدات حقيقية 100%
• تنفيذ سريع جداً

👇 اختر الكمية وابدأ الآن:`;
  },

  askLink(ctx) {
    return `✅ ممتاز يا ${name(ctx)}!

الآن أرسل لي رابط الفيديو الذي تريد زيادة مشاهداته.

💡 يجب أن يكون الرابط مثل:
\`https://www.tiktok.com/@username/video/123456789\`

أو الروابط المختصرة:
\`https://vt.tiktok.com/abc123\`
\`https://vm.tiktok.com/abc123\``;
  },

  invalidLink() {
    return `❌ الرابط غير صحيح

تأكد من أنك أرسلت رابط تيك توك صحيح:
\`https://www.tiktok.com/@username/video/123456789\`

حاول مرة أخرى 👇`;
  },

  preview(ctx, amount, url, videoId) {
    const name_ = name(ctx);
    const fullName_ = fullName(ctx);
    return `📋 *تفاصيل طلبك يا ${name_}*

👤 الاسم الكامل: \`${fullName_}\`
🆔 Username: @${ctx.from.username || 'N/A'}

📎 رابط الفيديو:
\`${url}\`

🎯 معرف الفيديو:
\`${videoId || 'جاري التحليل'}\`

👁️ عدد المشاهدات المطلوبة:
\`${amount.toLocaleString()}\`

⏱️ وقت التنفيذ:
\`5 - 15 دقيقة كحد أقصى\`

✨ *كل شي صح؟ اضغط تأكيد وخليني أبدأ* 🚀`;
  },

  confirmed(ctx, progress) {
    const name_ = name(ctx);
    const messages = [
      `🎉 تم قبول طلبك يا ${name_}!\n\n🔄 جاري معالجة الطلب...`,
      `⏳ الطلب قيد التنفيذ\n📊 الإنجاز: ${progress}%`,
      `🚀 معظم المشاهدات بدأت تصل!\n📊 الإنجاز: ${progress}%`,
      `✨ آخر اللمسات\n📊 الإنجاز: ${progress}%`,
      `🎊 تم! المشاهدات وصلت!\n\nفيديوك الآن أكثر شهرة 🔥\n\n💡 ممكن تحصل على 5,000 مشاهدة إضافية مجاناً إذا:\n1️⃣ زرت الموقع\n2️⃣ دعيت صديق عبر الرابط\n\nقبول العرض؟`
    ];

    if (progress <= 25) return messages[0];
    if (progress <= 50) return messages[1];
    if (progress <= 75) return messages[2];
    if (progress <= 95) return messages[3];
    return messages[4];
  },

  pending(ctx, minutes, refCode) {
    const name_ = name(ctx);
    return `⏳ صبر شوية يا ${name_}

طلبك السابق ما زال قيد التنفيذ
⏰ باقي تقريباً: *${minutes} دقائق*

💡 في الوقت اللي تنتظر:
• زر الموقع واكتشف عروض أكثر
• ادعو صديقك واحصل على مكافآت
• تابع دعواتك الناجحة

🔗 رابط دعوتك:
\`${refCode}\``;
  },

  blocked(ctx) {
    const name_ = name(ctx);
    return `😊 يا ${name_}

لازم ننهي الطلب الحالي أول 👇

بعدين ممكن:
✅ تزور الموقع (أكثر عروض)
✅ تدعي صديق (مكافآت إضافية)
✅ تطلب مشاهدات جديدة

الموقع فيه خيارات كتير أكثر وأسرع 🚀`;
  },

  visitSite(ctx) {
    const name_ = name(ctx);
    return `🌐 يا ${name_}

الموقع الخاص بنا فيه:
✅ عروض مجانية حصرية
✅ خدمات تيك توك وإنستا وفيسبوك
✅ خصومات وعروض يومية
✅ دعم سريع 24/7

بعد ما تزور الموقع، اضغط "تحققت من الموقع" 👇`;
  },

  siteVerified(ctx) {
    const name_ = name(ctx);
    return `✅ شكراً يا ${name_} على دعمك! 🙏

الآن إنت حققت الشرط الأول ✔️
• تبقى لك دعوة صديق واحد وتحصل على 5,000 مشاهدة إضافية`;
  },

  bonusConditions(ctx) {
    const name_ = name(ctx);
    return `🎁 احصل على 5,000 مشاهدة إضافية مجاناً!

عندنا شرطين بسيطين يا ${name_}:

1️⃣ *زر الموقع* ✨
   اشوف العروض والخدمات الجديدة

2️⃣ *ادعو صديق* 👥
   استخدم رابط دعوتك الخاص
   لما يكمل طلبه = مكافأة لك

اختر من هنا 👇`;
  },

  inviteFriend(ctx, refCode) {
    const name_ = name(ctx);
    return `👥 شارك مع أصدقائك يا ${name_}!

هاذا رابط دعوتك الخاص:
\`${refCode}\`

كل صديق يستخدمه:
✅ يحصل على عرض مجاني
✅ إنت تحصل على 5,000 مشاهدة مجانية

🔥 كل دعوة ناجحة = 5,000 مشاهدة لك!

انسخ الرابط واشاره مع أصدقائك 🚀`;
  },

  upsell(ctx) {
    const name_ = name(ctx);
    return `💼 معلومة مهمة يا ${name_}!

في الموقع الخاص بنا:
🔥 عروض مجانية محدودة جداً
⚡ خدمات سريعة وموثوقة
💎 أفضل الأسعار في السوق
🎯 دعم شخصي لكل عميل

تبي نروح للموقع؟ 👇`;
  }
};
