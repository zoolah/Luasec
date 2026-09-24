const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, isSuperUser, createErrorEmbed, createSuccessEmbed, createNeutralEmbed, createWarningEmbed } = require('../helpers');

module.exports = async function handleRevokeKey(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'revokekey') return false;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.member.permissions.has(8n) && interaction.guild.ownerId !== interaction.user.id && !isSuperUser(interaction.user.id)) return interaction.editReply({ content: 'No permission.' });
  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;
  const scriptsDocs = await mongo.listGuildScripts(guildId);
  const keyRefs = [];
  scriptsDocs.forEach(d => (d.users||[]).filter(u => u.userId === targetUser.id).forEach(u => keyRefs.push({ key: u.key, scriptName: d.name, scriptId: d.scriptId })));
  if (!keyRefs.length) return interaction.editReply({ content: 'User has no active keys.', ephemeral: true });
  const options = keyRefs.map((ref,i)=>({ label: `${ref.scriptName} – ${ref.key.slice(0,6)}...`, value: String(i) }));
  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('revoke_key_select').setPlaceholder('Select key to revoke').addOptions(options));
  const reply = await interaction.editReply({ content: `Select key to revoke for <@${targetUser.id}>:`, components: [row] });
  const selection = await reply.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(()=>null);
  if (!selection) return true;
  const selected = keyRefs[parseInt(selection.values[0])];

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_revoke').setLabel('Confirm Revoke').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_revoke').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await selection.update({
    embeds: [createWarningEmbed(
      'Confirm Key Revocation',
      `Are you sure you want to revoke this key from <@${targetUser.id}>?\n\n**Script:** ${selected.scriptName}\n**Key:** \`${selected.key}\``
    )],
    components: [confirmRow]
  });

  const confirmInteraction = await selection.message.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id,
    time: 20000
  }).catch(() => null);

  if (!confirmInteraction || confirmInteraction.customId === 'cancel_revoke') {
    return confirmInteraction
      ? confirmInteraction.update({ content: 'Revocation cancelled.', embeds: [], components: [] })
      : true;
  }

  const scriptDoc = await mongo.getServerScript(guildId, selected.scriptId);
  if (!scriptDoc) return confirmInteraction.update({ embeds: [createErrorEmbed('Script not found.')], components: [] });

  const newUsers = (scriptDoc.users || []).filter(u => u.key !== selected.key);
  if (newUsers.length === (scriptDoc.users || []).length) {
    return confirmInteraction.update({ embeds: [createErrorEmbed('Key not found.')], components: [] });
  }

  await mongo.updateScriptFields(guildId, scriptDoc.scriptId, { users: newUsers });

  await confirmInteraction.update({
    embeds: [createSuccessEmbed(
      'Key Revoked',
      `Access revoked for <@${targetUser.id}> on **${selected.scriptName}**.`
    )],
    components: []
  });

  return true;
};
