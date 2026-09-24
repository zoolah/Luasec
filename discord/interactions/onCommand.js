const { mongo, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, generate_key, add_user, get_user_scripts, redeemKey, isSuperUser, encodeIds } = require('../helpers');
const lootlabs = require('../lootlabs');

module.exports = async function onCommand(interaction) {
  if (!interaction.isCommand()) return false;
  const name = interaction.commandName;
  try {
    switch (name) {
      case 'ghblacklist':
        if (!isSuperUser(interaction.user.id)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const hwid = interaction.options.getString('hwid');
        if (await mongo.isHWIDBlacklisted(hwid)) return interaction.reply({ content: 'Already blacklisted.', ephemeral: true });
        await mongo.addGlobalHWID(hwid);
        return interaction.reply({ content: `HWID ${hwid} blacklisted.`, ephemeral: true });
      case 'gipblacklist':
        if (!isSuperUser(interaction.user.id)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const ip = interaction.options.getString('ip');
        if (await mongo.isIPBlacklisted(ip)) return interaction.reply({ content: 'Already blacklisted.', ephemeral: true });
        await mongo.addGlobalIP(ip);
        return interaction.reply({ content: `IP ${ip} blacklisted.`, ephemeral: true });
      case 'gblacklist-list':
        if (!isSuperUser(interaction.user.id)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const blacklist = await mongo.getGlobalBlacklist();
        const ipList = blacklist.ips.length > 0 ? blacklist.ips.join('\n') : 'None';
        const hwidList = blacklist.hwids.length > 0 ? blacklist.hwids.join('\n') : 'None';
        const embed = new EmbedBuilder()
          .setTitle('Global Blacklist')
          .addFields(
            { name: `IPs (${blacklist.ips.length})`, value: ipList, inline: false },
            { name: `HWIDs (${blacklist.hwids.length})`, value: hwidList, inline: false }
          )
          .setColor('#FF0000');
        return interaction.reply({ embeds: [embed], ephemeral: true });
      case 'gunblacklist-hwid':
        if (!isSuperUser(interaction.user.id)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const hwidToRemove = interaction.options.getString('hwid');
        if (!await mongo.isHWIDBlacklisted(hwidToRemove)) return interaction.reply({ content: 'HWID not blacklisted.', ephemeral: true });
        await mongo.removeGlobalHWID(hwidToRemove);
        return interaction.reply({ content: `HWID ${hwidToRemove} unblacklisted.`, ephemeral: true });
      case 'gunblacklist-ip':
        if (!isSuperUser(interaction.user.id)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const ipToRemove = interaction.options.getString('ip');
        if (!await mongo.isIPBlacklisted(ipToRemove)) return interaction.reply({ content: 'IP not blacklisted.', ephemeral: true });
        await mongo.removeGlobalIP(ipToRemove);
        return interaction.reply({ content: `IP ${ipToRemove} unblacklisted.`, ephemeral: true });

       
      default:
        return false; 
    }
  } catch (err) {
    console.error('Command error', name, err);
    if (!interaction.replied) await interaction.reply({ content: 'Error executing command', ephemeral: true });
  }
  return true;
};
