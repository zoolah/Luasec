module.exports = {
  name: 'whitelist',
  description: 'Whitelist a user for a script (duration in days)',
  options: [
    { name: 'duration', type: 4, description: 'Duration in days (0 = lifetime)', required: true },
    { name: 'user', type: 6, description: 'User to generate key for', required: true }
  ]
};
