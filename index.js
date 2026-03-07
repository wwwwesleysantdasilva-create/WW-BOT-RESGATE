
import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

const PRODUCTS = {
  INJECT: { name: "💉 Inject Pack", group: -1003801083393 },
  PHARM: { name: "🧪 Pharmacy Pack", group: -1003705721917 },
  AIMLOCK: { name: "🚂 Aimlock Pack", group: -1003350845729 }
};

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database("./database.sqlite");

let state = {};
let conversations = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS keys (
    key TEXT UNIQUE,
    product TEXT,
    used INTEGER DEFAULT 0
  )`);
});

/* ================= HELPERS ================= */

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const genKey = (prefix) =>
  `${prefix}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

const isAdmin = (id, cb) => {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT id FROM admins WHERE id=?`, [id], (_, r) => cb(!!r));
};

function logMsg(uid, sender, text) {
  if (!conversations[uid]) return;
  conversations[uid].messages.push({
    time: nowBR(),
    sender,
    text
  });
}

function generateTXT(uid) {
  const c = conversations[uid];
  if (!c) return null;

  let content = `===== LOG DE ATENDIMENTO =====

Usuário:
Nome: ${c.user.first_name || ""}
Username: @${c.user.username || "N/A"}
ID: ${c.user.id}

Produto:
${c.product?.name || "NÃO SELECIONADO"}

Key:
${c.key || "NÃO INFORMADA"} (${c.valid === null ? "N/A" : c.valid ? "VÁLIDA" : "INVÁLIDA"})

Grupo Liberado:
${c.group || "NENHUM"}

Horário Entrada (CONFIRMADO):
${c.joinTime || "NÃO ENTROU"}

===== CONVERSA =====
`;

  c.messages.forEach(m => {
    content += `[${m.time}] ${m.sender}: ${m.text}\n`;
  });

  const path = `./log_${uid}_${Date.now()}.txt`;
  fs.writeFileSync(path, content);
  return path;
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const userName = msg.from.first_name || "Usuário";

  conversations[id] = {
    user: msg.from,
    product: null,
    key: null,
    valid: null,
    group: null,
    joinTime: null,
    messages: []
  };

  state[id] = null;
  logMsg(id, `👤 ${userName}`, "/start");

  isAdmin(id, (isAdm) => {
    const keyboard = [
      [{ text: "💉 Inject Pack", callback_data: "user_INJECT" }],
      [{ text: "🧪 Pharmacy Pack", callback_data: "user_PHARM" }],
      [{ text: "🚂 Aimlock Pack", callback_data: "user_AIMLOCK" }]
    ];

    if (isAdm) {
      keyboard.push([{ text: "🛠 Painel Admin", callback_data: "admin_panel" }]);
    }
    
const fs = require('fs');

// Lê a URL ou caminho da foto
let startPhoto = null;

if (fs.existsSync("./start_photo.txt")) {
  const content = fs.readFileSync("./start_photo.txt", "utf8").trim();
  if (content && (content.startsWith("http://") || content.startsWith("https://") || fs.existsSync(content))) {
    startPhoto = content;
  }
}

// Envia a foto apenas se for válida
if (startPhoto) {
  bot.sendPhoto(msg.chat.id, startPhoto, {
    caption: "🍷 <b>Olá, seja bem-vindo! Aqui vocês irão resgatar seu Pack!</b>\n\nEscolha uma opção:",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: keyboard
    }
  }).catch(err => {
    console.error("Erro ao enviar foto:", err);
    // Envia só a mensagem se a foto falhar
    bot.sendMessage(msg.chat.id, "🍷 <b>Olá, seja bem-vindo! Aqui vocês irão resgatar seu Pack!</b>\n\nEscolha uma opção:", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard }
    });
  });
} else {
  // Se não houver foto, envia apenas a mensagem
  bot.sendMessage(msg.chat.id, "🍷 <b>Olá, seja bem-vindo! Aqui vocês irão resgatar seu Pack!</b>\n\nEscolha uma opção:", {
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard }
  });
}

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;
  const userName = q.from.first_name || "Usuário";

  if (q.data === "admin_panel") {
    return isAdmin(id, (ok) => {
      if (!ok) return;
      
if (q.data === "admin_start_img") {
  if (id !== MASTER_ADMIN) return;
  state[id] = { step: "await_start_photo" };

  return bot.sendMessage(chat, "📷 Envie a foto para usar no /start");
}
      state[id] = null;

      const buttons = [
        [{ text: "🔑 Gerar Keys", callback_data: "admin_gen" }]
      ];

      if (id === MASTER_ADMIN) {
        buttons.push(
          [{ text: "📷 Definir imagem start", callback_data: "admin_start_img" }]
          [{ text: "➕ Add Admin", callback_data: "admin_add" }],
          [{ text: "➖ Remover Admin", callback_data: "admin_remove" }]
        );
      }

      bot.sendMessage(chat, "🛠 <b>Painel Administrativo</b>", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: buttons }
      });

      logMsg(id, "🤖 BOT", "Painel admin aberto");
    });
  }

  if (q.data === "admin_gen") {
    state[id] = { step: "gen_choose" };
    return bot.sendMessage(chat, "Escolha o pack:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💉 Inject", callback_data: "gen_INJECT" }],
          [{ text: "🧪 Pharmacy", callback_data: "gen_PHARM" }],
          [{ text: "🚂 Aimlock", callback_data: "gen_AIMLOCK" }]
        ]
      }
    });
  }

  if (q.data === "admin_add" && id === MASTER_ADMIN) {
    state[id] = { step: "add_admin" };
    return bot.sendMessage(chat, "Envie o ID do novo admin:");
  }

  if (q.data === "admin_remove" && id === MASTER_ADMIN) {
    state[id] = { step: "remove_admin" };
    return bot.sendMessage(chat, "Envie o ID do admin para remover:");
  }

  if (q.data.startsWith("gen_")) {
    state[id] = { step: "gen_qty", product: q.data.replace("gen_", "") };
    return bot.sendMessage(chat, "Quantas keys deseja gerar?");
  }

  if (q.data.startsWith("user_")) {
    const product = q.data.replace("user_", "");
    state[id] = { step: "await_key", product };

    conversations[id].product = PRODUCTS[product];
    logMsg(id, `👤 ${userName}`, PRODUCTS[product].name);

    bot.sendMessage(
      chat,
      `📦 <b>${PRODUCTS[product].name}</b>\n\nEnvie sua <b>KEY</b>:`,
      { parse_mode: "HTML" }
    );
  }
});

/* ================= MESSAGES ================= */

bot.on("message", (msg) => {
  if (msg.text?.startsWith("/")) return; // 🔥 CORREÇÃO

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;
  
  if (state[id]?.step === "await_start_photo" && msg.photo) {

  const photo = msg.photo[msg.photo.length - 1].file_id;

  fs.writeFileSync("./start_photo.txt", photo);

  state[id] = null;

  return bot.sendMessage(msg.chat.id, "✅ Imagem do /start salva!");
}

  const userName = msg.from.first_name || "Usuário";
  logMsg(id, `👤 ${userName}`, text);

  if (state[id]?.step === "add_admin" && id === MASTER_ADMIN) {
    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin adicionado.");
  }

  if (state[id]?.step === "remove_admin" && id === MASTER_ADMIN) {
    db.run(`DELETE FROM admins WHERE id=?`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin removido.");
  }

  if (state[id]?.step === "gen_qty") {
    const qty = parseInt(text);
    if (!qty || qty < 1 || qty > 100)
      return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida.");

    const prefix = state[id].product;
    let keys = [];

    for (let i = 0; i < qty; i++) {
      const key = genKey(prefix);
      keys.push(key);
      db.run(`INSERT INTO keys (key, product, used) VALUES (?, ?, 0)`, [
        key,
        prefix
      ]);
    }

    state[id] = null;
    return bot.sendMessage(
      msg.chat.id,
      `✅ Keys geradas:\n\n<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );
  }

  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    const product = PRODUCTS[productKey];

    conversations[id].key = text;

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        conversations[id].valid = false;
        return bot.sendMessage(msg.chat.id, "❌ Key inválida.");
      }

      const invite = await bot.createChatInviteLink(product.group, {
        member_limit: 1
      });

      db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);

      conversations[id].valid = true;
      conversations[id].group = product.group;
      conversations[id].joinTime = nowBR();

      bot.sendMessage(
        msg.chat.id,
        `✅ <b>Resgate concluído!</b>\n\n${invite.invite_link}`,
        { parse_mode: "HTML" }
      );

      const file = generateTXT(id);
      bot.sendDocument(LOG_GROUP_ID, file, {
        caption: `✅ RESGATE CONFIRMADO\n📦 ${product.name}\n👤 ${userName}\n🕒 ${nowBR()}`
      });

      state[id] = null;
      delete conversations[id];
    });
  }
});

/* ===== FIX POLLING ERROR ===== */
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code);
});

console.log("🤖 BOT ONLINE — LOGS APENAS APÓS RESGATE");