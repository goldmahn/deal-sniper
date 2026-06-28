const axios = require("axios");
require("dotenv").config();

async function sendHealthTelegramMessage(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    const error = new Error("Missing Telegram environment variables for health alerts.");
    error.code = "HEALTH_TELEGRAM_CONFIG_MISSING";
    throw error;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text: message,
  });
}

module.exports = { sendHealthTelegramMessage };
