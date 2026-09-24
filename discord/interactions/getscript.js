const { mongo, encodeIds, createNeutralEmbed, createErrorEmbed } = require('../helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function handleGetScript(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('getscript')) return false;
  await interaction.deferReply({ ephemeral: true });
  const [, scriptId] = interaction.customId.split('|');
  const guildId = interaction.guild.id;
  const scriptData = await mongo.getServerScript(guildId, scriptId);
  if (!scriptData) return interaction.editReply({ embeds: [createErrorEmbed('This script doesn\'t exist. It may have been deleted.')] });
  let userEntry = (scriptData.users || []).find(u => u.userId === interaction.user.id);
  const now = Math.floor(Date.now() / 1000);
  if (userEntry && now > userEntry.unix_expiration) {
    const newUsers = (scriptData.users || []).filter(u => u.userId !== interaction.user.id);
    await mongo.updateScriptFields(guildId, scriptId, { users: newUsers });
    return interaction.editReply({ embeds: [createErrorEmbed(`Your key for this script expired at <t:${userEntry.unix_expiration}:F>.`, 'Key Expired')] });
  }
  if (!userEntry) {
    return interaction.editReply({ embeds: [createErrorEmbed(`You are not whitelisted for this script.`, "Not Whitelisted")] });
  }

  const safeScriptId = /^[0-9a-fA-F]+$/.test(scriptId) ? scriptId : '0';
  const encoded = encodeIds(guildId, safeScriptId);

  const configTable = scriptData.configTable ? `${scriptData.configTable}\n` : '';

  const loader = `loadstring(game:HttpGet("https://auth.yourdomain.com/loader/${encoded}?key=${userEntry.key}"))()`;

  const luaCode = ['-- Secured by @zula', configTable, loader].join('\n');

  const tempDir = path.join(__dirname, '../../temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const filePath = path.join(tempDir, `${scriptId}-${interaction.user.id}.lua`);
  fs.writeFileSync(filePath, luaCode, 'utf8');

  const embed = createNeutralEmbed(null, null, [
    { name: 'Key', value: userEntry.key, inline: true },
    { name: 'Executions', value: String(userEntry.usageCount), inline: true },
    { name: 'Expires At', value: `<t:${userEntry.unix_expiration}:F>`, inline: true }
  ])
  .setAuthor({ name: `${scriptData.name} - ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

  await interaction.editReply({
    embeds: [embed],
    files: [filePath],
    ephemeral: true
  });


  fs.unlinkSync(filePath);
  return true;
};
