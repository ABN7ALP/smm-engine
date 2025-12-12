const axios = require("axios");

axios.post("https://ucuzpanel.com/api/v2", {
    key: process.env.UCUZ_KEY,
    action: "services"
}).then(res => {
    console.log("✔️ API OK – البيانات رجعت:");
    console.log(res.data);
}).catch(err => {
    console.log("❌ API ERROR:");
    console.log(err.response?.data || err.message);
});
