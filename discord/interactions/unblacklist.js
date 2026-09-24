const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, isSuperUser, createErrorEmbed, createSuccessEmbed, createNeutralEmbed, createWarningEmbed } = require('../helpers');

module.exports = async function handleUnblacklist(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'unblacklist') return false;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.member.permissions.has(8n) && interaction.guild.ownerId !== interaction.user.id && !isSuperUser(interaction.user.id)) return interaction.editReply({ content: 'No permission.' });
  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;
  const scripts = await mongo.listGuildScripts(guildId);
  if (!scripts.length) return interaction.editReply({ content: 'No scripts found.' });
  const scriptOptions = scripts.map(s => ({ label: s.name, value: s.scriptId }));
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('unblacklist_select').setPlaceholder('Select a script').addOptions(scriptOptions));
  const reply = await interaction.editReply({ content: `Select the script to unblacklist <@${targetUser.id}> from:`, components: [row] });
  const selection = await reply.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(()=>null);
  if (!selection) return true;
  const scriptId = selection.values[0];
  const data = await mongo.getServerScript(guildId, scriptId);
  if (!data) return selection.update({ embeds: [createErrorEmbed('Script not found.')], components: [] });

  data.blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  const idx = data.blacklist.findIndex(e => e.userId === targetUser.id);
  if (idx === -1) return selection.update({ embeds: [createErrorEmbed('User is not blacklisted for this script.')], components: [] });

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_unblacklist').setLabel('Confirm Unblacklist').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('cancel_unblacklist').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await selection.update({
    embeds: [createWarningEmbed(
      'Confirm Unblacklist',
      `Remove <@${targetUser.id}> from the blacklist for **${data.name}**? This will restore their access.`
    )],
    components: [confirmRow]
  });

  const confirmInteraction = await selection.message.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id,
    time: 20000
  }).catch(() => null);

  if (!confirmInteraction || confirmInteraction.customId === 'cancel_unblacklist') {
    return confirmInteraction
      ? confirmInteraction.update({ content: 'Unblacklist cancelled.', embeds: [], components: [] })
      : true;
  }

  data.blacklist.splice(idx, 1);
  await mongo.updateScriptFields(guildId, data.scriptId, { blacklist: data.blacklist });

  await confirmInteraction.update({
    embeds: [createSuccessEmbed(
      'User Unblacklisted',
      `<@${targetUser.id}> has been removed from the blacklist for **${data.name}**.`
    )],
    components: []
  });

  return true;
};
