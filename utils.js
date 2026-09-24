const { v4: uuidv4 } = require('uuid');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const passport = require('passport');
const axios = require('axios');
const UAParser = require('ua-parser-js');
const { Strategy } = require('passport-discord');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const base85 = require('base85');
const { Client, GatewayIntentBits, REST, Routes, PermissionsBitField, CommandInteractionOptionResolver, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { exec } = require('child_process');
const rateLimit = require('express-rate-limit');


const mongo = require('./db/mongo');

module.exports = {
    make_fuckass_embed({ title, description = "No description provided.", color = "#0099ff", fields = [], buttons = [] }) {
        if (!title || typeof title !== "string") {
            throw new Error("Invalid or missing 'title' parameter for embed.");
        }

        if (typeof description !== "string") {
            throw new Error("Invalid 'description' parameter for embed.");
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color);

        if (fields.length > 0) {
            embed.addFields(fields);
        }

        const components = [];
        if (buttons.length > 0) {
            const actionRow = new ActionRowBuilder();
            buttons.forEach((button) => {
                actionRow.addComponents(
                    new ButtonBuilder()
                        .setLabel(button.label)
                        .setStyle(button.style) 
                        .setCustomId(button.customId)
                );
            });
            components.push(actionRow);
        }

        return { embeds: [embed], components };
    },

    generate_key() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let key = '';
      for (let i = 0; i < 24; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return key;
    },
    
    async add_user(user, guildId, scriptId) {
      const script = await mongo.getServerScript(guildId, scriptId);
      if (!script) return null;
      if ((script.users || []).some(u => u.userId === user.userId)) return null;
      await mongo.addUserToScript(guildId, scriptId, user);
      return user.key;
    },

    async notifyOwnerWhitelist({ client, actor, whitelisted, scriptName, key, expiresAt, durationText, guildName, guildId, scriptId, via = 'Discord' }) {
      const OWNER_ID = '1469053280414863501';
      if (!client) return;
      try {
        const owner = await client.users.fetch(OWNER_ID).catch(() => null);
        if (!owner) return;

        const embed = {
          color: 0x5865F2,
          title: `New Whitelist Issued (${via})`,
          description: `A user was whitelisted for **${scriptName}**${guildName ? ` in **${guildName}**` : ''}.`,
          fields: [
            { name: 'Whitelisted By', value: actor, inline: false },
            { name: 'Whitelisted User', value: whitelisted, inline: false },
            { name: 'Key', value: `\`${key}\``, inline: true },
            { name: 'Duration', value: durationText, inline: true },
            { name: 'Expires', value: `<t:${expiresAt}:F> (<t:${expiresAt}:R>)`, inline: false }
          ],
          footer: { text: `Guild: ${guildId || 'N/A'} • Script: ${scriptId || 'N/A'}` },
          timestamp: new Date()
        };

        await owner.send({ embeds: [embed] }).catch(() => {});
      } catch (e) {
        console.error('Failed to notify owner of whitelist:', e);
      }
    },
    
    build_error_page(errorMessage, errorCode) {
      return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Error ${errorCode}</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              background-color: #121212;
              color: #e0e0e0;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
            }
            .error-container {
              background-color: #1e1e1e;
              padding: 2rem;
              border-radius: 12px;
              box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
              max-width: 500px;
              width: 90%;
              text-align: center;
            }
            .error-code {
              font-size: 4rem;
              font-weight: bold;
              color: #e03e3e;
              margin: 0;
            }
            .error-message {
              font-size: 1.25rem;
              margin: 1rem 0;
              line-height: 1.4;
            }
            .btn-home {
              display: inline-block;
              margin-top: 1.5rem;
              padding: 0.75rem 1.5rem;
              background-color: #5865F2;
              color: #ffffff;
              text-decoration: none;
              font-weight: 600;
              border-radius: 8px;
              transition: background-color 0.2s ease;
            }
            .btn-home:hover {
              background-color: #4752c4;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <div class="error-code">${errorCode}</div>
            <div class="error-message">${errorMessage}</div>
          </div>
        </body>
      </html>
      `;
    },
    
    async add_key(key, guildId, scriptId) {
      await mongo.pushKey(guildId, scriptId, key);
      return key.key;
    },
    
    isDiscordWebhook(url) {
      const discordWebhookRegex = /^https:\/\/discord\.com\/api\/webhooks\/\d{17,20}\/[A-Za-z0-9_-]{60,}/;
      return discordWebhookRegex.test(url);
    },
    async redeemKey(guild, key, userId, username, scriptid) {
      try {
        const data = await mongo.getServerScript(guild.id, scriptid);
        if (!data) return [false, ''];
        const keyIndex = (data.keys || []).findIndex(k => k.key === key);
        if (keyIndex === -1) return [false, ''];
        const timenow = Math.floor(Date.now() / 1000);
        const users = data.users || [];
        const existingUserIndex = users.findIndex(u => u.userId === userId);
        if (existingUserIndex !== -1) {
          const existingUser = users[existingUserIndex];
          if (timenow < existingUser.unix_expiration) {
            return [false, '', 'You already have an active key for this script!'];
          } else {
            users.splice(existingUserIndex, 1);
          }
        }
        const removedKey = (data.keys || [])[keyIndex];
        const newKeys = (data.keys || []).filter(k => k.key !== key);
        users.push({
          key: removedKey.key,
          userId,
            username,
            usageCount: 0,
            executor: '',
            hwid: '',
            ip: '',
            lifetime: removedKey.lifetime,
            unix_expiration: timenow + (removedKey.lifetime * 24 * 60 * 60),
            last_reset: 0
        });
        await mongo.updateScriptFields(guild.id, scriptid, { users, keys: newKeys });
        return [true, data.name, ''];
      } catch (err) {
        console.error(`Error redeeming key for guild ${guild.id}, script ${scriptid}:`, err);
        return [false, '', 'An unknown error occurred.. sorry!'];
      }
    },
    
    
    
    async get_user_scripts(guildId, userId) {
      const scripts = await mongo.listGuildScripts(guildId);
      if (!scripts) return [];
      const results = [];
      scripts.forEach(data => {
        (data.users || []).forEach(u => {
          if (u.userId === userId) {
            results.push({
              scriptName: data.name,
              key: u.key,
              id: data.scriptId,
              usageCount: u.usageCount,
              serverId: guildId,
              scriptId: data.scriptId
            });
          }
        });
      });
      return results;
    },
    
    generateRandom9LetterString() {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 9; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
      }
      return result;
    },

    
    xorDecrypt(encryptedStr, key) {
      let decrypted = '';
      for (let i = 0; i < encryptedStr.length; i++) {
        let charCode = encryptedStr.charCodeAt(i);
        let keyCharCode = key.charCodeAt(i % key.length);
        decrypted += String.fromCharCode(charCode ^ keyCharCode);
      }
      return decrypted;
    },
    
    
    async getUserEntry(discordId) {
      return mongo.getOrCreateGlobalUser(discordId);
    },
    get_loader(key, serverid, scriptid, scriptName, Key) {
      const rawLoader = fs.readFileSync(path.join(__dirname, 'client', 'loader.lua'), 'utf8');
      const replacedLoader = rawLoader
        .replaceAll('${key}', key)
        .replaceAll('${SERVERID}', serverid)
        .replaceAll('${SCRIPTID}', scriptid)
        .replaceAll("${SCRIPTNAME}", scriptName)
        .replaceAll("${USERKEY}", Key);
      return replacedLoader;
    },
    get_raw_loader() {
      const rawLoader = fs.readFileSync(path.join(__dirname, 'client', 'loader.lua'), 'utf8');
      return rawLoader;
    },
    get_raw_script(serverid, scriptid) {
      const rawScript = fs.readFileSync(path.join(__dirname, 'client', 'main.lua'), 'utf8').replace('--${SCRIPTHERE}--', fs.readFileSync(path.join(__dirname, 'db', 'scripts', serverid, `${scriptid}.lua`), 'utf8'));
      return rawScript;
    },
    async send_embed_to_webhook(webhookUrl, title, description, fields = [], content) {
      const embed = {
        title: title,
        description: description,
        fields: fields
      };
    
      try {
        const response = await axios.post(webhookUrl, {
          content: content,
          embeds: [embed]
        });
        return response.data;
      } catch (error) {
        console.error(`Failed to send embed to webhook: ${error.message}`);
      }
    },
    
    async doesJobIdExist(placeId, targetJobId) {
      const baseUrl = `https://games.roblox.com/v1/games/${placeId}/servers/Public`;
      let cursor = null;
    
      try {
        while (true) {
          const url = new URL(baseUrl);
          url.searchParams.set('sortOrder', 'Asc');
          url.searchParams.set('limit', '100');
          if (cursor) url.searchParams.set('cursor', cursor);
    
          const res = await fetch(url.href);
          if (!res.ok) {
            console.error(`Error: ${res.status} ${res.statusText}`);
            return false;
          }
    
          const data = await res.json();
    
          for (const server of data.data) {
            if (server.id === targetJobId) {
              return true;
            }
          }
    
          if (!data.nextPageCursor) break;
          cursor = data.nextPageCursor;
        }
    
        return false;
      } catch (err) {
        console.error('Fetch failed:', err);
        return false;
      }
    },
    
    async is_user_blacklisted(guildId, scriptId, userId) {
      const data = await mongo.getServerScript(guildId, scriptId);
      if (!data) return false;
      const blacklist = data.blacklist || [];
      const now = Math.floor(Date.now() / 1000);
      const idx = blacklist.findIndex(entry => entry.userId === userId);
      if (idx === -1) return false;
      const entry = blacklist[idx];
      const expiry = entry.blacklistedAt + (entry.lifetime * 24 * 60 * 60);
      if (now >= expiry) {
        const newList = blacklist.filter(e => e !== entry);
        await mongo.updateScriptFields(guildId, scriptId, { blacklist: newList });
        return false;
      }
      return true;
    },
    async isIpGloballyBlacklisted(ip) {
      return mongo.isIPBlacklisted(ip);
    },
    async isHwidGloballyBlacklisted(hwid) {
      return mongo.isHWIDBlacklisted(hwid);
    }

};