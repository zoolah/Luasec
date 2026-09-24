const { get_user_scripts, ActionRowBuilder, ButtonBuilder, ButtonStyle, encodeIds, createNeutralEmbed } = require('../helpers');

module.exports = async function handleScripts(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'scripts') return false;
  try {
    const selectedUser = interaction.options.getUser('user') || interaction.user;
    const userScripts = await get_user_scripts(interaction.guild.id, selectedUser.id) || [];
    if (!userScripts.length) return interaction.reply({ content: "You don't have any scripts.", ephemeral: true });

    const buildEmbed = async (idx) => {
      const s = userScripts[idx];
      return createNeutralEmbed(
        null,
        [
          `**Script:** ${s.scriptName}`,
          `**Key:** ${s.key}`,
          `**Runs:** ${s.usageCount}`,
          `\n**Loader:**`,
          '```lua',
          `loadstring(game:HttpGet("https://auth.yourdomain.com/loader/${encodeIds(s.serverId, s.scriptId)}?key=${s.key}"))()`,
          '```'
        ].join('\n')
      )
      .setAuthor({ name: `${selectedUser.username}’s Scripts`, iconURL: selectedUser.displayAvatarURL() })
      .setFooter({ text: `Page ${idx + 1} of ${userScripts.length}` });
    };
    let page = 0;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('prev_scripts').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('next_scripts').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(userScripts.length <= 1)
    );
    await interaction.reply({ embeds: [await buildEmbed(page)], components: [row], ephemeral: true });
    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({ filter: i => i.user.id === interaction.user.id, time: 60_000 });
    collector.on('collect', async (i) => {
      if (i.customId === 'prev_scripts') page = Math.max(0, page - 1); else if (i.customId === 'next_scripts') page = Math.min(userScripts.length - 1, page + 1);
      row.components[0].setDisabled(page === 0);
      row.components[1].setDisabled(page === userScripts.length - 1);
      await i.update({ embeds: [await buildEmbed(page)], components: [row] });
    });
    collector.on('end', async () => { row.components.forEach(c => c.setDisabled(true)); await message.edit({ components: [row] }).catch(()=>{}); });
  } catch (err) {
    console.error('scripts cmd error', err);
    if (!interaction.replied) await interaction.reply({ content: 'Error loading scripts.', ephemeral: true });
  }
  return true;
};
