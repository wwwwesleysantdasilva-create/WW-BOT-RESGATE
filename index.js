import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";
import fs from "fs";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

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
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT UNIQUE,
    name TEXT,
    group_id INTEGER
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

// TRAVA DE SEGURANÇA: Função para garantir que a memória do usuário existe
function garantirMemoria(id, fromUser) {
  if (!conversations[id]) {
    conversations[id] = {
      user: fromUser,
      product: null,
      key: null,
      valid: null,
      group: null,
      joinTime: null,
      messages: []
    };
  }
}

/* ================= START ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  const userName = msg.from.first_name || "Usuário";

  garantirMemoria(id, msg.from);
  state[id] = null;
  logMsg(id, `👤 ${userName}`, "/start");

  isAdmin(id, (isAdm) => {
    db.all(`SELECT * FROM products`, [], (err, products) => {
      const keyboard = [];
      
      products.forEach(p => {
        keyboard.push([{ text: p.name, callback_data: `user_${p.id}` }]);
      });

      if (isAdm) {
        keyboard.push([{ text: "🛠 Painel Admin", callback_data: "admin_panel" }]);
      }

      if (keyboard.length === 0 && !isAdm) {
          return bot.sendMessage(msg.chat.id, "🚧 A loja está sendo configurada no momento. Volte mais tarde!");
      }

      bot.sendMessage(
        msg.chat.id,
        "👋 <b>Olá, seja bem-vindo!</b>\n\nEscolha o produto que você comprou:",
        {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard }
        }
      );
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;
  const userName = q.from.first_name || "Usuário";

  // Aplica a trava de segurança antes de fazer qualquer coisa
  garantirMemoria(id, q.from);

  if (q.data === "admin_panel") {
    return isAdmin(id, (ok) => {
      if (!ok) return;

      state[id] = null;

      const buttons = [
        [{ text: "🔑 Gerar Keys", callback_data: "admin_gen" }],
        [{ text: "📦 Add Produto", callback_data: "admin_add_prod" }],
        [{ text: "🗑️ Remover Produto", callback_data: "admin_rem_prod" }]
      ];

      if (id === MASTER_ADMIN) {
        buttons.push(
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

  if (q.data === "admin_add_prod") {
    state[id] = { step: "add_prod_id" };
    return bot.sendMessage(chat, "<b>PASSO 1/3</b>\n\nDigite um código curto para o bot identificar o produto (sem espaços).\n<i>Exemplo: SENSI, MACRO, VIP</i>", { parse_mode: "HTML" });
  }

  if (q.data === "admin_rem_prod") {
    state[id] = null;
    db.all(`SELECT * FROM products`, [], (err, products) => {
      if (products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado no momento.");
      
      const keyboard = products.map(p => [{ text: `❌ Deletar: ${p.name}`, callback_data: `delprod_${p.id}` }]);
      
      return bot.sendMessage(chat, "Escolha qual produto você deseja <b>REMOVER</b> do bot:", {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: keyboard }
      });
    });
    return;
  }

  if (q.data.startsWith("delprod_")) {
    const prodId = q.data.replace("delprod_", "");
    db.run(`DELETE FROM products WHERE id=?`, [prodId]);
    return bot.sendMessage(chat, `✅ Produto apagado com sucesso! Ele não vai mais aparecer no painel.`);
  }

  if (q.data === "admin_gen") {
    state[id] = { step: "gen_choose" };
    
    db.all(`SELECT * FROM products`, [], (err, products) => {
      if (products.length === 0) return bot.sendMessage(chat, "❌ Adicione um produto primeiro no Painel Admin.");

      const keyboard = [];
      products.forEach(p => {
        keyboard.push([{ text: p.name, callback_data: `gen_${p.id}` }]);
      });

      return bot.sendMessage(chat, "Escolha para qual produto deseja gerar keys:", {
        reply_markup: { inline_keyboard: keyboard }
      });
    });
    return;
  }

  if (q.data === "admin_add" && id === MASTER_ADMIN) {
    state[id] = { step: "add_admin" };
    return bot.sendMessage(chat, "Envie o ID numérico do novo admin:");
  }

  if (q.data === "admin_remove" && id === MASTER_ADMIN) {
    state[id] = { step: "remove_admin" };
    return bot.sendMessage(chat, "Envie o ID numérico do admin para remover:");
  }

  if (q.data.startsWith("gen_")) {
    state[id] = { step: "gen_qty", product: q.data.replace("gen_", "") };
    return bot.sendMessage(chat, "Quantas keys deseja gerar? (Exemplo: 10)");
  }

  if (q.data.startsWith("user_")) {
    const productId = q.data.replace("user_", "");
    state[id] = { step: "await_key", product: productId };

    db.get(`SELECT * FROM products WHERE id=?`, [productId], (err, product) => {
      if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");

      conversations[id].product = product;
      logMsg(id, `👤 ${userName}`, product.name);

      bot.sendMessage(
        chat,
        `📦 <b>${product.name}</b>\n\nEnvie sua <b>KEY</b> de acesso abaixo:`,
        { parse_mode: "HTML" }
      );
    });
  }
});

/* ================= MESSAGES ================= */

bot.on("message", (msg) => {
  if (msg.text?.startsWith("/")) return;

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  const userName = msg.from.first_name || "Usuário";
  
  // Aplica a trava de segurança antes de fazer qualquer coisa
  garantirMemoria(id, msg.from);
  logMsg(id, `👤 ${userName}`, text);

  if (state[id]?.step === "add_prod_id") {
    state[id].tempId = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    state[id].step = "add_prod_name";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 2/3</b>\n\nQual o NOME do produto que vai aparecer no botão para o cliente?\n<i>Exemplo: 💎 Pack Sensi VIP</i>", { parse_mode: "HTML" });
  }

  if (state[id]?.step === "add_prod_name") {
    state[id].tempName = text;
    state[id].step = "add_prod_group";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 3/3</b>\n\nPor fim, envie o ID do Grupo/Canal secreto.\n<i>Lembrando: Tem que ter o menos (-) na frente (Ex: -100123456789) e o bot precisa ser Admin lá!</i>", { parse_mode: "HTML" });
  }

  if (state[id]?.step === "add_prod_group") {
    const groupId = Number(text);
    if (isNaN(groupId)) return bot.sendMessage(msg.chat.id, "❌ ID inválido. Tente novamente enviando apenas os números com o sinal de menos.");
    
    db.run(`INSERT OR REPLACE INTO products (id, name, group_id) VALUES (?, ?, ?)`, [state[id].tempId, state[id].tempName, groupId]);
    bot.sendMessage(msg.chat.id, `✅ Sucesso! O produto <b>${state[id].tempName}</b> foi adicionado à sua vitrine.`, { parse_mode: "HTML" });
    state[id] = null;
    return;
  }

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
      return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida. Envie um número entre 1 e 100.");

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
      `✅ Keys geradas com sucesso:\n\n<pre>${keys.join("\n")}</pre>`,
      { parse_mode: "HTML" }
    );
  }

  if (state[id]?.step === "await_key") {
    const productKey = state[id].product;
    conversations[id].key = text;

    db.get(`SELECT * FROM keys WHERE key=?`, [text], async (_, row) => {
      if (!row || row.used || row.product !== productKey) {
        conversations[id].valid = false;
        return bot.sendMessage(msg.chat.id, "❌ Key inválida ou já utilizada.");
      }

      db.get(`SELECT * FROM products WHERE id=?`, [productKey], async (err, product) => {
        if (!product) return bot.sendMessage(msg.chat.id, "❌ Erro: Este produto não está mais disponível.");

        try {
          const invite = await bot.createChatInviteLink(product.group_id, {
            member_limit: 1
          });

          db.run(`UPDATE keys SET used=1 WHERE key=?`, [text]);

          conversations[id].valid = true;
          conversations[id].group = product.group_id;
          conversations[id].joinTime = nowBR();

          bot.sendMessage(
            msg.chat.id,
            `✅ <b>Acesso Liberado!</b>\n\nClique no link abaixo para acessad seu pack:\n${invite.invite_link}`,
            { parse_mode: "HTML" }
          );

          const file = generateTXT(id);
          bot.sendDocument(LOG_GROUP_ID, file, {
            caption: `✅ NOVO RESGATE CONFIRMADO\n📦 Produto: ${product.name}\n👤 Cliente: ${userName}\n🕒 Hora: ${nowBR()}`
          });
        } catch (error) {
          bot.sendMessage(msg.chat.id, "❌ Falha no sistema. Por favor, avise o suporte que o bot precisa ser promovido a Administrador do grupo VIP.");
        }

        state[id] = null;
        delete conversations[id];
      });
    });
  }
});

/* ===== FIX POLLING ERROR ===== */
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code);
});

console.log("🤖 BOT ONLINE — MEMÓRIA BLINDADA CONTRA REBOOTS");
