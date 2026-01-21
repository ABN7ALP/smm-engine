// لوحة التحكم الإدارية للبوت
// أضف هذا في نهاية src/index.js قبل bot.launch()

const adminCommands = {
  // عرض إحصائيات عامة
  stats: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    const totalUsers = database.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalRequests = database.prepare('SELECT COUNT(*) as count FROM requests').get().count;
    const completedRequests = database.prepare(
      "SELECT COUNT(*) as count FROM requests WHERE status='completed'"
    ).get().count;
    const totalReferrals = database.prepare('SELECT COUNT(*) as count FROM referrals').get().count;
    const completedReferrals = database.prepare(
      "SELECT COUNT(*) as count FROM referrals WHERE status='completed'"
    ).get().count;

    const totalViews = database.prepare(
      "SELECT SUM(amount) as total FROM requests WHERE status='completed'"
    ).get().total || 0;

    const statsMsg = `
📊 *احصائيات البوت*

👥 إجمالي المستخدمين: ${totalUsers}
📝 إجمالي الطلبات: ${totalRequests}
✅ الطلبات المكتملة: ${completedRequests}
⏳ الطلبات المعلقة: ${totalRequests - completedRequests}

👥 الدعوات الكلية: ${totalReferrals}
✅ الدعوات الناجحة: ${completedReferrals}

👁️ إجمالي المشاهدات المنفذة: ${totalViews.toLocaleString()}

📈 معدل النجاح: ${((completedRequests / totalRequests) * 100).toFixed(2)}%
`;

    ctx.reply(statsMsg);
  },

  // عرض آخر الطلبات
  requests: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    const recentRequests = database.prepare(`
      SELECT r.*, u.first_name, u.username
      FROM requests r
      JOIN users u ON r.telegram_id = u.telegram_id
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all();

    let msg = '📋 *آخر 10 طلبات*\n\n';

    recentRequests.forEach((req, idx) => {
      const date = new Date(req.created_at).toLocaleString('ar-SA');
      const status = req.status === 'completed' ? '✅' : req.status === 'pending' ? '⏳' : '❌';
      msg += `${idx + 1}. ${status} ${req.first_name} - ${req.amount} مشاهدة\n`;
      msg += `   الحالة: ${req.status} (${req.progress}%)\n`;
      msg += `   التاريخ: ${date}\n\n`;
    });

    ctx.reply(msg);
  },

  // عرض المستخدمين الأكثر نشاطاً
  topUsers: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    const topUsers = database.prepare(`
      SELECT u.first_name, u.username, COUNT(r.id) as request_count, SUM(r.amount) as total_views
      FROM users u
      LEFT JOIN requests r ON u.telegram_id = r.telegram_id
      GROUP BY u.telegram_id
      ORDER BY request_count DESC
      LIMIT 10
    `).all();

    let msg = '⭐ *أفضل 10 مستخدمين*\n\n';

    topUsers.forEach((user, idx) => {
      msg += `${idx + 1}. ${user.first_name} (@${user.username || 'N/A'})\n`;
      msg += `   الطلبات: ${user.request_count || 0}\n`;
      msg += `   المشاهدات: ${(user.total_views || 0).toLocaleString()}\n\n`;
    });

    ctx.reply(msg);
  },

  // عرض الدعوات الناجحة
  referralsReport: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    const topReferrers = database.prepare(`
      SELECT u.first_name, u.username, COUNT(r.id) as completed_count
      FROM users u
      LEFT JOIN referrals r ON u.telegram_id = r.referrer_id AND r.status='completed'
      GROUP BY u.telegram_id
      HAVING completed_count > 0
      ORDER BY completed_count DESC
      LIMIT 10
    `).all();

    let msg = '🎯 *أفضل الرافعين (Referrers)*\n\n';

    topReferrers.forEach((user, idx) => {
      const bonus = (user.completed_count || 0) * 5000;
      msg += `${idx + 1}. ${user.first_name} (@${user.username || 'N/A'})\n`;
      msg += `   الدعوات الناجحة: ${user.completed_count || 0}\n`;
      msg += `   المكافأة المستحقة: ${bonus.toLocaleString()} مشاهدة\n\n`;
    });

    ctx.reply(msg);
  },

  // إرسال إعلان عام
  broadcast: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    const users = database.prepare('SELECT telegram_id FROM users').all();
    let sent = 0;
    let failed = 0;

    const broadcastMsg = ctx.message.text.replace('/broadcast ', '');

    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.telegram_id, broadcastMsg);
        sent++;
      } catch (err) {
        failed++;
      }
    }

    ctx.reply(`📢 تم الإرسال!\n✅ نجح: ${sent}\n❌ فشل: ${failed}`);
  },

  // حذف طلب (للاختبار)
  deleteRequest: async (ctx) => {
    if (String(ctx.from.id) !== ADMIN_ID) {
      return ctx.reply('❌ ليس لديك صلاحية');
    }

    const requestId = ctx.message.text.split(' ')[1];
    if (!requestId) {
      return ctx.reply('استخدم: /delete_request <id>');
    }

    const Database = require('better-sqlite3');
    const database = new Database('bot.sqlite');

    database.prepare('DELETE FROM requests WHERE id=?').run(requestId);
    ctx.reply(`✅ تم حذف الطلب #${requestId}`);
  }
};

// سجل الأوامر الإدارية
bot.command('stats', ctx => adminCommands.stats(ctx));
bot.command('requests', ctx => adminCommands.requests(ctx));
bot.command('top_users', ctx => adminCommands.topUsers(ctx));
bot.command('referrals_report', ctx => adminCommands.referralsReport(ctx));
bot.command('broadcast', ctx => {
  if (ctx.message.text.split(' ').length < 2) {
    return ctx.reply('استخدم: /broadcast <message>');
  }
  adminCommands.broadcast(ctx);
});
bot.command('delete_request', ctx => adminCommands.deleteRequest(ctx));

// أمر مساعدة للمسؤول
bot.command('admin_help', ctx => {
  if (String(ctx.from.id) !== ADMIN_ID) {
    return ctx.reply('❌ ليس لديك صلاحية');
  }

  const helpMsg = `
🔧 *أوامر الإدارة*

/stats - عرض الإحصائيات العامة
/requests - آخر 10 طلبات
/top_users - أفضل المستخدمين
/referrals_report - تقرير الدعوات
/broadcast <message> - إرسال رسالة لجميع المستخدمين
/delete_request <id> - حذف طلب

📊 المعلومات الرئيسية:
• عدد المستخدمين النشطين
• معدل التحويل
• أفضل الرافعين (Referrers)
• الإيرادات المتوقعة
`;

  ctx.reply(helpMsg);
});

module.exports = adminCommands;
