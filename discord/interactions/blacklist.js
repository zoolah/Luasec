const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, isSuperUser } = require('../helpers');

module.exports = async function handleBlacklist(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'blacklist') return false;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.member.permissions.has(8n) && interaction.guild.ownerId !== interaction.user.id && !isSuperUser(interaction.user.id)) {
    return interaction.editReply({ content: 'No permission.' });
  }

  const duration = interaction.options.getInteger('duration');
  if (!duration || duration < 1) return interaction.editReply({ content: 'Please provide a valid duration in days.' });

  const targetUser = interaction.options.getUser('user');
  const guildId = interaction.guildId;

  const scripts = await mongo.listGuildScripts(guildId);
  if (!scripts.length) return interaction.editReply({ content: 'No scripts found for this server.' });

  const scriptOptions = scripts.map(s => ({ label: s.name, value: s.scriptId }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('blacklist_select').setPlaceholder('Select a script').addOptions(scriptOptions)
  );

  const reply = await interaction.editReply({
    content: `Select the script to blacklist <@${targetUser.id}> from for **${duration} days**:`,
    components: [row]
  });

  const selection = await reply.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(() => null);
  if (!selection) return true;

  const scriptId = selection.values[0];
  const data = await mongo.getServerScript(guildId, scriptId);
  if (!data) return selection.update({ content: 'Script not found.', components: [] });

  data.blacklist = Array.isArray(data.blacklist) ? data.blacklist : [];
  if (data.blacklist.find(e => e.userId === targetUser.id)) {
    return selection.update({ content: 'User is already blacklisted for this script.', components: [] });
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('confirm_blacklist').setLabel('Confirm Blacklist').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel_blacklist').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  await selection.update({
    content: `⚠️ Confirm: Blacklist <@${targetUser.id}> from **${data.name}** for ${duration} days? This cannot be undone easily.`,
    components: [confirmRow]
  });

  const confirmInteraction = await selection.message.awaitMessageComponent({
    filter: i => i.user.id === interaction.user.id,
    time: 20000
  }).catch(() => null);

  if (!confirmInteraction || confirmInteraction.customId === 'cancel_blacklist') {
    return confirmInteraction ? confirmInteraction.update({ content: 'Blacklist cancelled.', components: [] }) : true;
  }

  data.blacklist.push({
    userId: targetUser.id,
    username: targetUser.username,
    lifetime: duration,
    blacklistedAt: Math.floor(Date.now() / 1000)
  });
  await mongo.updateScriptFields(guildId, data.scriptId, { blacklist: data.blacklist });

  await confirmInteraction.update({
    content: `✅ <@${targetUser.id}> has been blacklisted from **${data.name}** for ${duration} days.`,
    components: []
  });
  return true;
};
