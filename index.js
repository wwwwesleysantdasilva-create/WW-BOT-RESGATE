import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

/* ================= INIT ================= */

const bot = new TelegramBot(BOT_TOKEN, { 
  polling: {
    params: {
      allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member"]
    }
  } 
});

const db = new sqlite3.Database("./database.sqlite");

let state = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT UNIQUE,
    name TEXT,
    group_id INTEGER
  )`);
});

/* ================= HELPERS ================= */

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const isAdmin = (id, cb) => {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT id FROM admins WHERE id=?`, [id], (_, r) => cb(!!r));
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ================= START / MENU ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  state[id] = null;

  isAdmin(id, (isAdm) => {
    if (!isAdm) {
      return bot.sendMessage(msg.chat.id, "🚧 Este é um bot administrativo privado de gestão de estoque.");
    }

    const buttons = [
      [{ text: "🔗 Gerar 100 Links (Estoque)", callback_data: "admin_gen" }],
      [{ text: "🔄 Grupos Sincronizados (Auto)", callback_data: "admin_sync_groups" }],
      [{ text: "✏️ Editar Nome de Produto", callback_data: "admin_edit_prod" }, { text: "🗑️ Remover Produto", callback_data: "admin_rem_prod" }]
    ];

    if (id === MASTER_ADMIN) {
      buttons.push(
        [{ text: "➕ Add Admin", callback_data: "admin_add" }, { text: "➖ Remover Admin", callback_data: "admin_remove" }]
      );
    }

    bot.sendMessage(msg.chat.id, "🛠 <b>Painel Estoquista — WW SENSI</b>\n\nO que deseja fazer?", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", async (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;

  isAdmin(id, async (ok) => {
    if (!ok) return;

    // CONSULTAR GRUPOS ONDE O BOT É ADMIN (AUTO-CADASTRADOS)
    if (q.data === "admin_sync_groups") {
      db.all(`SELECT * FROM products`, [], (err, rows) => {
        if (!rows || rows.length === 0) {
          return bot.sendMessage(chat, 
            "🔄 <b>Nenhum grupo detectado ainda.</b>\n\n" +
            "💡 Basta **adicionar o bot como Administrador** no seu grupo (e mandar uma mensagem lá) para que ele seja reconhecido e cadastrado automaticamente aqui!", 
            { parse_mode: "HTML" }
          );
        }
        
        let list = rows.map(r => `• <b>${r.name}</b> (ID: <code>${r.group_id}</code>)`).join("\n");
        return bot.sendMessage(chat, 
          `🔄 <b>Produtos/Grupos Detectados Automaticamente (${rows.length}):</b>\n\n${list}\n\n` +
          `<i>Para adicionar novos, basta promover o bot a Administrador no grupo desejado.</i>`, 
          { parse_mode: "HTML" }
        );
      });
      return;
    }

    // EDITAR APENAS NOME DO PRODUTO
    if (q.data === "admin_edit_prod") {
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado para editar.");
        const keyboard = products.map(p => [{ text: `✏️ Editar: ${p.name}`, callback_data: `editprod_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha qual produto deseja **renomear**:", { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      });
      return;
    }

    if (q.data.startsWith("editprod_")) {
      const prodId = q.data.replace("editprod_", "");
      db.get(`SELECT * FROM products WHERE id=?`, [prodId], (err, product) => {
        if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");
        state[id] = { step: "edit_prod_name_only", prodId: product.id };
        return bot.sendMessage(chat, `Produto selecionado: <b>${product.name}</b>\n\nDigite o **novo NOME** exibido para este produto:`, { parse_mode: "HTML" });
      });
      return;
    }

    // REMOVER PRODUTO
    if (q.data === "admin_rem_prod") {
      state[id] = null;
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado.");
        const keyboard = products.map(p => [{ text: `❌ Deletar: ${p.name}`, callback_data: `delprod_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha qual produto remover da lista:", { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      });
      return;
    }

    if (q.data.startsWith("delprod_")) {
      const prodId = q.data.replace("delprod_", "");
      db.run(`DELETE FROM products WHERE id=?`, [prodId]);
      return bot.sendMessage(chat, `✅ Produto removido com sucesso!`);
    }

    // GERAR ESTOQUE (100 LINKS OTIMIZADOS)
    if (q.data === "admin_gen") {
      db.all(`SELECT * FROM products`, [], async (err, products) => {
        if (!products || products.length === 0) {
          return bot.sendMessage(chat, "❌ Nenhum grupo cadastrado como produto. Adicione o bot como Administrador num grupo para ele aparecer aqui automaticamente!");
        }
        const keyboard = products.map(p => [{ text: p.name, callback_data: `gen_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha para qual produto deseja gerar o lote de <b>100 links de estoque</b>:", {
          parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard }
        });
      });
      return;
    }

    if (q.data.startsWith("gen_")) {
      const prodId = q.data.replace("gen_", "");
      
      db.get(`SELECT * FROM products WHERE id=?`, [prodId], async (err, product) => {
        if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");

        const msgLoading = await bot.sendMessage(chat, `⚡ A gerar 100 links para <b>${product.name}</b> de forma acelerada...`, { parse_mode: "HTML" });

        let links = [];
        const targetCount = 100;
        let batchSize = 10;

        while (links.length < targetCount) {
          let promises = [];
          let currentBatch = Math.min(batchSize, targetCount - links.length);

          for (let i = 0; i < currentBatch; i++) {
            promises.push(
              bot.createChatInviteLink(product.group_id, { member_limit: 1 })
                .then(invite => invite?.invite_link)
                .catch(() => null)
            );
          }

          let results = await Promise.all(promises);
          for (let link of results) {
            if (link) links.push(link);
          }

          await sleep(150);
        }

        bot.deleteMessage(chat, msgLoading.message_id).catch(() => {});

        let linksText = `<pre>${links.join("\n")}</pre>`;

        if (linksText.length > 4000) {
          bot.sendMessage(chat, `✅ <b>Lote de 100 Links Concluído (${product.name}):</b> (Parte 1)`, { parse_mode: "HTML" });
          for (let i = 0; i < links.length; i += 50) {
            const chunk = links.slice(i, i + 50).join("\n");
            bot.sendMessage(chat, `<pre>${chunk}</pre>`, { parse_mode: "HTML" });
          }
        } else {
          bot.sendMessage(
            chat,
            `✅ <b>Lote de 100 Links Gerado com Sucesso! (${product.name})</b>\n<i>Clique no bloco abaixo para copiar todos de uma vez:</i>\n\n${linksText}`,
            { parse_mode: "HTML" }
          );
        }
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
  });
});

/* ================= AUTO-REGISTRO EM TEMPO REAL ================= */

// 1. Quando o bot é adicionado como admin no grupo
bot.on("my_chat_member", (msg) => {
  const chat = msg.chat;
  const newStatus = msg.new_chat_member.status;

  if (chat.type === "supergroup" || chat.type === "group") {
    if (newStatus === "administrator" || newStatus === "member") {
      const prodId = "GRP_" + Math.abs(chat.id);
      const prodName = chat.title || "Grupo " + chat.id;

      db.run(`INSERT OR IGNORE INTO products (id, name, group_id) VALUES (?, ?, ?)`, [prodId, prodName, chat.id]);
    } else if (newStatus === "left" || newStatus === "kicked") {
      db.run(`DELETE FROM products WHERE group_id=?`, [chat.id]);
    }
  }
});

// 2. Quando o bot detecta qualquer mensagem enviada no grupo
bot.on("message", async (msg) => {
  const chatType = msg.chat.type;
  if (chatType === "supergroup" || chatType === "group") {
    const groupId = msg.chat.id;
    const groupName = msg.chat.title || "Grupo " + groupId;
    const prodId = "GRP_" + Math.abs(groupId);

    db.get(`SELECT id FROM products WHERE group_id=?`, [groupId], (err, row) => {
      if (!row) {
        db.run(`INSERT OR IGNORE INTO products (id, name, group_id) VALUES (?, ?, ?)`, [prodId, groupName, groupId]);
      }
    });
    return;
  }

  if (msg.text?.startsWith("/")) return;

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text || !state[id]) return;

  if (state[id].step === "edit_prod_name_only") {
    db.run(`UPDATE products SET name=? WHERE id=?`, [text, state[id].prodId], (err) => {
      if (err) {
        bot.sendMessage(msg.chat.id, "❌ Erro ao renomear produto no banco de dados.");
      } else {
        bot.sendMessage(msg.chat.id, `✅ Nome do produto alterado para <b>${text}</b> com sucesso!`, { parse_mode: "HTML" });
      }
      state[id] = null;
    });
    return;
  }

  if (state[id].step === "add_admin" && id === MASTER_ADMIN) {
    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin adicionado com sucesso.");
  }

  if (state[id].step === "remove_admin" && id === MASTER_ADMIN) {
    db.run(`DELETE FROM admins WHERE id=?`, [Number(text)]);
    state[id] = null;
    return bot.sendMessage(msg.chat.id, "✅ Admin removido com sucesso.");
  }
});

/* ================= LOGGER DE ENTRADAS ================= */

bot.on('chat_member', (msg) => {
  const chat = msg.chat;
  const newMember = msg.new_chat_member;
  const oldMember = msg.old_chat_member;
  const inviteLink = msg.invite_link;

  if (
    (oldMember.status === 'left' || oldMember.status === 'kicked' || oldMember.status === 'restricted') &&
    newMember.status === 'member' &&
    inviteLink
  ) {
     const userName = newMember.user.first_name + (newMember.user.username ? ` (@${newMember.user.username})` : '');
     const userId = newMember.user.id;
     const linkUrl = inviteLink.invite_link;

     db.get(`SELECT name FROM products WHERE group_id=?`, [chat.id], (err, product) => {
        const prodName = product ? product.name : chat.title;

        const logText = `📥 <b>NOVO ACESSO RESGATADO (ESTOQUE)</b>\n\n` +
                        `📦 <b>Produto/Grupo:</b> ${prodName}\n` +
                        `👤 <b>Membro:</b> ${userName}\n` +
                        `🆔 <b>ID:</b> <code>${userId}</code>\n` +
                        `🔗 <b>Link Utilizado:</b>\n${linkUrl}\n` +
                        `🕒 <b>Hora:</b> ${nowBR()}`;

        bot.sendMessage(LOG_GROUP_ID, logText, { parse_mode: 'HTML' });
     });
  }
});

/* ===== FIX POLLING ERROR ===== */
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code);
});

console.log("🤖 BOT ESTOQUISTA AUTO-REGISTRÁVEL COMPLETO ONLINE");
