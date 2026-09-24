const express = require('express');
const path = require('path');
const fs = require('fs');
const UAParser = require('ua-parser-js');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = function createCdnRouter() {
  const router = express.Router();

  router.use((req, res, next) => {
    // const gameId = req.headers['roblox-game-id'];
    // if (!gameId || !UUID_REGEX.test(gameId)) return res.status(403).send('Forbidden');

    const { name: browserName, version: browserVersion } = new UAParser(req.headers['user-agent'] || '').getResult().browser;
    if (browserName && browserVersion) return res.status(403).send('Forbidden');

    next();
  });

  router.get('/:file', (req, res) => {
    const filePath = path.join(__dirname, '..', 'cdn', req.params.file);
    res.sendFile(filePath, err => {
      if (err) {
        console.error('Error sending file:', err.message);
        if (err.code === 'ENOENT') return res.status(404).send('File not found');
        return res.status(500).send('Internal server error');
      }
    });
  });
  router.get('/', (req, res) => res.send('Nothing to see here! GET /filename to retrieve a file'));
  return router;
};
