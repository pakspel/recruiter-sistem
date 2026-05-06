/**
 * applications.js — Система приёма заявок в семью
 *
 * Переменные окружения (добавь в .env):
 *   APPLICATION_REVIEW_CHANNEL_ID  — канал, куда приходят заявки на рассмотрение
 *   APPROVED_ROLE_ID               — роль, выдаваемая при одобрении заявки
 *   RECRUIT_ROLE_ID                — роль рекрутов (видит тикет-каналы)
 *   TICKET_CATEGORY_ID             — ID категории для тикет-каналов (опционально)
 *
 * Slash-команды (только для администраторов):
 *   /заявка_панель  — отправить кнопку «Подать заявку» в текущий канал
 *
 * Подключение в bot.js:
 *   const applications = require('./applications');
 *   // В массиве commands:  ...applications.getCommands()
 *   // В clientReady:       applications.setup(client);
 */

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, ChannelType, PermissionsBitField
} = require('discord.js');
const storage = require('./storage');

// ─────────────────────────────────────────────────────────────
//  Slash command definitions (возвращаем уже .toJSON() объекты)
// ─────────────────────────────────────────────────────────────
function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName('заявка_панель')
      .setDescription('[ADMIN] Отправить кнопку «Подать заявку» в текущий канал')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON()
  ];
}

// ─────────────────────────────────────────────────────────────
//  Подключение обработчиков к клиенту
// ─────────────────────────────────────────────────────────────
function setup(client) {
  client.on('interactionCreate', async (interaction) => {
    // Игнорируем взаимодействия, не относящиеся к системе заявок
    if (!isApplicationInteraction(interaction)) return;

    try {
      await handleApplicationInteraction(interaction);
    } catch (err) {
      console.error('[Applications] Ошибка обработки взаимодействия:', err);
      const msg = { content: '❌ Произошла ошибка. Попробуй снова.', ephemeral: true };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch (_) {}
    }
  });

  console.log('📋 Модуль заявок подключён');
}

// ─────────────────────────────────────────────────────────────
//  Фильтр: относится ли взаимодействие к этому модулю
// ─────────────────────────────────────────────────────────────
function isApplicationInteraction(interaction) {
  if (interaction.isChatInputCommand()) return interaction.commandName === 'заявка_панель';
  if (interaction.isButton())           return interaction.customId.startsWith('app:');
  if (interaction.isModalSubmit())      return interaction.customId.startsWith('app:');
  return false;
}

// ─────────────────────────────────────────────────────────────
//  Главный обработчик
// ─────────────────────────────────────────────────────────────
async function handleApplicationInteraction(interaction) {

  // ── Slash: /заявка_панель ──────────────────────────────────
  if (interaction.isChatInputCommand() && interaction.commandName === 'заявка_панель') {
    return cmdSendPanel(interaction);
  }

  // ── Button: открыть форму заявки ──────────────────────────
  if (interaction.isButton() && interaction.customId === 'app:open_form') {
    return btnOpenForm(interaction);
  }

  // ── Modal submit: заявка заполнена ────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === 'app:submit_form') {
    return modalSubmitApplication(interaction);
  }

  // ── Buttons: одобрить / отклонить / создать тикет ─────────
  if (interaction.isButton() && interaction.customId.startsWith('app:')) {
    const [, action, applicantId] = interaction.customId.split(':');

    if (action === 'approve') return btnApprove(interaction, applicantId);
    if (action === 'reject')  return btnReject(interaction, applicantId);
    if (action === 'ticket')  return btnCreateTicket(interaction, applicantId);
  }
}

// ─────────────────────────────────────────────────────────────
//  /заявка_панель — отправить кнопку в канал
// ─────────────────────────────────────────────────────────────
async function cmdSendPanel(interaction) {
  const embed = new EmbedBuilder()
    .setDescription(
      'Рады видеть тебя здесь! Если ты хочешь вступить в нашу семью — просто нажми на кнопку ниже и заполни небольшую анкету. Мы постараемся рассмотреть её как можно скорее 🤝'
    )
    .setColor(0x5865F2);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('app:open_form')
      .setLabel('Подать заявку')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  return interaction.reply({ content: '✅ Панель заявок отправлена!', ephemeral: true });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Подать заявку» → открываем Modal
// ─────────────────────────────────────────────────────────────
async function btnOpenForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('app:submit_form')
    .setTitle('Заявка на вступление в семью');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('name_birth')
        .setLabel('Имя | Дата рождения')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: Кирилл 25.03.2008')
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('timezone_online')
        .setLabel('Часовой пояс | Время онлайна')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: МСК / в среднем 5 часов ежедневно')
        .setRequired(true)
        .setMaxLength(150)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('prev_families')
        .setLabel('В каких семьях были ранее')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: Sacred, Trivial или — если нигде не были')
        .setRequired(true)
        .setMaxLength(200)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('how_found')
        .setLabel('Откуда узнали о нас')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: друзья, реклама, сам нашёл')
        .setRequired(true)
        .setMaxLength(150)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('about')
        .setLabel('О себе')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Расскажи немного о себе...')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(500)
    )
  );

  return interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────
//  Modal submit — отправляем заявку в канал проверки
// ─────────────────────────────────────────────────────────────
async function modalSubmitApplication(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const nameBirth      = interaction.fields.getTextInputValue('name_birth');
  const timezoneOnline = interaction.fields.getTextInputValue('timezone_online');
  const prevFamilies   = interaction.fields.getTextInputValue('prev_families');
  const howFound       = interaction.fields.getTextInputValue('how_found');
  const about          = interaction.fields.getTextInputValue('about');

  const reviewChannelId = process.env.APPLICATION_REVIEW_CHANNEL_ID;
  if (!reviewChannelId) {
    console.warn('[Applications] APPLICATION_REVIEW_CHANNEL_ID не задан в .env');
    return interaction.editReply({ content: '⚙️ Канал для приёма заявок не настроен. Обратитесь к администратору.' });
  }

  let reviewChannel;
  try {
    reviewChannel = await interaction.client.channels.fetch(reviewChannelId);
  } catch {
    return interaction.editReply({ content: '❌ Не удалось найти канал для заявок. Обратитесь к администратору.' });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Заявка от <@${interaction.user.id}>`)
    .setColor(0x5865F2)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Имя | Дата рождения',         value: nameBirth },
      { name: 'Часовой пояс | Время онлайна', value: timezoneOnline },
      { name: 'В каких семьях были ранее',    value: prevFamilies },
      { name: 'Откуда узнали о нас',          value: howFound },
      { name: 'О себе',                        value: about },
      { name: 'ID пользователя',              value: interaction.user.id }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`app:approve:${interaction.user.id}`)
      .setLabel('Одобрить')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`app:reject:${interaction.user.id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌'),
    new ButtonBuilder()
      .setCustomId(`app:ticket:${interaction.user.id}`)
      .setLabel('Создать тикет')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🎫')
  );

  // Пингуем две роли рекрутов
  const pingParts = [];
  if (process.env.RECRUIT_ROLE_ID)   pingParts.push(`<@&${process.env.RECRUIT_ROLE_ID}>`);
  if (process.env.RECRUIT_ROLE_ID_2) pingParts.push(`<@&${process.env.RECRUIT_ROLE_ID_2}>`);
  const content = pingParts.length ? pingParts.join(' ') : undefined;

  await reviewChannel.send({ content, embeds: [embed], components: [row] });

  return interaction.editReply({ content: '✅ Твоя заявка успешно отправлена! Ожидай ответа от администрации.' });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Одобрить»
// ─────────────────────────────────────────────────────────────
async function btnApprove(interaction, applicantId) {
  const embed = interaction.message.embeds[0];
  if (!canReviewApplication(interaction.member, embed)) {
    return interaction.reply({ content: '❌ Одобрить заявку может только тот, кто создал тикет, куратор или администратор.', ephemeral: true });
  }

  await interaction.deferUpdate();

  // ── Выдаём роль соискателю ────────────────────────────────
  const approvedRoleId = process.env.APPROVED_ROLE_ID;
  let roleNote = '';
  if (approvedRoleId) {
    try {
      const member = await interaction.guild.members.fetch(applicantId);
      await member.roles.add(approvedRoleId);
      roleNote = ' Роль семьи выдана.';
    } catch (e) {
      console.error('[Applications] Не удалось выдать роль:', e);
      roleNote = ' ⚠️ Не удалось выдать роль — проверь права бота.';
    }
  } else {
    roleNote = ' ⚙️ APPROVED_ROLE_ID не задан в .env.';
  }

  // ── Начисляем баллы рекруту, который одобрил ─────────────
  const recruiter = storage.get(interaction.user.id);
  if (recruiter) {
    const config = storage.getConfig();
    const pts    = config.scoring?.accepted ?? 5;
    storage.addPoints(
      interaction.user.id, pts,
      `Принял заявку кандидата <@${applicantId}>`,
      'bot-auto', 'accepted'
    );
    roleNote += ` +${pts} баллов рекруту.`;
  }

  // ── Удаляем тикет-каналы если были созданы ───────────────
  await deleteTicketChannels(interaction);

  // ── DM соискателю ─────────────────────────────────────────
  try {
    const user = await interaction.client.users.fetch(applicantId);
    await user.send({ content: '✅ **Твоя заявка одобрена!** Добро пожаловать в семью!' });
  } catch (_) {}

  // ── Обновляем embed ───────────────────────────────────────
  const updatedEmbed = EmbedBuilder.from(embed)
    .setColor(0x2ecc71)
    .setTitle(embed.title?.replace('Заявка от', '✅ Заявка одобрена от') ?? '✅ Заявка одобрена')
    .addFields({ name: '👮 Одобрил', value: interaction.user.tag, inline: true });

  return interaction.editReply({ content: `✅ Одобрено.${roleNote}`, embeds: [updatedEmbed], components: [] });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Отклонить»
// ─────────────────────────────────────────────────────────────
async function btnReject(interaction, applicantId) {
  const embed = interaction.message.embeds[0];
  if (!canReviewApplication(interaction.member, embed)) {
    return interaction.reply({ content: '❌ Отклонить заявку может только тот, кто создал тикет, куратор или администратор.', ephemeral: true });
  }

  await interaction.deferUpdate();

  // ── Начисляем баллы рекруту, который отклонил ────────────
  let pointsNote = '';
  const recruiter = storage.get(interaction.user.id);
  if (recruiter) {
    const config = storage.getConfig();
    const pts    = config.scoring?.rejected ?? 3;
    storage.addPoints(
      interaction.user.id, pts,
      `Отклонил заявку кандидата <@${applicantId}>`,
      'bot-auto', 'rejected'
    );
    pointsNote = ` +${pts} баллов рекруту.`;
  }

  // ── Удаляем тикет-каналы если были созданы ───────────────
  await deleteTicketChannels(interaction);

  // ── DM соискателю ─────────────────────────────────────────
  try {
    const user = await interaction.client.users.fetch(applicantId);
    await user.send({
      content: '❌ **Твоя заявка была отклонена.**\nЕсли у тебя есть вопросы — обратись к администрации.'
    });
  } catch (_) {}

  // ── Обновляем embed ───────────────────────────────────────
  const updatedEmbed = EmbedBuilder.from(embed)
    .setColor(0xe63946)
    .setTitle(embed.title?.replace('Заявка от', '❌ Заявка отклонена от') ?? '❌ Заявка отклонена')
    .addFields({ name: '👮 Отклонил', value: interaction.user.tag, inline: true });

  return interaction.editReply({ content: `❌ Отклонено.${pointsNote}`, embeds: [updatedEmbed], components: [] });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Создать тикет» — 1 текстовый + 1 голосовой канал
// ─────────────────────────────────────────────────────────────
async function btnCreateTicket(interaction, applicantId) {
  if (!hasManageRoles(interaction.member)) {
    return interaction.reply({ content: '❌ Только администраторы могут создавать тикеты.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const guild          = interaction.guild;
  const recruitRoleId  = process.env.RECRUIT_ROLE_ID;
  const adminRoleId    = process.env.ADMIN_ROLE_ID;
  const categoryId     = process.env.TICKET_CATEGORY_ID;

  // Проверяем, не создан ли тикет ранее (ищем поле «Тикет» в embed)
  const existingEmbed = interaction.message.embeds[0];
  if (existingEmbed?.fields?.some(f => f.name === '🎫 Тикет')) {
    return interaction.editReply({ content: '⚠️ Тикет для этой заявки уже был создан.' });
  }

  // Получаем участника
  let applicantMember;
  try {
    applicantMember = await guild.members.fetch(applicantId);
  } catch {
    return interaction.editReply({ content: '❌ Пользователь не найден на сервере. Возможно, он покинул его.' });
  }

  // Формируем права доступа
  const overwrites = [
    // @everyone — запрещаем видеть
    { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    // Соискатель
    {
      id: applicantId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak
      ]
    }
  ];

  // Роль рекрутов
  if (recruitRoleId) {
    overwrites.push({
      id: recruitRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak
      ]
    });
  }

  // Роль администраторов
  if (adminRoleId) {
    overwrites.push({
      id: adminRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.MoveMembers
      ]
    });
  }

  const safeName = applicantMember.user.username
    .replace(/[^\w\u0400-\u04FF]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 20)
    .toLowerCase();

  const channelOptions = categoryId
    ? { permissionOverwrites: overwrites, parent: categoryId }
    : { permissionOverwrites: overwrites };

  // Создаём текстовый канал
  let textChannel;
  try {
    textChannel = await guild.channels.create({
      name: `заявка-${safeName}`,
      type: ChannelType.GuildText,
      topic: `Тикет заявки от ${applicantMember.user.tag} (${applicantId})`,
      ...channelOptions
    });
  } catch (e) {
    console.error('[Applications] Ошибка создания текстового канала:', e);
    return interaction.editReply({ content: '❌ Не удалось создать текстовый канал. Проверь права бота (Manage Channels).' });
  }

  // Создаём голосовой канал
  let voiceChannel;
  try {
    voiceChannel = await guild.channels.create({
      name: `🎙 тикет-${safeName}`,
      type: ChannelType.GuildVoice,
      ...channelOptions
    });
  } catch (e) {
    console.error('[Applications] Ошибка создания голосового канала:', e);
    // Текстовый уже создан — продолжаем без голосового
    voiceChannel = null;
  }

  // Отправляем приветствие в текстовый канал
  const voiceRef  = voiceChannel ? ` Голосовой канал: ${voiceChannel}.` : '';
  const ticketEmbed = new EmbedBuilder()
    .setTitle('🎫 Тикет по заявке')
    .setDescription(
      `Привет, <@${applicantId}>! 👋\n\n` +
      `Администрация скоро рассмотрит твою заявку.${voiceRef}\n\n` +
      `Пожалуйста, не покидай сервер и будь на связи.`
    )
    .setColor(0x5865F2)
    .setTimestamp();

  await textChannel.send({ content: `<@${applicantId}>`, embeds: [ticketEmbed] });

  // Обновляем embed в канале проверки — дизейблим кнопку «Создать тикет»
  const updatedEmbed = EmbedBuilder.from(existingEmbed)
    .addFields(
      {
        name: '🎫 Тикет',
        value: voiceChannel
          ? `${textChannel} / ${voiceChannel}`
          : `${textChannel}`,
        inline: true
      },
      {
        name: '👤 Создал тикет',
        value: `<@${interaction.user.id}>`,
        inline: true
      }
    );

  const oldRow = interaction.message.components[0];
  const newButtons = oldRow.components.map(comp => {
    const btn = ButtonBuilder.from(comp);
    if (comp.customId === `app:ticket:${applicantId}`) {
      btn.setDisabled(true).setLabel('Тикет создан');
    }
    return btn;
  });
  const updatedRow = new ActionRowBuilder().addComponents(newButtons);

  await interaction.message.edit({ embeds: [updatedEmbed], components: [updatedRow] });

  const replyText = voiceChannel
    ? `✅ Тикет создан: ${textChannel} и ${voiceChannel}`
    : `✅ Текстовый тикет создан: ${textChannel} (голосовой канал не удалось создать)`;

  return interaction.editReply({ content: replyText });
}

// ─────────────────────────────────────────────────────────────
//  Хелпер: удаляем тикет-каналы из embed поля «🎫 Тикет»
// ─────────────────────────────────────────────────────────────
async function deleteTicketChannels(interaction) {
  const embed = interaction.message.embeds[0];
  const ticketField = embed?.fields?.find(f => f.name === '🎫 Тикет');
  if (!ticketField) return; // тикет не создавался

  // Вытаскиваем все ID каналов из строки вида "<#123> / <#456>"
  const channelIds = [...ticketField.value.matchAll(/<#(\d+)>/g)].map(m => m[1]);

  for (const id of channelIds) {
    try {
      const ch = await interaction.guild.channels.fetch(id);
      await ch.delete('Заявка закрыта');
    } catch (e) {
      console.warn(`[Applications] Не удалось удалить канал ${id}:`, e.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  Хелпер: может ли участник одобрить / отклонить заявку
//
//  Разрешено если выполняется хотя бы одно условие:
//    1. Администратор (роль ADMIN_ROLE_ID или право Manage Roles)
//    2. Куратор (роль CURATOR_ROLE_ID или >= 2000 баллов в системе)
//    3. Именно тот, кто создал тикет (поле "Создал тикет" в embed)
// ─────────────────────────────────────────────────────────────
function canReviewApplication(member, embed) {
  // 1. Администратор
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageRoles)) return true;

  // 2. Куратор
  const curatorRoleId = process.env.CURATOR_ROLE_ID;
  if (curatorRoleId && member.roles.cache.has(curatorRoleId)) return true;
  const recruiter = storage.get(member.id);
  if (recruiter && recruiter.points >= 2000) return true;

  // 3. Создатель тикета
  const creatorField = embed?.fields?.find(f => f.name === '\u{1F464} \u0421\u043E\u0437\u0434\u0430\u043B \u0442\u0438\u043A\u0435\u0442');
  if (creatorField) {
    const creatorId = creatorField.value.match(/<@(\d+)>/)?.[1];
    if (creatorId && creatorId === member.id) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
//  Хелпер: проверка прав на управление ролями (создание тикетов)
// ─────────────────────────────────────────────────────────────
function hasManageRoles(member) {
  if (process.env.RECRUIT_ROLE_ID   && member.roles.cache.has(process.env.RECRUIT_ROLE_ID))   return true;
  if (process.env.RECRUIT_ROLE_ID_2 && member.roles.cache.has(process.env.RECRUIT_ROLE_ID_2)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

module.exports = { getCommands, setup };
