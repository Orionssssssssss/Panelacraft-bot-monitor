require('dotenv').config();
const fs = require('fs');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits
} = require('discord.js');
const util = require('minecraft-server-util');
const { Rcon } = require('rcon-client');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Ficheiro de persistência de dados
const COORDS_FILE = './coords.json';

function loadCoords() {
    if (!fs.existsSync(COORDS_FILE)) {
        fs.writeFileSync(COORDS_FILE, JSON.stringify([]));
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function saveCoords(coords) {
    fs.writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2));
}

// Busca flexível: aceita espaços, sublinhados (_) e maiúsculas/minúsculas
function findCoordIndex(coords, search) {
    if (!search) return -1;
    const clean = search.toLowerCase().trim();
    const cleanSlug = clean.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

    return coords.findIndex(c => {
        const nameLower = (c.name || '').toLowerCase().trim();
        const warpLower = (c.warpName || '').toLowerCase().trim();
        const nameSlug = nameLower.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');

        return nameLower === clean ||
               warpLower === clean ||
               nameSlug === cleanSlug ||
               warpLower === cleanSlug;
    });
}

// Envio de comandos via RCON
async function sendRconCommand(command) {
    try {
        const rcon = await Rcon.connect({
            host: process.env.RCON_HOST,
            port: parseInt(process.env.RCON_PORT || '25575'),
            password: process.env.RCON_PASSWORD,
            timeout: 5000
        });
        const response = await rcon.send(command);
        await rcon.end();
        return { success: true, response };
    } catch (error) {
        console.error('Erro no RCON:', error.message);
        return { success: false, error: error.message };
    }
}

// Atualização automática do Status do Servidor
async function updateStatusEmbed() {
    try {
        const channel = await client.channels.fetch(process.env.STATUS_CHANNEL_ID);
        if (!channel) return;

        let serverStatus;
        let ping = 0;
        const startTime = Date.now();

        try {
            serverStatus = await util.status(process.env.MC_HOST, parseInt(process.env.MC_PORT || '25565'), { timeout: 5000 });
            ping = serverStatus.roundTripLatency || (Date.now() - startTime);
        } catch (e) {
            serverStatus = null;
        }

        const embed = new EmbedBuilder().setTimestamp();

        if (serverStatus) {
            const online = serverStatus.players.online;
            const max = serverStatus.players.max;

            // Criação da barra visual de quadradinhos
            const totalBlocks = 10;
            const filledBlocks = max > 0 ? Math.round((online / max) * totalBlocks) : 0;
            const progressBar = '🟩'.repeat(filledBlocks) + '⬛'.repeat(totalBlocks - filledBlocks);

            // Lista de jogadores online (se disponível)
            let playersText = `\`${online} / ${max}\`\n${progressBar}`;
            if (serverStatus.players.sample && serverStatus.players.sample.length > 0) {
                const names = serverStatus.players.sample.map(p => p.name).join(', ');
                playersText += `\n**Online:** \`${names}\``;
            }

            embed.setTitle('🎮 PanelaCraft — Status do Servidor')
                .setColor(0x57F287) // Verde vibrante do Discord
                .addFields(
                    { name: '🟢 Estado', value: '`ONLINE`', inline: true },
                    { name: '👥 Jogadores', value: playersText, inline: true },
                    { name: '⚡ Ping', value: `\`${ping} ms\``, inline: true },
                    { name: '📌 Versão', value: `\`${serverStatus.version.name}\``, inline: true },
                    { name: '🌐 IP do Servidor', value: `\`${process.env.MC_HOST}:${process.env.MC_PORT}\``, inline: false }
                );
        } else {
            embed.setTitle('🎮 PanelaCraft — Status do Servidor')
                .setColor(0xED4245) // Vermelho vibrante
                .addFields(
                    { name: '🔴 Estado', value: '`OFFLINE`', inline: true },
                    { name: '🌐 IP do Servidor', value: `\`${process.env.MC_HOST}:${process.env.MC_PORT}\``, inline: true }
                );
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_refresh_status').setLabel('Atualizar Status').setStyle(ButtonStyle.Secondary).setEmoji('🔄')
        );

        const messages = await channel.messages.fetch({ limit: 10 });
        const lastMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Status do Servidor'));

        if (lastMsg) {
            await lastMsg.edit({ embeds: [embed], components: [row] });
        } else {
            await channel.send({ embeds: [embed], components: [row] });
        }
    } catch (err) {
        console.error('Erro ao atualizar status:', err.message);
    }
}

// Criar / Atualizar Painel Fixo de Coordenadas
async function initOrUpdateCoordsPanel(client) {
    try {
        const channel = await client.channels.fetch(process.env.COORDS_CHANNEL_ID);
        if (!channel) return;

        const coords = loadCoords();
        const embed = new EmbedBuilder()
            .setTitle('🗺️ Painel de Coordenadas e Warps')
            .setColor(0x5865F2)
            .setTimestamp();

        if (coords.length === 0) {
            embed.setDescription('Nenhuma coordenada registada até ao momento.\nClique no botão abaixo para adicionar a primeira!');
        } else {
            let description = '';
            coords.forEach((c, index) => {
                description += `**${index + 1}. ${c.name}**\n`;
                description += `➔ \`X: ${c.x} | Y: ${c.y} \vert{} Z:${c.z}\` (${c.dimension})\n`;
                description += `└ Criado por: <@${c.authorId}>\n\n`;
            });
            embed.setDescription(description);
            embed.setFooter({ text: `Total de locais: ${coords.length} | Clique nos botões abaixo para interagir` });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_coord').setLabel('Adicionar Coordenada').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_tp_coord').setLabel('Teleportar').setStyle(ButtonStyle.Primary).setEmoji('🌀'),
            new ButtonBuilder().setCustomId('btn_del_coord').setLabel('Deletar Coordenada').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
            new ButtonBuilder().setCustomId('btn_refresh_coord').setLabel('Atualizar').setStyle(ButtonStyle.Secondary).setEmoji('🔄')
        );

        const messages = await channel.messages.fetch({ limit: 10 });
        const panelMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Painel de Coordenadas'));

        if (panelMsg) {
            await panelMsg.edit({ embeds: [embed], components: [row] });
        } else {
            await channel.send({ embeds: [embed], components: [row] });
        }
    } catch (err) {
        console.error('Erro ao atualizar painel de coordenadas:', err.message);
    }
}

client.once('ready', () => {
    console.log(`🤖 Bot ligado com sucesso como ${client.user.tag}!`);
    updateStatusEmbed();
    setInterval(updateStatusEmbed, 15000);
    initOrUpdateCoordsPanel(client);
});

// Gestão de Botões e Modais
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isButton()) {
            const { customId } = interaction;

            if (customId === 'btn_refresh_status') {
                await interaction.deferUpdate();
                return updateStatusEmbed();
            }

            if (customId === 'btn_add_coord') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_add_coord')
                    .setTitle('Adicionar Nova Coordenada');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_name').setLabel('Nome do Local (ex: Templo do Oceano)').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_coords').setLabel('Coordenadas (X, Y, Z)').setPlaceholder('ex: 648, 62, 695').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_dimension').setLabel('Dimensão (Overworld / Nether / End)').setValue('Overworld').setStyle(TextInputStyle.Short).setRequired(false))
                );

                return interaction.showModal(modal);
            }

            if (customId === 'btn_tp_coord') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_tp_coord')
                    .setTitle('Teleportar para Coordenada');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_warp').setLabel('Nome do Local/Warp').setPlaceholder('ex: Templo oceano').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_nick').setLabel('Seu Nick no Minecraft').setStyle(TextInputStyle.Short).setRequired(true))
                );

                return interaction.showModal(modal);
            }

            if (customId === 'btn_del_coord') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_del_coord')
                    .setTitle('Deletar Coordenada');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_warp_del').setLabel('Nome do Local a Deletar').setStyle(TextInputStyle.Short).setRequired(true))
                );

                return interaction.showModal(modal);
            }

            if (customId === 'btn_refresh_coord') {
                await interaction.deferUpdate();
                return initOrUpdateCoordsPanel(interaction.client);
            }
        }

        if (interaction.isModalSubmit()) {
            const { customId } = interaction;

            // Modal: Adicionar
            if (customId === 'modal_add_coord') {
                await interaction.deferReply({ ephemeral: true });

                const rawName = interaction.fields.getTextInputValue('input_name').trim();
                const coordsRaw = interaction.fields.getTextInputValue('input_coords');
                const dimension = interaction.fields.getTextInputValue('input_dimension') || 'Overworld';

                const parts = coordsRaw.split(',').map(s => s.trim());
                if (parts.length < 3 || parts.some(p => isNaN(p))) {
                    return interaction.editReply('❌ Formato de coordenadas inválido. Utilize o formato: `X, Y, Z` (ex: `100, 64, -200`).');
                }

                const warpName = rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                const coords = loadCoords();

                if (coords.some(c => c.warpName === warpName || c.name.toLowerCase() === rawName.toLowerCase())) {
                    return interaction.editReply(`❌ Já existe uma coordenada/warp com o nome **${rawName}**.`);
                }

                const newCoord = {
                    name: rawName,
                    warpName,
                    x: parts[0],
                    y: parts[1],
                    z: parts[2],
                    dimension,
                    authorId: interaction.user.id,
                    createdAt: new Date().toISOString()
                };

                coords.push(newCoord);
                saveCoords(coords);

                const rconResult = await sendRconCommand(`setwarp ${warpName} ${parts[0]} ${parts[1]} ${parts[2]}`);

                let msg = `✅ Coordenada **${rawName}** (\`/warp ${warpName}\`) adicionada com sucesso!`;
                if (!rconResult.success) {
                    msg += `\n⚠️ *(Aviso RCON: ${rconResult.error})*`;
                }

                await interaction.editReply(msg);
                return initOrUpdateCoordsPanel(interaction.client);
            }

            // Modal: Teleportar
            if (customId === 'modal_tp_coord') {
                await interaction.deferReply({ ephemeral: true });

                const warpSearch = interaction.fields.getTextInputValue('input_warp');
                const player = interaction.fields.getTextInputValue('input_nick').trim();

                const coords = loadCoords();
                const coordIndex = findCoordIndex(coords, warpSearch);

                if (coordIndex === -1) {
                    return interaction.editReply(`❌ Coordenada **${warpSearch}** não encontrada.`);
                }

                const coord = coords[coordIndex];
                const rconResult = await sendRconCommand(`warp ${coord.warpName} ${player}`);

                if (rconResult.success) {
                    return interaction.editReply(`✅ **${player}** foi teleportado para **${coord.name}**!`);
                } else {
                    return interaction.editReply(`❌ Erro ao teleportar: \`${rconResult.error}\`. Verifique se o jogador está ligado ao servidor.`);
                }
            }

            // Modal: Deletar Coordenada
            if (customId === 'modal_del_coord') {
                await interaction.deferReply({ ephemeral: true });

                const warpSearch = interaction.fields.getTextInputValue('input_warp_del');
                let coords = loadCoords();
                const coordIndex = findCoordIndex(coords, warpSearch);

                if (coordIndex === -1) {
                    return interaction.editReply(`❌ A coordenada **${warpSearch}** não foi encontrada.`);
                }

                const targetCoord = coords[coordIndex];

                const isGuildMember = interaction.inGuild() && interaction.member;
                const isAdmin = isGuildMember && (
                    interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
                    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
                );
                const isAuthor = targetCoord.authorId === interaction.user.id;

                if (!isAdmin && !isAuthor) {
                    return interaction.editReply('🚫 **Acesso Negado!** Apenas Administradores ou o Criador original podem excluir esta coordenada.');
                }

                coords.splice(coordIndex, 1);
                saveCoords(coords);

                const rconResult = await sendRconCommand(`deletewarp ${targetCoord.warpName}`);

                let msg = `🗑️ Coordenada **${targetCoord.name}** removida com sucesso!`;
                if (!rconResult.success) {
                    msg += `\n⚠️ *(Aviso RCON: ${rconResult.error})*`;
                }

                await interaction.editReply(msg);
                return initOrUpdateCoordsPanel(interaction.client);
            }
        }
    } catch (err) {
        console.error('Erro na interação:', err);
    }
});

client.login(process.env.DISCORD_TOKEN);
