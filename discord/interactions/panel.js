const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, isSuperUser, createNeutralEmbed } = require('../helpers');


module.exports = async function handlePanel(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'panel') return false;
  await interaction.deferReply({ ephemeral: true });



  const isAdmin = interaction.member.permissions.has(8n) || interaction.guild.ownerId === interaction.user.id || isSuperUser(interaction.user.id);
  const guildId = interaction.guild.id;
  const scripts = await mongo.listGuildScripts(guildId);
  if (!scripts.length) return interaction.editReply({ content: 'No scripts found for this server.' });
  const opts = scripts.map(s => ({ label: s.name, value: s.scriptId }));

  const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('panel_script_select').setPlaceholder('Select a script').addOptions(opts));
  await interaction.editReply({ content: 'Which script should this panel be for?', components: [row] });

  const selection = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId === 'panel_script_select', time: 30_000 }).catch(() => null);
  if (!selection) return true;
  const scriptId = selection.values[0];
  const settings = await mongo.getServerScript(guildId, scriptId);
  if (!settings) return interaction.editReply({ content: 'Script not found.' });

  const embed = createNeutralEmbed(
    `${settings.name} – Panel`,
    'Use the buttons below to redeem a key, get your loader script, reset your HWID, or open the full web management panel.',
    []
  ).setThumbnail(interaction.guild.iconURL({ dynamic: true }));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`redeem|${scriptId}`).setLabel('Redeem Key').setStyle(ButtonStyle.Primary).setEmoji('🌟'),
    new ButtonBuilder().setCustomId(`getscript|${scriptId}`).setLabel('Get Script').setStyle(ButtonStyle.Secondary).setEmoji('📝'),

    ...(settings.freemium ? [
      new ButtonBuilder().setCustomId(`getkey|${scriptId}`).setLabel('Get Key').setStyle(ButtonStyle.Secondary).setEmoji('🔑')
    ] : []),
    new ButtonBuilder().setCustomId(`resethwid|${scriptId}`).setLabel('Reset HWID').setStyle(ButtonStyle.Danger).setEmoji('🔄')
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setURL(`https://app.yourdomain.com/panel/${guildId}/${scriptId}`).setLabel('Web Panel').setStyle(ButtonStyle.Link).setEmoji('🌐')
  );
  const components = [row1, row2];

  if (isAdmin) {
    await interaction.channel.send({ embeds: [embed], components });
    await interaction.editReply({ content: 'Panel has been posted in this channel.', embeds: [], components: [] });
  } else {
    await interaction.editReply({ embeds: [embed], components });
  }


  return true;
};
