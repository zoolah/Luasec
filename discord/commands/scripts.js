module.exports = {
  name: 'scripts',
  description: "List script for a user! If user field is left blank, it'll default to your own.",
  options: [
    { name: 'user', type: 6, description: 'User to get scripts for', required: false }
  ]
};
