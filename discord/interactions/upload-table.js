const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, isSuperUser } = require('../helpers');
const fs = require('fs');
const path = require('path');
const { listGuildScripts, updateScriptFields } = require('../../db/mongo');

module.exports = async function handleTableUpload(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'upload-table') return false;
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    return interaction.editReply({ content: 'This command cannot be used here.' });
  }

  const isAdmin = interaction.member.permissions.has(8n) || interaction.guild.ownerId === interaction.user.id || isSuperUser(interaction.user.id);
  const guildId = interaction.guild.id;

  if (!isAdmin) {
    return interaction.editReply({ content: 'No permission.' });
  }

  const scripts = await listGuildScripts(guildId);
  if (!scripts.length) {
    return interaction.editReply({ content: 'No scripts found for this server.' });
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select-script')
    .setPlaceholder('Select a script')
    .addOptions(scripts.map(script => ({
      label: script.name,
      value: script.scriptId,
    })));

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.editReply({ content: 'Select a script to upload the table for:', components: [row] });

  const filter = i => i.customId === 'select-script' && i.user.id === interaction.user.id;
  const collector = interaction.channel.createMessageComponentCollector({ filter, time: 60000 });

  collector.on('collect', async i => {
    const scriptId = i.values[0];
    collector.stop();

    const modal = new ModalBuilder()
      .setCustomId(`upload-table-modal-${scriptId}`)
      .setTitle('Upload Config Table')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('table-content')
            .setLabel('Paste your table content')
            .setStyle(TextInputStyle.Paragraph)
        )
      );

    await i.showModal(modal);
  });

  interaction.client.on('interactionCreate', async modalInteraction => {
    if (!modalInteraction.isModalSubmit()) return;

    const modalId = modalInteraction.customId;
    if (!modalId.startsWith('upload-table-modal-')) return;

    const scriptId = modalId.replace('upload-table-modal-', '');
    const tableContent = modalInteraction.fields.getTextInputValue('table-content');

    await updateScriptFields(guildId, scriptId, { configTable: tableContent });

    await modalInteraction.reply({ content: 'Table uploaded successfully!', ephemeral: true });
  });
};
