// watchers/ucuzpanel.js
const axios = require("axios");
const connectDB = require("../db"); // استيراد دالة الاتصال

module.exports = function startUcuzWatcher(config, bot, chatId) {
    // اسم الـ collection الذي سنخزن فيه البيانات
    const collectionName = "ucuzpanel_services";

    async function check() {
        try {
            const db = await connectDB();
            const servicesCollection = db.collection(collectionName);

            const response = await axios.post(config.url, {
                key: config.key,
                action: "services"
            });

            const newData = response.data;
            // جلب البيانات القديمة من قاعدة البيانات
            const oldData = await servicesCollection.find().toArray();

            if (oldData.length === 0) {
                // إذا كانت هذه هي المرة الأولى، فقط قم بتخزين البيانات
                if (newData.length > 0) {
                    await servicesCollection.insertMany(newData);
                    console.log(`Initialized with ${newData.length} services.`);
                    bot.sendMessage(chatId, `✅ تم تهيئة قاعدة البيانات بـ ${newData.length} خدمة.`);
                }
                return;
            }

            const oldMap = {};
            oldData.forEach(s => oldMap[s.service] = s);

            const operations = []; // لتجميع عمليات التحديث

            for (const s of newData) {
                const old = oldMap[s.service];

                if (!old) {
                    bot.sendMessage(chatId,
                        `🟢 خدمة جديدة\n${s.name}\nID: ${s.service}\nالسعر: ${s.rate}`
                    );
                    // إضافة عملية إدراج للخدمة الجديدة
                    operations.push({ insertOne: { document: s } });
                    continue;
                }

                if (old.rate !== s.rate) {
                    bot.sendMessage(chatId,
                        `🔔 تغيّر سعر\nاسم: ${s.name}\nID: ${s.service}\n${old.rate} → ${s.rate}`
                    );
                }

                if (old.name !== s.name) {
                    bot.sendMessage(chatId,
                        `✏️ تغيّر اسم خدمة\nمن ${old.name}\nإلى ${s.name}`
                    );
                }

                if (old.category !== s.category) {
                    bot.sendMessage(chatId,
                        `📂 تغيّر فئة خدمة ${s.name}\n${old.category} → ${s.category}`
                    );
                }

                // إضافة عملية تحديث للخدمة الحالية
                operations.push({
                    updateOne: {
                        filter: { service: s.service },
                        update: { $set: s }
                    }
                });
            }

            const newIds = newData.map(s => s.service);
            oldData.forEach(s => {
                if (!newIds.includes(s.service)) {
                    bot.sendMessage(chatId,
                        `🔴 خدمة محذوفة\n${s.name}\nID: ${s.service}`
                    );
                    // إضافة عملية حذف للخدمة المحذوفة
                    operations.push({ deleteOne: { filter: { service: s.service } } });
                }
            });

            // تنفيذ جميع التغييرات على قاعدة البيانات دفعة واحدة
            if (operations.length > 0) {
                await servicesCollection.bulkWrite(operations);
            }

        } catch (err) {
            console.log("Error:", err.response?.data || err.message);
            // يمكنك إضافة إشعار تليجرام هنا لإعلامك بالخطأ
            bot.sendMessage(chatId, `⚠️ حدث خطأ أثناء التحقق من الخدمات:\n${err.message}`);
        }
    }

    setInterval(check, config.interval * 1000);
    console.log("Ucuzpanel watcher started with MongoDB backend…");
};
