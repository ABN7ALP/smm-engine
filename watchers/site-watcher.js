// watchers/site-watcher.js
const axios = require("axios");
const connectDB = require("../db");

// الآن الدالة تقبل "siteName" كمعلمة جديدة
module.exports = function startSiteWatcher(siteName, config, bot, chatId) {
    // اسم الـ collection سيكون فريداً لكل موقع، مثلاً "services_secsers"
    const collectionName = `services_${siteName}`;

    async function check() {
        try {
            const db = await connectDB();
            const servicesCollection = db.collection(collectionName);

            const response = await axios.post(config.url, {
                key: config.key,
                action: "services"
            });

            const newData = response.data;
            const oldData = await servicesCollection.find().toArray();

            if (oldData.length === 0) {
                if (newData.length > 0) {
                    await servicesCollection.insertMany(newData);
                    console.log(`[${siteName}] Initialized with ${newData.length} services.`);
                    bot.sendMessage(chatId, `✅ [${siteName}] تم تهيئة قاعدة البيانات بـ ${newData.length} خدمة.`);
                }
                return;
            }

            const oldMap = {};
            oldData.forEach(s => oldMap[s.service] = s);

            const changes = { new: [], deleted: [], price: [], name: [], category: [] };
            let totalChanges = 0;
            const operations = [];

            for (const s of newData) {
                const old = oldMap[s.service];

                if (!old) {
                    changes.new.push(`• ${s.name} (ID: ${s.service})`);
                    totalChanges++;
                    operations.push({ insertOne: { document: s } });
                    continue;
                }

                let hasChanged = false;
                if (old.rate !== s.rate) {
                    changes.price.push(`• ${s.name}: ${old.rate} → ${s.rate}`);
                    totalChanges++;
                    hasChanged = true;
                }
                if (old.name !== s.name) {
                    changes.name.push(`• ID ${s.service}: "${old.name}" → "${s.name}"`);
                    totalChanges++;
                    hasChanged = true;
                }
                if (old.category !== s.category) {
                    changes.category.push(`• ${s.name}: ${old.category} → ${s.category}`);
                    totalChanges++;
                    hasChanged = true;
                }

                if (hasChanged) {
                    operations.push({
                        updateOne: { filter: { service: s.service }, update: { $set: s } }
                    });
                }
            }

            const newIds = newData.map(s => s.service);
            oldData.forEach(s => {
                if (!newIds.includes(s.service)) {
                    changes.deleted.push(`• ${s.name} (ID: ${s.service})`);
                    totalChanges++;
                    operations.push({ deleteOne: { filter: { service: s.service } } });
                }
            });

            if (totalChanges > 0) {
                let message = `📢 **[${siteName}] ملخص التحديثات (${totalChanges} تغييرات)** 📢\n\n`;

                if (changes.price.length > 0) { message += `🔔 **تغييرات الأسعار (${changes.price.length})**\n${changes.price.join('\n')}\n\n`; }
                if (changes.new.length > 0) { message += `🟢 **خدمات جديدة (${changes.new.length})**\n${changes.new.join('\n')}\n\n`; }
                if (changes.deleted.length > 0) { message += `🔴 **خدمات محذوفة (${changes.deleted.length})**\n${changes.deleted.join('\n')}\n\n`; }
                if (changes.name.length > 0) { message += `✏️ **تغييرات الأسماء (${changes.name.length})**\n${changes.name.join('\n')}\n\n`; }
                if (changes.category.length > 0) { message += `📂 **تغييرات الفئات (${changes.category.length})**\n${changes.category.join('\n')}\n\n`; }

                try {
                    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
                } catch (e) {
                    await bot.sendMessage(chatId, `⚠️ [${siteName}] فشل إرسال ملخص التحديثات. تم اكتشاف ${totalChanges} تغيير.`);
                }

                if (operations.length > 0) {
                    await servicesCollection.bulkWrite(operations);
                }
            }

        } catch (err) {
            console.log(`Error for site ${siteName}:`, err.response?.data || err.message);
            bot.sendMessage(chatId, `⚠️ [${siteName}] حدث خطأ أثناء التحقق من الخدمات:\n${err.message}`);
        }
    }

    setInterval(check, config.interval * 1000);
    console.log(`[${siteName}] watcher started with interval ${config.interval}s.`);
};
