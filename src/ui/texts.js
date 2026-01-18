function nameOf(ctx) {
  return (ctx.from?.first_name || 'صاحبي').trim();
}

function humanMs(ms) {
  const m = Math.ceil(ms / 60000);
  return `${m} دقيقة`;
}

module.exports = {
  nameOf,
  humanMs,
  msg: {
    chooseAmount: (ctx, opts) => `أهلاً يا ${nameOf(ctx)}.\n\nاختار هديتك المجانية: ${opts.join(' أو ')} مشاهدة.\nخلّينا نبلش صح.`,
    sendUrl: (ctx) => `تمام يا ${nameOf(ctx)}.\nابعت رابط فيديو تيك توك هون وبنجهزه.`,
    invalidUrl: () => `الرابط مو واضح إنه تيك توك.\nابعت رابط مثل:\nhttps://www.tiktok.com/@user/video/1234567890`,
    pending: (ctx, minutes) => `يا ${nameOf(ctx)} طلبك قيد التنفيذ.\nخلال ${minutes} دقائق تقريباً بيكون جاهز.\nإذا بدك كميات أكبر فوراً: الموقع أسرع.`,
    cooldown: (ctx, remainText) => `يا ${nameOf(ctx)} خلّصت هديتك المجانية قريباً.\nباقي تقريباً ${remainText} لتصير مجانية ثانية.\nبس لو مستعجل، الموقع فيه خيارات مجانية/مدفوعة أسرع.`,
    preview: (ctx, amount, url, key) =>
      `لقيته يا ${nameOf(ctx)}.\n\n- الرابط: ${url}\n- معرف الفيديو: ${key || 'غير واضح'}\n- الكمية: ${amount} مشاهدة\n\nتأكيد ونبدأ؟`,
    confirmed: (ctx) =>
      `تم يا ${nameOf(ctx)}.\nدخلنا الطلب بالتنفيذ.\nخلال 5 إلى 10 دقائق بتبدأ المشاهدات توصل.\n\nبدك كمان زيادة؟`,
    blockedNew: (ctx) =>
      `يا ${nameOf(ctx)} خلّينا نكمل الطلب الحالي أول.\nإذا بدك أكثر من طلب أو كميات كبيرة، الموقع رح يكون أريح لك.`,
    rateLimited: (ctx, waitText) =>
      `على مهلك يا ${nameOf(ctx)}.\nخلّيني أرتّبها صح.\nجرّب بعد ${waitText}.`
  }
};
