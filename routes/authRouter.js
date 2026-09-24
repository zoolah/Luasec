const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const { EmbedBuilder } = require('discord.js');
const mongo = require('../db/mongo');
const wynfuscator = require("../wynfuscate");
const {
  get_loader,
  xorDecrypt,
  is_user_blacklisted,
  isHwidGloballyBlacklisted,
  isIpGloballyBlacklisted,
  isDiscordWebhook,
  send_embed_to_webhook,
  get_raw_loader,
  get_raw_script
} = require('../utils');
const { name } = require('ejs');
const EventEmitter = require('events');
const logEmitter = new EventEmitter();
logEmitter.setMaxListeners(50);

const heartbeatClients = new Map(); // compositeKey `${serverId}:${scriptId}:${key}` -> { serverId, scriptId, key, username, hwid, connectedAt, lastSeen, pendingCommands: [] }

function bufferToBase62(buffer) {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const hex = buffer.toString('hex');
  let num = BigInt('0x' + hex);

  let result = '';
  while (num > 0) {
    result = chars[Number(num % 62n)] + result;
    num = num / 62n;
  }
  return result || '0'; 
}


function hashLuaCode(luaCode, length = 8) {
  if (typeof luaCode !== 'string') {
    throw new Error('Input must be a string of Lua code');
  }

  const digest = crypto
    .createHash('sha256')
    .update(luaCode, 'utf8')  
    .digest();               

  const base62 = bufferToBase62(digest);

  return base62.slice(0, length);
}


function generateRandom9LetterString() {
      const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 9; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
      }
      return result;
};

function transform(x) {
  return (x / 2) - 0.25
}

function hwidMiddleware(req, res, next) {
  let hwid = null;
  for (const headerName in req.headers) {
    if (headerName.toLowerCase().endsWith('-fingerprint')) { hwid = req.headers[headerName]; break; }
  }
  if (!hwid) return res.status(500).json({ error: 'Missing fingerprint header' });
  req.hwid = hwid; next();
}

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

function encodeIds(serverIdStr, scriptIdHexStr) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const base = BigInt(alphabet.length);
  const serverId = BigInt(serverIdStr);
  const scriptId = BigInt(`0x${scriptIdHexStr}`);
  const combined = (serverId << BigInt(32)) | scriptId;
  let encoded = ''; let temp = combined;
  if (combined === BigInt(0)) return alphabet[0];
  while (temp > BigInt(0)) { encoded = alphabet[Number(temp % base)] + encoded; temp = temp / base; }
  return encoded;
}



function log(stage, status, user, scriptId, details = '') {
  if (stage === 'VALIDATE' && status === 'OK') {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const time = `${hh}:${mm}:${ss}`;
    
    const output = `${time} ✓  ${user.padEnd(18)} ${scriptId.padEnd(12)} ${details}`;
    process.stdout.write(output + '\n');

    logEmitter.emit('log', {
      time,
      icon: '✓',
      stage,
      status,
      user: user || '',
      scriptId: scriptId || '',
      details: details || '',
      raw: output
    });
  } else {
    logEmitter.emit('log', {
      time: new Date().toISOString(),
      icon: '→',
      stage,
      status,
      user: user || '',
      scriptId: scriptId || '',
      details: details || '',
      raw: ''
    });
  }
}

function createAuthRouter({ client }) {
  const router = express.Router();

  // // Script session tracking
  // const scriptSessions = new Map(); // token -> { createdAt, serverId, scriptId }
  // const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  // // Clean up expired sessions periodically
  // const cleanupInterval = setInterval(() => {
  //   const now = Date.now();

  //   for (const [token, session] of scriptSessions.entries()) {
  //     if (now - session.createdAt > SESSION_TIMEOUT) {
  //       scriptSessions.delete(token);
  //     }
  //   }
  // }, 60 * 1000); // Check every minute
  


  router.post('/validate', hwidMiddleware, express.json({ limit: '1mb' }), async (req, res) => {
    const Hwid = req.hwid;
    const ip = req.ip;
    
    if (await isHwidGloballyBlacklisted(Hwid) || await isIpGloballyBlacklisted(ip)) {
      log('VALIDATE', 'FAIL', 'BLACKLISTED', '', `HWID: ${Hwid.slice(0, 8)}... | IP: ${ip}`);
      return res.status(403).send("Forbidden");
    }
    
    let sent;
    try {
      const codes = String(req.body.Data).split(',').map(c => parseInt(c.trim(), 10));
      const b64 = String.fromCharCode(...codes);
      const key = b64.slice(0, 9);
      const encrypted = Buffer.from(b64.slice(9), 'base64').toString('utf8');
      const decrypted = xorDecrypt(encrypted, key);
      sent = JSON.parse(decrypted);
    } catch (err) {
      console.error('[DEBUG] Decrypt/Parse Error:', err);
      log('VALIDATE', 'FAIL', 'DECRYPT_ERROR', '', `Payload invalid`);
      return res.status(403).send("INVALID PAYLOAD");
    }
    
    const { Key, ScriptId, ServerId, Rng1, Rng2, Rng3, Rng4, Rng5, RobloxUser, GameId, GameName, JobId, Executor, Token } = sent;
    if (!Key || Key.length !== 24 || !ScriptId) {
      log('VALIDATE', 'FAIL', 'INVALID_CREDS', ScriptId, `Key len: ${Key?.length || 0}`);
      return res.status(403).send("Invalid");
    }
    
 
    
    const metadata = await mongo.getServerScript(ServerId, ScriptId);
    if (!metadata) {
      log('VALIDATE', 'FAIL', 'NOT_FOUND', `${ServerId}/${ScriptId}`, '');
      return res.status(403).send("Script Not found");
    }
    
    const user = (metadata.users || []).find(u => u.key === Key);
    if (!user) {
      log('VALIDATE', 'FAIL', 'INVALID_KEY', ScriptId, 'User not found');
      return res.status(403).send("Invalid key");
    }
    
    if (await is_user_blacklisted(ServerId, ScriptId, user.userId)) {
      log('VALIDATE', 'FAIL', user.username, ScriptId, 'Blacklisted');
      return res.status(403).send("Forbidden");
    }
    
    const nowSec = Math.floor(Date.now() / 1000);
    if (!user.unix_expiration) { const days = user.lifetime || 1; user.unix_expiration = nowSec + days * 24 * 3600; }
    else if (user.unix_expiration < nowSec) {
      log('VALIDATE', 'FAIL', user.username, ScriptId, 'Subscription expired');
      return res.status(403).send("Key Expired");
    }
    

    if (user.hwid && user.hwid !== Hwid) {
      log('VALIDATE', 'FAIL', user.username, ScriptId, 'HWID mismatch');
      return res.status(403).send("Hwid mismatch");
    }
    
    user.hwid ||= Hwid; user.usageCount = (user.usageCount || 0) + 1;
    if (metadata.dmOnExec) {
      const discordUser = await client.users.fetch(user.userId).catch(() => null);
      if (discordUser) {
        const embed = new EmbedBuilder().setTitle(`${metadata.name} Logs`).setColor(0x00AE86).setDescription(`You just executed ${metadata.name}`).setTimestamp();
        discordUser.send({ embeds: [embed] }).catch(() => null);
      }
    }
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10); 
    metadata.executions = metadata.executions || {};
    metadata.executions[dateKey] = (metadata.executions[dateKey] || 0) + 1;
    
    if (metadata.execution_log_webhook && isDiscordWebhook(metadata.execution_log_webhook)) {
      const timestamp = new Date().toISOString();
      const description = [
        `**Script:** ${metadata.name || 'N/A'}`,
        `**Discord User:** ${user.username || 'N/A'} (${user.userId || 'N/A'})`,
        `**Roblox User:** ${RobloxUser || 'N/A'}`,
        `**Executor:** ${Executor || 'N/A'}`,
        `**Timestamp:** ${timestamp}`
      ].join('\n');

      const fields = [
        { name: 'Game', value: `${GameName || 'N/A'} (${GameId || 'N/A'})`, inline: false },
        { name: 'Job ID', value: JobId || 'N/A', inline: true }
      ];

      await send_embed_to_webhook(metadata.execution_log_webhook, `Execution log`, description, fields, '');
    }
    const newUsers = (metadata.users || []).map(u => u.key === user.key ? user : u);
    await mongo.updateScriptFields(ServerId, ScriptId, { users: newUsers, executions: metadata.executions });
    
    const check = `${transform(Rng1)}|${transform(Rng2)}|${transform(Rng3)}|${transform(Rng4)}|${transform(Rng5)}`;

    log('VALIDATE', 'OK', user.username, metadata.name, `${RobloxUser} • ${GameName} • ${Executor} • JobID: ${JobId}`);
    return res.status(200).json({ Valid: true, check });
  });

  router.post('/script', express.json({ limit: '1mb' }), async (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',').shift().trim() || req.connection.remoteAddress;
    const startTime = Date.now();

        let sent;
    try {
        const codes = String(req.body.Data).split(',').map(c => parseInt(c.trim(), 10));
        const b64 = String.fromCharCode(...codes);
        const key = b64.slice(0, 9);
        const encrypted = Buffer.from(b64.slice(9), 'base64').toString('utf8');
        const decrypted = xorDecrypt(encrypted, key);
        sent = JSON.parse(decrypted);
    } catch (err) {
        log('SCRIPT', 'FAIL', 'DECRYPT_ERROR', '', 'Payload invalid');
        return res.status(403).send("Internal server error");
    }
      
    const { ServerId, ScriptId, Key } = sent;
    
    let hwid = null;
    for (const headerName in req.headers) {
      if (headerName.toLowerCase().endsWith('-fingerprint')) { hwid = req.headers[headerName]; break; }
    }
    
    if (await isIpGloballyBlacklisted(ip) || (hwid && await isHwidGloballyBlacklisted(hwid))) {
      log('SCRIPT', 'FAIL', 'BLACKLISTED_START', '', `IP: ${ip} | HWID: ${hwid?.slice(0, 8) || 'N/A'}...`);
      return res.status(403).send("Forbidden.");
    }
    
    const { name: browserName, version: browserVersion } = new UAParser(req.headers['user-agent'] || '').getResult().browser;
    if (browserName && browserVersion) {
      log('SCRIPT', 'FAIL', 'BROWSER_DETECTED', '', `${browserName} ${browserVersion}`);
      return res.status(403).send('404 Not Found');
    }



    const metadata = await mongo.getServerScript(ServerId, ScriptId);
    if (!metadata) {
      log('SCRIPT', 'FAIL', 'NOT_FOUND', `${ServerId}/${ScriptId}`, '');
      return res.status(403).send("Script not found");
    }
    
    const user = (metadata.users || []).find(u => u.key === Key);
    if (!user) {
      log('SCRIPT', 'FAIL', 'INVALID_KEY', ScriptId, '');
      return res.status(403).send("Invalid key");
    }
    
    if (await is_user_blacklisted(ServerId, ScriptId, user.userId)) {
      log('SCRIPT', 'FAIL', user.username, ScriptId, 'Blacklisted');
      return res.status(403).send("Forbidden");
    }
  
    if (hwid && user.hwid && hwid !== user.hwid) {  
      log('SCRIPT', 'FAIL', user.username, ScriptId, 'HWID mismatch');
      return res.status(403).send("Hwid mismatch");
    }
    
    user.ip ||= ip;
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    if (!user.unix_expiration) { const days = user.lifetime || 1; user.unix_expiration = nowSec + days * 24 * 3600; }
    else if (user.unix_expiration < nowSec) {
      log('SCRIPT', 'FAIL', user.username, ScriptId, 'Subscription expired');
      return res.status(403).send("Key Expired");
    }
    
    const newUsers = (metadata.users || []).map(u => u.key === user.key ? user : u);
    await mongo.updateScriptFields(ServerId, ScriptId, { users: newUsers });

    // const scriptToken = crypto.randomBytes(32).toString('hex');
    // scriptSessions.set(scriptToken, {
    //   createdAt: Date.now(),
    //   serverId: ServerId,
    //   scriptId: ScriptId
    // });


    const rawScript = get_raw_script(ServerId, ScriptId);
    const rawHash = hashLuaCode(rawScript);
    const outputDir = path.join(__dirname, '..', 'cache', 'script-cache');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const obfFileName = `${ServerId}-${ScriptId}-${Key}.obf.lua`;
    const obfMetaFileName = `${ServerId}-${ScriptId}-${Key}.json`;
    const obfFilePath = path.join(outputDir, obfFileName);
    const obfMetaPath = path.join(outputDir, obfMetaFileName);

    if (fs.existsSync(obfFilePath)) {
        const cachedHash = JSON.parse(fs.readFileSync(obfMetaPath, 'utf8')).hash;
        if (cachedHash === rawHash) {
            log('SCRIPT', 'OK', user.username, ScriptId, `Cache hit - ${rawHash}`);
            return res.status(200).json({ Valid: true, Body: fs.readFileSync(obfFilePath, 'utf8') }); 
        }
    } else {
        console.debug(`[SCRIPT] No cache file found — obfuscating for the first time`);
    }

    const obfuscated = await wynfuscator.obfuscateMainScript(
        path.join(__dirname, '..', 'db', 'scripts', ServerId, `${ScriptId}.lua`),
        user,
        ServerId,
        ScriptId,
        metadata.name
    );
    fs.writeFileSync(obfFilePath, obfuscated);
    fs.writeFileSync(obfMetaPath, JSON.stringify({ hash: rawHash }));

    
    const duration = Date.now() - startTime;
    log('SCRIPT', 'OK', user.username, ScriptId, `${(obfuscated.length / 1024).toFixed(1)}KB | ${duration}ms`);
    return res.status(200).json({ Valid: true, Body: obfuscated });
  });

  router.get('/loader/:encoded', async (req, res) => {
    try {

      
      const ip = req.ip || req.headers['x-forwarded-for']?.split(',').shift().trim() || req.connection.remoteAddress;
      const startTime = Date.now();

      
      let hwid = null;
      for (const headerName in req.headers) {
        if (headerName.toLowerCase().endsWith('-fingerprint')) { hwid = req.headers[headerName]; break; }
      }
      
      if (await isIpGloballyBlacklisted(ip) || (hwid && await isHwidGloballyBlacklisted(hwid))) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Forbidden')");
      }
      
      const { serverid, scriptid } = decodeIds(req.params.encoded);

      const { name: browserName, version: browserVersion } = new UAParser((req.headers['user-agent'] || '')).getResult().browser;
      if (browserName && browserVersion) {
        return res.status(200).type('text/plain').send("Fuck you");
      }
      
      const metadata = await mongo.getServerScript(serverid, scriptid);
      if (!metadata) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Script not found')");
      }

      const Key = req.query.key;
      if (!Key) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Invalid key')");
      }

      const user = (metadata.users || []).find(u => u.key === Key);
      if (!user) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Invalid key')");
      }
      
      if (await is_user_blacklisted(serverid, scriptid, user.userId)) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Blacklisted')");
      }

      if (hwid && user.hwid && hwid !== user.hwid) {  
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('HWID mismatch')");
      }

      user.ip ||= ip;
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      if (!user.unix_expiration) { const days = user.lifetime || 1; user.unix_expiration = nowSec + days * 24 * 3600; }
      else if (user.unix_expiration < nowSec) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Key Expired')");
      }
      
      const luaPath = path.join(__dirname, '..', 'db', 'scripts', serverid, `${scriptid}.lua`);
      if (!fs.existsSync(luaPath)) {
        return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Script not found')");
      }
      

      
      const loader = get_loader(generateRandom9LetterString(), serverid, scriptid, metadata.name, Key);
      const raw_loader = get_raw_loader();
      const rawHash = hashLuaCode(raw_loader);

      const outputDir = path.join(__dirname, '..', 'cache', 'loader-cache');
      if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
      }

      const obfFileName     = `${serverid}-${scriptid}-${Key}.obf.lua`;
      const obfMetaFileName = `${serverid}-${scriptid}-${Key}.json`;
      const obfFilePath     = path.join(outputDir, obfFileName);
      const obfMetaPath     = path.join(outputDir, obfMetaFileName);


      if (fs.existsSync(obfFilePath)) {

          const cachedHash = JSON.parse(fs.readFileSync(obfMetaPath, 'utf8')).hash;

          if (cachedHash === rawHash) {
              return res.type('text/plain').send(fs.readFileSync(obfFilePath, 'utf8'));
          }

      } else {
          console.debug(`[LOADER] No cache file found — obfuscating for the first time`);
      }

      const obfuscated = await wynfuscator.obfuscateText(loader, {
          securityTier: "STANDARD",
          targetPlatform: "ROBLOX",
          node: "STABLE",
      });

      fs.writeFileSync(obfFilePath, obfuscated);
      fs.writeFileSync(obfMetaPath, JSON.stringify({ hash: rawHash }));
                  
      const duration = Date.now() - startTime;
      log('LOADER', 'OK', metadata.name, `${serverid}/${scriptid}`, `${(obfuscated.length / 1024).toFixed(1)}KB | ${duration}ms`);
      return res.type('text/plain').send(obfuscated);
    } catch (e) {
      log('LOADER', 'FAIL', 'ERROR', '', e.message);
      return res.status(200).send("game:GetService('Players').LocalPlayer:Kick('Internal server error')");
    }
  });






  router.post('/heartbeat', express.json({ limit: '1mb' }), async (req, res) => {
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',').shift()?.trim();

    let payload;
    try {
      const codes = String(req.body.Data || '').split(',').map(c => parseInt(c.trim(), 10));
      const b64 = String.fromCharCode(...codes);
      const key = b64.slice(0, 9);
      const encrypted = Buffer.from(b64.slice(9), 'base64').toString('utf8');
      const decrypted = xorDecrypt(encrypted, key);
      payload = JSON.parse(decrypted);
    } catch (err) {
      console.error('[HEARTBEAT] Decode error:', err.message);
      return res.status(400).json({ kick: 'Invalid heartbeat format' });
    }

    const { Key, ServerId, ScriptId, Hwid: payloadHwid } = payload;

    let Hwid = payloadHwid;
    if (!Hwid) {
      for (const headerName in req.headers) {
        if (headerName.toLowerCase().endsWith('-fingerprint')) { Hwid = req.headers[headerName]; break; }
      }
    }

    if (Hwid && (await isHwidGloballyBlacklisted(Hwid) || await isIpGloballyBlacklisted(ip))) {
      return res.status(403).json({ kick: 'Blacklisted' });
    }

    if (!Key || !ServerId || !ScriptId) {
      return res.status(400).json({ kick: 'Invalid heartbeat payload' });
    }

    const metadata = await mongo.getServerScript(ServerId, ScriptId);
    if (!metadata) {
      logEmitter.emit('log', {
        time: new Date().toLocaleTimeString(),
        icon: '✗',
        stage: 'HEARTBEAT',
        status: 'FAIL',
        user: Key || '',
        scriptId: ScriptId || '',
        details: 'Script Not Found'
      });
      return res.status(200).json({ kick: 'Script Not found' });
    }

    const user = (metadata.users || []).find(u => u.key === Key);
    if (!user) {
      logEmitter.emit('log', {
        time: new Date().toLocaleTimeString(),
        icon: '✗',
        stage: 'HEARTBEAT',
        status: 'FAIL',
        user: Key || '',
        scriptId: ScriptId || '',
        details: 'Invalid Key'
      });
      return res.status(200).json({ kick: 'Invalid key' });
    }

    if (await is_user_blacklisted(ServerId, ScriptId, user.userId)) {
      logEmitter.emit('log', {
        time: new Date().toLocaleTimeString(),
        icon: '✗',
        stage: 'HEARTBEAT',
        status: 'FAIL',
        user: user.username || Key,
        scriptId: ScriptId || '',
        details: 'Blacklisted'
      });
      return res.status(200).json({ kick: 'You are blacklisted' });
    }

    const nowSec = Math.floor(Date.now() / 1000);

    if (!user.unix_expiration) {
      const days = user.lifetime || 1;
      user.unix_expiration = nowSec + days * 24 * 3600;
    } else if (user.unix_expiration < nowSec) {
      logEmitter.emit('log', {
        time: new Date().toLocaleTimeString(),
        icon: '✗',
        stage: 'HEARTBEAT',
        status: 'FAIL',
        user: user.username || Key,
        scriptId: ScriptId || '',
        details: 'Subscription Expired'
      });
      return res.status(200).json({ kick: 'Key Expired' });
    }

    if (user.hwid && user.hwid !== Hwid) {
      logEmitter.emit('log', {
        time: new Date().toLocaleTimeString(),
        icon: '✗',
        stage: 'HEARTBEAT',
        status: 'FAIL',
        user: user.username || Key,
        scriptId: ScriptId || '',
        details: 'HWID Mismatch'
      });
      return res.status(200).json({ kick: 'HWID mismatch' });
    }

    const time = new Date().toLocaleTimeString();
    logEmitter.emit('log', {
      time,
      icon: '♡',
      stage: 'HEARTBEAT',
      status: 'OK',
      user: Key || '',
      scriptId: ScriptId || '',
      details: `ServerId: ${ServerId} | HWID: ${(Hwid || 'N/A').slice(0, 8)}...`
    });

    const composite = `${ServerId}:${ScriptId}:${Key}`;
    const nowTs = Date.now();
    let entry = heartbeatClients.get(composite);
    if (!entry) {
      entry = {
        serverId: ServerId,
        scriptId: ScriptId,
        key: Key,
        username: user.username || Key,
        hwid: Hwid,
        connectedAt: nowTs,
        lastSeen: nowTs,
        pendingCommands: []
      };
      heartbeatClients.set(composite, entry);
    } else {
      entry.lastSeen = nowTs;
      entry.hwid = Hwid;
    }

    // Drain pending remote commands
    const commands = entry.pendingCommands.splice(0, entry.pendingCommands.length);

    return res.json({
      success: true,
      commands: commands.map(c => ({ code: c.code }))
    });
  });

  return router;
};

function setupWebSocket(server) {
  console.log('[Luasec] WebSocket heartbeat disabled (using HTTP /heartbeat polling instead)');
  return null;
}

setInterval(() => {
  const now = Date.now();
  const STALE_MS = 45_000;
  for (const [composite, entry] of heartbeatClients.entries()) {
    if (now - (entry.lastSeen || 0) > STALE_MS) {
      heartbeatClients.delete(composite);
    }
  }
}, 20_000);

function getLiveClients(serverId, scriptId) {
  const out = [];
  for (const [composite, entry] of heartbeatClients.entries()) {
    if (entry.serverId === serverId && entry.scriptId === scriptId) {
      out.push({
        key: entry.key,
        username: entry.username,
        hwid: entry.hwid,
        connectedAt: entry.connectedAt,
        lastSeen: entry.lastSeen
      });
    }
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}

function sendLuaToClients(serverId, scriptId, targetKey, luaCode) {
  const safeCode = String(luaCode || '').trim();
  if (!safeCode) return 0;
  let queued = 0;
  for (const [composite, entry] of heartbeatClients.entries()) {
    if (entry.serverId !== serverId || entry.scriptId !== scriptId) continue;
    if (targetKey && entry.key !== targetKey) continue;
    if (!entry.pendingCommands) entry.pendingCommands = [];
    entry.pendingCommands.push({ code: safeCode, queuedAt: Date.now() });
    queued++;
  }
  return queued;
}

module.exports = createAuthRouter;
module.exports.logEmitter = logEmitter;
module.exports.setupWebSocket = setupWebSocket;
module.exports.getLiveClients = getLiveClients;
module.exports.sendLuaToClients = sendLuaToClients;
