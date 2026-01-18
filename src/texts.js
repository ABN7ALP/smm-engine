function greetName(ctx) {
  const n = ctx.from?.first_name?.trim();
  return n ? n : 'صاحبي';
}

function startPitch(ctx, freeOptionsArr) {
  const name = greetName(ctx);
  return `أهلاً يا ${name}.\n\nحابب أساعدك بمشاهدات تيك توك مجاناً.\nاختر كمية مجانية (مرة واحدة أثناء التنفيذ): ${freeOptionsArr.join(' أو ')} مشاهدة.\n\nبس ابعتلي رابط الفيديو هون.`;
}

function pendingMsg(ctx, minutes) {
  const name = greetName(ctx);
  return `يا ${name} طلبك قيد التنفيذ حالياً.\nخلال ${minutes} دقائق تقريباً بيكون خلص.\nإذا بدك مشاهدات زيادة بسرعة، الموقع فيه عروض أحسن كمان.`;
}

function askUrlMsg(ctx) {
  const name = greetName(ctx);
  return `تمام يا ${name}.\nابعت رابط فيديو التيك توك (URL) هون.`;
}

function invalidUrlMsg(ctx) {
  return `الرابط مو واضح إنه تيك توك.\nابعت رابط مثل:\nhttps://www.tiktok.com/@user/video/1234567890`;
}

function previewMsg(ctx, amount, videoUrl, videoKey) {
  const name = greetName(ctx);
  return `تمام يا ${name}.\nلقيت الفيديو.\n\n- الرابط: ${videoUrl}\n- معرف الفيديو: ${videoKey || 'غير معروف'}\n- الكمية: ${amount} مشاهدة مجانية\n\nبدك أكد الطلب؟`;
}

function afterConfirmMsg(ctx) {
  const name = greetName(ctx);
  return `تم يا ${name}.\nطلبك دخل التنفيذ.\nخلال 5 إلى 10 دقائق بتبدأ المشاهدات توصل إن شاء الله.\n\nبدك مشاهدات أكتر مجاناً؟`;
}

function upsellNoMsg(ctx) {
  const name = greetName(ctx);
  return `تمام يا ${name}.\nبس تذكير سريع: في عروض مجانية على بعض الخدمات بالموقع، خصوصاً تيك توك.\nبدك أبعتلك الرابط؟`;
}

function blockedNewUrlMsg(ctx) {
  const name = greetName(ctx);
  return `يا ${name} خلّينا نخلص طلبك الحالي أول.\nإذا بدك كميات أكبر أو طلبات متعددة، بتلاقيها بالموقع بشكل أسهل وأسرع.`;
}

module.exports = {
  greetName,
  startPitch,
  pendingMsg,
  askUrlMsg,
  invalidUrlMsg,
  previewMsg,
  afterConfirmMsg,
  upsellNoMsg,
  blockedNewUrlMsg
};
