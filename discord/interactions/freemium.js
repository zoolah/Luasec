const { mongo, createNeutralEmbed, createErrorEmbed } = require('../helpers');
const { createFreemiumFlow, cache } = require('../lootlabs');

module.exports = async function handleFreemium(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('getkey')) return false;
  await interaction.deferReply({ ephemeral: true });
  try {
    const guildId = interaction.guild.id;
    const scriptId = interaction.customId.split('|')[1];
    const settings = await mongo.getServerScript(guildId, scriptId);
    if (!settings) return interaction.editReply('This script doesn\'t exist! Maybe it was deleted.');
    if (!settings.freemium) return interaction.editReply('Freemium is disabled here.');
    const shortCode = Math.random().toString(36).substring(2, 10).toUpperCase() + Math.random().toString(36).substring(2, 10).toUpperCase();
    const { loot_url, encrypted } = await createFreemiumFlow(settings, shortCode);
    cache[shortCode] = { guild: guildId, script: scriptId, userId: interaction.user.id, username: interaction.user.username, scriptName: settings.name };
    const embed = createNeutralEmbed(
      `Free Key for ${settings.name}`,
      'Complete the tasks on the link below to receive a temporary 1-day key.\n\nAfter finishing, return to the panel and use the **Redeem Key** button.'
    ).addFields({ name: 'Ad-Gate Link', value: `[Click here to start](${loot_url}&data=${encrypted})` });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error('freemium error', err.response?.data || err.message);
    await interaction.editReply({ embeds: [createErrorEmbed('Failed to generate the ad-gate link. Please try again later.')] });
  }
  return true;
};
