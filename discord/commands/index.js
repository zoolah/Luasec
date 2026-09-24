module.exports = [
  require('./panel'),
  require('./ticket'),
  require('./whitelist'),
  require('./blacklist'),
  require('./unblacklist'),
  require('./revokekey'),
  require('./scripts'),
].filter(Boolean);
