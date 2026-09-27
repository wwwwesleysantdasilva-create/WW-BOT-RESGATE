import TelegramBot from "node-telegram-bot-api";
import sqlite3 from "sqlite3";

/* ================= CONFIG ================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const MASTER_ADMIN = 8235876348;
const LOG_GROUP_ID = -1003713776395;

/* ================= INIT ================= */

// ATENÇÃO: allowed_updates é obrigatório para o bot conseguir "ver" quem entra no grupo e qual link usou
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

// Função para pausar e evitar Rate Limit do Telegram ao criar 100 links
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* ================= START / MENU ================= */

bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  state[id] = null;

  isAdmin(id, (isAdm) => {
    if (!isAdm) {
      return bot.sendMessage(msg.chat.id, "🚧 Este é um bot administrativo privado.");
    }

    const buttons = [
      [{ text: "🔗 Gerar Links (Estoque)", callback_data: "admin_gen" }],
      [{ text: "📦 Add Produto (Grupo)", callback_data: "admin_add_prod" }],
      [{ text: "🗑️ Remover Produto", callback_data: "admin_rem_prod" }]
    ];

    if (id === MASTER_ADMIN) {
      buttons.push(
        [{ text: "➕ Add Admin", callback_data: "admin_add" }],
        [{ text: "➖ Remover Admin", callback_data: "admin_remove" }]
      );
    }

    bot.sendMessage(msg.chat.id, "🛠 <b>Painel Administrativo</b>\n\nO que deseja fazer?", {
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

    if (q.data === "admin_add_prod") {
      state[id] = { step: "add_prod_id" };
      return bot.sendMessage(chat, "<b>PASSO 1/3</b>\n\nDigite um código curto para o produto (sem espaços).\n<i>Exemplo: SENSI, VIP</i>", { parse_mode: "HTML" });
    }

    if (q.data === "admin_rem_prod") {
      state[id] = null;
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (products.length === 0) return bot.sendMessage(chat, "❌ Nenhum produto cadastrado.");
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

    if (q.data === "admin_gen") {
      state[id] = { step: "gen_choose" };
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (products.length === 0) return bot.sendMessage(chat, "❌ Adicione um produto primeiro.");
        const keyboard = products.map(p => [{ text: p.name, callback_data: `gen_${p.id}` }]);
        return bot.sendMessage(chat, "Escolha para qual produto deseja <b>GERAR LINKS</b>:", {
          parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard }
        });
      });
      return;
    }

    if (q.data.startsWith("gen_")) {
      state[id] = { step: "gen_qty", product: q.data.replace("gen_", "") };
      return bot.sendMessage(chat, "Quantos links de <b>uso único</b> deseja gerar? (Exemplo: 50, 100)\n\n<i>Links grandes demoram alguns segundos para evitar bloqueio do Telegram.</i>", { parse_mode: "HTML" });
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

/* ================= MESSAGES (STATE MACHINE) ================= */

bot.on("message", async (msg) => {
  if (msg.text?.startsWith("/")) return;

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text) return;

  if (state[id]?.step === "add_prod_id") {
    state[id].tempId = text.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    state[id].step = "add_prod_name";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 2/3</b>\n\nQual o NOME do produto?\n<i>Exemplo: 💎 Pack Sensi VIP</i>", { parse_mode: "HTML" });
  }

  if (state[id]?.step === "add_prod_name") {
    state[id].tempName = text;
    state[id].step = "add_prod_group";
    return bot.sendMessage(msg.chat.id, "<b>PASSO 3/3</b>\n\nEnvie o ID do Grupo/Canal (Com o sinal de - na frente).\n<i>O bot precisa ser Administrador com permissão de 'Adicionar Usuários' lá!</i>", { parse_mode: "HTML" });
  }

  if (state[id]?.step === "add_prod_group") {
    const groupId = Number(text);
    if (isNaN(groupId)) return bot.sendMessage(msg.chat.id, "❌ ID inválido. Tente novamente.");
    
    db.run(`INSERT OR REPLACE INTO products (id, name, group_id) VALUES (?, ?, ?)`, [state[id].tempId, state[id].tempName, groupId]);
    bot.sendMessage(msg.chat.id, `✅ Sucesso! O grupo <b>${state[id].tempName}</b> foi vinculado.`, { parse_mode: "HTML" });
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
    if (!qty || qty < 1 || qty > 200)
      return bot.sendMessage(msg.chat.id, "❌ Quantidade inválida. Envie um número entre 1 e 200.");

    const prodId = state[id].product;
    state[id] = null;

    db.get(`SELECT * FROM products WHERE id=?`, [prodId], async (err, product) => {
      if (!product) return bot.sendMessage(msg.chat.id, "❌ Produto não encontrado.");

      let statusMsg = await bot.sendMessage(msg.chat.id, `⏳ Gerando ${qty} links para <b>${product.name}</b>...\nIsso leva cerca de ${Math.ceil((qty * 250) / 1000)} segundos.`, { parse_mode: "HTML" });
      
      let links = [];
      let errors = 0;

      for (let i = 0; i < qty; i++) {
        try {
          const invite = await bot.createChatInviteLink(product.group_id, {
            member_limit: 1 // Link expira após 1 uso (auto-destrutivo)
          });
          links.push(invite.invite_link);
        } catch (error) {
          errors++;
        }
        await sleep(250); // Pausa de 250ms para evitar limite da API do Telegram (Rate limit)
      }

      if (links.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Falha ao gerar links. Verifique se o bot é administrador do grupo e tem permissão para gerenciar convites.");
      }

      // Separa os links por linha dentro de um bloco <pre> para o clique copiar tudo de uma vez
      let linksText = `<pre>${links.join("\n")}</pre>`;
      
      bot.deleteMessage(msg.chat.id, statusMsg.message_id).catch(()=>{});

      // Se passou de 4000 caracteres, divide em blocos para não bugar o telegram
      if (linksText.length > 4000) {
        bot.sendMessage(msg.chat.id, `✅ <b>${links.length} Links Gerados:</b> (Parte 1)`, { parse_mode: "HTML" });
        
        // Pega em blocos de 50 links
        for (let i = 0; i < links.length; i += 50) {
            const chunk = links.slice(i, i + 50).join("\n");
            bot.sendMessage(msg.chat.id, `<pre>${chunk}</pre>`, { parse_mode: "HTML" });
        }
      } else {
        bot.sendMessage(
          msg.chat.id,
          `✅ <b>${links.length} Links Gerados:</b>\n<i>Clique no quadrado abaixo para copiar todos de uma vez:</i>\n\n${linksText}`,
          { parse_mode: "HTML" }
        );
      }

      if (errors > 0) {
        bot.sendMessage(msg.chat.id, `⚠️ Aviso: Houve erro ao tentar gerar ${errors} links.`);
      }
    });
  }
});

/* ================= LOGGER DE ENTRADAS (A Mágica) ================= */

bot.on('chat_member', (msg) => {
  const chat = msg.chat;
  const newMember = msg.new_chat_member;
  const oldMember = msg.old_chat_member;
  const inviteLink = msg.invite_link;

  // Verifica se a pessoa efetivamente acabou de entrar no grupo e usou um link para isso
  if (
    (oldMember.status === 'left' || oldMember.status === 'kicked' || oldMember.status === 'restricted') &&
    newMember.status === 'member' &&
    inviteLink
  ) {
     const userName = newMember.user.first_name + (newMember.user.username ? ` (@${newMember.user.username})` : '');
     const userId = newMember.user.id;
     const linkUrl = inviteLink.invite_link; // Pega o link exato que o cara usou

     // Busca no banco qual produto é atrelado a este grupo
     db.get(`SELECT name FROM products WHERE group_id=?`, [chat.id], (err, product) => {
        const prodName = product ? product.name : chat.title;

        const logText = `📥 <b>NOVO ACESSO VIP</b>\n\n` +
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

console.log("🤖 BOT ESTOQUISTA ONLINE — AGUARDANDO COMANDOS");
