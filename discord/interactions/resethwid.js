const { mongo, createSuccessEmbed, createErrorEmbed } = require('../helpers');

module.exports = async function handleResetHwid(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('resethwid')) return false;
  await interaction.deferReply({ ephemeral: true });
  const scriptId = interaction.customId.split('|')[1];
  const guildId = interaction.guildId;
  const scriptData = await mongo.getServerScript(guildId, scriptId);
  if (!scriptData) return interaction.editReply({ content: 'This script doesn\'t exist! Maybe it was deleted.' });
  const currentUnix = Math.floor(Date.now() / 1000);
  const timeoutSeconds = (scriptData.hwid_reset_timeout_in_hours || 24) * 3600;
  let total = 0;
  for (const user of (scriptData.users || [])) {
    if (user.userId === interaction.user.id) {
      const lastReset = user.last_reset || 0;
      if (lastReset === 0 || currentUnix - lastReset >= timeoutSeconds) {
        user.hwid = '';
        user.last_reset = currentUnix;
        total++;
      }
    }
  }
  await mongo.updateScriptFields(guildId, scriptId, { users: scriptData.users });
  if (total > 0) {
    return interaction.editReply({ embeds: [createSuccessEmbed('HWID Reset Successful', `Your HWID has been reset for **${scriptData.name}**.`)] });
  } else {
    return interaction.editReply({ embeds: [createErrorEmbed('You cannot reset your HWID yet. Please wait for the cooldown period.')] });
  }
};
