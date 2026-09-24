const express = require('express');
const path = require('path');
const mongo = require('../db/mongo');
const { build_error_page, generate_key, add_key } = require('../utils');

module.exports = function createApiRouter({ lootlabsCache }) {
  const router = express.Router();

  router.get('/freemium', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send(build_error_page('Malformed request.', '400'));
  if (!lootlabsCache || !lootlabsCache[code]) return res.status(400).send(build_error_page('Invalid code.', '400'));
    const referrer = req.get('Referrer');
    if (!referrer || (!referrer.includes('loot-link.com') && !referrer.includes('lootdest.org'))) {
      return res.status(401).send(build_error_page('Bypass detected. Please complete the challenges.', '401'));
    }
  const { guild: guildId, script: scriptId, scriptName } = lootlabsCache[code];
    try {
      const key = await add_key({ key: generate_key(), lifetime: 1, createdAt: Math.floor(Date.now() / 1000) }, guildId, scriptId);
  delete lootlabsCache[code];
      return res.send(`<!DOCTYPE html><html><head><meta charset='UTF-8'/><title>Freemium Key</title><style>body{margin:0;padding:2rem;background:#121212;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;color:#fff}.container{max-width:600px;width:100%;background:#1e1e1e;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.5);padding:2rem}h1{margin:0 0 1rem;font-size:1.75rem;color:#5865F2;text-align:center}.key-box{background:#2a2a2a;padding:1.5rem;border-radius:8px;margin:1.5rem 0;text-align:center}.key-label{font-size:.9rem;font-weight:600;color:#b0b0b0;margin-bottom:.5rem}.key{display:inline-block;background:#121212;padding:.75rem 1rem;border-radius:6px;border:1px solid #383838;font-family:'Courier New',monospace;font-size:1.2rem;word-break:break-all}.info,.warning{font-size:.85rem;line-height:1.4;text-align:center}.info{color:#999;margin-top:1.5rem}.warning{color:#ff6b6b;margin-top:1rem}</style></head><body><div class='container'><h1>Your Freemium Key for <span style='color:#fff;'>${scriptName}</span></h1><div class='key-box'><div class='key-label'>Here it is:</div><div class='key'>${key}</div></div><div class='info'>Redeem this key back in the Discord server via the <strong>Redeem</strong> button!</div><div class='warning'>If you reload, your progress resets and this key will be lost.</div></div><script>window.addEventListener('beforeunload',e=>{const m='Reloading will reset your progress and lose your key.';(e||window.event).returnValue=m;return m});</script></body></html>`);
    } catch (err) {
      console.error('Freemium route error:', err.message);
      return res.status(500).send('Internal server error.');
    }
  });

  router.post('/get-key-info', async (req, res) => {
    try {
      const { guildId, scriptId, key } = req.body;
      const doc = await mongo.getServerScript(guildId, scriptId);
      if (!doc) return res.status(200).json({ error: 'Data file not found.' });
      const keyData = (doc.users || []).find(u => u.key === key);
      if (!keyData) return res.status(200).json({ error: 'Key not found.' });
      return res.json({
        key: keyData.key,
        username: keyData.username,
        usageCount: keyData.usageCount,
        lifetime: keyData.lifetime,
        unix_expiration: keyData.unix_expiration,
        last_reset: keyData.last_reset
      });
    } catch (e) {
      console.error('get-key-info error:', e.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  });

  return router;
};
