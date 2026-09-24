module.exports = {
  name: 'blacklist',
  description: 'Blacklist a user from a script (duration in days)',
  options: [
    { name: 'duration', type: 4, description: 'Duration in days', required: true },
    { name: 'user', type: 6, description: 'User to blacklist', required: true }
  ]
};
