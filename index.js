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
      allowed_updates: ["message", "callback_query", "chat_member"]
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
      [{ text: "📦 Add Produto", callback_data: "admin_add_prod" }, { text: "✏️ Editar Produto", callback_data: "admin_edit_prod" }],
      [{ text: "🗑️ Remover Produto", callback_data: "admin_rem_prod" }]
    ];

    if (id === MASTER_ADMIN) {
      buttons.push(
        [{ text: "➕ Add Admin", callback_data: "admin_add" }],
        [{ text: "➖ Remover Admin", callback_data: "admin_remove" }]
      );
    }

    bot.sendMessage(msg.chat.id, "🛠 <b>Painel Estoquista — WW SENSI</b>\n\nO que deseja fazer?", {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: buttons }
    });
  });
});

/* ================= CALLBACKS ================= */

bot.on("callback_query", (q) => {
  const id = q.from.id;
  const chat = q.message.chat.id;

  isAdmin(id, (ok) => {
    if (!ok) return;

    // ADICIONAR PRODUTO
    if (q.data === "admin_add_prod") {
      state[id] = { step: "add_prod_id" };
      return bot.sendMessage(chat, "<b>PASSO 1/3</b>\n\nDigite um código curto para o produto (sem espaços).\n<i>Exemplo: SENSI, VIP</i>", { parse_mode: "HTML" });
    }

    // EDITAR PRODUTO (LISTAR)
    if (q.data === "admin_edit_prod") {
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado para editar.");
        const keyboard = products.map(p => [{ text: `✏️ Editar: ${p.name}`, callback_data: `editprod_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha qual produto deseja <b>editar</b>:", { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      });
      return;
    }

    if (q.data.startsWith("editprod_")) {
      const prodId = q.data.replace("editprod_", "");
      db.get(`SELECT * FROM products WHERE id=?`, [prodId], (err, product) => {
        if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");
        state[id] = { step: "edit_prod_name", prodId: product.id };
        return bot.sendMessage(chat, `Editando produto: <b>${product.name}</b>\n\nDigite o <b>novo NOME</b> para este produto:`, { parse_mode: "HTML" });
      });
      return;
    }

    // REMOVER PRODUTO
    if (q.data === "admin_rem_prod") {
      state[id] = null;
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado.");
        const keyboard = products.map(p => [{ text: `❌ Deletar: ${p.name}`, callback_data: `delprod_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha qual produto remover:", { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } });
      });
      return;
    }

    if (q.data.startsWith("delprod_")) {
      const prodId = q.data.replace("delprod_", "");
      db.run(`DELETE FROM products WHERE id=?`, [prodId]);
      return bot.sendMessage(chat, `✅ Produto apagado com sucesso!`);
    }

    // GERAR ESTOQUE (100 LINKS FIXOS GARANTIDOS)
    if (q.data === "admin_gen") {
      db.all(`SELECT * FROM products`, [], async (err, products) => {
        if (!products || products.length === 0) return bot.sendMessage(chat, "❌ Adicione um produto primeiro.");
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

        const statusMsg = await bot.sendMessage(chat, `⏳ Gerando lote obrigatório de <b>100 links</b> para <b>${product.name}</b>...\nIsso pode levar alguns segundos devido às travas de segurança do Telegram.`, { parse_mode: "HTML" });
        
        let links = [];
        let attempts = 0;
        const targetCount = 100;
        const maxAttempts = 300; // Trava de segurança para loop infinito caso o grupo dê erro crítico

        // Loop rigoroso: só encerra quando atingir 100 links válidos
        while (links.length < targetCount && attempts < maxAttempts) {
          attempts++;
          try {
            const invite = await bot.createChatInviteLink(product.group_id, {
              member_limit: 1 // Link de uso único / auto-destrutivo
            });
            if (invite && invite.invite_link) {
              links.push(invite.invite_link);
            }
          } catch (error) {
            // Em caso de rate-limit ou falha temporária do Telegram, aguarda um pouco mais e tenta novamente
            await sleep(500);
          }
          await sleep(250); // Intervalo padrão entre requisições
        }

        bot.deleteMessage(chat, statusMsg.message_id).catch(() => {});

        if (links.length < targetCount) {
          return bot.sendMessage(chat, `⚠️ Atenção: O processo encerrou, mas conseguimos gerar apenas ${links.length}/100 links. Verifique se o bot possui permissão de administrador total no grupo.`);
        }

        // Monta os links em bloco formatado para cópia rápida
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

    // GERENCIAMENTO DE ADMINS (MASTER)
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

/* ================= MESSAGES (STATE MACHINE) ================= */

bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text || !state[id]) return;

  // Fluxo de Cadastro de Produto
  if (state[id].step === "add_prod_id") {
    state[id].tempId = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    state[id].step = "add_prod_name";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 2/3</b>\n\nQual o NOME do produto?\n<i>Exemplo: 💎 Pack Sensi VIP</i>", { parse_mode: "HTML" });
  }

  if (state[id].step === "add_prod_name") {
    state[id].tempName = text;
    state[id].step = "add_prod_group";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 3/3</b>\n\nEnvie o ID numérico do Grupo/Canal (Com o sinal de menos na frente, ex: <code>-100...</code>).\n<i>O bot precisa ser Administrador com permissão de 'Adicionar Usuários' lá!</i>", { parse_mode: "HTML" });
  }

  if (state[id].step === "add_prod_group") {
    const groupId = Number(text);
    if (isNaN(groupId)) return bot.sendMessage(msg.chat.id, "❌ ID inválido. Tente novamente enviando apenas números com o sinal de menos.");
    
    db.run(`INSERT OR REPLACE INTO products (id, name, group_id) VALUES (?, ?, ?)`, [state[id].tempId, state[id].tempName, groupId]);
    bot.sendMessage(msg.chat.id, `✅ Sucesso! O produto <b>${state[id].tempName}</b> foi configurado no estoque.`, { parse_mode: "HTML" });
    state[id] = null;
    return;
  }

  // Fluxo de Edição de Produto
  if (state[id].step === "edit_prod_name") {
    state[id].tempName = text;
    state[id].step = "edit_prod_group";
    return bot.sendMessage(msg.chat.id, `Digite o <b>novo ID do Grupo</b> para o produto <b>${text}</b>:`, { parse_mode: "HTML" });
  }

  if (state[id].step === "edit_prod_group") {
    const groupId = Number(text);
    if (isNaN(groupId)) return bot.sendMessage(msg.chat.id, "❌ ID de grupo inválido. Envie apenas números.");

    db.run(`UPDATE products SET name=?, group_id=? WHERE id=?`, [state[id].tempName, groupId, state[id].prodId], (err) => {
      if (err) {
        bot.sendMessage(msg.chat.id, "❌ Erro ao atualizar produto no banco de dados.");
      } else {
        bot.sendMessage(msg.chat.id, `✅ Produto atualizado com sucesso!`, { parse_mode: "HTML" });
      }
      state[id] = null;
    });
    return;
  }

  // Adicionar/Remover Admins
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

console.log("🤖 BOT ESTOQUISTA 100% OTIMIZADO ONLINE — PRONTO PARA GERAR ESTOQUES");
