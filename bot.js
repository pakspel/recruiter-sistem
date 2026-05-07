const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActivityType
} = require('discord.js');
const storage      = require('./storage');
const applications = require('./applications');
const vacations    = require('./vacations');

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
  if (!roleId) return false;
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
      s.setName('ссылка_обзвона').setDescription('Ссылка на обзвон (выдаётся при кейворде ОБЗВОН)')
        .addStringOption(o => o.setName('url').setDescription('URL обзвона').setRequired(true)))
    .addSubcommand(s =>
      s.setName('откат_обзвона').setDescription('Ссылка для отката обзвона')
        .addStringOption(o => o.setName('url').setDescription('URL отката').setRequired(true)))
    .addSubcommand(s =>
      s.setName('канал_новостей').setDescription('Канал куда бот публикует новости')
        .addStringOption(o => o.setName('id').setDescription('Channel ID').setRequired(true)))
    .addSubcommand(s =>
      s.setName('показать').setDescription('Показать текущие настройки')),

  new SlashCommandBuilder()
    .setName('статистика_приёма')
    .setDescription('[Куратор/Админ] Кто принял сколько людей'),


  new SlashCommandBuilder()
    .setName('задания')
    .setDescription('Показать мои задания'),

  new SlashCommandBuilder()
    .setName('привязать')
    .setDescription('Как привязать свой Discord к аккаунту на сайте'),

  new SlashCommandBuilder()
    .setName('бэкап_бд')
    .setDescription('[ADMIN] Скачать резервную копию базы данных')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('новость')
    .setDescription('[ADMIN] Опубликовать новость для рекрутов')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('заголовок').setDescription('Заголовок новости').setRequired(true))
    .addStringOption(o => o.setName('текст').setDescription('Текст новости').setRequired(true))
    .addStringOption(o => o.setName('канал').setDescription('ID канала (по умолчанию — канал новостей из настроек)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('опрос')
    .setDescription('[ADMIN] Создать опрос для рекрутов')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('вопрос').setDescription('Вопрос опроса').setRequired(true))
    .addStringOption(o => o.setName('вариант_1').setDescription('Вариант ответа 1').setRequired(true))
    .addStringOption(o => o.setName('вариант_2').setDescription('Вариант ответа 2').setRequired(true))
    .addStringOption(o => o.setName('вариант_3').setDescription('Вариант ответа 3').setRequired(false))
    .addStringOption(o => o.setName('вариант_4').setDescription('Вариант ответа 4').setRequired(false))
    .addStringOption(o => o.setName('канал').setDescription('ID канала для опроса').setRequired(false)),

  new SlashCommandBuilder()
    .setName('закрыть_опрос')
    .setDescription('[ADMIN] Закрыть опрос и показать результаты')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('id').setDescription('ID опроса').setRequired(true)),

  new SlashCommandBuilder()
    .setName('статус_бота')
    .setDescription('[ADMIN] Изменить мемный статус бота (последний в очереди)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName('текст').setDescription('Текст статуса').setRequired(true))
    .addStringOption(o =>
      o.setName('тип').setDescription('Тип активности (по умолчанию: Слушает)').setRequired(false)
        .addChoices(
          { name: '🎵 Слушает',       value: 'listening'  },
          { name: '📺 Смотрит',       value: 'watching'   },
          { name: '🎮 Играет',        value: 'playing'    },
          { name: '🏆 Соревнуется в', value: 'competing'  }
        )),

].map(c => c.toJSON());

// ── Дополнительные команды из модулей ──────────────────────
commands.push(...applications.getCommands());
commands.push(...vacations.getCommands());

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
//  Динамические статусы бота
// ─────────────────────────────────────

/**
 * Собирает список статусов с актуальными данными из БД.
 * Кураторы (>= 2000 баллов) не считаются в топе и не входят в "активных рекрутов".
 */
async function buildStatuses(client) {
  const all = Object.values(storage.getAll());
  const nonCurators = all.filter(r => r.status !== 'kicked' && !storage.isCurator(r.points));

  // 👥 Активных рекрутов
  const activeCount = nonCurators.filter(r => r.status !== 'kicked').length;

  // 🏆 Лидер (топ-1 среди не-кураторов)
  const sorted = [...nonCurators].sort((a, b) => b.points - a.points);
  const leader = sorted[0];
  const leaderText = leader
    ? `🏆 Лидер: ${leader.displayName} — ${leader.points} баллов`
    : '🏆 Лидер: ещё нет данных';

  // 📋 Заявок на рассмотрении (считаем сообщения с кнопкой "Одобрить" в канале проверки)
  let pendingCount = 0;
  const reviewChannelId = process.env.APPLICATION_REVIEW_CHANNEL_ID;
  if (reviewChannelId) {
    try {
      const ch = await client.channels.fetch(reviewChannelId);
      let lastId;
      while (true) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const batch = await ch.messages.fetch(opts);
        if (batch.size === 0) break;
        pendingCount += batch.filter(m =>
          m.components.length > 0 &&
          m.components[0].components.some(c => c.customId?.startsWith('app:approve'))
        ).size;
        if (batch.size < 100) break;
        lastId = batch.last().id;
      }
    } catch (_) { /* канал недоступен — просто 0 */ }
  }

  // 📅 До списания: берём lastWeeklyBurn из мета и прибавляем 7 дней
  let daysUntilBurn = '?';
  try {
    const { lastWeeklyBurn } = storage.load();
    if (lastWeeklyBurn) {
      const next = new Date(new Date(lastWeeklyBurn).getTime() + 7 * 24 * 60 * 60 * 1000);
      const diff = Math.ceil((next - Date.now()) / (1000 * 60 * 60 * 24));
      daysUntilBurn = Math.max(0, diff);
    }
  } catch (_) {}

  // 📊 Всего заявок = сумма принятых + отклонённых по всем рекрутам
  const totalApps = all.reduce((s, r) => s + (r.totalAccepted || 0) + (r.totalRejected || 0), 0);

  // 🎵 Мемный статус (можно менять через /статус_бота)
  const config      = storage.getConfig();
  const memeText    = config.memeStatusText || 'мальчик поплыл, мальчик пропал — Анна Асти';
  const memeTypeKey = config.memeStatusType || 'listening';
  const typeMap     = {
    listening:  ActivityType.Listening,
    watching:   ActivityType.Watching,
    playing:    ActivityType.Playing,
    competing:  ActivityType.Competing,
  };
  const memeType = typeMap[memeTypeKey] ?? ActivityType.Listening;

  return [
    { name: `👥 Активных рекрутов: ${activeCount}`,           type: ActivityType.Watching  },
    { name: `📋 Заявок на рассмотрении: ${pendingCount}`,     type: ActivityType.Watching  },
    { name: leaderText,                                          type: ActivityType.Watching  },
    { name: `📅 До списания: ${daysUntilBurn} дн.`,           type: ActivityType.Watching  },
    { name: `📊 Всего заявок получено: ${totalApps}`,         type: ActivityType.Watching  },
    { name: '👨‍💻 Разработчик: PAKSPEL',                         type: ActivityType.Watching  },
    { name: memeText,                                            type: memeType               },
  ];
}

let _statusIndex    = 0;
let _statusInterval = null;

async function rotateStatus(client) {
  try {
    const statuses = await buildStatuses(client);
    const s = statuses[_statusIndex % statuses.length];
    client.user.setPresence({ status: 'online', activities: [{ name: s.name, type: s.type }] });
    _statusIndex++;
  } catch (err) {
    console.error('[StatusRotation] Ошибка обновления статуса:', err);
  }
}

function startStatusRotation(client) {
  rotateStatus(client); // сразу при старте
  if (_statusInterval) clearInterval(_statusInterval);
  _statusInterval = setInterval(() => rotateStatus(client), 30_000); // каждые 30 секунд
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
const OBZVON_KEYWORD  = 'ОБЗВОН';  // куратор выдаёт ссылку на обзвон + откат

function getReportKeywords(config) {
  return { ...DEFAULT_REPORT_KEYWORDS, ...(config.reportKeywords || {}) };
}

/** Ищет первый совпавший кейворд в тексте (без учёта регистра). */
function detectKeyword(text, keywords) {
  // Сначала проверяем ЗАДАНИЕ отдельно
  if (text.toUpperCase().includes(ZADANIE_KEYWORD)) return { keyword: ZADANIE_KEYWORD, points: null };
  // Проверяем ОБЗВОН отдельно
  if (text.toUpperCase().includes(OBZVON_KEYWORD)) return { keyword: OBZVON_KEYWORD, points: null };
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

  const isObzvon  = kwMatch?.keyword === OBZVON_KEYWORD;
  const isZadanie = kwMatch?.keyword === ZADANIE_KEYWORD;

  // ── ОБЗВОН: особая логика — нужно 2 ссылки, фото не требуется ──
  if (isObzvon) {
    const urlRegex = /https?:\/\/[^\s]+/gi;
    const links = text.match(urlRegex) || [];

    if (links.length < 2) {
      const reply = await message.reply({
        content: [
          '❌ **Отчёт ОБЗВОН не принят — нужно 2 ссылки:**',
          '🔗 **Ссылка 1** — ссылка на Discord-сервер/канал обзвона',
          '🎬 **Ссылка 2** — ссылка на видео/запись как ты его провёл',
          '',
          '**Формат:** `ОБЗВОН https://discord.gg/... https://youtu.be/...`',
        ].join('\n')
      });
      setTimeout(() => reply.delete().catch(() => {}), 30_000);
      return;
    }

    const recruiter = storage.get(message.author.id);
    if (!recruiter) return;

    const OBZVON_POINTS = 2;
    const updated = storage.addPoints(
      message.author.id, OBZVON_POINTS,
      'Отчёт: ОБЗВОН', 'bot-report', 'report'
    );

    await message.react('✅').catch(() => {});

    // Авто-сообщение рекруту прямо в канал отчётности
    const confirmMsg = await message.reply({
      content: [
        `✅ **${recruiter.displayName}**, твой отчёт **ОБЗВОН** принят автоматически!`,
        `💎 Начислено: **+${OBZVON_POINTS}** балла. Итого: **${updated.points}**.`,
      ].join('\n')
    });
    setTimeout(() => confirmMsg.delete().catch(() => {}), 30_000);

    // Карточка в канал проверки
    const reviewChannelId = config.reportReviewChannelId || config.reportChannelId;
    let reviewChannel;
    try { reviewChannel = await message.client.channels.fetch(reviewChannelId); }
    catch { return; }

    const embed = new EmbedBuilder()
      .setTitle('✅ Обзвон — +2 балла начислено автоматически')
      .setColor(0xa855f7)
      .addFields(
        { name: '👤 Рекрут',             value: `${recruiter.displayName} (<@${message.author.id}>)`, inline: true },
        { name: '🔑 Тип',                value: '`ОБЗВОН`', inline: true },
        { name: '💎 Начислено',           value: `+${OBZVON_POINTS}`, inline: true },
        { name: '📊 Итого',              value: `${updated.points} баллов`, inline: true },
        { name: '🔗 Сообщение',          value: `[Перейти](${message.url})`, inline: true },
        { name: '📅 Дата',               value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
        { name: '🔗 Ссылка 1 (Discord)', value: links[0].slice(0, 200), inline: false },
        { name: '🎬 Ссылка 2 (Видео)',   value: links[1].slice(0, 200), inline: false }
      )
      .setFooter({ text: `ID: ${message.author.id} · msg: ${message.id}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`report_revoke:${message.author.id}:${OBZVON_POINTS}:${message.id}`)
        .setLabel(`❌ Скам — снять ${OBZVON_POINTS} балла`)
        .setStyle(ButtonStyle.Danger)
    );

    await reviewChannel.send({ embeds: [embed], components: [row] });
    return;
  }

  // Молчим если не похоже на отчёт (нет ни кейворда, ни фото вместе)
  if (!kwMatch && !hasPhoto) return;

  // ── Валидация для обычных кейвордов ───────────────────
  const errors = [];
  if (!hasPhoto) errors.push('📷 **Нет фото-доказательства** — прикрепи скриншот');
  if (!kwMatch)  errors.push(`🔑 **Нет кейворда** — укажи: ${[...Object.keys(keywords), OBZVON_KEYWORD, ZADANIE_KEYWORD].join(' · ')}`);

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
  vacations.setup(client);    // ← система отпусков
  startStatusRotation(client); // ← ротация статусов каждые 30 сек
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

    // ── Кнопки голосования в опросе ───────────────────────
    if (taskAction === 'poll_vote') {
      const pollId    = taskId;
      const optionIdx = parseInt(targetDiscordId);
      const poll      = storage.getPoll(pollId);
      if (!poll) return interaction.reply({ content: '❌ Опрос не найден.', ephemeral: true });
      if (poll.closedAt) return interaction.reply({ content: '🔒 Опрос уже закрыт.', ephemeral: true });

      const updated    = storage.votePoll(pollId, interaction.user.id, optionIdx);
      const EMOJIS     = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
      const totalVotes = Object.values(updated.voteCounts).reduce((s, v) => s + v, 0);
      const chosen     = updated.options[optionIdx];

      // Обновляем embed с текущими результатами
      const resultLines = updated.options.map((o, i) => {
        const cnt = updated.voteCounts[i] || 0;
        const pct = totalVotes > 0 ? Math.round(cnt / totalVotes * 100) : 0;
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
        return `${EMOJIS[i]} **${o}** — ${cnt} (${pct}%)\n${bar}`;
      }).join('\n\n');

      const embed = new EmbedBuilder()
        .setTitle(`📊 Опрос`)
        .setDescription(`**${updated.question}**\n\n${resultLines}`)
        .setColor(0x60a5fa)
        .setFooter({ text: `ID: ${pollId} · Всего голосов: ${totalVotes}` })
        .setTimestamp();

      try { await interaction.message.edit({ embeds: [embed] }); } catch (_) {}
      return interaction.reply({ content: `✅ Ты проголосовал за: **${chosen}**`, ephemeral: true });
    }

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
            `📞 ОБЗВОН — ссылка: ${config.obzvonLink || '—'}`,
            `🔄 ОБЗВОН — откат: ${config.obzvonReset || '—'}`,
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
        if (sub === 'ссылка_обзвона') {
          const url = interaction.options.getString('url');
          storage.setConfig({ obzvonLink: url });
          return interaction.reply({ content: `✅ Ссылка на обзвон установлена: ${url}`, ephemeral: true });
        }
        if (sub === 'откат_обзвона') {
          const url = interaction.options.getString('url');
          storage.setConfig({ obzvonReset: url });
          return interaction.reply({ content: `✅ Ссылка отката обзвона установлена: ${url}`, ephemeral: true });
        }
        if (sub === 'канал_новостей') {
          const id = interaction.options.getString('id');
          storage.setConfig({ newsChannelId: id });
          return interaction.reply({ content: `✅ Канал новостей установлен: <#${id}>`, ephemeral: true });
        }
        break;
      }

      case 'статистика_приёма': {
        const config = storage.getConfig();
        if (!isCuratorOrAdmin(interaction.member, config)) {
          return interaction.reply({ content: '❌ Только кураторы и администраторы могут просматривать эту статистику.', ephemeral: true });
        }

        const stats = storage.getAcceptedStats();
        if (!stats.length) {
          return interaction.reply({ content: '📋 Нет данных о принятых людях.', ephemeral: true });
        }

        const medals = ['🥇', '🥈', '🥉'];
        const rows = stats.map((r, i) => {
          const medal = medals[i] || `**${i + 1}.**`;
          return `${medal} **${r.displayName}** — ✅ ${r.totalAccepted} принято · ❌ ${r.totalRejected} отклонено`;
        }).slice(0, 25);

        const embed = new EmbedBuilder()
          .setTitle('📊 Статистика приёма — кто принял сколько людей')
          .setColor(0xa855f7)
          .setDescription(rows.join('\n'))
          .setTimestamp()
          .setFooter({ text: `Всего рекрутов: ${stats.length}` });

        return interaction.reply({ embeds: [embed], ephemeral: true });
      }



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
          let deadlineStr = '';
          if (t.deadline) {
            const dl = new Date(t.deadline);
            const hoursLeft = Math.round((dl - Date.now()) / 36e5);
            const dlFormatted = dl.toLocaleString('ru', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            const urgency = hoursLeft <= 6 ? '🔴' : hoursLeft <= 24 ? '🟡' : '🕐';
            deadlineStr = `\n${urgency} Дедлайн: **${dlFormatted}** (осталось ~${hoursLeft}ч.)`;
          }
          return `${isDone ? '✅' : '🔲'} **${t.title}**${target}${desc}${deadlineStr}`;
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

      case 'бэкап_бд': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        await interaction.deferReply({ ephemeral: true });
        const dbPath = storage.getDbPath();
        const fs = require('fs');

        if (!fs.existsSync(dbPath))
          return interaction.editReply({ content: '❌ Файл базы данных не найден.' });

        const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
        const backupPath = require('path').join(require('os').tmpdir(), backupName);
        fs.copyFileSync(dbPath, backupPath);

        const stats = fs.statSync(backupPath);
        const sizeMb = (stats.size / 1024 / 1024).toFixed(2);

        await interaction.editReply({
          content: `✅ **Бэкап базы данных**\n📦 Размер: **${sizeMb} MB**\n📅 Дата: ${new Date().toLocaleString('ru')}\n\n⬇️ Файл прикреплён:`,
          files: [{ attachment: backupPath, name: backupName }]
        });

        // Удаляем временный файл через 30 секунд
        setTimeout(() => { try { fs.unlinkSync(backupPath); } catch (_) {} }, 30_000);
        break;
      }

      case 'новость': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        const title  = interaction.options.getString('заголовок');
        const body   = interaction.options.getString('текст');
        const config = storage.getConfig();
        const channelId = interaction.options.getString('канал') || config.newsChannelId;

        if (!channelId)
          return interaction.reply({
            content: '❌ Укажи канал для новости или настрой его командой `/настройки канал_новостей`.',
            ephemeral: true
          });

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel)
          return interaction.reply({ content: `❌ Канал <#${channelId}> не найден.`, ephemeral: true });

        const news = storage.createNews(title, body, interaction.user.username);

        const embed = new EmbedBuilder()
          .setTitle(`📢 ${title}`)
          .setDescription(body)
          .setColor(0xf59e0b)
          .setAuthor({ name: `📰 Новости рекрутинга`, iconURL: interaction.guild?.iconURL() || undefined })
          .setFooter({ text: `Опубликовал: ${interaction.user.displayName || interaction.user.username}` })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
        await interaction.reply({ content: `✅ Новость **"${title}"** опубликована в <#${channelId}>!`, ephemeral: true });
        break;
      }

      case 'опрос': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        const question = interaction.options.getString('вопрос');
        const opts = [
          interaction.options.getString('вариант_1'),
          interaction.options.getString('вариант_2'),
          interaction.options.getString('вариант_3'),
          interaction.options.getString('вариант_4'),
        ].filter(Boolean);

        const config = storage.getConfig();
        const channelId = interaction.options.getString('канал') || config.newsChannelId || interaction.channelId;
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel)
          return interaction.reply({ content: `❌ Канал не найден.`, ephemeral: true });

        const poll = storage.createPoll(question, opts, channelId, interaction.user.username);

        const POLL_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const optLines = opts.map((o, i) => `${POLL_EMOJIS[i]} ${o}`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle(`📊 Опрос`)
          .setDescription(`**${question}**\n\n${optLines}`)
          .setColor(0x60a5fa)
          .setFooter({ text: `ID опроса: ${poll.id} · Нажми кнопку чтобы проголосовать` })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          opts.map((o, i) =>
            new ButtonBuilder()
              .setCustomId(`poll_vote:${poll.id}:${i}`)
              .setLabel(`${POLL_EMOJIS[i]} ${o.slice(0, 50)}`)
              .setStyle(ButtonStyle.Primary)
          )
        );

        const msg = await channel.send({ embeds: [embed], components: [row] });
        storage.setPollMessageId(poll.id, msg.id);

        await interaction.reply({
          content: `✅ Опрос создан в <#${channelId}>!\n🆔 ID опроса: \`${poll.id}\`\nЧтобы закрыть: \`/закрыть_опрос id:${poll.id}\``,
          ephemeral: true
        });
        break;
      }

      case 'закрыть_опрос': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        const pollId = interaction.options.getString('id');
        const poll   = storage.getPoll(pollId);
        if (!poll) return interaction.reply({ content: '❌ Опрос не найден.', ephemeral: true });
        if (poll.closedAt) return interaction.reply({ content: '⚠️ Опрос уже закрыт.', ephemeral: true });

        const closed = storage.closePoll(pollId);
        const POLL_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
        const totalVotes = Object.values(closed.voteCounts).reduce((s, v) => s + v, 0);

        const resultLines = closed.options.map((o, i) => {
          const cnt = closed.voteCounts[i] || 0;
          const pct = totalVotes > 0 ? Math.round(cnt / totalVotes * 100) : 0;
          const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
          return `${POLL_EMOJIS[i]} **${o}**\n${bar} ${cnt} голос(ов) (${pct}%)`;
        }).join('\n\n');

        const embed = new EmbedBuilder()
          .setTitle(`📊 Результаты опроса — закрыт`)
          .setDescription(`**${closed.question}**\n\n${resultLines}`)
          .setColor(0x6b7280)
          .setFooter({ text: `Всего проголосовало: ${totalVotes} · ID: ${pollId}` })
          .setTimestamp();

        // Обновляем оригинальное сообщение (убираем кнопки)
        try {
          const ch  = await client.channels.fetch(closed.channelId);
          const msg = await ch.messages.fetch(closed.messageId);
          await msg.edit({ embeds: [embed], components: [] });
        } catch (_) {}

        await interaction.reply({ content: `✅ Опрос закрыт. Результаты опубликованы в <#${closed.channelId}>.`, ephemeral: true });
        break;
      }

      case 'статус_бота': {
        if (!hasAdminRole(interaction.member))
          return interaction.reply({ content: '❌ Недостаточно прав.', ephemeral: true });

        const newText    = interaction.options.getString('текст');
        const newTypeKey = interaction.options.getString('тип') || 'listening';

        storage.setConfig({ memeStatusText: newText, memeStatusType: newTypeKey });

        // Сбрасываем индекс на мемный статус (последний) и сразу применяем
        _statusIndex = 6; // индекс мемного статуса
        await rotateStatus(client);

        const typeLabels = {
          listening: '🎵 Слушает',
          watching:  '📺 Смотрит',
          playing:   '🎮 Играет',
          competing: '🏆 Соревнуется в',
        };
        await interaction.reply({
          content: `✅ Мемный статус обновлён!\n> ${typeLabels[newTypeKey] ?? '🎵 Слушает'}: **${newText}**`,
          ephemeral: true
        });
        break;
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

// ─────────────────────────────────────
//  Deadline notification scheduler
// ─────────────────────────────────────

/**
 * Каждый час проверяем задания с дедлайном в ближайшие 24 часа
 * и шлём DM рекрутам, которые ещё не получили уведомление.
 */
async function checkDeadlineNotifications() {
  try {
    const tasks = storage.getTasksNearDeadline(24 * 60 * 60 * 1000);
    if (!tasks.length) return;

    const allRecruiters = Object.values(storage.getAll()).filter(r => r.status !== 'kicked');

    for (const task of tasks) {
      const deadline    = new Date(task.deadline);
      const hoursLeft   = Math.round((deadline - Date.now()) / 36e5);
      const deadlineStr = deadline.toLocaleString('ru', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

      // Определяем, кому слать уведомление
      let targets = [];
      if (task.assignedTo === 'all') {
        targets = allRecruiters;
      } else {
        const r = storage.get(task.assignedTo);
        if (r) targets = [r];
      }

      for (const recruiter of targets) {
        // Уже отметили как выполненное — не беспокоим
        if ((task.completedBy || []).includes(recruiter.discordId)) continue;
        // Уже отправляли уведомление
        if (storage.isDeadlineNotified(task.id, recruiter.discordId)) continue;

        try {
          const user = await client.users.fetch(recruiter.discordId);
          const embed = new EmbedBuilder()
            .setTitle('⏰ Дедлайн приближается!')
            .setColor(hoursLeft <= 6 ? 0xef4444 : 0xf59e0b)
            .setDescription(
              `У тебя есть невыполненное задание с дедлайном!\n\n` +
              `📋 **Задание:** ${task.title}\n` +
              (task.description ? `> ${task.description}\n\n` : '\n') +
              `⏳ **Осталось:** примерно **${hoursLeft} ч.**\n` +
              `🕐 **Дедлайн:** ${deadlineStr} (МСК)\n\n` +
              `Используй \`/задания\` чтобы отметить выполнение.`
            )
            .setTimestamp();

          await user.send({ embeds: [embed] });
          storage.markDeadlineNotified(task.id, recruiter.discordId);
          console.log(`⏰ Deadline notification sent to ${recruiter.displayName} for task "${task.title}"`);
        } catch (err) {
          // DM закрыты — пропускаем
          console.log(`Could not send deadline DM to ${recruiter.discordId}: ${err.message}`);
          storage.markDeadlineNotified(task.id, recruiter.discordId); // не спамим
        }
      }
    }
  } catch (err) {
    console.error('Deadline checker error:', err);
  }
}

function startBot() {
  client.login(process.env.BOT_TOKEN)
    .then(() => {
      console.log('🔑 Bot token accepted');
      // Запускаем проверку дедлайнов каждый час
      setInterval(checkDeadlineNotifications, 60 * 60 * 1000);
      // Первая проверка через 30 секунд после старта
      setTimeout(checkDeadlineNotifications, 30_000);
    })
    .catch(err => console.error('❌ Bot login failed:', err));
}

module.exports = { startBot };
