const { sendTelegramMessage } = require("../src/telegram");

async function verifyTelegram() {
  await sendTelegramMessage("🚨 Deal Sniper online.");
}

if (require.main === module) {
  verifyTelegram().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { verifyTelegram };
