const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const storage      = require('./storage');
const applications = require('./applications');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ─────────────────────────────────────
//  Проверка роли
// ─────────────────────────────────────
function hasAdminRole(member) {
  const roleId = process.env.ADMIN_ROLE_ID;
  if (!roleId) return member.permissions.has(PermissionFlagsBits.ManageRoles);
  return member.roles.cache.has(roleId);
}

// ─────────────────────────────────────
//  Slash command definitions
// ─────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('рейтинг')
    .setDescription('Показать таблицу рейтинга рекрутов'),

  new SlashCommandBuilder()
    .setName('профиль')
    .setDescription('Профиль рекрута')
    .addUserOption(o => o.setName('пользователь').setDescription('Пользователь').setRequired(false)),

  new SlashCommandBuilder()
    .setName('добавить_рекрута')
    .setDescription('[ADMIN] Зарегистрировать рекрута')
    .addUserOption(o => o.setName('пользователь').setDescription('Пользователь').setRequired(true))
    .addStringOption(o => o.setName('имя').setDescription('Отображаемое имя').setRequired(false)),

  new SlashCommandBuilder()
    .setName('убрать_рекрута')
    .setDescription('[ADMIN] Удалить рекрута из системы')
    .addUserOption(o => o.setName('пользователь').setDescription('Пользователь').setRequired(true)),

  new SlashCommandBuilder()
    .setName('баллы')
    .setDescription('[ADMIN] Добавить / снять баллы вручную')
    .addUserOption(o => o.setName('пользователь').setDescription('Пользователь').setRequired(true))
    .addIntegerOption(o => o.setName('количество').setDescription('Баллы (отрицательные — снять)').setRequired(true))
    .addStringOption(o => o.setName('причина').setDescription('Причина').setRequired(false)),

  new SlashCommandBuilder()
    .setName('сжечь_баллы')
    .setDescription('[ADMIN] Провести еженедельное списание вручную')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('настройки')
    .setDescription('[ADMIN] Настройки системы')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s =>
      s.setName('списание').setDescription('Баллов списывается в неделю')
        .addIntegerOption(o => o.setName('баллы').setDescription('Количество').setRequired(true)))
    .addSubcommand(s =>
      s.setName('канал_бота').setDescription('ID канала откуда слушать другого бота')
        .addStringOption(o => o.setName('id').setDescription('Channel ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('id_бота').setDescription('ID другого бота')
        .addStringOption(o => o.setName('id').setDescription('Bot User ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('канал_отчётности').setDescription('Канал где рекруты присылают отчёты')
        .addStringOption(o => o.setName('id').setDescription('Channel ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('канал_проверки').setDescription('Канал куда бот шлёт отчёты на одобрение')
        .addStringOption(o => o.setName('id').setDescription('Channel ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('баллы_за_отчёт').setDescription('Баллы за кейворд в отчёте')
        .addStringOption(o => o.setName('кейворд').setDescription('Кейворд (ТП / ВН / 5ВИТО / ...)').setRequired(true))
        .addIntegerOption(o => o.setName('баллы').setDescription('Сколько баллов начислять').setRequired(true)))
    .addSubcommand(s =>
      s.setName('показать').setDescription('Показать текущие настройки')),

  // ── Новые команды ──────────────────
  new SlashCommandBuilder()
    .setName('задания')
    .setDescription('Показать мои задания'),

  new SlashCommandBuilder()
    .setName('привязать')
    .setDescription('Как привязать свой Discord к аккаунту на сайте'),

].map(c => c.toJSON());

// ── Дополнительные команды из модулей ──────────────────────
commands.push(...applications.getCommands());

// ─────────────────────────────────────
//  Register slash commands
// ─────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
}

// ─────────────────────────────────────
//  Helpers
// ─────────────────────────────────────

/**
 * Генерирует случайный пароль длиной до 8 символов
 * из букв (верхний/нижний регистр) и цифр.
 */
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < length; i++)
    pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

function statusEmoji(status) {
  return { active: '🟢', warning: '🟡', danger: '🔴', kicked: '💀' }[status] || '⚪';
}

function buildLeaderboardEmbed(config) {
  const all = Object.values(storage.getAll())
    .filter(r => r.status !== 'kicked')
    .sort((a, b) => b.points - a.points);

  const embed = new EmbedBuilder()
    .setTitle('🏆 Рейтинг рекрутов')
    .setColor(0xe63946)
    .setTimestamp()
    .setFooter({ text: `Еженедельное списание: -${config.weeklyBurn} баллов` });

  if (all.length === 0) {
    embed.setDescription('Пока никого нет. Добавьте рекрутов командой `/добавить_рекрута`');
    return embed;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = all.map((r, i) => {
    const medal = medals[i] || `**${i + 1}.**`;
    const rank = storage.getRank(r.points, config);
    const weeks = (r.weeklyActivity || []).slice(0, 4).map(w => w ? '🟩' : '⬜').join('');
    return `${medal} ${statusEmoji(r.status)} **${r.displayName}** — ${rank.emoji} ${rank.name}\n└ 💎 **${r.points}** баллов ${weeks}`;
  });

  embed.setDescription(rows.join('\n\n'));
  return embed;
}

function buildProfileEmbed(r, config) {
  const rank = storage.getRank(r.points, config);
  const nextRank = config.ranks.find(rk => rk.min > r.points);
  const weeks = (r.weeklyActivity || []).slice(0, 8).map(w => w ? '🟩' : '⬜').join('') || '—';

  const lastActions = (r.history || []).slice(0, 5).map(h => {
    const sign = h.delta > 0 ? `+${h.delta}` : h.delta;
    const d = new Date(h.date).toLocaleDateString('ru');
    return `\`${d}\` ${h.delta > 0 ? '🔺' : '🔻'} **${sign}** — ${h.action}`;
  }).join('\n') || 'Нет истории';

  const embed = new EmbedBuilder()
    .setTitle(`${rank.emoji} ${r.displayName}`)
    .setColor(r.status === 'danger' ? 0xe63946 : r.status === 'warning' ? 0xf4a261 : 0x2ecc71)
    .addFields(
      { name: '💎 Баллы', value: `**${r.points}**`, inline: true },
      { name: '🏅 Ранг', value: `${rank.name}`, inline: true },
      { name: '📊 Статус', value: `${statusEmoji(r.status)} ${r.status}`, inline: true },
      { name: '📅 Активность (недели)', value: weeks, inline: false },
      { name: nextRank ? `До ${nextRank.emoji} ${nextRank.name}` : '👑 Максимальный ранг', value: nextRank ? `${nextRank.min - r.points} баллов` : '—', inline: true },
      { name: '📈 Всего заработано', value: `${r.totalEarned || 0}`, inline: true },
      { name: '📋 Последние действия', value: lastActions, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `ID: ${r.discordId} · Дата вступления: ${new Date(r.joinedAt).toLocaleDateString('ru')}` });

  return embed;
}

// ─────────────────────────────────────
//  Message parsing (other bot)
// ─────────────────────────────────────
const ACCEPT_RE = /<@(\d+)> принял заявку в семью от <@(\d+)>/g;
const REJECT_RE = /<@(\d+)> отклонил заявку от <@(\d+)>/g;

async function parseOtherBotMessage(message) {
  const config = storage.getConfig();
  const scoring = config.scoring;
  const results = [];

  let m;
  ACCEPT_RE.lastIndex = 0;
  while ((m = ACCEPT_RE.exec(message.content)) !== null) {
    const recruiterId = m[1];
    const candidateId = m[2];
    if (!storage.get(recruiterId)) continue;
    storage.addPoints(recruiterId, scoring.accepted, `Принял кандидата <@${candidateId}>`, 'bot-auto', 'accepted');
    results.push({ recruiterId, delta: +scoring.accepted, action: 'принял заявку' });
  }

  REJECT_RE.lastIndex = 0;
  while ((m = REJECT_RE.exec(message.content)) !== null) {
    const recruiterId = m[1];
    const candidateId = m[2];
    if (!storage.get(recruiterId)) continue;
    storage.addPoints(recruiterId, scoring.rejected, `Отклонил кандидата <@${candidateId}> (поймал нарушителя)`, 'bot-auto', 'rejected');
    results.push({ recruiterId, delta: +scoring.rejected, action: 'отклонил заявку' });
  }

  if (results.length > 0) {
    const lines = results.map(r => {
      const rec = storage.get(r.recruiterId);
      const name = rec?.displayName || `<@${r.recruiterId}>`;
      return `${r.delta > 0 ? '🔺' : '🔻'} **${name}** — ${r.delta > 0 ? '+' : ''}${r.delta} баллов (${r.action})`;
    });
    const embed = new EmbedBuilder()
      .setTitle('💎 Баллы начислены автоматически')
      .setDescription(lines.join('\n'))
      .setColor(0x2ecc71)
      .setTimestamp();
    await message.channel.send({ embeds: [embed] });
  }
}

// ─────────────────────────────────────
//  Report channel handler
// ─────────────────────────────────────

/**
 * Дефолтные баллы за кейворды.
 * Хранятся в config.reportKeywords = { "ТП": 5, "ВН": 5, "5ВИТО": 5 }
 * Специальный кейворд ЗАДАНИЕ — баллы указывает куратор вручную через модал.
 */
const DEFAULT_REPORT_KEYWORDS = { 'ТП': 5, 'ВН': 5, '5ВИТО': 5 };
const ZADANIE_KEYWORD = 'ЗАДАНИЕ'; // баллы задаёт куратор

function getReportKeywords(config) {
  return { ...DEFAULT_REPORT_KEYWORDS, ...(config.reportKeywords || {}) };
}

/** Ищет первый совпавший кейворд в тексте (без учёта регистра). */
function detectKeyword(text, keywords) {
  // Сначала проверяем ЗАДАНИЕ отдельно
  if (text.toUpperCase().includes(ZADANIE_KEYWORD)) return { keyword: ZADANIE_KEYWORD, points: null };
  for (const [kw, pts] of Object.entries(keywords)) {
    if (text.toUpperCase().includes(kw.toUpperCase())) return { keyword: kw, points: pts };
  }
  return null;
}

/** Проверяет, является ли пользователь куратором или администратором. */
function isCuratorOrAdmin(member, config) {
  if (hasAdminRole(member)) return true;
  const curatorRoleId = config.curatorRoleId || process.env.CURATOR_ROLE_ID;
  if (curatorRoleId) return member.roles.cache.has(curatorRoleId);
  // Фолбэк — проверяем по баллам в системе
  const rec = storage.get(member.id);
  return rec && rec.points >= 2000;
}

async function handleReportMessage(message) {
  const config = storage.getConfig();

  if (!config.reportChannelId || message.channelId !== config.reportChannelId) return;
  if (message.author.bot) return;

  const text = message.content || '';
  const hasPhoto = message.attachments.some(a =>
    a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '')
  );
  const keywords = getReportKeywords(config);
  const kwMatch  = detectKeyword(text, keywords);

  // Молчим если не похоже на отчёт (нет ни кейворда, ни фото вместе)
  if (!kwMatch && !hasPhoto) return;

  // ── Валидация ─────────────────────────────────────────
  const errors = [];
  if (!hasPhoto) errors.push('📷 **Нет фото-доказательства** — прикрепи скриншот');
  if (!kwMatch)  errors.push(`🔑 **Нет кейворда** — укажи: ${[...Object.keys(keywords), ZADANIE_KEYWORD].join(' · ')}`);

  if (errors.length) {
    const reply = await message.reply({
      content: ['❌ **Отчёт не принят — исправь и отправь снова:**', ...errors, '',
        `**Формат:** \`тег КЕЙВОРД\` + скриншот`].join('\n')
    });
    setTimeout(() => reply.delete().catch(() => {}), 30_000);
    return;
  }

  const recruiter = storage.get(message.author.id);
  if (!recruiter) return; // не рекрут — тихо игнорируем

  const reviewChannelId = config.reportReviewChannelId || config.reportChannelId;
  let reviewChannel;
  try { reviewChannel = await message.client.channels.fetch(reviewChannelId); }
  catch { console.error('[Reports] Канал проверки не найден:', reviewChannelId); return; }

  const photo = message.attachments.first();
  const isZadanie = kwMatch.keyword === ZADANIE_KEYWORD;

  if (isZadanie) {
    // ── ЗАДАНИЕ: баллы выставляет куратор вручную ────────
    const embed = new EmbedBuilder()
      .setTitle('📌 Задание выполнено — укажи баллы')
      .setColor(0x60a5fa)
      .addFields(
        { name: '👤 Рекрут',    value: `${recruiter.displayName} (<@${message.author.id}>)`, inline: true },
        { name: '🔑 Тип',       value: '`ЗАДАНИЕ`', inline: true },
        { name: '🔗 Сообщение', value: `[Перейти](${message.url})`, inline: true },
        { name: '💬 Текст',     value: text.slice(0, 500) || '—', inline: false },
        { name: '📅 Дата',      value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true }
      )
      .setImage(photo?.url ?? null)
      .setFooter({ text: `ID: ${message.author.id} · msg: ${message.id}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`zadanie_award:${message.author.id}:${message.id}`)
        .setLabel('💎 Выставить баллы')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`report_revoke:${message.author.id}:0:${message.id}`)
        .setLabel('❌ Отклонить')
        .setStyle(ButtonStyle.Danger)
    );

    await reviewChannel.send({ embeds: [embed], components: [row] });
    await message.react('⏳').catch(() => {});

  } else {
    // ── Обычный кейворд: баллы начисляем сразу ──────────
    const awarded = storage.addPoints(
      message.author.id, kwMatch.points,
      `Отчёт: ${kwMatch.keyword}`, 'bot-report', 'report'
    );

    // Реакция ✅ на исходное сообщение
    await message.react('✅').catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('✅ Баллы начислены автоматически')
      .setColor(0x2ecc71)
      .addFields(
        { name: '👤 Рекрут',    value: `${recruiter.displayName} (<@${message.author.id}>)`, inline: true },
        { name: '🔑 Активность',value: `\`${kwMatch.keyword}\``, inline: true },
        { name: '💎 Начислено', value: `+${kwMatch.points}`, inline: true },
        { name: '📊 Итого',     value: `${awarded.points} баллов`, inline: true },
        { name: '🔗 Сообщение', value: `[Перейти](${message.url})`, inline: true },
        { name: '📅 Дата',      value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
        { name: '💬 Текст',     value: text.slice(0, 300) || '—', inline: false }
      )
      .setImage(photo?.url ?? null)
      .setFooter({ text: `ID: ${message.author.id} · msg: ${message.id}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_revoke:${message.author.id}:${kwMatch.points}:${message.id}`)
        .setLabel(`❌ Скам — снять ${kwMatch.points} баллов`)
        .setStyle(ButtonStyle.Danger)
    );

    await reviewChannel.send({ embeds: [embed], components: [row] });
  }
}


client.once('clientReady', async () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  await registerCommands();
  applications.setup(client); // ← система заявок
});

client.on('messageCreate', async (message) => {
  const config = storage.getConfig();

  // ── Отчёты рекрутов ───────────────────────────────────
  try {
    await handleReportMessage(message);
  } catch (err) {
    console.error('Error handling report message:', err);
  }

  // ── Другой бот ────────────────────────────────────────
  if (!config.watchChannelId || !config.otherBotId) return;
  if (message.channelId !== config.watchChannelId) return;
  if (message.author.id !== config.otherBotId) return;

  try {
    await parseOtherBotMessage(message);
  } catch (err) {
    console.error('Error parsing bot message:', err);
  }
});

client.on('interactionCreate', async (interaction) => {

  // ── Modal submit: ЗАДАНИЕ — куратор указал баллы ──────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('zadanie_modal:')) {
    const parts      = interaction.customId.split(':');
    const recruiterId = parts[1];
    const origMsgId   = parts[2];
    const rawPoints   = interaction.fields.getTextInputValue('zadanie_points').trim();
    const points      = parseInt(rawPoints);

    if (isNaN(points) || points < 1 || points > 500) {
      return interaction.reply({ content: '❌ Укажи число от 1 до 500.', ephemeral: true });
    }

    const recruiter = storage.get(recruiterId);
    if (!recruiter) return interaction.reply({ content: '❌ Рекрут не найден.', ephemeral: true });

    const updated = storage.addPoints(recruiterId, points, 'Задание (куратор)', interaction.user.id, 'report');

    // Обновляем embed в канале проверки
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x2ecc71)
      .setTitle('✅ Задание засчитано')
      .addFields(
        { name: '💎 Начислено',   value: `+${points}`, inline: true },
        { name: '📊 Итого',       value: `${updated.points} баллов`, inline: true },
        { name: '👮 Куратор',     value: interaction.user.username, inline: true }
      );
    await interaction.update({ embeds: [updatedEmbed], components: [] });

    // Меняем реакцию на ✅ в канале отчётности
    try {
      const config = storage.getConfig();
      const reportCh = await interaction.client.channels.fetch(config.reportChannelId);
      const origMsg  = await reportCh.messages.fetch(origMsgId);
      await origMsg.reactions.removeAll();
      await origMsg.react('✅');
    } catch {}

    // ЛС рекруту
    try {
      const user = await interaction.client.users.fetch(recruiterId);
      await user.send({ content: `✅ Твоё задание засчитано куратором! +**${points}** баллов. Итого: **${updated.points}**.` });
    } catch {}
    return;
  }

  // ── Button handler ────────────────────────────────────────
  if (interaction.isButton()) {
    const parts  = interaction.customId.split(':');
    const action = parts[0];

    // ── Кнопка: снять баллы (скам) ────────────────────────
    if (action === 'report_revoke') {
      if (!hasAdminRole(interaction.member)) {
        return interaction.reply({ content: '❌ Только администраторы могут отклонять отчёты.', ephemeral: true });
      }
      const recruiterId = parts[1];
      const points      = parseInt(parts[2]) || 0;
      const origMsgId   = parts[3];
      const recruiter   = storage.get(recruiterId);

      // Снимаем баллы (если уже были начислены — points > 0)
      let updated = recruiter;
      if (points > 0 && recruiter) {
        updated = storage.addPoints(recruiterId, -points, 'Отчёт отклонён (скам)', interaction.user.id, 'report-revoke');
      }

      const revokedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xe63946)
        .setTitle('🚫 Отчёт отклонён — баллы сняты')
        .addFields(
          { name: '👮 Администратор', value: interaction.user.username, inline: true },
          { name: '🔻 Снято',         value: points > 0 ? `-${points}` : '—', inline: true },
          { name: '📊 Итого',         value: updated ? `${updated.points}` : '—', inline: true }
        );
      await interaction.update({ embeds: [revokedEmbed], components: [] });

      // Меняем реакцию на ❌ в канале отчётности
      try {
        const config = storage.getConfig();
        const reportCh = await interaction.client.channels.fetch(config.reportChannelId);
        const origMsg  = await reportCh.messages.fetch(origMsgId);
        await origMsg.reactions.removeAll();
        await origMsg.react('❌');
      } catch {}

      // ЛС рекруту
      try {
        const user = await interaction.client.users.fetch(recruiterId);
        const txt = points > 0
          ? `🚫 Твой отчёт был отклонён как скам — снято **${points}** баллов. Обратись к администратору если это ошибка.`
          : `🚫 Твоё задание было отклонено администратором.`;
        await user.send({ content: txt });
      } catch {}
      return;
    }

    // ── Кнопка: ЗАДАНИЕ — открываем модал для ввода баллов ─
    if (action === 'zadanie_award') {
      const config = storage.getConfig();
      if (!isCuratorOrAdmin(interaction.member, config)) {
        return interaction.reply({ content: '❌ Только кураторы и администраторы могут выставлять баллы за задания.', ephemeral: true });
      }
      const recruiterId = parts[1];
      const origMsgId   = parts[2];
      const recruiter   = storage.get(recruiterId);

      const modal = new ModalBuilder()
        .setCustomId(`zadanie_modal:${recruiterId}:${origMsgId}`)
        .setTitle(`Баллы за задание — ${recruiter?.displayName || recruiterId}`);

      const input = new TextInputBuilder()
        .setCustomId('zadanie_points')
        .setLabel('Сколько баллов начислить? (1–500)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 10')
        .setMinLength(1)
        .setMaxLength(3)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    // ── Кнопки заданий (задачи рекрутов) ─────────────────
    const [taskAction, taskId, targetDiscordId] = parts;
    if (taskAction === 'complete_task' || taskAction === 'uncomplete_task') {
      if (interaction.user.id !== targetDiscordId) {
        return interaction.reply({ content: '❌ Это не твоё задание.', ephemeral: true });
      }
      if (taskAction === 'complete_task') {
        storage.completeTask(taskId, interaction.user.id);
        await interaction.reply({ content: '✅ Задание отмечено как выполненное!', ephemeral: true });
      } else {
        storage.uncompleteTask(taskId, interaction.user.id);
        await interaction.reply({ content: '↩ Отметка снята.', ephemeral: true });
      }
    }
    return;
  }


  const config = storage.getConfig();

  try {
    switch (interaction.commandName) {

      case 'рейтинг': {
        const embed = buildLeaderboardEmbed(config);
        await interaction.reply({ embeds: [embed] });
        break;
      }

      case 'профиль': {
        const target = interaction.options.getUser('пользователь') || interaction.user;
        const r = storage.get(target.id);
        if (!r) return interaction.reply({ content: '❌ Рекрут не найден в системе.', ephemeral: true });
        await interaction.reply({ embeds: [buildProfileEmbed(r, config)] });
        break;
      }

      case 'добавить_рекрута': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        const target = interaction.options.getUser('пользователь');
        const name   = interaction.options.getString('имя') || target.displayName || target.username;

        if (storage.get(target.id))
          return interaction.reply({ content: '⚠️ Этот пользователь уже в системе.', ephemeral: true });

        // 1. Регистрируем рекрута в таблице recruiters
        storage.register(target.id, target.username, name);

        // 2. Авто-создаём личный кабинет на сайте
        const login    = target.username;
        const password = generatePassword(8);
        const siteUrl  = process.env.SITE_URL || 'твой-сайт.railway.app';

        // Создаём пользователя (если уже есть — не ломаемся)
        const regResult = storage.registerUser(login, password);
        if (regResult.ok) {
          // Авто-одобряем и сразу привязываем Discord ID
          storage.approveUser(login);
          storage.linkDiscordToUser(login, target.id);
        }
        // Если пользователь уже существует — только привязываем Discord
        else {
          storage.linkDiscordToUser(login, target.id);
        }

        // 3. Отправляем DM рекруту с данными
        let dmSent = false;
        try {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎉 Добро пожаловать в систему рекрутов!')
            .setColor(0x2ecc71)
            .setDescription(
              `Тебя добавили в систему рекрутов. Твой личный кабинет уже создан!\n\n` +
              `🌐 **Сайт:** ${siteUrl}\n\n` +
              `**Данные для входа:**\n` +
              `> 🔑 **Логин:** \`${login}\`\n` +
              `> 🔒 **Пароль:** \`${password}\`\n\n` +
              `⚠️ Сохрани этот пароль — он больше не будет показан!\n\n` +
              `После входа на сайт используй команду \`/привязать\` в Discord ` +
              `чтобы получить доступ к заданиям прямо в боте.`
            )
            .setTimestamp();

          await target.send({ embeds: [dmEmbed] });
          dmSent = true;
        } catch (_) {
          // У пользователя закрыты личные сообщения
        }

        const dmNote = dmSent
          ? `📨 Логин и пароль отправлены в личные сообщения.`
          : `⚠️ Не удалось отправить DM — у пользователя закрыты личные сообщения.\n` +
            `Передай вручную: логин \`${login}\`, пароль \`${password}\``;

        await interaction.reply({
          content: [
            `✅ **${name}** добавлен как рекрут!`,
            `💎 Начальный буфер: **${config.startingBuffer}** баллов.`,
            `🔐 Личный кабинет на сайте создан автоматически.`,
            dmNote
          ].join('\n'),
          ephemeral: true   // показываем только админу — пароль не светим публично
        });
        break;
      }

      case 'убрать_рекрута': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });
        const target = interaction.options.getUser('пользователь');
        storage.remove(target.id);
        await interaction.reply({ content: `🗑 **${target.username}** удалён из системы.` });
        break;
      }

      case 'баллы': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });
        const target = interaction.options.getUser('пользователь');
        const amount = interaction.options.getInteger('количество');
        const reason = interaction.options.getString('причина') || 'Ручное начисление';
        const r = storage.get(target.id);
        if (!r) return interaction.reply({ content: '❌ Рекрут не найден.', ephemeral: true });
        const updated = storage.addPoints(target.id, amount, reason, interaction.user.id);
        const sign = amount > 0 ? `+${amount}` : amount;
        const emoji = amount > 0 ? '🔺' : '🔻';
        await interaction.reply({
          content: `${emoji} **${updated.displayName}** — ${sign} баллов. Причина: *${reason}*. Итого: **${updated.points}**`
        });
        break;
      }

      case 'сжечь_баллы': {
        await interaction.deferReply();
        const results = storage.doWeeklyBurn();
        const cfg = storage.getConfig();
        const lines = [`⏳ Еженедельное списание **-${cfg.weeklyBurn}** баллов проведено.`];
        if (results.kicked.length) lines.push(`💀 Удалены (0 баллов): ${results.kicked.map(id => `<@${id}>`).join(', ')}`);
        if (results.burned.length) lines.push(`🔴 В опасности: ${results.burned.map(id => `<@${id}>`).join(', ')}`);
        await interaction.editReply({ content: lines.join('\n') });
        break;
      }

      case 'настройки': {
        const sub = interaction.options.getSubcommand();
        if (sub === 'показать') {
          const keywords = getReportKeywords(config);
          const kwLines = Object.entries(keywords).map(([k, v]) => `  \`${k}\` → +${v} баллов`).join('\n');
          const lines = [
            `**Еженедельное списание:** ${config.weeklyBurn} баллов`,
            `**Начальный буфер:** ${config.startingBuffer} баллов`,
            `**Канал другого бота:** ${config.watchChannelId ? `<#${config.watchChannelId}>` : '—'}`,
            `**ID другого бота:** ${config.otherBotId || '—'}`,
            `**ID admin роли:** ${process.env.ADMIN_ROLE_ID || '—'}`,
            '',
            '**Отчётность:**',
            `📋 Канал отчётности: ${config.reportChannelId ? `<#${config.reportChannelId}>` : '—'}`,
            `🔍 Канал проверки: ${config.reportReviewChannelId ? `<#${config.reportReviewChannelId}>` : '(тот же)'}`,
            `🔑 Кейворды:\n${kwLines}`,
            '',
            '**Начисление баллов (другой бот):**',
            `✅ Кандидат принят: +${config.scoring.accepted}`,
            `❌ Кандидат отклонён: +${config.scoring.rejected}`,
            `🚶 Кандидат слился: ${config.scoring.candidateLeft}`,
          ];
          return interaction.reply({ content: lines.join('\n'), ephemeral: true });
        }
        if (sub === 'списание') {
          const val = interaction.options.getInteger('баллы');
          storage.setConfig({ weeklyBurn: val });
          return interaction.reply({ content: `✅ Еженедельное списание: **${val}** баллов.`, ephemeral: true });
        }
        if (sub === 'канал_бота') {
          const id = interaction.options.getString('id');
          storage.setConfig({ watchChannelId: id });
          return interaction.reply({ content: `✅ Канал установлен: <#${id}>`, ephemeral: true });
        }
        if (sub === 'id_бота') {
          const id = interaction.options.getString('id');
          storage.setConfig({ otherBotId: id });
          return interaction.reply({ content: `✅ ID бота установлен: \`${id}\``, ephemeral: true });
        }
        if (sub === 'канал_отчётности') {
          const id = interaction.options.getString('id');
          storage.setConfig({ reportChannelId: id });
          return interaction.reply({ content: `✅ Канал отчётности: <#${id}>`, ephemeral: true });
        }
        if (sub === 'канал_проверки') {
          const id = interaction.options.getString('id');
          storage.setConfig({ reportReviewChannelId: id });
          return interaction.reply({ content: `✅ Канал проверки отчётов: <#${id}>`, ephemeral: true });
        }
        if (sub === 'баллы_за_отчёт') {
          const kw  = interaction.options.getString('кейворд').toUpperCase();
          const pts = interaction.options.getInteger('баллы');
          const config = storage.getConfig();
          const keywords = { ...(config.reportKeywords || {}), [kw]: pts };
          storage.setConfig({ reportKeywords: keywords });
          return interaction.reply({ content: `✅ Кейворд \`${kw}\` → **+${pts}** баллов.`, ephemeral: true });
        }
        break;
      }

      // ── Новые команды ──────────────────

      case 'задания': {
        await interaction.deferReply({ ephemeral: true });

        // Ищем рекрута напрямую по Discord ID — без привязки аккаунта
        const recruiter = storage.get(interaction.user.id);

        if (!recruiter) {
          return interaction.editReply({
            content: [
              '❌ **Ты не зарегистрирован в системе рекрутов.**',
              '',
              'Обратись к администратору чтобы тебя добавили командой `/добавить_рекрута`.'
            ].join('\n')
          });
        }

        // ── НОВАЯ ПРОВЕРКА: требуем привязку аккаунта к сайту ──
        const linkedUser = storage.getUserByDiscordId(interaction.user.id);
        if (!linkedUser) {
          const siteUrl = process.env.SITE_URL || 'твой-сайт.railway.app';
          return interaction.editReply({
            content: [
              '🔒 **Для просмотра заданий нужно привязать Discord к сайту.**',
              '',
              `1. Войди в личный кабинет на **${siteUrl}**`,
              '   *(данные для входа были отправлены тебе в личные сообщения при добавлении)*',
              '2. Используй команду **/привязать** — получишь одноразовый код',
              '3. Введи код в личном кабинете в разделе **🔗 Привязка Discord**',
              '',
              '✨ После этого задания будут доступны прямо в боте!'
            ].join('\n')
          });
        }
        // ────────────────────────────────────────────────────────
        // BUG FIX: personal tasks have assigned_to = login (string), not discordId.
        // Look up the linked account login so personal tasks are found correctly.
        // (linkedUser уже определён выше и гарантированно не null)
        const tasks = storage.getTasksForUser(interaction.user.id, linkedUser ? linkedUser.login : null);

        if (!tasks.length) {
          return interaction.editReply({
            content: `📋 **${recruiter.displayName}** — заданий пока нет. Следи за обновлениями!`
          });
        }

        const doneCount = tasks.filter(t => (t.completedBy || []).includes(interaction.user.id)).length;

        const lines = tasks.map((t, i) => {
          const isDone = (t.completedBy || []).includes(interaction.user.id);
          const target = t.assignedTo !== 'all' ? ' *(личное)*' : '';
          const desc = t.description ? `\n> ${t.description}` : '';
          return `${isDone ? '✅' : '🔲'} **${t.title}**${target}${desc}`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`📋 Задания — ${recruiter.displayName}`)
          .setDescription(lines.join('\n\n'))
          .setColor(0x60a5fa)
          .addFields({ name: 'Прогресс', value: `${doneCount} / ${tasks.length} выполнено`, inline: true })
          .setTimestamp();

        // Кнопки для отметки выполнения (первые 5 невыполненных)
        const undoneTasks = tasks.filter(t => !(t.completedBy || []).includes(interaction.user.id)).slice(0, 5);
        const rows = [];

        if (undoneTasks.length) {
          const row = new ActionRowBuilder().addComponents(
            undoneTasks.map(t =>
              new ButtonBuilder()
                .setCustomId(`complete_task:${t.id}:${interaction.user.id}`)
                .setLabel(`✔ ${t.title.slice(0, 30)}`)
                .setStyle(ButtonStyle.Secondary)
            )
          );
          rows.push(row);
        }

        // Кнопка снять отметку для выполненных
        const doneTasks = tasks.filter(t => (t.completedBy || []).includes(interaction.user.id)).slice(0, 5);
        if (doneTasks.length) {
          const row2 = new ActionRowBuilder().addComponents(
            doneTasks.map(t =>
              new ButtonBuilder()
                .setCustomId(`uncomplete_task:${t.id}:${interaction.user.id}`)
                .setLabel(`↩ ${t.title.slice(0, 28)}`)
                .setStyle(ButtonStyle.Danger)
            )
          );
          rows.push(row2);
        }

        return interaction.editReply({ embeds: [embed], components: rows });
      }

      case 'привязать': {
        const siteUrl = process.env.SITE_URL || 'твой-сайт.railway.app';

        // Проверяем, не привязан ли уже
        const existing = storage.getUserByDiscordId(interaction.user.id);
        if (existing) {
          return interaction.reply({
            content: `✅ Твой Discord уже привязан к аккаунту **${existing.login}**.\nИспользуй /задания чтобы посмотреть задания.`,
            ephemeral: true
          });
        }

        // Генерируем одноразовый код
        const result = storage.generateLinkCode(interaction.user.id);
        if (!result.ok) {
          return interaction.reply({
            content: `⚠️ ${result.error || 'Ошибка генерации кода. Попробуй снова.'}`,
            ephemeral: true
          });
        }

        return interaction.reply({
          content: [
            '🔗 **Привязка Discord к аккаунту на сайте**',
            '',
            `1. Зайди на **${siteUrl}/cabinet.html**`,
            '2. Войди в свой аккаунт',
            '3. Найди раздел **🔗 Привязка Discord**',
            `4. Введи одноразовый код: \`\`\`${result.code}\`\`\``,
            '⏱️ Код действует **5 минут**. Не показывай его другим!',
            '',
            '✨ После этого команда **/задания** покажет твои задания прямо в Discord!'
          ].join('\n'),
          ephemeral: true
        });
      }

    }
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const msg = { content: '❌ Произошла ошибка при выполнении команды.', ephemeral: true };
    if (interaction.deferred) await interaction.editReply(msg);
    else await interaction.reply(msg);
  }
});

function startBot() {
  client.login(process.env.BOT_TOKEN)
    .then(() => console.log('🔑 Bot token accepted'))
    .catch(err => console.error('❌ Bot login failed:', err));
}

module.exports = { startBot };
