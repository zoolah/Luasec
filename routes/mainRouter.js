const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const marked = require('marked');
const { PermissionsBitField, ActionRowBuilder, ButtonBuilder } = require('discord.js');
const mongo = require('../db/mongo');
const {
  generate_key,
  getUserEntry,
  isDiscordWebhook,
  redeemKey,
  notifyOwnerWhitelist,
} = require('../utils');
const authRouter = require('./authRouter');
const { logEmitter } = authRouter;
const EventEmitter = require('events');
const pageEmitter = new EventEmitter();
pageEmitter.setMaxListeners(50);

function decodeIds(encodedString) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const base = BigInt(alphabet.length);
  const power32 = BigInt(2 ** 32);
  let combined = BigInt(0);
  for (let i = 0; i < encodedString.length; i++) {
    const index = alphabet.indexOf(encodedString[i]);
    if (index === -1) throw new Error('Invalid Base62 character');
    combined = combined * base + BigInt(index);
  }
  const scriptId = combined & (power32 - BigInt(1));
  const serverId = combined >> BigInt(32);
  const scriptHex = scriptId.toString(16).padStart(8, '0');
  return { serverid: serverId.toString(), scriptid: scriptHex };
}

module.exports = function createMainRouter({ client, disablePayments }) {
  const router = express.Router();
  const ADMIN_ID = '1469053280414863501';

  function isApproved(user, reqUser) {
    return user.approved || disablePayments || reqUser.id === ADMIN_ID;
  }

  function genToken() {
    const raw = crypto.randomBytes(48).toString('base64url');
    let t = raw.slice(0, 16) + '.' + raw.slice(16, 40) + '.' + raw.slice(40);
    const arr = t.split('');
    for (let i = 0; i < 4; i++) {
      const p = 1 + Math.floor(Math.random() * (arr.length - 2));
      if (arr[p] !== '.') arr[p] = '~';
    }
    return arr.join('');
  }

  function regToken(session, page, params) {
    if (!session._r) session._r = {};
    const keys = Object.keys(session._r);
    if (keys.length > 200) {
      const drop = keys.slice(0, keys.length - 150);
      for (const k of drop) delete session._r[k];
    }
    const t = genToken();
    session._r[t] = { page, params: params || [], fresh: true };
    return '/' + t;
  }

  function buildRoutes(session) {
    return {
      get dashboard() { return regToken(session, 'dashboard'); },
      get admin()     { return regToken(session, 'admin'); },
      get payment()   { return regToken(session, 'payment'); },
      get terms()     { return regToken(session, 'terms'); },
      get privacy()   { return regToken(session, 'privacy'); },
      get logout()    { return regToken(session, 'logout'); },
      manage: (id) => regToken(session, 'manage', [id]),
      panel:  (gId, sId) => regToken(session, 'panel', [gId, sId]),
    };
  }

  function _r(req, name, ...args) {
    return regToken(req.session, name, args.length ? args : undefined);
  }

  function resolveAlias(session, urlPath) {
    if (!session || !session._r) return null;
    const token = urlPath.replace(/^\//, '');
    return session._r[token] || null;
  }

  const TRACKED_PAGES = {
    '/': 'Home',
    '/dashboard': 'Dashboard',

    '/payment': 'Payment',
    '/admin': 'Admin',
    '/terms': 'Terms',
    '/privacy': 'Privacy'
  };

  function trackPage(page, req) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const user = req.isAuthenticated() ? req.user.username : null;
    const userId = req.isAuthenticated() ? req.user.id : null;
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    pageEmitter.emit('visit', { time, page, path: req.originalUrl, ip, user, userId });
  }

  router.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const p = req.path.replace(/\/$/, '') || '/';
    if (p === '/') {
      trackPage('Home', req);
    } else if (req.session) {
      const resolved = resolveAlias(req.session, p);
      if (resolved) {
        const nameMap = { dashboard: 'Dashboard', admin: 'Admin', manage: 'Manage', panel: 'Panel', payment: 'Payment', terms: 'Terms', privacy: 'Privacy' };
        if (nameMap[resolved.page]) trackPage(nameMap[resolved.page], req);
      }
    }
    next();
  });

  router.get('/', (req, res) => res.render('home'));
  router.get('/logo', (req, res) => res.sendFile(path.join(__dirname, '..', 'media', 'logo.png')));

  async function fetchUserGuilds(user) {
    if (!user.accessToken) return user.guilds || [];
    try {
      const res = await axios.get('https://discord.com/api/v10/users/@me/guilds', {
        headers: { Authorization: `Bearer ${user.accessToken}` }
      });
      user.guilds = res.data;
      return res.data;
    } catch (err) {
      console.warn('Failed to refresh guilds from Discord API:', err.message);
      return user.guilds || [];
    }
  }

  async function buildUserScripts(userId) {
    const docs = await mongo.findUserScripts(userId);
    const now = Math.floor(Date.now() / 1000);
    return docs.map(d => {
      const entry = (d.users || []).find(u => u.userId === userId);
      let guildName = d.guildId;
      try { const g = client.guilds.cache.get(d.guildId); if (g) guildName = g.name; } catch {}
      return {
        guildId: d.guildId,
        guildName,
        scriptId: d.scriptId,
        scriptName: d.name,
        key: entry ? entry.key : null,
        expired: entry ? now > entry.unix_expiration : false,
      };
    });
  }

  const pageHandlers = {};

  pageHandlers.dashboard = async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    const user = await getUserEntry(req.user.id);
    const approved = isApproved(user, req.user);
    const routes = buildRoutes(req.session);
    let ownedGuilds = [];
    if (approved) {
      const guilds = await fetchUserGuilds(req.user);
      const baseGuilds = guilds.filter(g => {
        const perms = new PermissionsBitField(typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions));
        return g.owner || perms.has(PermissionsBitField.Flags.Administrator);
      });
      ownedGuilds = await Promise.all(baseGuilds.map(async g => {
        let scriptCount = 0;
        try {
          const scripts = await mongo.listGuildScripts(g.id);
          scriptCount = scripts.length;
        } catch (err) {
          console.warn('Failed to list scripts for guild', g.id, err.message);
        }
        return { ...g, scriptCount };
      }));
    }
    const userScripts = await buildUserScripts(req.user.id);
    res.render('dashboard', { user: req.user, ownedGuilds, userScripts, approved, routes });
  };

  pageHandlers.logout = (req, res) => req.logout(() => res.redirect('/'));

  pageHandlers.manage = async (req, res, params) => {
    req.params.id = params[0];
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    const user = await getUserEntry(req.user.id);
    if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const guilds = await fetchUserGuilds(req.user);
    const guild = guilds.find(g =>
      g.id === req.params.id && (g.owner || new PermissionsBitField(typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions)).has(PermissionsBitField.Flags.Administrator))
    );
    if (!guild) return res.status(403).send('You do not own this server.');
    if (!client.guilds.cache.has(req.params.id)) {
      const redirectUri = encodeURIComponent('https://app.yourdomain.com/server_redirect');
      return res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot&guild_id=${req.params.id}&disable_guild_select=true&response_type=code&redirect_uri=${redirectUri}`);
    }
    let scripts = [];
    try {
      try { await mongo.ensureGuild(guild.id); } catch (eg) { console.warn('ensureGuild warning:', eg.message); }
      const docs = await mongo.listGuildScripts(guild.id);
      const scriptsDir = path.join(__dirname, '..', 'db', 'scripts', guild.id);
      scripts = await Promise.all(docs.map(async d => {
        let luaContent = '';
        try {
          const luaPath = path.join(scriptsDir, `${d.scriptId}.lua`);
            if (fs.existsSync(luaPath)) {
              const data = fs.readFileSync(luaPath, 'utf8');
              if (data.length <= 1_000_000) luaContent = data; else luaContent = data.slice(0, 1_000_000) + '\n-- File truncated for display --';
            }
        } catch (readErr) {
          console.warn(`Warning: failed to read lua file for script ${d.scriptId}:`, readErr.message);
        }
        return {
          name: d.name,
          scriptId: d.scriptId,
          keys: d.keys || [],
          luaContent,
          users: d.users || [],
          execution_log_webhook: d.execution_log_webhook,
          crack_detection_webhook: d.crack_detection_webhook,
          hwid_reset_timeout_in_hours: d.hwid_reset_timeout_in_hours,
          freemium: d.freemium,
          dmOnExec: d.dmOnExec,
          executions: d.executions || {},
          configTable: d.configTable || '',
          logo: d.logo || ''
        };
      }));
    } catch (e) {
      console.error('Error listing scripts from Mongo:', e.message);
      return res.status(500).send('Internal server error.');
    }
    const routes = buildRoutes(req.session);
    res.render('server', { user: req.user, guild, scripts, routes });
  };

  pageHandlers.payment = async (req, res) => {
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    const user = await getUserEntry(req.user.id);
    const guilds = await fetchUserGuilds(req.user);
    const ownedGuilds = guilds.filter(g => {
      const raw = typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions);
      const perms = new PermissionsBitField(raw);
      return g.owner || perms.has(PermissionsBitField.Flags.Administrator);
    });
    const routes = buildRoutes(req.session);
    if (isApproved(user, req.user)) return res.render('dashboard', { user: req.user, ownedGuilds, routes });
    res.render('payment', { user: req.user, routes });
  };

  pageHandlers.panel = async (req, res, params) => {
    const guildId = params[0];
    const scriptId = params[1];
    if (!req.isAuthenticated()) return res.redirect('/auth/login');
    if (!/^\d+$/.test(guildId) || !/^[0-9a-fA-F-]+$/.test(scriptId)) return res.status(400).send('Invalid parameters.');
    const userId = req.user.id;
    const scriptData = await mongo.getServerScript(guildId, scriptId);
    if (!scriptData) return res.status(404).send('Script not found.');
    const now = Math.floor(Date.now() / 1000);
    const userEntry = (scriptData.users || []).find(u => u.userId === userId);
    const expired = userEntry && now > userEntry.unix_expiration;
    let guild = null;
    try { guild = await client.guilds.fetch(guildId); } catch {}
    const guildName = guild ? guild.name : guildId;
    const guildIcon = guild ? guild.iconURL({ dynamic: true, size: 64 }) : null;
    const routes = buildRoutes(req.session);
    res.render('panel', {
      user: req.user,
      guildId,
      guildName,
      guildIcon,
      scriptId,
      scriptName: scriptData.name,
      freemium: !!scriptData.freemium,
      userEntry: expired ? null : (userEntry || null),
      expired,
      encodedLoader: encodeIds(guildId, scriptId),
      routes
    });
  };

  pageHandlers.admin = async (req, res) => {
    if (!req.isAuthenticated()) { return res.redirect('/auth/login'); }
    if (req.user.id !== ADMIN_ID) { return res.status(403).send('Forbidden'); }
    const [approvedUsers, blacklist] = await Promise.all([
      mongo.listApprovedGlobalUsers(),
      mongo.getGlobalBlacklist()
    ]);
    const routes = buildRoutes(req.session);
    res.render('admin', { user: req.user, approvedUsers, blacklist, routes });
  };

  pageHandlers.terms = async (req, res) => {
    try {
      const rawUrl = 'https://raw.githubusercontent.com/your-username/luasec/main/terms.md';
      const { data: markdown } = await axios.get(rawUrl);
      const htmlContent = marked.parse(markdown);
      const routes = buildRoutes(req.session);
      res.render('terms', { termsHtml: htmlContent, routes });
    } catch (error) {
      console.error('Error fetching terms:', error.message);
      res.status(500).send('Unable to load Terms of Service at this time.');
    }
  };

  pageHandlers.privacy = async (req, res) => {
    try {
      const rawUrl = 'https://raw.githubusercontent.com/your-username/luasec/main/privacy.md';
      const { data: markdown } = await axios.get(rawUrl);
      const htmlContent = marked.parse(markdown);
      const routes = buildRoutes(req.session);
      res.render('privacy', { termsHtml: htmlContent, routes });
    } catch (error) {
      console.error('Error fetching privacy:', error.message);
      res.status(500).send('Unable to load Privacy Policy at this time.');
    }
  };

  router.get('/dashboard', (req, res) => res.redirect(_r(req, 'dashboard')));
  router.get('/scripts', (req, res) => res.redirect(_r(req, 'dashboard')));
  router.get('/server_redirect', (req, res) => res.redirect(_r(req, 'dashboard')));
  router.get('/admin', (req, res) => res.redirect(_r(req, 'admin')));
  router.get('/manage/:id', (req, res) => res.redirect(_r(req, 'manage', req.params.id)));
  router.get('/panel/:guildId/:scriptId', (req, res) => res.redirect(_r(req, 'panel', req.params.guildId, req.params.scriptId)));
  router.get('/terms', (req, res) => res.redirect(_r(req, 'terms')));
  router.get('/privacy', (req, res) => res.redirect(_r(req, 'privacy')));
  router.get('/logout', (req, res) => res.redirect(_r(req, 'logout')));
  router.get('/auth/login', (req, res, next) => require('passport').authenticate('discord')(req, res, next));
  router.get('/auth/redirect', (req, res, next) => {
    require('passport').authenticate('discord', (err, user) => {
      if (err || !user) return res.redirect('/');
      req.logIn(user, loginErr => {
        if (loginErr) return res.redirect('/');
        res.redirect(_r(req, 'dashboard'));
      });
    })(req, res, next);
  });

  router.post('/q1x', async (req, res) => {
    if (!req.isAuthenticated()) return res.render('/auth/login');
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const { c: name, a: guildId } = req.body;
    if (!name || !guildId) return res.status(400).send('Invalid request data.');
    const guild = req.user.guilds.find(g => {
      if (g.id !== guildId) return false; if (g.owner) return true;
      const raw = typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions);
      const perms = new PermissionsBitField(raw);
      return perms.has(PermissionsBitField.Flags.Administrator);
    });
    if (!guild) return res.status(403).send('You do not own this server.');
    const scriptId = uuidv4().split('-')[0];
    try {
      await mongo.upsertServerScript({ guildId, scriptId, name, keys: [], users: [], blacklist: [], executions: {}, hwid_reset_timeout_in_hours: 24, freemium: false, dmOnExec: false });
    } catch (e) {
      console.error('Error creating script in Mongo:', e.message);
      return res.status(500).send('Internal server error.');
    }
    try {
      const scriptsDir = path.join(__dirname, '..', 'db', 'scripts', guildId);
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(scriptsDir, `${scriptId}.lua`), "print('Placeholder script loaded!')", 'utf8');
    } catch (e) { console.warn('Warning: failed to write placeholder lua file:', e.message); }
    return res.redirect(_r(req, 'manage', guildId));
  });

  router.post('/q2x', async (req, res) => {
    if (!req.isAuthenticated()) return res.render('/auth/login');
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const { a: guildId, b: scriptId, d: scriptContent } = req.body;
    if (!guildId || !scriptId || typeof scriptContent !== 'string') return res.status(400).send('Invalid request data.');
    const guild = req.user.guilds.find(g => {
      if (g.id !== guildId) return false; if (g.owner) return true;
      const raw = typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions);
      const perms = new PermissionsBitField(raw);
      return perms.has(PermissionsBitField.Flags.Administrator);
    });
    if (!guild) return res.status(403).send('You do not own this server.');
    try {
      const scriptsDir = path.join(__dirname, '..', 'db', 'scripts', guildId);
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.writeFileSync(path.join(scriptsDir, `${scriptId}.lua`), scriptContent);
      return res.json({ success: true });
    } catch (err) {
      console.error('Error saving script content:', err);
      return res.status(500).json({ error: 'Failed to save script content.' });
    }
  });

  router.post('/q3x', async (req, res) => {
    if (!req.isAuthenticated()) return res.render('/auth/login');
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    let { a: guildId, b: scriptId, e: lifetime, f: keyCount } = req.body;
    if (!guildId || !scriptId || isNaN(+lifetime) || isNaN(+keyCount)) return res.status(400).send('Invalid request data.');
    const guild = req.user.guilds.find(g => {
      if (g.id !== guildId) return false; if (g.owner) return true;
      const raw = typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions);
      const perms = new PermissionsBitField(raw);
      return perms.has(PermissionsBitField.Flags.Administrator);
    });
    if (!guild) return res.status(403).send('You do not own this server.');
    if (lifetime == 0) lifetime = 36500;
    try {
      const doc = await mongo.getServerScript(guildId, scriptId);
      if (!doc) return res.status(404).send('Script not found.');
      const newKeys = Array.from({ length: +keyCount }, () => ({ key: generate_key(), lifetime: +lifetime, createdAt: Date.now() }));
      await mongo.updateScriptFields(guildId, scriptId, { keys: [...(doc.keys || []), ...newKeys] });
      return res.redirect(_r(req, 'manage', guildId));
    } catch (e) {
      console.error('Error adding keys:', e.message);
      return res.status(500).send('Internal server error.');
    }
  });

  router.post('/q4x', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).json({ error: 'Not authenticated.' });
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const { b: scriptId, g: userId, h: duration } = req.body;
    if (!scriptId || !userId || isNaN(+duration)) return res.status(400).json({ error: 'Missing or invalid parameters.' });
    let guildId = null;
    for (const g of req.user.guilds) {
      const permsObj = new PermissionsBitField(typeof g.permissions === 'string' ? BigInt(g.permissions) : BigInt(g.permissions));
      if (!(g.owner || permsObj.has(PermissionsBitField.Flags.Administrator))) continue;
      const s = await mongo.getServerScript(g.id, scriptId);
      if (s) { guildId = g.id; break; }
    }
    if (!guildId) return res.status(404).json({ error: 'Script not found.' });
    const scriptDoc = await mongo.getServerScript(guildId, scriptId);
    if (!scriptDoc) return res.status(404).json({ error: 'Script not found.' });
    if ((scriptDoc.users || []).some(u => u.userId === userId)) return res.status(409).json({ error: 'User already whitelisted.' });
    const usernamefromid = await client.users.fetch(userId).then(u => u.username).catch(() => 'Unknown');
    const newUser = { key: generate_key(), userId, username: usernamefromid, usageCount: 0, lifetime: +duration, unix_expiration: Math.floor(Date.now() / 1000) + (+duration * 24 * 3600) };
    await mongo.updateScriptFields(guildId, scriptId, { users: [...(scriptDoc.users || []), newUser] });

    const duser = await client.users.fetch(userId).catch(() => null);
    if (duser) {
      const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Open Panel')
          .setURL(`https://app.yourdomain.com/panel/${guildId}/${scriptId}`)
          .setStyle('Link')
      );
      await duser.send({ embeds: [{ color: 0x2f3136, title: 'You\'ve been whitelisted!', description: `You've been assigned a key for **${scriptDoc.name}**`, fields: [ { name: 'Expiration', value: `<t:${newUser.unix_expiration}:R>`, inline: true }, { name: 'Duration', value: `**${duration} day(s)**`, inline: true }], footer: { text: 'app.yourdomain.com' }, timestamp: new Date() }], components: [buttonRow] });
    }

    const webActor = req.user ? `<@${req.user.id}> (${req.user.username || req.user.id})` : 'Web Panel User';
    await notifyOwnerWhitelist({
      client,
      actor: webActor,
      whitelisted: `<@${userId}> (${usernamefromid})`,
      scriptName: scriptDoc.name,
      key: newUser.key,
      expiresAt: newUser.unix_expiration,
      durationText: `${duration} day(s)`,
      guildName: null,
      guildId,
      scriptId,
      via: 'Web Panel'
    });

    return res.json({ success: true });
  });

  router.post('/q5x', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(403).json({ error: 'Not authenticated.' });
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const { a: guildId, b: scriptId, i: key } = req.body;
    if (!guildId || !scriptId || !key) return res.status(400).json({ error: 'Missing parameters.' });
    const doc = await mongo.getServerScript(guildId, scriptId);
    if (!doc) return res.status(404).json({ error: 'Script not found.' });
    const initialLen = (doc.users || []).length;
    const newUsers = (doc.users || []).filter(u => u.key !== key);
    if (newUsers.length === initialLen) return res.status(404).json({ error: 'User not found in script metadata.' });
    await mongo.updateScriptFields(guildId, scriptId, { users: newUsers });
    return res.json({ success: true });
  });

  router.post('/q6x', async (req, res) => {
    const { a: guildId, b: scriptId } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters.' });
    if (!req.isAuthenticated()) return res.status(403).json({ error: 'Not authenticated.' });
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    try { await mongo.deleteServerScript(guildId, scriptId); } catch (e) { console.error('Error deleting script in Mongo:', e.message); return res.status(500).json({ error: 'Failed to delete script in database.' }); }
    try { const luaPath = path.join(__dirname, '..', 'db', 'scripts', guildId, `${scriptId}.lua`); if (fs.existsSync(luaPath)) fs.unlinkSync(luaPath); } catch (e) { console.warn('Failed to remove lua file:', e.message); }
    return res.json({ success: true });
  });

  router.post('/q7x', async (req, res) => {
    if (!req.isAuthenticated()) return res.render('/auth/login');
    const user = await getUserEntry(req.user.id);
  if (!isApproved(user, req.user)) return res.redirect(_r(req, 'payment'));
    const { a: guildId, b: scriptId, j: executionLogWebhook, k: crackDetectionWebhook, l: script_hwid_reset_timeout_in_hours, m: freemiumScript, n: dmOnExec, c: newName } = req.body;
    const guild = req.user.guilds.find(g => g.id === guildId);
    if (!guild || (!guild.owner && !new PermissionsBitField(BigInt(guild.permissions)).has(PermissionsBitField.Flags.Administrator))) return res.status(403).send('You do not own this server.');
    const doc = await mongo.getServerScript(guildId, scriptId);
    if (!doc) return res.status(404).send('Server not found!');
    const hwidResetTimeout = parseInt(script_hwid_reset_timeout_in_hours);
    if (isNaN(hwidResetTimeout) || hwidResetTimeout < 1 || hwidResetTimeout > 168) return res.status(400).send('Invalid HWID reset timeout value.');
    const update = { hwid_reset_timeout_in_hours: hwidResetTimeout, freemium: freemiumScript === 'true', dmOnExec: dmOnExec === 'true' };
    update.execution_log_webhook = executionLogWebhook && isDiscordWebhook(executionLogWebhook) ? executionLogWebhook : '';
    update.crack_detection_webhook = crackDetectionWebhook && isDiscordWebhook(crackDetectionWebhook) ? crackDetectionWebhook : '';
    if (newName && typeof newName === 'string') {
      const trimmed = newName.trim().slice(0, 64);
      if (trimmed) update.name = trimmed;
    }
    try { await mongo.updateScriptFields(guildId, scriptId, update); return res.json({ success: true }); } catch (e) { console.error('Error updating settings:', e.message); return res.status(500).send('Error updating the settings.'); }
  });

  router.post('/q8x', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
    const user = await getUserEntry(req.user.id);
    if (!isApproved(user, req.user)) return res.status(403).json({ error: 'Not approved' });
    const { a: guildId, b: scriptId, o: configTable } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters' });
    if (typeof configTable !== 'string') return res.status(400).json({ error: 'Invalid parameter' });
    if (configTable.length > 500000) return res.status(400).json({ error: 'Config table too large' });
    const guild = req.user.guilds.find(g => g.id === guildId);
    if (!guild || (!guild.owner && !new PermissionsBitField(BigInt(guild.permissions)).has(PermissionsBitField.Flags.Administrator))) return res.status(403).json({ error: 'No permission' });
    const doc = await mongo.getServerScript(guildId, scriptId);
    if (!doc) return res.status(404).json({ error: 'Script not found' });
    try {
      await mongo.updateScriptFields(guildId, scriptId, { configTable });
      return res.json({ success: true });
    } catch (e) {
      console.error('Error updating config table:', e.message);
      return res.status(500).json({ error: 'Error saving config table' });
    }
  });

  router.post('/qLx', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
    const user = await getUserEntry(req.user.id);
    if (!isApproved(user, req.user)) return res.status(403).json({ error: 'Not approved' });
    const { a: guildId, b: scriptId, logo } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters' });
    const guild = req.user.guilds.find(g => g.id === guildId);
    if (!guild || (!guild.owner && !new PermissionsBitField(typeof guild.permissions === 'string' ? BigInt(guild.permissions) : BigInt(guild.permissions)).has(PermissionsBitField.Flags.Administrator))) {
      return res.status(403).json({ error: 'No permission' });
    }
    const doc = await mongo.getServerScript(guildId, scriptId);
    if (!doc) return res.status(404).json({ error: 'Script not found' });

    let finalLogo = '';
    if (logo && typeof logo === 'string' && logo.startsWith('data:image/')) {
      if (logo.length > 380000) return res.status(400).json({ error: 'Logo too large (max ~280KB)' });
      finalLogo = logo;
    }
    try {
      await mongo.updateScriptFields(guildId, scriptId, { logo: finalLogo });
      return res.json({ success: true });
    } catch (e) {
      console.error('Error updating logo:', e.message);
      return res.status(500).json({ error: 'Failed to save logo' });
    }
  });

  router.get('/discord', (req, res) => res.redirect('https://discord.gg/DcqZuBzBxb'));

  function requireAdmin(req, res) {
    if (!req.isAuthenticated()) { res.redirect('/auth/login'); return false; }
    if (req.user.id !== ADMIN_ID) { res.status(403).send('Forbidden'); return false; }
    return true;
  }

  router.post('/admin/q9x', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { p: discordId } = req.body;
    if (!discordId || !/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'Invalid Discord ID.' });
    await mongo.getOrCreateGlobalUser(discordId);
    let username = discordId;
    try { const u = await client.users.fetch(discordId); username = u.username; } catch {}
    await mongo.updateGlobalUser(discordId, { approved: true, discordUsername: username });
    return res.json({ success: true });
  });

  router.post('/admin/qax', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { p: discordId } = req.body;
    if (!discordId || !/^\d{17,20}$/.test(discordId)) return res.status(400).json({ error: 'Invalid Discord ID.' });
    await mongo.updateGlobalUser(discordId, { approved: false });
    return res.json({ success: true });
  });

  router.post('/admin/qbx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { q: ip } = req.body;
    if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'Invalid IP.' });
    if (await mongo.isIPBlacklisted(ip)) return res.status(409).json({ error: 'Already blacklisted.' });
    await mongo.addGlobalIP(ip);
    return res.json({ success: true });
  });

  router.post('/admin/qcx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { r: hwid } = req.body;
    if (!hwid || typeof hwid !== 'string') return res.status(400).json({ error: 'Invalid HWID.' });
    if (await mongo.isHWIDBlacklisted(hwid)) return res.status(409).json({ error: 'Already blacklisted.' });
    await mongo.addGlobalHWID(hwid);
    return res.json({ success: true });
  });

  router.post('/admin/qdx', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { q: ip } = req.body;
    if (!ip || typeof ip !== 'string') return res.status(400).json({ error: 'Invalid IP.' });
    await mongo.removeGlobalIP(ip);
    return res.json({ success: true });
  });

  router.post('/admin/qex', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { r: hwid } = req.body;
    if (!hwid || typeof hwid !== 'string') return res.status(400).json({ error: 'Invalid HWID.' });
    await mongo.removeGlobalHWID(hwid);
    return res.json({ success: true });
  });

  const LOG_BUFFER_SIZE = 200;
  const logBuffer = [];

  logEmitter.on('log', (entry) => {
    logBuffer.push(entry);
    if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  });

  router.get('/admin/qfx', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_ID) return res.status(403).send('Forbidden');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('\n');

    for (const entry of logBuffer) {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    }

    const onLog = (entry) => {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    };
    logEmitter.on('log', onLog);

    req.on('close', () => {
      logEmitter.removeListener('log', onLog);
    });
  });

  const PAGE_BUFFER_SIZE = 200;
  const pageBuffer = [];

  pageEmitter.on('visit', (entry) => {
    pageBuffer.push(entry);
    if (pageBuffer.length > PAGE_BUFFER_SIZE) pageBuffer.shift();
  });

  router.get('/admin/qgx', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_ID) return res.status(403).send('Forbidden');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('\n');

    for (const entry of pageBuffer) {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    }

    const onVisit = (entry) => {
      res.write('data: ' + JSON.stringify(entry) + '\n\n');
    };
    pageEmitter.on('visit', onVisit);

    req.on('close', () => {
      pageEmitter.removeListener('visit', onVisit);
    });
  });


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

  router.post('/panel/qhx', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated.' });
    const { a: guildId, b: scriptId, i: key } = req.body;
    if (!guildId || !scriptId || !key) return res.status(400).json({ error: 'Missing parameters.' });
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return res.status(404).json({ error: 'Server not found.' });
      const [success, scriptName, errorMsg] = await redeemKey(guild, key, req.user.id, req.user.username, scriptId);
      if (!success) return res.status(400).json({ error: errorMsg || 'Invalid or already-used key.' });
      return res.json({ success: true, scriptName });
    } catch (err) {
      console.error('Web panel redeem error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  router.post('/panel/qix', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated.' });
    const { a: guildId, b: scriptId } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters.' });
    try {
      const scriptData = await mongo.getServerScript(guildId, scriptId);
      if (!scriptData) return res.status(404).json({ error: 'Script not found.' });
      const currentUnix = Math.floor(Date.now() / 1000);
      const timeoutSeconds = (scriptData.hwid_reset_timeout_in_hours || 24) * 3600;
      let reset = false;
      const users = scriptData.users || [];
      for (const user of users) {
        if (user.userId === req.user.id) {
          const lastReset = user.last_reset || 0;
          if (lastReset === 0 || currentUnix - lastReset >= timeoutSeconds) {
            user.hwid = '';
            user.last_reset = currentUnix;
            reset = true;
          }
        }
      }
      if (!reset) return res.status(400).json({ error: 'Cannot reset HWID yet. Please wait.' });
      await mongo.updateScriptFields(guildId, scriptId, { users });
      return res.json({ success: true });
    } catch (err) {
      console.error('Web panel reset-hwid error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  router.post('/panel/qjx', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated.' });
    const { a: guildId, b: scriptId } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters.' });
    try {
      const scriptData = await mongo.getServerScript(guildId, scriptId);
      if (!scriptData) return res.status(404).json({ error: 'Script not found.' });
      const userEntry = (scriptData.users || []).find(u => u.userId === req.user.id);
      if (!userEntry) return res.status(403).json({ error: 'You are not whitelisted for this script.' });
      const now = Math.floor(Date.now() / 1000);
      if (now > userEntry.unix_expiration) return res.status(403).json({ error: 'Your key has expired.' });
      const configTable = scriptData.configTable ? `${scriptData.configTable}\n` : '';
      const encoded = encodeIds(guildId, scriptId);
      const loader = `loadstring(game:HttpGet("https://auth.yourdomain.com/loader/${encoded}?key=${userEntry.key}"))()`;
      const luaCode = ['-- Secured by @zula', configTable, loader].join('\n');
      return res.json({
        success: true,
        key: userEntry.key,
        usageCount: userEntry.usageCount,
        unix_expiration: userEntry.unix_expiration,
        luaCode
      });
    } catch (err) {
      console.error('Web panel get-script error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  function hasAdminPerms(perms) {
    const raw = typeof perms === 'string' ? BigInt(perms) : BigInt(perms || 0);
    const p = new PermissionsBitField(raw);
    return p.has(PermissionsBitField.Flags.Administrator);
  }

  router.post('/panel/qlx', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated.' });
    const { a: guildId, b: scriptId } = req.body;
    if (!guildId || !scriptId) return res.status(400).json({ error: 'Missing parameters.' });
    const guild = req.user.guilds.find(g => g.id === guildId && (g.owner || hasAdminPerms(g.permissions)));
    if (!guild) return res.status(403).json({ error: 'No permission for this server.' });
    try {
      const clients = authRouter.getLiveClients(guildId, scriptId);
      return res.json({ success: true, clients, count: clients.length });
    } catch (err) {
      console.error('Live view list error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  router.post('/panel/qmx', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated.' });
    const { a: guildId, b: scriptId, c: targetKey, d: luaCode } = req.body;
    if (!guildId || !scriptId || typeof luaCode !== 'string') return res.status(400).json({ error: 'Missing parameters.' });
    const guild = req.user.guilds.find(g => g.id === guildId && (g.owner || hasAdminPerms(g.permissions)));
    if (!guild) return res.status(403).json({ error: 'No permission for this server.' });
    if (luaCode.length > 50000) return res.status(400).json({ error: 'Lua code too large (max 50KB).' });
    try {
      const sent = authRouter.sendLuaToClients(guildId, scriptId, targetKey || null, luaCode);
      return res.json({ success: true, sent });
    } catch (err) {
      console.error('Live view execute error:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  router.get('/:token', async (req, res, next) => {
    if (!req.session) return next();
    const token = req.path.replace(/^\//, '');
    const resolved = req.session._r && req.session._r[token];
    if (!resolved) return next();
    const handler = pageHandlers[resolved.page];
    if (!handler) return next();
    if (!resolved.fresh) {
      delete req.session._r[token];
      return res.redirect(_r(req, resolved.page, ...(resolved.params || [])));
    }
    resolved.fresh = false;
    try { await handler(req, res, resolved.params); } catch (e) { next(e); }
  });

  
  router.get('/table/:encoded', async (req, res) => {
  const { serverid, scriptid } = decodeIds(req.params.encoded);
  if (!serverid || !scriptid) return res.status(400).send('Missing parameters');

  try {
    const scriptData = await mongo.getServerScript(serverid, scriptid);
    if (!scriptData) return res.status(404).send('Script not found');

    const code = (scriptData.configTable || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const cheatname = scriptData.name || 'N/A';

    res.setHeader('Content-Type', 'text/html');

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${cheatname} — Config Table</title>

  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/lua.min.js"></script>

  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&amp;family=Space+Grotesk:wght@500;600&amp;display=swap" rel="stylesheet" />

  <style>
    :root {
      --bg:        #0a0a0a;
      --bg2:       #111111;
      --border:    #1f1f1f;
      --accent:    #9e9e9e;
      --accent2:   #555555;
      --text:      #e6e6e6;
      --text-dim:  #888888;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      height: 100%;
      background: var(--bg);
      font-family: 'Inter', system-ui, sans-serif;
      color: var(--text);
      overflow: hidden;
    }

    .page {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 12px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 24px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-radius: 8px 8px 0 0;
      flex-shrink: 0;
      box-shadow: 0 1px 0 rgba(255,255,255,0.03);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-mark {
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 17px;
      letter-spacing: -0.02em;
      color: var(--accent);
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .tag {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border: 1px solid var(--accent2);
      border-radius: 4px;
      color: var(--text-dim);
      background: rgba(255,255,255,0.03);
    }

    .copy-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--accent2);
      border-radius: 6px;
      font-family: 'Space Grotesk', sans-serif;
      font-weight: 600;
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .copy-btn:hover {
      background: rgba(88, 166, 255, 0.08);
      border-color: var(--accent);
      color: #ffffff;
    }

    .copy-btn.copied {
      color: #4ade80;
      border-color: #4ade80;
    }

    .subbar {
      display: flex;
      align-items: center;
      gap: 24px;
      padding: 10px 24px;
      background: #0c0c0c;
      border-left: 1px solid var(--border);
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      font-size: 11px;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      text-transform: uppercase;
    }

    .subbar-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .subbar-item span:first-child {
      color: var(--accent2);
      font-weight: 500;
    }

    .code-wrap {
      flex: 1;
      overflow: auto;
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      background: #0a0a0a;
      position: relative;
    }

    .code-wrap::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    .code-wrap::-webkit-scrollbar-track {
      background: #111111;
    }

    .code-wrap::-webkit-scrollbar-thumb {
      background: #333333;
      border-radius: 4px;
    }

    pre {
      margin: 0;
      padding: 0;
    }

    pre code.hljs {
      display: block;
      padding: 28px 32px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 14px;
      line-height: 1.7;
      background: transparent !important;
      tab-size: 2;
    }

    footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 24px;
      background: var(--bg2);
      border: 1px solid var(--border);
      border-top: none;
      border-radius: 0 0 8px 8px;
      font-size: 11px;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      text-transform: uppercase;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
  <div class="page">
    <header>
      <div class="header-left">
        <div class="logo-mark">${cheatname}</div>
        <span style="color:#555;font-size:18px;">•</span>
        <div style="font-size:15px;font-weight:500;letter-spacing:0.02em;">Config Table</div>
      </div>

      <div class="header-right">
        <button class="copy-btn" onclick="copyCode(this)">
          <span>Copy</span>
        </button>
      </div>
    </header>



    <div class="code-wrap">
      <pre><code class="language-lua">${code}</code></pre>
    </div>

  </div>

  <script>
    hljs.highlightAll();

    function updateLineCount() {
      const codeEl = document.querySelector('code');
      if (!codeEl) return;
      const lines = codeEl.innerText.split('\n').length;
      document.getElementById('line-count').textContent = \`\${lines} ln\`;
    }

    function copyCode(btn) {
      const codeEl = document.querySelector('code');
      if (!codeEl) return;

      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span>Copied ✓</span>';
        btn.classList.add('copied');

        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.classList.remove('copied');
        }, 2200);
      });
    }

    window.addEventListener('load', updateLineCount);
  </script>
</body>
</html>`);
  } catch (err) {
    console.error('Error fetching config table:', err);
    return res.status(500).send('Internal server error');
  }
  });

  return router;
};
