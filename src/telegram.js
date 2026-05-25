const axios = require("axios");
require("dotenv").config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

async function sendTelegramMessage(message) {
  if (!token || !chatId) {
    console.error("Missing Telegram environment variables.");
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    await axios.post(url, {
      chat_id: chatId,
      text: message,
    });

    console.log("Telegram alert sent.");
  } catch (error) {
    console.error("Telegram error:", error.message);
  }
}

module.exports = { sendTelegramMessage };
