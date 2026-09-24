const axios = require('axios');
const lootlabs_api_key = process.env.LOOTLABS_API_KEY || 'missing_api_key';
const cache = {};
async function createFreemiumFlow(settings, shortCode) {
  const redirectUrl = `https://api.yourdomain.com/freemium?code=${shortCode}`;
  const { data: { message: encrypted } } = await axios.post('https://be.lootlabs.gg/api/lootlabs/url_encryptor', { destination_url: redirectUrl }, { headers: { Authorization: `Bearer ${lootlabs_api_key}` } });
  const { data: { message: [{ loot_url }] } } = await axios.post('https://be.lootlabs.gg/api/lootlabs/content_locker', { title: `${settings.name} Freemium`, url: 'google.com', tier_id: 1, number_of_tasks: 3, theme: 5 }, { headers: { Authorization: `Bearer ${lootlabs_api_key}` } });
  return { loot_url, encrypted };
}
module.exports = { cache, createFreemiumFlow };
