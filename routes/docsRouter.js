const express = require('express');
const path = require('path');

module.exports = function createDocsRouter() {
  const router = express.Router();
  router.get('/', (req, res) => {
    res.send("Under construction");
    res.sendFile(path.join(__dirname, '..', 'frontend', 'docs.html'));
  });
  return router;
};
