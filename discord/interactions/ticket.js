const {
  mongo,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType,
  createNeutralEmbed
} = require('../helpers');

const FIELD_LIMIT = 5;

module.exports = async function handleTicket(interaction) {
  if (interaction.isCommand() && interaction.commandName === 'ticket') {
    const sub = interaction.options.getSubcommand(false);
    if (sub === 'panel') return handleCreatePanelCommand(interaction);
    if (sub === 'default') return handleQuickDefaultPanel(interaction);
    return false;
  }

  if (interaction.isButton() && (interaction.customId.startsWith('ticket_open|') || interaction.customId.startsWith('ticket_create|'))) {
    return handleOpenTicketButton(interaction);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket_select|')) {
    return handleTicketSelectMenu(interaction);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_submit|')) {
    return handleTicketModalSubmit(interaction);
  }

  if (interaction.isButton() && interaction.customId === 'ticket_close') {
    return handleCloseTicketButton(interaction);
  }

  return false;
};

async function handleCreatePanelCommand(interaction) {
  if (!interaction.guild) return interaction.reply({ content: 'Server only.', ephemeral: true });

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                  interaction.guild.ownerId === interaction.user.id ||
                  require('../helpers').isSuperUser(interaction.user.id);
  if (!isAdmin) return interaction.reply({ content: 'Administrator permission required.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const setupId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);


  const cats = [...interaction.guild.channels.cache.values()].filter(c => c.type === ChannelType.GuildCategory);
  if (!cats.length) return interaction.editReply({ content: 'Create a category first.' });

  await interaction.editReply({
    content: 'Select ticket **category**:',
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`cat|${setupId}`).addOptions(cats.slice(0,25).map(c => ({label: c.name, value: c.id})))
    )]
  });

  let catSel;
  try { catSel = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId === `cat|${setupId}`, time: 60000 }); } catch { return; }
  const categoryId = catSel.values[0];
  await catSel.deferUpdate().catch(() => {});

  const roleList = [...interaction.guild.roles.cache.values()].filter(r => !r.managed && r.id !== interaction.guild.id).slice(0, 23);
  const roleOpts = [{label: 'Admins only', value: 'none'}, ...roleList.map(r => ({label: r.name, value: r.id}))];

  await interaction.editReply({
    content: `Category selected. Choose support role:`,
    components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`role|${setupId}`).addOptions(roleOpts))]
  });

  let roleSel;
  try { roleSel = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId === `role|${setupId}`, time: 60000 }); } catch { return; }
  const supportRoleId = roleSel.values[0] === 'none' ? null : roleSel.values[0];
  await roleSel.deferUpdate().catch(() => {});

  let title = 'Support Tickets';
  let desc = 'Click a button below to open a ticket.';

  const tdRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`editmeta|${setupId}`).setLabel('Edit Title/Desc').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`keepmeta|${setupId}`).setLabel('Keep Defaults').setStyle(ButtonStyle.Secondary)
  );
  await interaction.editReply({ content: `**${title}**\n${desc}`, components: [tdRow] });

  let metaAct;
  try { metaAct = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`|${setupId}`), time: 60000 }); } catch { return; }

  if (metaAct.customId.includes('editmeta')) {
    const m = new ModalBuilder().setCustomId(`meta|${Date.now()}`).setTitle('Panel Text');
    m.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('t').setLabel('Title').setValue(title).setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('d').setLabel('Description').setValue(desc).setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    await metaAct.showModal(m);
    let mr; try { mr = await metaAct.awaitModalSubmit({ time: 90000 }); await mr.deferReply({ ephemeral: true }); } catch {}
    if (mr) {
      title = mr.fields.getTextInputValue('t').trim();
      desc = mr.fields.getTextInputValue('d').trim();
      await mr.editReply({ content: 'Saved.' }).catch(() => {});
    }
  } else {
    await metaAct.deferUpdate().catch(() => {});
  }

  const buttons = [];

  async function askFields(btnTitle) {
    const fs = [];


    const replyMsg = await interaction.fetchReply().catch(() => null);
    if (!replyMsg) return fs;

    while (fs.length < FIELD_LIMIT) {
      const preview = fs.length ? fs.map((f,i)=>`${i+1}. ${f.label}`).join('\n') : '_No questions yet_';
      const r = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`as|${setupId}`).setLabel('+ Short').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ap|${setupId}`).setLabel('+ Paragraph').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`rem|${setupId}`).setLabel('Remove').setStyle(ButtonStyle.Danger).setDisabled(!fs.length),
        new ButtonBuilder().setCustomId(`fdone|${setupId}`).setLabel('Done').setStyle(ButtonStyle.Success)
      );

      await interaction.editReply({ content: `**Questions for "${btnTitle}"**\n${preview}`, components: [r] }).catch(() => {});

      let c;
      try {
        c = await replyMsg.awaitMessageComponent({
          filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`|${setupId}`),
          time: 120000
        });
      } catch {
        return fs;
      }

      if (c.customId.includes('fdone')) {
        await c.deferUpdate().catch(() => {});
        break;
      }
      if (c.customId.includes('rem')) {
        fs.pop();
        await c.deferUpdate().catch(() => {});
        continue;
      }

      const isShort = c.customId.includes('as');
      const qm = new ModalBuilder().setCustomId(`q|${Date.now()}`).setTitle('Question');
      qm.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('l').setLabel('Label').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p').setLabel('Placeholder').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('req').setLabel('Required? (yes/no)').setValue('yes').setStyle(TextInputStyle.Short))
      );

      await c.showModal(qm);

      let qms;
      try {
        qms = await c.awaitModalSubmit({ time: 60000 });
        await qms.deferReply({ ephemeral: true });
      } catch {
        await interaction.editReply({ components: [r] }).catch(() => {});
        continue;
      }

      fs.push({
        customId: `f${fs.length+1}`,
        label: qms.fields.getTextInputValue('l').trim(),
        style: isShort ? TextInputStyle.Short : TextInputStyle.Paragraph,
        required: qms.fields.getTextInputValue('req').toLowerCase().startsWith('y'),
        placeholder: qms.fields.getTextInputValue('p')?.trim() || undefined
      });
      await qms.editReply({ content: 'Question added.' }).catch(() => {});
    }

    return fs.length ? fs : [{ customId: 'f1', label: 'Subject', style: TextInputStyle.Short, required: true }];
  }

  while (true) {
    const list = buttons.length ? buttons.map((b,i) => `${i+1}. ${b.emoji||''}**${b.label}** (${b.type}${b.scriptName ? ' • ' + b.scriptName : ''})`).join('\n') : '_No buttons yet_';

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`addsup|${setupId}`).setLabel('Add Support Button').setStyle(ButtonStyle.Primary).setEmoji('🛠️'),
      new ButtonBuilder().setCustomId(`addpur|${setupId}`).setLabel('Add Purchase Button').setStyle(ButtonStyle.Success).setEmoji('💰'),
      new ButtonBuilder().setCustomId(`remb|${setupId}`).setLabel('Remove Last').setStyle(ButtonStyle.Danger).setDisabled(!buttons.length),
      new ButtonBuilder().setCustomId(`post|${setupId}`).setLabel('Post Panel').setStyle(ButtonStyle.Secondary)
    );

    await interaction.editReply({ content: `**Buttons**\n${list}\n\nAdd Support or Purchase buttons. Each gets its own questions.`, components: [row] });

    let act;
    try { act = await interaction.channel.awaitMessageComponent({ filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`|${setupId}`), time: 300000 }); } catch { break; }

    if (act.customId.includes('post')) { await act.deferUpdate().catch(()=>{}); break; }
    if (act.customId.includes('remb')) { buttons.pop(); await act.deferUpdate().catch(()=>{}); continue; }

    if (act.customId.includes('addsup')) {
      const scripts = await mongo.listGuildScripts(interaction.guild.id);
      let scriptId = null, scriptName = null;
      let ss = null;

      if (scripts.length) {
        const sOpts = [{label: 'General / No script', value: 'none'}, ...scripts.slice(0,23).map(s=>({label:s.name, value:s.scriptId}))];
        await interaction.editReply({ content: 'Link to a script? (optional)', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ss|${setupId}`).addOptions(sOpts))] });
        try {
          ss = await interaction.channel.awaitMessageComponent({ filter: i=>i.user.id===interaction.user.id && i.customId===`ss|${setupId}`, time:45000 });
          if (ss.values[0] !== 'none') {
            scriptId = ss.values[0];
            scriptName = scripts.find(x => x.scriptId === scriptId)?.name;
          }
        } catch {}
      }

      const defLabel = scriptName ? `Support - ${scriptName}` : 'General Support';
      const lm = new ModalBuilder().setCustomId(`lab|${Date.now()}`).setTitle('Support Button');
      lm.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('l')
          .setLabel('Button Text')
          .setValue(defLabel)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ));

      const modalTarget = ss || act;
      await modalTarget.showModal(lm);

      let lmr; try { lmr = await interaction.awaitModalSubmit({ time: 60000 }); await lmr.deferReply({ ephemeral: true }); } catch { continue; }
      const lbl = lmr.fields.getTextInputValue('l').trim();
      const f = await askFields(lbl);
      buttons.push({ id: 'btn_'+Math.random().toString(36).slice(2,9), label: lbl, emoji: '🛠️', style: 'Primary', type: 'support', scriptId, scriptName, fields: f });
      await lmr.editReply({ content: 'Support button added.' }).catch(() => {});
    }

    if (act.customId.includes('addpur')) {
      const scripts = await mongo.listGuildScripts(interaction.guild.id);
      if (!scripts.length) {
        await interaction.editReply({ content: 'No scripts registered in this server yet.' });
        await new Promise(r => setTimeout(r, 1400));
        continue;
      }

      const pOpts = scripts.slice(0, 24).map(s => ({ label: s.name, value: s.scriptId }));
      await interaction.editReply({ content: 'Select the script this purchase button is for:', components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ps|${setupId}`).addOptions(pOpts))] });

      let ps;
      try { 
        ps = await interaction.channel.awaitMessageComponent({ filter: i=>i.user.id===interaction.user.id && i.customId===`ps|${setupId}`, time:60000 }); 
      } catch { continue; }

      const sc = scripts.find(s => s.scriptId === ps.values[0]);
      const sName = sc?.name || 'Script';

      const pm = new ModalBuilder().setCustomId(`pl|${Date.now()}`).setTitle('Purchase Button');
      pm.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('l')
          .setLabel('Button Text')
          .setValue(`Purchase - ${sName}`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ));
      await ps.showModal(pm);   

      let pmr; try { pmr = await interaction.awaitModalSubmit({ time: 60000 }); await pmr.deferReply({ ephemeral: true }); } catch { continue; }
      const pLabel = pmr.fields.getTextInputValue('l').trim();
      const pFields = await askFields(pLabel);

      buttons.push({
        id: 'btn_'+Math.random().toString(36).slice(2,9),
        label: pLabel, emoji: '💰', style: 'Success',
        type: 'purchase', scriptId: ps.values[0], scriptName: sName, fields: pFields
      });
      await pmr.editReply({ content: `Purchase button for **${sName}** added!` }).catch(() => {});
    }
  }

  if (!buttons.length) return interaction.editReply({ content: 'Need at least one button.' });

  const deleteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`autodel_yes|${setupId}`).setLabel('Yes - Auto delete channels').setStyle(ButtonStyle.Success).setEmoji('🗑️'),
    new ButtonBuilder().setCustomId(`autodel_no|${setupId}`).setLabel('No - Keep channels (locked)').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    content: `**Final setting**\nWhen a ticket is closed, should the channel be **automatically deleted** after ~25 seconds?\n\n(This is recommended to keep your server clean.)`,
    components: [deleteRow]
  });

  let delChoice;
  try {
    delChoice = await interaction.channel.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId.endsWith(`|${setupId}`) && (i.customId.includes('autodel_yes') || i.customId.includes('autodel_no')),
      time: 60000
    });
    await delChoice.deferUpdate().catch(() => {});
  } catch {
    // 
  }

  const autoDeleteOnClose = !delChoice || delChoice.customId.includes('autodel_yes');

  const panelMsg = await postTicketPanelWithDropdown(interaction.channel, title, desc, buttons);

  await mongo.createTicketPanel({
    guildId: interaction.guild.id,
    messageId: panelMsg.id,
    channelId: interaction.channel.id,
    categoryId,
    supportRoleId,
    title,
    description: desc,
    buttons,
    autoDeleteOnClose,
    createdBy: interaction.user.id
  });

  const deleteNote = autoDeleteOnClose 
    ? 'Channels will be auto-deleted ~25s after closing.'
    : 'Closed channels will be kept (renamed + locked).';

  await interaction.editReply({ content: `✅ Panel posted with a dropdown menu.\n${deleteNote}` });
  return true;
}

async function postTicketPanelWithDropdown(channel, title, description, buttons) {
  const embed = createNeutralEmbed(title, description).setFooter({ text: 'app.yourdomain.com' });
  const msg = await channel.send({ embeds: [embed] });

  if (!buttons || buttons.length === 0) return msg;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`ticket_select|${msg.id}`)
    .setPlaceholder('Select what you need...')
    .addOptions(
      buttons.map(b => ({
        label: b.label,
        value: b.id,
        emoji: b.emoji || undefined,
        description: b.type === 'purchase' ? 'Purchase this script' : undefined
      }))
    );

  const row = new ActionRowBuilder().addComponents(select);
  await msg.edit({ components: [row] });
  return msg;
}

async function handleQuickDefaultPanel(interaction) {
  if (!interaction.guild) {
    return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  }

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                  interaction.guild.ownerId === interaction.user.id ||
                  isSuperUser(interaction.user.id);

  if (!isAdmin) {
    return interaction.reply({ content: 'You need Administrator permission to use this.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  const setupId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const scripts = await mongo.listGuildScripts(interaction.guild.id);
  if (!scripts.length) {
    return interaction.editReply({ content: 'You don\'t have any scripts registered yet. Use the web panel to create one first.' });
  }

  const scriptOptions = scripts.slice(0, 25).map(s => ({
    label: s.name,
    value: s.scriptId
  }));

  await interaction.editReply({
    content: 'Select the **script** you want to create a quick panel for:',
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`qd_script|${setupId}`)
        .setPlaceholder('Choose a script...')
        .addOptions(scriptOptions)
    )]
  });

  let scriptSel;
  try {
    scriptSel = await interaction.channel.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId === `qd_script|${setupId}`,
      time: 60000
    });
    await scriptSel.deferUpdate().catch(() => {});
  } catch {
    return interaction.editReply({ content: 'Timed out.' });
  }

  const scriptId = scriptSel.values[0];
  const script = scripts.find(s => s.scriptId === scriptId);
  const scriptName = script?.name || 'Script';

  const categories = [...interaction.guild.channels.cache.values()]
    .filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);

  if (!categories.length) {
    return interaction.editReply({ content: 'You need at least one category in the server first.' });
  }

  const catOptions = categories.slice(0, 25).map(c => ({ label: c.name, value: c.id }));

  await interaction.editReply({
    content: `Script: **${scriptName}**\nNow select the **category** where tickets for this script should be created:`,
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`qd_cat|${setupId}`).addOptions(catOptions)
    )]
  });

  let catSel;
  try {
    catSel = await interaction.channel.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId === `qd_cat|${setupId}`,
      time: 60000
    });
    await catSel.deferUpdate().catch(() => {});
  } catch {
    return interaction.editReply({ content: 'Timed out.' });
  }

  const categoryId = catSel.values[0];

  const roles = [...interaction.guild.roles.cache.values()]
    .filter(r => !r.managed && r.id !== interaction.guild.id)
    .sort((a, b) => b.position - a.position)
    .slice(0, 23);

  const roleOptions = [
    { label: 'No specific support role (Admins only)', value: 'none' },
    ...roles.map(r => ({ label: r.name, value: r.id }))
  ];

  await interaction.editReply({
    content: `Category selected.\nOptional: Choose a **support role** that can see these tickets:`,
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`qd_role|${setupId}`).addOptions(roleOptions)
    )]
  });

  let roleSel;
  try {
    roleSel = await interaction.channel.awaitMessageComponent({
      filter: i => i.user.id === interaction.user.id && i.customId === `qd_role|${setupId}`,
      time: 60000
    });
    await roleSel.deferUpdate().catch(() => {});
  } catch {
    return interaction.editReply({ content: 'Timed out.' });
  }

  const supportRoleId = roleSel.values[0] === 'none' ? null : roleSel.values[0];

  const purchaseFields = [
    { customId: 'f1', label: 'What plan/package are you interested in?', style: TextInputStyle.Short, required: true, placeholder: 'e.g. Lifetime, Monthly, etc.' },
    { customId: 'f2', label: 'How many keys do you need?', style: TextInputStyle.Short, required: true },
    { customId: 'f3', label: 'Any questions before purchasing?', style: TextInputStyle.Paragraph, required: false }
  ];

  const supportFields = [
    { customId: 'f1', label: 'What issue are you having?', style: TextInputStyle.Short, required: true },
    { customId: 'f2', label: 'Please describe the problem in detail', style: TextInputStyle.Paragraph, required: true }
  ];

  const buttons = [
    {
      id: 'btn_' + Math.random().toString(36).slice(2, 10),
      label: `Purchase - ${scriptName}`,
      emoji: '💰',
      style: 'Success',
      type: 'purchase',
      scriptId,
      scriptName,
      fields: purchaseFields
    },
    {
      id: 'btn_' + Math.random().toString(36).slice(2, 10),
      label: `Support - ${scriptName}`,
      emoji: '🛠️',
      style: 'Primary',
      type: 'support',
      scriptId,
      scriptName,
      fields: supportFields
    }
  ];

  const panelTitle = 'Open a ticket';
  const panelDesc = `Need help with **${scriptName}** or want to purchase?`;

  const panelMsg = await postTicketPanelWithDropdown(interaction.channel, panelTitle, panelDesc, buttons);

  await mongo.createTicketPanel({
    guildId: interaction.guild.id,
    messageId: panelMsg.id,
    channelId: interaction.channel.id,
    categoryId,
    supportRoleId,
    title: panelTitle,
    description: panelDesc,
    buttons,
    autoDeleteOnClose: true,
    createdBy: interaction.user.id
  });

  await interaction.editReply({
    content: `✅ Quick panel created for **${scriptName}**!\nPosted with a dropdown menu containing Purchase and Support options.`,
    components: []
  });

  return true;
}

async function handleOpenTicketButton(interaction) {
  const parts = interaction.customId.split('|');
  const panelMessageId = parts[1];
  const buttonId = parts[2] || 'btn_legacy';
  return handleTicketOption(interaction, panelMessageId, buttonId);
}

async function handleTicketSelectMenu(interaction) {
  const parts = interaction.customId.split('|');
  const panelMessageId = parts[1];
  const buttonId = interaction.values?.[0];
  if (!buttonId) {
    return interaction.reply({ content: 'Invalid selection.', ephemeral: true });
  }
  return handleTicketOption(interaction, panelMessageId, buttonId);
}

async function handleTicketOption(interaction, panelMessageId, buttonId) {
  const panel = await mongo.getTicketPanelByMessage(panelMessageId);
  if (!panel) return interaction.reply({ content: 'This panel no longer exists.', ephemeral: true });

  let button = panel.buttons?.find(b => b.id === buttonId);
  if (!button && panel.buttons?.length) button = panel.buttons[0];
  if (!button) button = { type: 'support', fields: panel.fields || [], label: 'Ticket' }; 

  const existing = await mongo.getOpenTicketForUser(interaction.guild.id, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: `You already have an open ticket: <#${existing.channelId}>`, ephemeral: true });
  }

  const modal = new ModalBuilder().setCustomId(`ticket_submit|${panelMessageId}|${buttonId}`).setTitle(button.label || 'Ticket');

  const comps = (button.fields || []).slice(0, 5).map(f => {
    const inp = new TextInputBuilder()
      .setCustomId(f.customId)
      .setLabel(f.label)
      .setStyle(f.style || TextInputStyle.Short)
      .setRequired(!!f.required);
    if (f.placeholder) inp.setPlaceholder(f.placeholder);
    return new ActionRowBuilder().addComponents(inp);
  });

  if (!comps.length) {
    comps.push(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('subject').setLabel('Subject').setStyle(TextInputStyle.Short).setRequired(true)
    ));
  }

  modal.addComponents(...comps);
  await interaction.showModal(modal);
  return true;
}

async function handleTicketModalSubmit(interaction) {
  const parts = interaction.customId.split('|');
  const panelMessageId = parts[1];
  const buttonId = parts[2] || 'btn_legacy';

  const panel = await mongo.getTicketPanelByMessage(panelMessageId);
  if (!panel) return interaction.reply({ content: 'Panel gone.', ephemeral: true });

  let button = panel.buttons?.find(b => b.id === buttonId) || panel.buttons?.[0];
  if (!button) button = { type: 'support', label: 'Ticket', scriptId: null, scriptName: null };

  const existing = await mongo.getOpenTicketForUser(interaction.guild.id, interaction.user.id);
  if (existing) return interaction.reply({ content: `Already have open ticket: <#${existing.channelId}>`, ephemeral: true });

  await interaction.deferReply({ ephemeral: true });

  const category = interaction.guild.channels.cache.get(panel.categoryId);
  if (!category) return interaction.editReply({ content: 'Configured category no longer exists.' });

  const ticketNumber = await mongo.getNextTicketNumber(interaction.guild.id);
  const safe = (interaction.user.username || 'user').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  const chName = `${button.type === 'purchase' ? 'purchase' : 'ticket'}-${String(ticketNumber).padStart(4,'0')}-${safe}`;

  const overwrites = [
    { id: interaction.guild.id, type: 0, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.client.user.id, type: 1, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
  ];
  if (panel.supportRoleId) {
    if (interaction.guild.roles.cache.has(panel.supportRoleId)) {
      overwrites.push({ id: panel.supportRoleId, type: 0, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    } else {
      console.warn(`[tickets] Panel ${panelMessageId} references deleted/missing support role ${panel.supportRoleId} in guild ${interaction.guild.id}`);
    }
  }

  let ticketChannel;
  try {
    ticketChannel = await interaction.guild.channels.create({
      name: chName,
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason: `${button.type} ticket #${ticketNumber} by ${interaction.user.tag}`
    });
  } catch (createErr) {
    console.error('Ticket channel create failed:', createErr);
    return interaction.editReply({ content: 'Failed to create the ticket channel (permissions/role issue or Discord error). Please contact an admin.' }).catch(() => {});
  }

  try {
      const responses = {};
    (button.fields || []).forEach(f => {
      try { responses[f.label] = interaction.fields.getTextInputValue(f.customId); } catch {}
    });

    await mongo.createTicket({
      guildId: interaction.guild.id,
      channelId: ticketChannel.id,
      userId: interaction.user.id,
      username: interaction.user.username,
      panelMessageId,
      buttonId,
      buttonType: button.type,
      buttonLabel: button.label,
      scriptId: button.scriptId,
      scriptName: button.scriptName,
      ticketNumber,
      responses
    });

    const info = Object.entries(responses).map(([k,v]) => `**${k}**\n${v}`).join('\n\n') || 'No details';

    const header = button.type === 'purchase'
      ? `Purchase Inquiry — **${button.scriptName || 'Script'}**`
      : (button.scriptName ? `Support — **${button.scriptName}**` : 'Support Ticket');

    const embed = createNeutralEmbed(`Ticket #${String(ticketNumber).padStart(4,'0')} — ${header}`, `Opened by <@${interaction.user.id}>`)
      .addFields({ name: 'Details', value: info });

    if (button.scriptId) {
      try {
        const scriptDoc = await mongo.getServerScript(interaction.guild.id, button.scriptId);
        if (scriptDoc?.logo) {
          embed.setThumbnail(scriptDoc.logo);
        }
      } catch (e) {
        console.error('Failed to load script logo for ticket embed:', e.message);
      }
    }

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
    );

    const mention = panel.supportRoleId ? `<@&${panel.supportRoleId}> ` : '';
    await ticketChannel.send({ content: `<@${interaction.user.id}> ${mention}`.trim(), embeds: [embed], components: [closeRow] });

    await interaction.editReply({ content: `✅ Ticket created: ${ticketChannel}` });
  } catch (err) {
    console.error('Failed during ticket finalization (DB/send):', err);
    try {
      await interaction.editReply({ content: 'Ticket channel created but setup failed. Staff have been notified via logs.' });
    } catch {}
  }
  return true;
}

async function handleCloseTicketButton(interaction) {
  if (!interaction.channel?.guild) return false;

  const ticket = await mongo.getTicketByChannel(interaction.channel.id);
  if (!ticket || ticket.status !== 'open') return interaction.reply({ content: 'Not an active ticket.', ephemeral: true });

  const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || interaction.guild.ownerId === interaction.user.id || require('../helpers').isSuperUser(interaction.user.id);
  const hasSupport = ticket.panelMessageId && (await mongo.getTicketPanelByMessage(ticket.panelMessageId))?.supportRoleId &&
                     interaction.member.roles.cache.has((await mongo.getTicketPanelByMessage(ticket.panelMessageId)).supportRoleId);

  if (!isAdmin && !hasSupport) return interaction.reply({ content: 'Only staff can close tickets.', ephemeral: true });

  await interaction.deferReply();

  try { await interaction.channel.permissionOverwrites.delete(ticket.userId).catch(() => {}); } catch {}
  try { await interaction.channel.setName(`closed-${String(ticket.ticketNumber).padStart(4,'0')}`); } catch {}

  await mongo.closeTicket(interaction.channel.id, interaction.user.id);

  const closedEmbed = createNeutralEmbed('Ticket Closed', `Closed by <@${interaction.user.id}>`);

  if (ticket.scriptId) {
    try {
      const scriptDoc = await mongo.getServerScript(interaction.guild.id, ticket.scriptId);
      if (scriptDoc?.logo) closedEmbed.setThumbnail(scriptDoc.logo);
    } catch {}
  }
  const disabled = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ticket_close').setLabel('Closed').setStyle(ButtonStyle.Secondary).setDisabled(true));

  await interaction.message.edit({ components: [disabled] }).catch(() => {});
  await interaction.editReply({ embeds: [closedEmbed] });

  const panelForClose = ticket.panelMessageId ? await mongo.getTicketPanelByMessage(ticket.panelMessageId) : null;
  const shouldAutoDelete = panelForClose?.autoDeleteOnClose !== false;

  if (shouldAutoDelete) {
    setTimeout(() => { interaction.channel?.delete().catch(() => {}); }, 25000);
  } else {
    try { await interaction.channel.permissionOverwrites.delete(ticket.userId).catch(() => {}); } catch {}
  }

  return true;
}
