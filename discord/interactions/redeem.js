const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle, redeemKey, createSuccessEmbed, createErrorEmbed } = require('../helpers');

module.exports = async function handleRedeem(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('redeem')) return false;
  let key; let modalInteraction = interaction;
  const modal = new ModalBuilder().setCustomId('redeem_modal').setTitle('Redeem Key').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('key_input').setLabel('Enter your script key').setStyle(TextInputStyle.Short).setPlaceholder('Purchased script key').setRequired(true)));
  try {
    await interaction.showModal(modal);
    const modalResponse = await interaction.awaitModalSubmit({ filter: i => i.customId === 'redeem_modal', time: 60000 });
    await modalResponse.deferReply({ ephemeral: true });
    key = modalResponse.fields.getTextInputValue('key_input');
    modalInteraction = modalResponse;
  } catch { return true; }
  try {
    const scriptId = interaction.customId.split('|')[1];
    const [success, scriptname, error_msg] = await redeemKey(interaction.guild, key, interaction.user.id, interaction.user.username, scriptId);
    if (success) {
      await modalInteraction.editReply({ embeds: [createSuccessEmbed(`Key Redeemed for ${scriptname}!`, 'Use the buttons on the panel or the web panel to get your loader script.')] });
    } else {
      await modalInteraction.editReply({ embeds: [createErrorEmbed(error_msg || 'Redemption failed.')] });
    }
  } catch (err) {
    console.error('redeem error', err);
    await modalInteraction.editReply({ content: 'Error redeeming key.', ephemeral: true });
  }
  return true;
};
