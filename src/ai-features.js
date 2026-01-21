// نظام الذكاء الاصطناعي المتقدم للبوت

const db = require('./db');

/**
 * نظام إعادة التفاعل الذكي
 * يتابع المستخدمين الذين لم يردوا
 */
class SmartReEngagement {
  constructor(bot, botToken) {
    this.bot = bot;
    this.botToken = botToken;
    this.reEngagementMessages = [
      {
        delay: 5 * 60 * 1000, // 5 دقائق
        message: 'يبدو أنك اشتغلت على شي آخر 😊\n\nخلّني أساعدك بـ 5,000 مشاهدة مجاناً؟',
        emoji: '💡'
      },
      {
        delay: 15 * 60 * 1000, // 15 دقيقة
        message: 'ما زلت هنا 👋\n\nلو في سؤال ما حول الخدمة، أنا متاح!\n\nبدك تبدأ الآن؟',
        emoji: '🤔'
      },
      {
        delay: 30 * 60 * 1000, // 30 دقيقة
        message: 'فرصة ذهبية! 🔥\n\nالعرض المجاني ما زال متوفر\n\nهاي أكبر زيادة مشاهدات مجاناً!',
        emoji: '🎁'
      }
    ];
  }

  async trackUserInactivity(userId) {
    const lastInteraction = new Date(db.getLastCompletedRequest(userId, 24)?.completed_at || Date.now());
    const inactivityTime = Date.now() - lastInteraction.getTime();

    // إذا كان المستخدم غير نشط لأكثر من 1 ساعة
    if (inactivityTime > 3600000) {
      await this.sendSmartMessage(userId, 'inactivity');
    }
  }

  async sendSmartMessage(userId, type) {
    try {
      const msgConfig = this.reEngagementMessages[Math.floor(Math.random() * this.reEngagementMessages.length)];
      
      await this.bot.telegram.sendMessage(
        userId,
        msgConfig.message,
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ نعم، ابدأ الآن!', callback_data: 'AMOUNT_5000' }],
              [{ text: '❌ لاحقاً', callback_data: 'REMIND_LATER' }]
            ]
          }
        }
      );
    } catch (err) {
      console.log('Smart message not sent:', err.message);
    }
  }
}

/**
 * نظام التحليل الذكي للمحادثة
 */
class ConversationAnalyzer {
  analyzeUserBehavior(userId) {
    const interactions = db.getUserInteractions(userId);
    
    return {
      engagementLevel: this.calculateEngagement(interactions),
      likelihood: this.predictConversion(interactions),
      bestOfferTime: this.findBestOfferTime(interactions),
      sentiment: this.analyzeSentiment(interactions)
    };
  }

  calculateEngagement(interactions) {
    if (!interactions || interactions.length === 0) return 'low';
    
    const lastInteraction = new Date(interactions[0].created_at);
    const daysSinceLastInteraction = (Date.now() - lastInteraction) / (1000 * 60 * 60 * 24);

    if (daysSinceLastInteraction < 1) return 'high';
    if (daysSinceLastInteraction < 7) return 'medium';
    return 'low';
  }

  predictConversion(interactions) {
    let score = 0;
    
    interactions.forEach(interaction => {
      if (interaction.interaction_type === 'request_created') score += 30;
      if (interaction.interaction_type === 'site_verified') score += 20;
      if (interaction.interaction_type === 'referral_sent') score += 25;
    });

    return Math.min(score, 100);
  }

  findBestOfferTime(interactions) {
    const times = interactions.map(i => new Date(i.created_at).getHours());
    const frequency = {};
    
    times.forEach(hour => {
      frequency[hour] = (frequency[hour] || 0) + 1;
    });

    return Object.keys(frequency).reduce((a, b) => 
      frequency[a] > frequency[b] ? a : b
    );
  }

  analyzeSentiment(interactions) {
    const positiveActions = ['confirmed', 'verified', 'referral_sent'];
    const negativeActions = ['cancelled', 'blocked'];
    
    let positive = 0, negative = 0;

    interactions.forEach(i => {
      if (positiveActions.includes(i.interaction_type)) positive++;
      if (negativeActions.includes(i.interaction_type)) negative++;
    });

    if (positive > negative) return 'positive';
    if (negative > positive) return 'negative';
    return 'neutral';
  }
}

/**
 * نظام الرسائل الشخصية الذكية
 */
class PersonalizedMessaging {
  getPersonalizedGreeting(userName, engagementLevel) {
    const greetings = {
      high: [
        `يا النجم ${userName}! 🌟 معاك أكبر عرض اليوم`,
        `${userName}! فرصة ذهبية بانتظارك 🔥`
      ],
      medium: [
        `أهلاً يا ${userName}! شنو أخبارك؟`,
        `يا ${userName}! في عرض جديد لك`
      ],
      low: [
        `اشتقنا لك يا ${userName}! 😊`,
        `${userName}! ليش ما ردك علينا؟`
      ]
    };

    const msgs = greetings[engagementLevel] || greetings.medium;
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  getUpsellMessage(userStats) {
    const scripts = {
      firstTime: 'هاي أول مرة؟ احصل على 10,000 مشاهدة مجاناً! 🎁',
      repeat: `أنت أيقونة! جرب 5000 مشاهدة إضافية مجاناً 🚀`,
      referral: `ادعو أصدقائك واحصل على مكافآت! 👥💰`,
      site_visitor: `شكراً لزيارتك للموقع! إليك مكافأة إضافية 🎉`
    };

    return scripts[userStats.lastAction] || scripts.firstTime;
  }
}

/**
 * نظام التوقيت الذكي
 */
class SmartTiming {
  shouldShowOffer(userId) {
    const lastRequest = db.getLastCompletedRequest(userId, 24);
    if (!lastRequest) return true;

    const hoursSinceLastRequest = (Date.now() - lastRequest.completed_at) / (1000 * 60 * 60);
    return hoursSinceLastRequest >= 2; // عروض كل ساعتين على الأقل
  }

  getOptimalOfferTime(userId) {
    const interactions = db.getUserInteractions(userId);
    if (!interactions || interactions.length === 0) return 'now';

    const hours = interactions.map(i => new Date(i.created_at).getHours());
    const mostActiveHour = Math.floor(hours.reduce((a, b) => a + b) / hours.length);

    return {
      hour: mostActiveHour,
      isNow: new Date().getHours() === mostActiveHour
    };
  }
}

module.exports = {
  SmartReEngagement,
  ConversationAnalyzer,
  PersonalizedMessaging,
  SmartTiming
};
