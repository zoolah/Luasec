const { REST, Routes } = require('discord.js');
const commands = require('./discord/commands');
const interactionHandlers = require('./discord/interactions');
const { cache: lootlabsCache } = require('./discord/lootlabs');

async function registerSlashCommands(token, clientId) {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Registered ${commands.length} application (/) commands.`);
}

function wireInteractionHandlers(client) {
  client.on('interactionCreate', async (interaction) => {
    for (const handler of interactionHandlers) {
      const handled = await handler(interaction);
      if (handled) break;
    }
  });
}

module.exports = {
  lootlabsCache,
  async initializeBot(client) {
    const token = process.env.TOKEN;
    const clientId = process.env.CLIENT_ID;
    if (!token || !clientId) throw new Error('Missing TOKEN or CLIENT_ID environment variables.');

    await registerSlashCommands(token, clientId);
    wireInteractionHandlers(client);

  client.once('ready', () => console.log(`Discord bot ready as ${client.user.tag}`));
    await client.login(token);
  }
};
