const mongo = require('../db/mongo');
const axios = require('axios');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const { generate_key, add_user, get_user_scripts, redeemKey, notifyOwnerWhitelist } = require('../utils');

const SUPER_USERS = new Set(['1359717182921244813', '1469053280414863501']);
const isSuperUser = id => SUPER_USERS.has(String(id));

function encodeIds(serverIdStr, scriptIdHexStr) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const base = BigInt(alphabet.length);
  const serverId = BigInt(serverIdStr);
  const scriptId = BigInt(`0x${scriptIdHexStr}`);
  const combined = (serverId << BigInt(32)) | scriptId;
  if (combined === BigInt(0)) return alphabet[0];
  let encoded = '', temp = combined;
  while (temp > 0) { encoded = alphabet[Number(temp % base)] + encoded; temp /= base; }
  return encoded;
}

module.exports = { mongo, axios, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType, generate_key, add_user, get_user_scripts, redeemKey, isSuperUser, encodeIds, notifyOwnerWhitelist };

const BRAND_COLOR = 0x2f3136;          
const SUCCESS_COLOR = 0x22c55e;
const ERROR_COLOR = 0xef4444;
const WARNING_COLOR = 0xf59e0b;

function createEmbed(options = {}) {
  const embed = new EmbedBuilder()
    .setColor(options.color || BRAND_COLOR)
    .setFooter({ text: 'app.yourdomain.com' })
    .setTimestamp();

  if (options.title) embed.setTitle(options.title);
  if (options.description) embed.setDescription(options.description);
  if (options.fields) embed.addFields(options.fields);
  if (options.thumbnail) embed.setThumbnail(options.thumbnail);
  if (options.author) embed.setAuthor(options.author);

  return embed;
}

function createSuccessEmbed(title, description, fields = []) {
  return createEmbed({ color: SUCCESS_COLOR, title, description, fields });
}

function createErrorEmbed(message, title = 'Something went wrong') {
  return createEmbed({ color: ERROR_COLOR, title, description: message });
}

function createWarningEmbed(title, description, fields = []) {
  return createEmbed({ color: WARNING_COLOR, title, description, fields });
}

function createNeutralEmbed(title, description, fields = []) {
  return createEmbed({ title, description, fields });
}

module.exports.createEmbed = createEmbed;
module.exports.createSuccessEmbed = createSuccessEmbed;
module.exports.createErrorEmbed = createErrorEmbed;
module.exports.createWarningEmbed = createWarningEmbed;
module.exports.createNeutralEmbed = createNeutralEmbed;
module.exports.BRAND_COLOR = BRAND_COLOR;
