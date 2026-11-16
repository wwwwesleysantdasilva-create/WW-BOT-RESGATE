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
      allowed_updates: JSON.stringify(["message", "callback_query", "chat_member", "my_chat_member"])
    }
  }
});

const DB_DIR = (process.env.RAILWAY_VOLUME_MOUNT_PATH || ".").replace(/\/$/, "");
const db = new sqlite3.Database(`${DB_DIR}/database.sqlite`, (err) => {
  if (err) console.error("❌ Erro ao abrir o banco de dados:", err.message);
  else console.log(`💾 Banco de dados conectado em: ${DB_DIR}/database.sqlite`);
});

let state = {};

/* ================= DATABASE ================= */

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS admins (id INTEGER UNIQUE)`);
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT UNIQUE,
    name TEXT,
    group_id INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_link TEXT,
    user_id INTEGER,
    user_name TEXT,
    username TEXT,
    product_name TEXT,
    group_id INTEGER,
    used_at TEXT
  )`);
});

/* ================= HELPERS ================= */

const nowBR = () =>
  new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

const isAdmin = (id, cb) => {
  if (id === MASTER_ADMIN) return cb(true);
  db.get(`SELECT id FROM admins WHERE id=?`, [id], (_, r) => cb(!!r));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const escapeHTML = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Cria um link respeitando o retry_after do Telegram (anti-flood)
const createLink = async (groupId, tries = 0) => {
  try {
    const inv = await bot.createChatInviteLink(groupId, { member_limit: 1 });
    return inv.invite_link;
  } catch (e) {
    const retry = e?.response?.body?.parameters?.retry_after;
    if (retry && tries < 5) {
      await sleep((retry + 1) * 1000);
      return createLink(groupId, tries + 1);
    }
    console.error("❌ Erro ao criar link:", e?.response?.body?.description || e.message);
    return null;
  }
};

const generateLogImage = async (log) => {
  const chartConfig = {
    type: "bar",
    data: { labels: [""], datasets: [] },
    options: {
      responsive: false,
      layout: { padding: 45 },
      scales: {
        x: { display: false },
        y: { display: false }
      },
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          align: "start",
          color: "#f8fafc",
          font: { size: 22, family: "sans-serif", weight: "bold", lineHeight: 1.6 },
          padding: { top: 10, bottom: 10 },
          text: [
            "📋 RASTREAMENTO DE ACESSO — WW SENSI",
            "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
            `📦 Produto/Grupo: ${log.product_name}`,
            `👤 Nome do Usuário: ${log.user_name}`,
            `🆔 ID / Nº Pessoal: ${log.user_id}`,
            `📱 Usuário (@): ${log.username}`,
            `🕒 Horário de Uso: ${log.used_at}`,
            `🔗 Link Utilizado: ${log.invite_link}`
          ]
        }
      }
    }
  };

  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: "3",
      width: 920,
      height: 430,
      backgroundColor: "#0f172a",
      devicePixelRatio: 2,
      format: "png",
      chart: chartConfig
    })
  });

  if (!res.ok) throw new Error(`Erro ao gerar imagem: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
};

/* ================= START / MENU ================= */

bot.onText(/^\/start/, (msg) => {
  if (msg.chat.type !== "private") return;

  const id = msg.from.id;
  state[id] = null;

  isAdmin(id, (isAdm) => {
    if (!isAdm) {
      return bot.sendMessage(msg.chat.id, "🚧 Este é um bot administrativo privado de gestão de estoque.");
    }

    const buttons = [
      [{ text: "🔗 Gerar 100 Links (Estoque)", callback_data: "admin_gen" }],
      [{ text: "🔍 Consultar Logs", callback_data: "admin_check_log" }],
      [{ text: "🔄 Grupos Sincronizados (Auto)", callback_data: "admin_sync_groups" }],
      [
        { text: "✏️ Editar Nome de Produto", callback_data: "admin_edit_prod" },
        { text: "🗑️ Remover Produto", callback_data: "admin_rem_prod" }
      ]
    ];

    if (id === MASTER_ADMIN) {
      buttons.push([
        { text: "➕ Add Admin", callback_data: "admin_add" },
        { text: "➖ Remover Admin", callback_data: "admin_remove" }
      ]);
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

  // Tira o "relógio" do botão
  bot.answerCallbackQuery(q.id).catch(() => {});

  isAdmin(id, async (ok) => {
    if (!ok) return;

    // CONSULTAR LOG POR LINK
    if (q.data === "admin_check_log") {
      state[id] = { step: "check_log_link" };
      return bot.sendMessage(
        chat,
        "🔍 <b>Consultar Log de Acesso</b>\n\nEnvie o <b>Link da log</b> (link de convite) que deseja rastrear:",
        { parse_mode: "HTML" }
      );
    }

    // LISTAR GRUPOS AUTO-CADASTRADOS
    if (q.data === "admin_sync_groups") {
      db.all(`SELECT * FROM products`, [], (err, rows) => {
        if (!rows || rows.length === 0) {
          return bot.sendMessage(
            chat,
            "🔄 <b>Nenhum grupo detectado ainda.</b>\n\n" +
              "💡 Basta <b>adicionar o bot como Administrador</b> no seu grupo (e mandar uma mensagem lá) para que ele seja reconhecido e cadastrado automaticamente aqui!",
            { parse_mode: "HTML" }
          );
        }

        const list = rows
          .map((r) => `• <b>${escapeHTML(r.name)}</b> (ID: <code>${r.group_id}</code>)`)
          .join("\n");
        return bot.sendMessage(
          chat,
          `🔄 <b>Produtos/Grupos Detectados Automaticamente (${rows.length}):</b>\n\n${list}\n\n` +
            `<i>Para adicionar novos, basta promover o bot a Administrador no grupo desejado.</i>`,
          { parse_mode: "HTML" }
        );
      });
      return;
    }

    // EDITAR NOME DO PRODUTO
    if (q.data === "admin_edit_prod") {
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) {
          return bot.sendMessage(chat, "❌ Nenhum produto cadastrado para editar.");
        }
        const keyboard = products.map((p) => [
          { text: `✏️ Editar: ${p.name}`, callback_data: `editprod_${p.id}` }
        ]);
        return bot.sendMessage(chat, "Escolha qual produto deseja <b>renomear</b>:", {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard }
        });
      });
      return;
    }

    if (q.data.startsWith("editprod_")) {
      const prodId = q.data.replace("editprod_", "");
      db.get(`SELECT * FROM products WHERE id=?`, [prodId], (err, product) => {
        if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");
        state[id] = { step: "edit_prod_name_only", prodId: product.id };
        return bot.sendMessage(
          chat,
          `Produto selecionado: <b>${escapeHTML(product.name)}</b>\n\nDigite o <b>novo NOME</b> exibido para este produto:`,
          { parse_mode: "HTML" }
        );
      });
      return;
    }

    // REMOVER PRODUTO
    if (q.data === "admin_rem_prod") {
      state[id] = null;
      db.all(`SELECT * FROM products`, [], (err, products) => {
        if (!products || products.length === 0) {
          return bot.sendMessage(chat, "❌ Nenhum produto cadastrado.");
        }
        const keyboard = products.map((p) => [
          { text: `❌ Deletar: ${p.name}`, callback_data: `delprod_${p.id}` }
        ]);
        return bot.sendMessage(chat, "Escolha qual produto remover da lista:", {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard }
        });
      });
      return;
    }

    if (q.data.startsWith("delprod_")) {
      const prodId = q.data.replace("delprod_", "");
      db.run(`DELETE FROM products WHERE id=?`, [prodId], (err) => {
        if (err) {
          console.error("❌ Erro ao remover produto:", err.message);
          return bot.sendMessage(chat, "❌ Erro ao remover o produto.");
        }
        bot.sendMessage(
          chat,
          `✅ Produto removido com sucesso!\n<i>Obs: se o grupo receber uma nova mensagem, ele será cadastrado de novo automaticamente.</i>`,
          { parse_mode: "HTML" }
        );
      });
      return;
    }

    // GERAR ESTOQUE (100 LINKS)
    if (q.data === "admin_gen") {
      db.all(`SELECT * FROM products`, [], async (err, products) => {
        if (!products || products.length === 0) {
          return bot.sendMessage(
            chat,
            "❌ Nenhum grupo cadastrado como produto. Adicione o bot como Administrador num grupo para ele aparecer aqui automaticamente!"
          );
        }
        const keyboard = products.map((p) => [{ text: p.name, callback_data: `gen_${p.id}` }]);
        return bot.sendMessage(
          chat,
          "Escolha para qual produto deseja gerar o lote de <b>100 links de estoque</b>:",
          { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard } }
        );
      });
      return;
    }

    if (q.data.startsWith("gen_")) {
      const prodId = q.data.replace("gen_", "");

      db.get(`SELECT * FROM products WHERE id=?`, [prodId], async (err, product) => {
        if (!product) return bot.sendMessage(chat, "❌ Produto não encontrado.");

        const msgLoading = await bot.sendMessage(
          chat,
          `⚡ Gerando 100 links para <b>${escapeHTML(product.name)}</b>...`,
          { parse_mode: "HTML" }
        );

        const targetCount = 100;
        const batchSize = 5;
        const links = [];
        let fails = 0;

        while (links.length < targetCount && fails < 20) {
          const n = Math.min(batchSize, targetCount - links.length);
          const res = await Promise.all(
            Array.from({ length: n }, () => createLink(product.group_id))
          );
          const okLinks = res.filter(Boolean);
          links.push(...okLinks);
          fails = okLinks.length ? 0 : fails + 1;
          await sleep(100);
        }

        bot.deleteMessage(chat, msgLoading.message_id).catch(() => {});

        if (links.length === 0) {
          return bot.sendMessage(
            chat,
            "❌ Não consegui gerar nenhum link.\n\nVerifique se o bot é <b>administrador</b> do grupo com a permissão <b>Convidar usuários via link</b>.",
            { parse_mode: "HTML" }
          );
        }

        const incomplete =
          links.length < targetCount
            ? `\n⚠️ Só foi possível gerar ${links.length} de ${targetCount} links.`
            : "";

        const linksText = `<pre>${links.join("\n")}</pre>`;

        if (linksText.length > 4000) {
          await bot.sendMessage(
            chat,
            `✅ <b>Lote de ${links.length} Links Concluído (${escapeHTML(product.name)}):</b>${incomplete}`,
            { parse_mode: "HTML" }
          );
          for (let i = 0; i < links.length; i += 50) {
            const chunk = links.slice(i, i + 50).join("\n");
            await bot.sendMessage(chat, `<pre>${chunk}</pre>`, { parse_mode: "HTML" });
          }
        } else {
          await bot.sendMessage(
            chat,
            `✅ <b>Lote de ${links.length} Links Gerado com Sucesso! (${escapeHTML(product.name)})</b>${incomplete}\n<i>Clique no bloco abaixo para copiar todos de uma vez:</i>\n\n${linksText}`,
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

// 1. Quando o bot é adicionado/removido de um grupo
bot.on("my_chat_member", (msg) => {
  const chat = msg.chat;
  const newStatus = msg.new_chat_member.status;

  console.log(`ℹ️ my_chat_member: ${chat.title || chat.id} -> ${newStatus}`);

  if (chat.type === "supergroup" || chat.type === "group") {
    if (newStatus === "administrator" || newStatus === "member") {
      const prodId = "GRP_" + Math.abs(chat.id);
      const prodName = chat.title || "Grupo " + chat.id;

      db.run(
        `INSERT OR IGNORE INTO products (id, name, group_id) VALUES (?, ?, ?)`,
        [prodId, prodName, chat.id],
        (err) => {
          if (err) console.error("❌ Erro ao cadastrar grupo:", err.message);
        }
      );
    } else if (newStatus === "left" || newStatus === "kicked") {
      db.run(`DELETE FROM products WHERE group_id=?`, [chat.id], (err) => {
        if (err) console.error("❌ Erro ao remover grupo:", err.message);
      });
    }
  }
});

// 2. Mensagens (grupos = auto-cadastro; privado = fluxo do admin)
bot.on("message", async (msg) => {
  const chatType = msg.chat.type;

  if (chatType === "supergroup" || chatType === "group") {
    const groupId = msg.chat.id;
    const groupName = msg.chat.title || "Grupo " + groupId;
    const prodId = "GRP_" + Math.abs(groupId);

    db.get(`SELECT id FROM products WHERE group_id=?`, [groupId], (err, row) => {
      if (!row) {
        db.run(
          `INSERT OR IGNORE INTO products (id, name, group_id) VALUES (?, ?, ?)`,
          [prodId, groupName, groupId],
          (e) => {
            if (e) console.error("❌ Erro ao cadastrar grupo:", e.message);
          }
        );
      }
    });
    return;
  }

  if (msg.text?.startsWith("/")) return;

  const id = msg.from.id;
  const text = msg.text?.trim();
  if (!text || !state[id]) return;

  // CONSULTA DE LOG
  if (state[id].step === "check_log_link") {
    const cleanLink = (text.match(/https?:\/\/t\.me\/[^\s]+/i)?.[0] || text).trim();
    state[id] = null;

    db.get(
      `SELECT * FROM access_logs WHERE invite_link = ? ORDER BY id DESC LIMIT 1`,
      [cleanLink],
      async (err, log) => {
        if (err) console.error("❌ Erro ao consultar log:", err.message);

        if (err || !log) {
          return bot.sendMessage(
            msg.chat.id,
            "⚠️ <b>Nenhum registro encontrado para este link.</b>\n\nCertifique-se de que o link já foi utilizado por um membro para entrar no grupo.",
            { parse_mode: "HTML" }
          );
        }

        const caption =
          `✅ <b>Log de Acesso Localizada!</b>\n\n` +
          `📦 <b>Produto:</b> ${escapeHTML(log.product_name)}\n` +
          `👤 <b>Usuário:</b> ${escapeHTML(log.user_name)}\n` +
          `🆔 <b>ID Pessoal:</b> <code>${log.user_id}</code>\n` +
          `📱 <b>Username:</b> ${escapeHTML(log.username)}\n` +
          `🕒 <b>Horário de Uso:</b> ${escapeHTML(log.used_at)}\n` +
          `🔗 <b>Link:</b>\n${escapeHTML(log.invite_link)}`;

        try {
          const imgBuffer = await generateLogImage(log);
          await bot.sendPhoto(
            msg.chat.id,
            imgBuffer,
            { caption, parse_mode: "HTML" },
            { filename: "log-acesso.png", contentType: "image/png" }
          );
        } catch (imgErr) {
          console.error("Erro ao gerar imagem de log:", imgErr.message);
          bot.sendMessage(msg.chat.id, caption, { parse_mode: "HTML" });
        }
      }
    );
    return;
  }

  // RENOMEAR PRODUTO
  if (state[id].step === "edit_prod_name_only") {
    const prodId = state[id].prodId;
    db.run(`UPDATE products SET name=? WHERE id=?`, [text, prodId], (err) => {
      if (err) {
        console.error("❌ Erro ao renomear:", err.message);
        bot.sendMessage(msg.chat.id, "❌ Erro ao renomear produto no banco de dados.");
      } else {
        bot.sendMessage(
          msg.chat.id,
          `✅ Nome do produto alterado para <b>${escapeHTML(text)}</b> com sucesso!`,
          { parse_mode: "HTML" }
        );
      }
      state[id] = null;
    });
    return;
  }

  // ADD ADMIN
  if (state[id].step === "add_admin" && id === MASTER_ADMIN) {
    const newId = Number(text);
    state[id] = null;
    if (!Number.isInteger(newId)) {
      return bot.sendMessage(msg.chat.id, "❌ ID inválido. Envie apenas números.");
    }
    db.run(`INSERT OR IGNORE INTO admins VALUES (?)`, [newId], (err) => {
      if (err) {
        console.error("❌ Erro ao adicionar admin:", err.message);
        return bot.sendMessage(msg.chat.id, "❌ Erro ao adicionar admin.");
      }
      bot.sendMessage(msg.chat.id, "✅ Admin adicionado com sucesso.");
    });
    return;
  }

  // REMOVER ADMIN
  if (state[id].step === "remove_admin" && id === MASTER_ADMIN) {
    const remId = Number(text);
    state[id] = null;
    if (!Number.isInteger(remId)) {
      return bot.sendMessage(msg.chat.id, "❌ ID inválido. Envie apenas números.");
    }
    db.run(`DELETE FROM admins WHERE id=?`, [remId], (err) => {
      if (err) {
        console.error("❌ Erro ao remover admin:", err.message);
        return bot.sendMessage(msg.chat.id, "❌ Erro ao remover admin.");
      }
      bot.sendMessage(msg.chat.id, "✅ Admin removido com sucesso.");
    });
    return;
  }
});

/* ================= LOGGER DE ENTRADAS ================= */

bot.on("chat_member", (msg) => {
  // Debug: mostra tudo que chega. Depois que estiver estável, pode remover.
  console.log("📨 chat_member recebido:", JSON.stringify(msg));

  const chat = msg.chat;
  const newMember = msg.new_chat_member;
  const oldMember = msg.old_chat_member;
  const inviteLink = msg.invite_link;

  const entrou =
    ["left", "kicked", "restricted"].includes(oldMember.status) &&
    newMember.status === "member";

  if (!entrou) return;

  if (!inviteLink) {
    console.log(`ℹ️ Entrada sem invite_link em ${chat.title || chat.id} (user ${newMember.user.id}) - ignorada.`);
    return;
  }

  const fullName =
    [newMember.user.first_name, newMember.user.last_name].filter(Boolean).join(" ") || "Usuário";
  const usernameOnly = newMember.user.username ? `@${newMember.user.username}` : "Sem @username";
  const userNameDisplay = fullName + (newMember.user.username ? ` (@${newMember.user.username})` : "");
  const userId = newMember.user.id;
  const linkUrl = inviteLink.invite_link;
  const timestamp = nowBR();

  db.get(`SELECT name FROM products WHERE group_id=?`, [chat.id], (err, product) => {
    const prodName = product ? product.name : chat.title || `Grupo ${chat.id}`;

    db.run(
      `INSERT INTO access_logs (invite_link, user_id, user_name, username, product_name, group_id, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [linkUrl, userId, fullName, usernameOnly, prodName, chat.id, timestamp],
      (e) => {
        if (e) console.error("❌ Erro ao gravar access_log:", e.message);
        else console.log(`✅ Log gravado: ${userId} -> ${prodName}`);
      }
    );

    const logText =
      `📥 <b>NOVO ACESSO RESGATADO (ESTOQUE)</b>\n\n` +
      `📦 <b>Produto/Grupo:</b> ${escapeHTML(prodName)}\n` +
      `👤 <b>Membro:</b> ${escapeHTML(userNameDisplay)}\n` +
      `🆔 <b>ID:</b> <code>${userId}</code>\n` +
      `🔗 <b>Link Utilizado:</b>\n${escapeHTML(linkUrl)}\n` +
      `🕒 <b>Hora:</b> ${timestamp}`;

    bot
      .sendMessage(LOG_GROUP_ID, logText, { parse_mode: "HTML" })
      .catch((e) => console.error("❌ Erro ao enviar para o grupo de logs:", e?.response?.body?.description || e.message));
  });
});

/* ===== ERROS DE POLLING ===== */
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.code, err.message);
  if (String(err.message).includes("409")) {
    console.error("⚠️ Conflito 409: existe OUTRA instância do bot rodando com o mesmo token. Desligue a duplicada.");
  }
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

bot
  .getMe()
  .then((me) => console.log(`🔑 Conectado como @${me.username} (id ${me.id})`))
  .catch((e) => console.error("❌ Token inválido ou sem conexão com o Telegram:", e.message));

bot
  .getWebHookInfo()
  .then((info) => {
    if (info.url) console.error(`⚠️ Existe um webhook ativo (${info.url}). Ele bloqueia o polling!`);
  })
  .catch(() => {});

console.log("🤖 BOT ESTOQUISTA AUTO-REGISTRÁVEL COMPLETO ONLINE");
