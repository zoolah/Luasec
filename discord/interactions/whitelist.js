const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, generate_key, add_user, isSuperUser, notifyOwnerWhitelist } = require('../helpers');

module.exports = async function handleWhitelist(interaction) {
  if (!interaction.isCommand() || interaction.commandName !== 'whitelist') return false;
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.member.permissions.has(8n) && interaction.guild.ownerId !== interaction.user.id && !isSuperUser(interaction.user.id)) {
    return interaction.editReply({ content: 'No permission.', ephemeral: true });
  }

  let duration = interaction.options.getInteger('duration');
  const isLifetime = duration === 0;
  if (isLifetime) duration = 36500;
  if (!duration || duration < 1) return interaction.editReply({ content: 'Please provide a valid number of days (0 for lifetime).', ephemeral: true });

  const target = interaction.options.getUser('user');
  if (!target) return interaction.editReply({ content: 'Invalid user.', ephemeral: true });

  const guildId = interaction.guildId;
  const scripts = await mongo.listGuildScripts(guildId);
  if (!scripts.length) return interaction.editReply({ content: 'No scripts found for this server.', ephemeral: true });

  const options = scripts.map(s => ({ label: s.name, value: s.scriptId }));
  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('whitelist_script_select').setPlaceholder('Select a script').addOptions(options)
  );

  const reply = await interaction.editReply({ content: `Select the script to whitelist <@${target.id}> for ${isLifetime ? 'lifetime' : duration + ' days'}.`, components: [row] });
  const selection = await reply.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id, time: 30000 }).catch(() => null);
  if (!selection) return true;

  const scriptId = selection.values[0];
  const scriptName = options.find(o => o.value === scriptId).label;
  const expiresAt = Math.floor(Date.now() / 1000) + duration * 86400;


  let replacedExpiredKey = false;
  const now = Math.floor(Date.now() / 1000);
  const scriptDoc = await mongo.getServerScript(guildId, scriptId);
  if (scriptDoc) {
    const existing = (scriptDoc.users || []).find(u => u.userId === target.id);
    if (existing) {
      if (now < existing.unix_expiration) {
        const errEmbed = new EmbedBuilder()
          .setColor(0x2f3136)
          .setTitle('Whitelisting Error')
          .setDescription(`User already has an active key for **${scriptName}**.`)
          .setFooter({ text: 'app.yourdomain.com' })
          .setTimestamp();
        return selection.update({ embeds: [errEmbed], components: [] });
      } else {
        const newUsers = (scriptDoc.users || []).filter(u => u.userId !== target.id);
        await mongo.updateScriptFields(guildId, scriptId, { users: newUsers });
        replacedExpiredKey = true;
      }
    }
  }

  const key = await add_user({
    key: generate_key(),
    userId: target.id,
    username: target.username,
    usageCount: 0,
    executor: '',
    hwid: '',
    ip: '',
    lifetime: isLifetime ? 0 : duration,
    unix_expiration: expiresAt,
    last_reset: 0
  }, guildId, scriptId);

  if (key == null) {
    const errEmbed = new EmbedBuilder()
      .setColor(0x2f3136)
      .setTitle('Whitelisting Error')
      .setDescription('Failed to create key (script may no longer exist).')
      .setFooter({ text: 'app.yourdomain.com' })
      .setTimestamp();
    return selection.update({ embeds: [errEmbed], components: [] });
  }

  try {
    const panelUrl = `https://app.yourdomain.com/panel/${guildId}/${scriptId}`;
    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Open Web Panel').setURL(panelUrl).setStyle(ButtonStyle.Link)
    );

    const dmEmbed = new EmbedBuilder()
      .setColor(0x3b82f6) 
      .setTitle(`You've been whitelisted for ${scriptName}`)
      .setDescription(`A key has been generated for you on **${scriptName}** in **${interaction.guild.name}**.`)
      .addFields(
        { name: 'Your Key', value: `\`${key}\``, inline: false },
        { name: 'Expires', value: `<t:${expiresAt}:R>`, inline: true },
        { name: 'Duration', value: isLifetime ? 'Lifetime' : `${duration} day(s)`, inline: true }
      )
      .setFooter({ text: 'app.yourdomain.com • Keep this key private' })
      .setTimestamp();

    await target.send({
      content: 'Welcome! Here is your access key and next steps:',
      embeds: [dmEmbed],
      components: [buttonRow]
    });
  } catch (e) {
    console.error(`Failed to DM user ${target.id} about new key:`, e);
  }

  await notifyOwnerWhitelist({
    client: interaction.client,
    actor: `<@${interaction.user.id}> (${interaction.user.tag})`,
    whitelisted: `<@${target.id}> (${target.tag})`,
    scriptName,
    key,
    expiresAt,
    durationText: isLifetime ? 'Lifetime' : `${duration} day(s)`,
    guildName: interaction.guild.name,
    guildId: interaction.guildId,
    scriptId,
    via: 'Discord Command'
  });

  const successEmbed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('User Whitelisted')
    .setDescription(
      replacedExpiredKey
        ? `Replaced <@${target.id}>'s expired key and granted fresh access to **${scriptName}**.`
        : `<@${target.id}> has been given access to **${scriptName}**.`
    )
    .addFields(
      { name: 'Key', value: `\`${key}\``, inline: true },
      { name: 'Expires', value: `<t:${expiresAt}:R>`, inline: true }
    )
    .setFooter({ text: 'app.yourdomain.com' })
    .setTimestamp();

  await selection.update({ embeds: [successEmbed], components: [] });
  return true;
};
