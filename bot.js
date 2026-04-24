const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits
} = require('discord.js');
const storage = require('./storage');

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
      s.setName('показать').setDescription('Показать текущие настройки'))
].map(c => c.toJSON());

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
    storage.addPoints(recruiterId, scoring.accepted, `Принял кандидата <@${candidateId}>`, 'bot-auto');
    results.push({ recruiterId, delta: +scoring.accepted, action: 'принял заявку' });
  }

  REJECT_RE.lastIndex = 0;
  while ((m = REJECT_RE.exec(message.content)) !== null) {
    const recruiterId = m[1];
    const candidateId = m[2];
    if (!storage.get(recruiterId)) continue;
    storage.addPoints(recruiterId, scoring.rejected, `Отклонил кандидата <@${candidateId}> (поймал нарушителя)`, 'bot-auto');
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
//  Event handlers
// ─────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('messageCreate', async (message) => {
  const config = storage.getConfig();
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
  if (!interaction.isChatInputCommand()) return;
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
        const name = interaction.options.getString('имя') || target.displayName || target.username;
        if (storage.get(target.id))
          return interaction.reply({ content: '⚠️ Этот пользователь уже в системе.', ephemeral: true });
        storage.register(target.id, target.username, name);
        await interaction.reply({ content: `✅ **${name}** добавлен как рекрут! Начальный буфер: **${config.startingBuffer}** баллов.` });
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
          const lines = [
            `**Еженедельное списание:** ${config.weeklyBurn} баллов`,
            `**Начальный буфер:** ${config.startingBuffer} баллов`,
            `**Канал другого бота:** ${config.watchChannelId ? `<#${config.watchChannelId}>` : '—'}`,
            `**ID другого бота:** ${config.otherBotId || '—'}`,
            `**ID admin роли:** ${process.env.ADMIN_ROLE_ID || '—'}`,
            '',
            '**Начисление баллов:**',
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
        break;
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
