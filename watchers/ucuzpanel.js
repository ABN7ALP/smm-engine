const axios = require("axios");
const fs = require("fs");
const TelegramBot = require("node-telegram-bot-api");

module.exports = function startUcuzWatcher(config, bot, chatId) {
    const saveFile = `./data/ucuzpanel.json`;

    async function check() {
        try {
            const response = await axios.post(config.url, {
                key: config.key,
                action: "services"
            });

            const newData = response.data;
            let oldData = [];

            if (fs.existsSync(saveFile)) {
                oldData = JSON.parse(fs.readFileSync(saveFile));
            }

            const oldMap = {};
            oldData.forEach(s => oldMap[s.service] = s);

            for (const s of newData) {
                const old = oldMap[s.service];

                if (!old) {
                    bot.sendMessage(chatId,
                        `🟢 خدمة جديدة\n${s.name}\nID: ${s.service}\nالسعر: ${s.rate}`
                    );
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
            }

            const newIds = newData.map(s => s.service);
            oldData.forEach(s => {
                if (!newIds.includes(s.service)) {
                    bot.sendMessage(chatId,
                        `🔴 خدمة محذوفة\n${s.name}\nID: ${s.service}`
                    );
                }
            });

            fs.writeFileSync(saveFile, JSON.stringify(newData, null, 2));

        } catch (err) {
            console.log("Error:", err.message);
        }
    }

    setInterval(check, config.interval * 1000);
    console.log("Ucuzpanel watcher started…");
};
