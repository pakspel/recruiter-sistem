/**
 * vacations.js — Система заявок на отпуск (ИС / ООС АФК)
 *
 * Переменные окружения (добавь в .env):
 *   VACATION_REVIEW_CHANNEL_ID  — канал куда приходят заявки на рассмотрение
 *   VACATION_ROLE_ID            — роль, выдаваемая при одобрении отпуска
 *
 * Slash-команды (только для администраторов):
 *   /отпуск_панель  — отправить панель «Оставить заявку» в текущий канал
 */

const {
  SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder
} = require('discord.js');

// ─────────────────────────────────────────────────────────────
//  Slash commands
// ─────────────────────────────────────────────────────────────
function getCommands() {
  return [
    new SlashCommandBuilder()
      .setName('отпуск_панель')
      .setDescription('[ADMIN] Отправить панель заявок на отпуск в текущий канал')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .toJSON()
  ];
}

// ─────────────────────────────────────────────────────────────
//  Подключение к клиенту
// ─────────────────────────────────────────────────────────────
function setup(client) {
  client.on('interactionCreate', async (interaction) => {
    if (!isVacationInteraction(interaction)) return;

    try {
      await handleVacationInteraction(interaction);
    } catch (err) {
      console.error('[Vacations] Ошибка:', err);
      const msg = { content: '❌ Произошла ошибка. Попробуй снова.', ephemeral: true };
      try {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
        else await interaction.reply(msg);
      } catch (_) {}
    }
  });

  console.log('🏖️ Модуль отпусков подключён');
}

// ─────────────────────────────────────────────────────────────
//  Фильтр
// ─────────────────────────────────────────────────────────────
function isVacationInteraction(interaction) {
  if (interaction.isChatInputCommand()) return interaction.commandName === 'отпуск_панель';
  if (interaction.isButton())           return interaction.customId.startsWith('vac:');
  if (interaction.isModalSubmit())      return interaction.customId.startsWith('vac:');
  return false;
}

// ─────────────────────────────────────────────────────────────
//  Роутер
// ─────────────────────────────────────────────────────────────
async function handleVacationInteraction(interaction) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'отпуск_панель') {
    return cmdSendPanel(interaction);
  }

  if (interaction.isButton() && interaction.customId === 'vac:open_form') {
    return btnOpenForm(interaction);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'vac:submit_form') {
    return modalSubmitVacation(interaction);
  }

  if (interaction.isButton()) {
    const [, action, applicantId] = interaction.customId.split(':');
    if (action === 'approve') return btnApprove(interaction, applicantId);
    if (action === 'reject')  return btnReject(interaction, applicantId);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('vac:reject_reason:')) {
    const applicantId = interaction.customId.split(':')[2];
    return modalRejectReason(interaction, applicantId);
  }
}

// ─────────────────────────────────────────────────────────────
//  /отпуск_панель — панель с кнопкой
// ─────────────────────────────────────────────────────────────
async function cmdSendPanel(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('Отпуск (АФК)')
    .setDescription(
      'Здесь вы можете оставить заявку для получения ИС или ООС отпуска.\n' +
      'Заполните форму для получения отпуска.'
    )
    .setColor(0x9B59B6);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vac:open_form')
      .setLabel('Оставить заявку')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🩷')
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  return interaction.reply({ content: '✅ Панель отпусков отправлена!', ephemeral: true });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Оставить заявку» → Modal
// ─────────────────────────────────────────────────────────────
async function btnOpenForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('vac:submit_form')
    .setTitle('Заявка на отпуск');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('full_name')
        .setLabel('Имя, фамилия')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: Tony Prostovski')
        .setRequired(true)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Причина')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Укажи причину отпуска...')
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(500)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('date_from')
        .setLabel('С какого числа')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 29.04.2026')
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('date_to')
        .setLabel('До какого числа')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Например: 13.05.2026')
        .setRequired(true)
        .setMaxLength(20)
    )
  );

  return interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────
//  Modal submit — отправляем заявку в канал проверки
// ─────────────────────────────────────────────────────────────
async function modalSubmitVacation(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const fullName = interaction.fields.getTextInputValue('full_name');
  const reason   = interaction.fields.getTextInputValue('reason');
  const dateFrom = interaction.fields.getTextInputValue('date_from');
  const dateTo   = interaction.fields.getTextInputValue('date_to');

  const reviewChannelId = process.env.VACATION_REVIEW_CHANNEL_ID;
  if (!reviewChannelId) {
    return interaction.editReply({ content: '⚙️ Канал для заявок на отпуск не настроен. Обратитесь к администратору.' });
  }

  let reviewChannel;
  try {
    reviewChannel = await interaction.client.channels.fetch(reviewChannelId);
  } catch {
    return interaction.editReply({ content: '❌ Не удалось найти канал для заявок. Обратитесь к администратору.' });
  }

  const embed = new EmbedBuilder()
    .setTitle(`Заявка на отпуск от ${fullName}`)
    .setColor(0x9B59B6)
    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: 'Имя, фамилия',    value: fullName },
      { name: 'Причина',         value: reason },
      { name: 'С какого числа',  value: dateFrom, inline: true },
      { name: 'До какого числа', value: dateTo,   inline: true },
      { name: 'ID пользователя', value: interaction.user.id }
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vac:approve:${interaction.user.id}`)
      .setLabel('Одобрить')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`vac:reject:${interaction.user.id}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌')
  );

  await reviewChannel.send({ embeds: [embed], components: [row] });
  return interaction.editReply({ content: '✅ Твоя заявка на отпуск отправлена! Ожидай ответа от администрации.' });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Одобрить»
// ─────────────────────────────────────────────────────────────
async function btnApprove(interaction, applicantId) {
  if (!hasManageRoles(interaction.member)) {
    return interaction.reply({ content: '❌ Только администраторы могут управлять заявками.', ephemeral: true });
  }

  await interaction.deferUpdate();

  // ── Выдаём роль отпуска ───────────────────────────────────
  const vacRoleId = process.env.VACATION_ROLE_ID;
  let roleNote = '';
  if (vacRoleId) {
    try {
      const member = await interaction.guild.members.fetch(applicantId);
      await member.roles.add(vacRoleId);
      roleNote = ' Роль отпуска выдана.';
    } catch (e) {
      console.error('[Vacations] Не удалось выдать роль:', e);
      roleNote = ' ⚠️ Не удалось выдать роль — проверь права бота.';
    }
  } else {
    roleNote = ' ⚙️ VACATION_ROLE_ID не задан в .env.';
  }

  // ── DM соискателю ─────────────────────────────────────────
  try {
    const user = await interaction.client.users.fetch(applicantId);
    await user.send({ content: '✅ **Твоя заявка на отпуск одобрена!** Хорошего отдыха 🏖️' });
  } catch (_) {}

  // ── Обновляем embed — добавляем статус, убираем кнопки ───
  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor(0x2ecc71)
    .addFields({
      name:  'Статус',
      value: `Заявка одобрена ✅\nОдобрил: ${interaction.user}`
    });

  return interaction.editReply({ embeds: [updatedEmbed], components: [] });
}

// ─────────────────────────────────────────────────────────────
//  Кнопка «Отклонить» → Modal с причиной
// ─────────────────────────────────────────────────────────────
async function btnReject(interaction, applicantId) {
  if (!hasManageRoles(interaction.member)) {
    return interaction.reply({ content: '❌ Только администраторы могут управлять заявками.', ephemeral: true });
  }

  // Открываем модальное окно для ввода причины отказа
  const modal = new ModalBuilder()
    .setCustomId(`vac:reject_reason:${applicantId}`)
    .setTitle('Причина отказа');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Укажи причину отказа')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Эта причина будет отправлена человеку в личные сообщения')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(500)
    )
  );

  return interaction.showModal(modal);
}

// ─────────────────────────────────────────────────────────────
//  Modal submit — причина отказа введена
// ─────────────────────────────────────────────────────────────
async function modalRejectReason(interaction, applicantId) {
  await interaction.deferUpdate();

  const reason = interaction.fields.getTextInputValue('reason');

  // ── DM соискателю с причиной ──────────────────────────────
  try {
    const user = await interaction.client.users.fetch(applicantId);
    await user.send({
      content:
        '❌ **Твоя заявка на отпуск была отклонена.**\n\n' +
        `**Причина:** ${reason}\n\n` +
        'Если у тебя есть вопросы — обратись к администрации.'
    });
  } catch (_) {}

  // ── Обновляем embed — добавляем статус, убираем кнопки ───
  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor(0xe63946)
    .addFields(
      {
        name:  'Статус',
        value: `Заявка отклонена ❌\nОтклонил: ${interaction.user}`
      },
      {
        name:  'Причина отказа',
        value: reason
      }
    );

  return interaction.editReply({ embeds: [updatedEmbed], components: [] });
}

// ─────────────────────────────────────────────────────────────
//  Хелпер: проверка прав
// ─────────────────────────────────────────────────────────────
function hasManageRoles(member) {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (adminRoleId && member.roles.cache.has(adminRoleId)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageRoles);
}

module.exports = { getCommands, setup };
