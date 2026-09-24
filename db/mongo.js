const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const path = require('path');

let client;
let db;

async function connect() {
  if (db) return db;
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI env var not set');
  client = new MongoClient(uri, { maxPoolSize: 10 });
  await client.connect();
  db = client.db(process.env.MONGO_DB);
  await ensureIndexes();
  return db;
}

async function ensureIndexes() {
  const d = db;
  await Promise.all([
    d.collection('servers').createIndex({ guildId:1, scriptId:1 }, { unique:true }),
    d.collection('globalUsers').createIndex({ discordId:1 }, { unique:true }),
    d.collection('ticketPanels').createIndex({ guildId:1 }),
    d.collection('ticketPanels').createIndex({ messageId:1 }, { unique:true }),
    d.collection('tickets').createIndex({ guildId:1, channelId:1 }, { unique:true }),
    d.collection('tickets').createIndex({ guildId:1, userId:1, status:1 }),
  ]);
}

function serverFilter(guildId, scriptId){ return { guildId: String(guildId), scriptId: String(scriptId) }; }

async function getServerScript(guildId, scriptId) {
  await connect();
  return db.collection('servers').findOne(serverFilter(guildId, scriptId));
}

async function upsertServerScript(data) {
  await connect();
  const filter = serverFilter(data.guildId, data.scriptId);
  const update = { $set: data };
  await db.collection('servers').updateOne(filter, update, { upsert: true });
  return getServerScript(data.guildId, data.scriptId);
}

async function pushKey(guildId, scriptId, keyObj) {
  await connect();
  await db.collection('servers').updateOne(serverFilter(guildId, scriptId), { $push: { keys: keyObj } });
}

async function popKey(guildId, scriptId, keyStr) {
  await connect();
  return db.collection('servers').findOneAndUpdate(serverFilter(guildId, scriptId), { $pull: { keys: { key: keyStr } } }, { returnDocument:'before' });
}

async function addUserToScript(guildId, scriptId, userObj) {
  await connect();
  await db.collection('servers').updateOne(serverFilter(guildId, scriptId), { $push: { users: userObj } });
}

async function updateUsersArray(guildId, scriptId, usersArr){
  await connect();
  await db.collection('servers').updateOne(serverFilter(guildId, scriptId), { $set: { users: usersArr } });
}

async function updateScriptFields(guildId, scriptId, fields){
  await connect();
  await db.collection('servers').updateOne(serverFilter(guildId, scriptId), { $set: fields });
}

async function listGuildScripts(guildId){
  await connect();
  return db.collection('servers').find({ guildId: String(guildId) }).toArray();
}

async function findUserScripts(userId){
  await connect();
  return db.collection('servers').find({ 'users.userId': String(userId), placeholder: { $ne: true } }).toArray();
}

async function deleteServerScript(guildId, scriptId){
  await connect();
  await db.collection('servers').deleteOne(serverFilter(guildId, scriptId));
}

async function getOrCreateGlobalUser(discordId){
  await connect();
  const col = db.collection('globalUsers');
  const existing = await col.findOne({ discordId });
  if (existing) return existing;
  const doc = { discordId, discordUsername:'', approved:false, plan:'free' };
  await col.insertOne(doc);
  return doc;
}
async function updateGlobalUser(discordId, fields){
  await connect();
  await db.collection('globalUsers').updateOne({ discordId }, { $set: fields });
}
async function listApprovedGlobalUsers(){
  await connect();
  return db.collection('globalUsers').find({ approved:true }).toArray();
}

async function getGlobalBlacklist(){
  await connect();
  const col = db.collection('globalBlacklists');
  let doc = await col.findOne({ _id:'global' });
  if(!doc){ doc = { _id:'global', ips:[], hwids:[] }; await col.insertOne(doc); }
  return doc;
}
async function addGlobalIP(ip){
  await connect();
  await db.collection('globalBlacklists').updateOne({ _id:'global' }, { $addToSet: { ips: ip } }, { upsert:true });
}
async function addGlobalHWID(hwid){
  await connect();
  await db.collection('globalBlacklists').updateOne({ _id:'global' }, { $addToSet: { hwids: hwid } }, { upsert:true });
}
async function isIPBlacklisted(ip){
  const doc = await getGlobalBlacklist();
  return doc.ips.includes(ip);
}
async function isHWIDBlacklisted(hwid){
  const doc = await getGlobalBlacklist();
  return doc.hwids.includes(hwid);
}
async function removeGlobalIP(ip){
  await connect();
  await db.collection('globalBlacklists').updateOne({ _id:'global' }, { $pull: { ips: ip } }, { upsert:true });
}
async function removeGlobalHWID(hwid){
  await connect();
  await db.collection('globalBlacklists').updateOne({ _id:'global' }, { $pull: { hwids: hwid } }, { upsert:true });
}


async function ensureGuild(guildId){
  await connect();
  const existing = await db.collection('servers').findOne({ guildId: String(guildId) });
  if (existing) return false; 
  const placeholder = {
    guildId: String(guildId),
    scriptId: [...crypto.randomBytes(4)].map(b => b.toString(16).padStart(2,'0')).join(''),
    name: 'Placeholder Script',
    keys: [],
    users: [],
    blacklist: [],
    executions: {},
    hwid_reset_timeout_in_hours: 24,
    freemium: false,
    dmOnExec: false,
    createdAt: Date.now(),
    placeholder: true
  };
  await db.collection('servers').insertOne(placeholder);
  return true;
}


async function createTicketPanel(data) {
  await connect();

  let buttons = [];
  if (Array.isArray(data.buttons) && data.buttons.length > 0) {
    buttons = data.buttons.map(b => ({
      id: b.id || ('btn_' + Math.random().toString(36).slice(2, 10)),
      label: b.label || 'Support',
      emoji: b.emoji || null,
      style: b.style || 'Primary',
      type: b.type || 'support',          
      scriptId: b.scriptId ? String(b.scriptId) : null,
      scriptName: b.scriptName || null,
      fields: Array.isArray(b.fields) ? b.fields : []
    }));
  } else if (Array.isArray(data.fields) && data.fields.length > 0) {
    buttons = [{
      id: 'btn_legacy',
      label: 'Create Ticket',
      emoji: null,
      style: 'Primary',
      type: 'support',
      scriptId: null,
      scriptName: null,
      fields: data.fields
    }];
  }

  const doc = {
    guildId: String(data.guildId),
    messageId: String(data.messageId),
    channelId: String(data.channelId),
    categoryId: data.categoryId ? String(data.categoryId) : null,
    supportRoleId: data.supportRoleId ? String(data.supportRoleId) : null,
    title: data.title || 'Support Tickets',
    description: data.description || 'Click a button below to open a ticket.',
    buttons,
    autoDeleteOnClose: data.autoDeleteOnClose !== false, // default true
    createdBy: String(data.createdBy),
    createdAt: Date.now()
  };

  await db.collection('ticketPanels').insertOne(doc);
  return doc;
}

async function getTicketPanelByMessage(messageId) {
  await connect();
  const raw = await db.collection('ticketPanels').findOne({ messageId: String(messageId) });
  if (!raw) return null;
  return normalizeTicketPanel(raw);
}

function normalizeTicketPanel(raw) {
  if (!raw) return null;

  let buttons = [];

  if (Array.isArray(raw.buttons) && raw.buttons.length > 0) {
    buttons = raw.buttons;
  } else if (Array.isArray(raw.fields) && raw.fields.length > 0) {
    buttons = [{
      id: 'btn_legacy',
      label: raw.title || 'Create Ticket',
      emoji: null,
      style: 'Primary',
      type: 'support',
      scriptId: null,
      scriptName: null,
      fields: raw.fields
    }];
  }

  return {
    ...raw,
    buttons,
    autoDeleteOnClose: raw.autoDeleteOnClose !== false 
  };
}

async function getTicketPanelsForGuild(guildId) {
  await connect();
  return db.collection('ticketPanels').find({ guildId: String(guildId) }).toArray();
}

async function deleteTicketPanel(messageId) {
  await connect();
  await db.collection('ticketPanels').deleteOne({ messageId: String(messageId) });
}

async function createTicket(data) {
  await connect();
  const doc = {
    guildId: String(data.guildId),
    channelId: String(data.channelId),
    userId: String(data.userId),
    username: data.username || 'unknown',
    panelMessageId: data.panelMessageId ? String(data.panelMessageId) : null,
    buttonId: data.buttonId || null,
    buttonType: data.buttonType || 'support',
    buttonLabel: data.buttonLabel || null,
    scriptId: data.scriptId || null,
    scriptName: data.scriptName || null,
    ticketNumber: Number(data.ticketNumber) || 1,
    status: 'open',
    responses: data.responses || {},
    createdAt: Date.now(),
    closedAt: null,
    closedBy: null
  };
  await db.collection('tickets').insertOne(doc);
  return doc;
}

async function getTicketByChannel(channelId) {
  await connect();
  return db.collection('tickets').findOne({ channelId: String(channelId) });
}

async function getOpenTicketForUser(guildId, userId) {
  await connect();
  return db.collection('tickets').findOne({
    guildId: String(guildId),
    userId: String(userId),
    status: 'open'
  });
}

async function closeTicket(channelId, closedById) {
  await connect();
  const result = await db.collection('tickets').findOneAndUpdate(
    { channelId: String(channelId), status: 'open' },
    { $set: { status: 'closed', closedAt: Date.now(), closedBy: String(closedById) } },
    { returnDocument: 'after' }
  );
  return result;
}

async function getNextTicketNumber(guildId) {
  await connect();
  const count = await db.collection('tickets').countDocuments({ guildId: String(guildId) });
  return count + 1;
}

module.exports = {
  connect,
  getServerScript,
  upsertServerScript,
  pushKey,
  popKey,
  addUserToScript,
  updateUsersArray,
  updateScriptFields,
  listGuildScripts,
  findUserScripts,
  deleteServerScript,
  getOrCreateGlobalUser,
  updateGlobalUser,
  listApprovedGlobalUsers,
  getGlobalBlacklist,
  addGlobalIP,
  addGlobalHWID,
  removeGlobalIP,
  removeGlobalHWID,
  isIPBlacklisted,
  isHWIDBlacklisted,

  ensureGuild,

  // Ticket system
  createTicketPanel,
  getTicketPanelByMessage,
  getTicketPanelsForGuild,
  deleteTicketPanel,
  createTicket,
  getTicketByChannel,
  getOpenTicketForUser,
  closeTicket,
  getNextTicketNumber,
  normalizeTicketPanel
};
