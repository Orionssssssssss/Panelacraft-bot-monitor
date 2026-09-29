require('dotenv').config();
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
const fs = require('fs');
const path = require('path');
const http = require('http');

// ================= 1. SERVIDOR WEBPAGE KEEP-ALIVE (REPLIT & UPTIMEROBOT) =================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write('🤖 Bot panela Craft está ativo e operacional!');
    res.end();
}).listen(PORT, () => {
    console.log(`🌐 Servidor Web HTTP Keep-Alive ativo na porta ${PORT}`);
});

// ================= 2. CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE =================
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    
    // Servidor Minecraft
    MC_HOST: process.env.MC_HOST || 'Panelacraft.astral.ovh',
    MC_PORT: parseInt(process.env.MC_PORT || '25941', 10),
    UPDATE_SECONDS: parseInt(process.env.UPDATE_SECONDS || '15', 10),
    IGNORED_PLAYERS: (process.env.IGNORED_PLAYERS || '')
        .split(',')
        .map(p => p.trim().toLowerCase())
        .filter(Boolean),

    // Canais do Discord
    STATUS_CHANNEL_ID: process.env.STATUS_CHANNEL_ID || '1554309905736011817',
    COORDS_CHANNEL_ID: '1554309905736011817',

    // Conexão RCON para Warps
    RCON_HOST: process.env.RCON_HOST || process.env.MC_HOST || 'Panelacraft.astral.ovh',
    RCON_PORT: parseInt(process.env.RCON_PORT || '25575', 10),
    RCON_PASSWORD: process.env.RCON_PASSWORD || 'panelacraftacess'
};

const COORDS_FILE = path.join(__dirname, 'coordenadas.json');
const PANEL_FILE = path.join(__dirname, 'panel_info.json');

// Validação de token
if (!CONFIG.DISCORD_TOKEN) {
    console.error('❌ ERRO CRÍTICO: DISCORD_TOKEN não foi definido nos Secrets/Variáveis de Ambiente!');
}

// Inicialização do cliente do Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages
    ]
});

// ================= 3. FUNÇÕES DE ARQUIVO LOCAL =================
function loadCoords() {
    try {
        if (!fs.existsSync(COORDS_FILE)) {
            fs.writeFileSync(COORDS_FILE, JSON.stringify([], null, 2));
            return [];
        }
        return JSON.parse(fs.readFileSync(COORDS_FILE, 'utf8'));
    } catch (err) {
        console.error('⚠️ Erro ao carregar coordenadas.json:', err.message);
        return [];
    }
}

function saveCoords(coords) {
    try {
        fs.writeFileSync(COORDS_FILE, JSON.stringify(coords, null, 2));
    } catch (err) {
        console.error('⚠️ Erro ao salvar coordenadas.json:', err.message);
    }
}

function savePanelInfo(channelId, messageId) {
    try {
        fs.writeFileSync(PANEL_FILE, JSON.stringify({ channelId, messageId }, null, 2));
    } catch (err) {
        console.error('⚠️ Erro ao salvar panel_info.json:', err.message);
    }
}

function loadPanelInfo() {
    try {
        if (!fs.existsSync(PANEL_FILE)) return null;
        return JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
    } catch (err) {
        return null;
    }
}

// ================= 4. CONEXÃO RCON (MINECRAFT) =================
async function sendRconCommand(command) {
    let rcon;
    try {
        rcon = await Rcon.connect({
            host: CONFIG.RCON_HOST,
            port: CONFIG.RCON_PORT,
            password: CONFIG.RCON_PASSWORD,
            timeout: 5000
        });
        const response = await rcon.send(command);
        await rcon.end();

        const lowerResp = (response || '').toLowerCase();
        if (lowerResp.includes('error') || lowerResp.includes('inválid') || lowerResp.includes('unknown') || lowerResp.includes('falha')) {
            return { success: false, error: response || 'O servidor de Minecraft recusou a execução do comando.' };
        }

        return { success: true, response };
    } catch (error) {
        if (rcon) {
            try { await rcon.end(); } catch (_) {}
        }
        console.error(`⚠️ [RCON Error] Comando "${command}" falhou:`, error.message);
        return { success: false, error: error.message };
    }
}

// ================= 5. MÓDULO DE MONITORAMENTO DO SERVIDOR =================
let statusMessage = null;

function createProgressBar(current, max, size = 10) {
    if (!max || max <= 0) return '░░░░░░░░░░';
    const percentage = Math.min(Math.max(current / max, 0), 1);
    const progress = Math.round(size * percentage);
    const emptyProgress = size - progress;
    return '🟩'.repeat(progress) + '⬜'.repeat(emptyProgress);
}

async function fetchMinecraftStatus() {
    // Tentativa 1: Socket direto via minecraft-server-util
    try {
        const result = await util.status(CONFIG.MC_HOST, CONFIG.MC_PORT, {
            timeout: 5000,
            enableSRV: true
        });

        const samplePlayers = result.players.sample || [];
        const validPlayers = samplePlayers
            .filter(player => !CONFIG.IGNORED_PLAYERS.includes(player.name.toLowerCase()))
            .map(p => p.name);

        return {
            online: true,
            playersOnline: Math.max(0, validPlayers.length),
            maxPlayers: result.players.max,
            playerList: validPlayers,
            version: result.version.name,
            ping: result.roundTripLatency,
            motd: result.motd.clean || 'panela Craft'
        };
    } catch (primaryError) {
        // Tentativa 2: Fallback via API REST (MCSrvStat)
        try {
            const response = await fetch(`https://api.mcsrvstat.us/3/${CONFIG.MC_HOST}:${CONFIG.MC_PORT}`);
            const data = await response.json();

            if (data.online) {
                const playerList = data.players?.list || [];
                const validPlayers = playerList.filter(name => 
                    !CONFIG.IGNORED_PLAYERS.includes(name.toLowerCase())
                );

                return {
                    online: true,
                    playersOnline: Math.max(0, validPlayers.length),
                    maxPlayers: data.players?.max || 20,
                    playerList: validPlayers,
                    version: data.version || '1.20.x',
                    ping: data.debug?.ping || 50,
                    motd: data.motd?.clean?.[0] || 'panela Craft'
                };
            }
        } catch (fallbackError) {
            // Falha em ambas
        }

        return { online: false };
    }
}

function buildStatusEmbed(data) {
    const fullAddress = `${CONFIG.MC_HOST}:${CONFIG.MC_PORT}`;

    if (!data.online) {
        return new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle('🎮 Status do Servidor panela Craft')
            .setDescription('🔴 **O servidor está atualmente OFFLINE.**\nAguarde o reinício ou verifique com a administração.')
            .addFields(
                { name: '🌐 IP do Servidor', value: `\`\`\`${fullAddress}\`\`\``, inline: false },
                { name: '📊 Estado', value: '🔴 **OFFLINE**', inline: true }
            )
            .setThumbnail('https://cdn.icon-icons.com/icons2/2699/PNG/512/minecraft_logo_icon_168974.png')
            .setFooter({ text: 'panela Craft • Monitorização em Tempo Real' })
            .setTimestamp();
    }

    const progressBar = createProgressBar(data.playersOnline, data.maxPlayers);
    const pingEmoji = data.ping < 100 ? '🟢' : data.ping < 200 ? '🟡' : '🔴';

    return new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('🎮 Status do Servidor panela Craft')
        .setDescription('🟢 **O servidor está ONLINE e pronto para jogar!**')
        .setThumbnail('https://cdn.icon-icons.com/icons2/2699/PNG/512/minecraft_logo_icon_168974.png')
        .addFields(
            {
                name: '🌐 IP do Servidor (Clique para copiar)',
                value: `\`\`\`${fullAddress}\`\`\``,
                inline: false
            },
            {
                name: '📊 Estado',
                value: '🟢 **ONLINE**',
                inline: true
            },
            {
                name: '🏷️ Versão',
                value: `\`${data.version}\``,
                inline: true
            },
            {
                name: '⚡ Latência',
                value: `${pingEmoji} \`${data.ping}ms\``,
                inline: true
            },
            {
                name: `👥 Jogadores Online (${data.playersOnline}/${data.maxPlayers})`,
                value: `${progressBar}\n\`${data.playersOnline} de ${data.maxPlayers} slots ocupados\``,
                inline: false
            }
        )
        .setFooter({ text: 'panela Craft • Monitorização em Tempo Real' })
        .setTimestamp();
}

function buildStatusActionRow() {
    const btnPlayers = new ButtonBuilder()
        .setCustomId('btn_ver_jogadores')
        .setLabel('Ver quem está online')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(btnPlayers);
}

async function updateStatus() {
    try {
        const channel = await client.channels.fetch(CONFIG.STATUS_CHANNEL_ID);
        if (!channel) {
            console.error(`❌ Canal de status (${CONFIG.STATUS_CHANNEL_ID}) não encontrado!`);
            return;
        }

        const statusData = await fetchMinecraftStatus();
        const embed = buildStatusEmbed(statusData);
        const row = buildStatusActionRow();

        if (statusMessage) {
            await statusMessage.edit({ embeds: [embed], components: [row] });
            return;
        }

        const messages = await channel.messages.fetch({ limit: 10 });
        const botMsg = messages.find(m => m.author.id === client.user.id && m.embeds.some(e => e.title && e.title.includes('Status do Servidor')));

        if (botMsg) {
            statusMessage = await botMsg.edit({ embeds: [embed], components: [row] });
        } else {
            statusMessage = await channel.send({ embeds: [embed], components: [row] });
        }
    } catch (error) {
        console.error('⚠️ Erro ao atualizar o painel de status:', error.message);
    }
}

// ================= 6. MÓDULO DO PAINEL FIXO DE COORDENADAS =================
function generateCoordsEmbedAndButtons() {
    const coords = loadCoords();

    let listText = '📂 Nenhuma coordenada cadastrada ainda. Clique em **Adicionar Coordenada** abaixo para registrar a primeira!';
    if (coords.length > 0) {
        listText = coords.map((c, i) => 
            `**${i + 1}. \`${c.name}\`** ➔ \`X: ${c.x} | Y: ${c.y} | Z: ${c.z}\` (${c.dimension})\n└ Criado por: <@${c.authorId}>`
        ).join('\n\n');
    }

    const embed = new EmbedBuilder()
        .setTitle('🗺️ Painel de Coordenadas e Warps')
        .setColor(0x3498DB)
        .setDescription(listText.length > 4000 ? listText.substring(0, 4000) + '...' : listText)
        .setFooter({ text: `Total de locais: ${coords.length} | Clique nos botões abaixo para interagir` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_add_coord')
            .setLabel('Adicionar Coordenada')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('btn_tp_coord')
            .setLabel('Teleportar')
            .setEmoji('🌀')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('btn_del_coord')
            .setLabel('Deletar Coordenada')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('btn_refresh_coord')
            .setLabel('Atualizar')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

async function initOrUpdateCoordsPanel(client) {
    try {
        const channel = await client.channels.fetch(CONFIG.COORDS_CHANNEL_ID);
        if (!channel) return;

        const info = loadPanelInfo();
        const panelData = generateCoordsEmbedAndButtons();

        if (info && info.messageId) {
            try {
                const msg = await channel.messages.fetch(info.messageId);
                if (msg) {
                    await msg.edit(panelData);
                    return;
                }
            } catch (_) {}
        }

        const newMsg = await channel.send(panelData);
        savePanelInfo(CONFIG.COORDS_CHANNEL_ID, newMsg.id);
    } catch (err) {
        console.error('⚠️ Erro ao atualizar painel de coordenadas:', err.message);
    }
}

// ================= 7. EVENTOS E MANIPULADORES DE INTERAÇÃO =================
client.once('ready', async () => {
    console.log(`✅ Bot conectado com sucesso como: ${client.user.tag}`);
    console.log(`📍 Servidor Minecraft: ${CONFIG.MC_HOST}:${CONFIG.MC_PORT}`);

    // Inicializa e agenda a atualização automática do status
    await updateStatus();
    setInterval(updateStatus, CONFIG.UPDATE_SECONDS * 1000);

    // Inicializa o Painel Fixo de Coordenadas
    await initOrUpdateCoordsPanel(client);
});

client.on('interactionCreate', async (interaction) => {

    // --- A. GERENCIAMENTO DE CLIQUE NOS BOTÕES ---
    if (interaction.isButton()) {
        const { customId } = interaction;

        // BOTÃO: Ver Jogadores Online (Status)
        if (customId === 'btn_ver_jogadores') {
            try {
                await interaction.deferReply({ ephemeral: true });
                const status = await fetchMinecraftStatus();

                if (!status.online) {
                    return await interaction.editReply({ content: '🔴 **O servidor panela Craft está offline no momento.**' });
                }

                const players = status.playerList || [];
                let responseText = `📊 **Jogadores Online no panela Craft (${status.playersOnline}/${status.maxPlayers}):**\n\n`;

                if (players.length > 0) {
                    responseText += players.map(name => `• \`${name}\``).join('\n');
                } else {
                    responseText += '*Nenhum jogador conectado no momento.*';
                }

                return await interaction.editReply({ content: responseText });
            } catch (err) {
                console.error('Erro ao listar jogadores online:', err);
            }
        }

        // BOTÃO: Atualizar Painel de Coordenadas
        if (customId === 'btn_refresh_coord') {
            const panelData = generateCoordsEmbedAndButtons();
            await interaction.update(panelData);
            return;
        }

        // BOTÃO: Adicionar Coordenada
        if (customId === 'btn_add_coord') {
            const modal = new ModalBuilder()
                .setCustomId('modal_add_coord')
                .setTitle('➕ Adicionar Coordenada & Warp');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_name').setLabel('Nome do Local / Warp').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_x').setLabel('Coordenada X').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_y').setLabel('Coordenada Y').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_z').setLabel('Coordenada Z').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_dim').setLabel('Dimensão (Overworld, Nether, End)').setStyle(TextInputStyle.Short).setValue('Overworld').setRequired(false))
            );

            return await interaction.showModal(modal);
        }

        // BOTÃO: Teleportar
        if (customId === 'btn_tp_coord') {
            const modal = new ModalBuilder()
                .setCustomId('modal_tp_coord')
                .setTitle('🌀 Teleportar para Warp');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_warp').setLabel('Nome da Coordenada / Warp').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_nick').setLabel('Seu Nick no Minecraft').setStyle(TextInputStyle.Short).setRequired(true))
            );

            return await interaction.showModal(modal);
        }

        // BOTÃO: Deletar Coordenada
        if (customId === 'btn_del_coord') {
            const modal = new ModalBuilder()
                .setCustomId('modal_del_coord')
                .setTitle('🗑️ Deletar Coordenada');

            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_warp_del').setLabel('Nome da Coordenada a Excluir').setStyle(TextInputStyle.Short).setRequired(true))
            );

            return await interaction.showModal(modal);
        }
    }

    // --- B. FORMULÁRIOS (MODALS) ---
    if (interaction.isModalSubmit()) {
        const { customId } = interaction;

        // Modal: Adicionar Coordenada
        if (customId === 'modal_add_coord') {
            await interaction.deferReply({ ephemeral: true });

            const rawName = interaction.fields.getTextInputValue('input_name').trim();
            const name = rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
            const x = parseInt(interaction.fields.getTextInputValue('input_x').trim(), 10);
            const y = parseInt(interaction.fields.getTextInputValue('input_y').trim(), 10);
            const z = parseInt(interaction.fields.getTextInputValue('input_z').trim(), 10);
            const dim = interaction.fields.getTextInputValue('input_dim').trim() || 'Overworld';

            if (isNaN(x) || isNaN(y) || isNaN(z)) {
                return interaction.editReply('❌ As coordenadas X, Y e Z devem ser números inteiros!');
            }

            let coords = loadCoords();
            if (coords.some(c => c.name.toLowerCase() === name)) {
                return interaction.editReply(`❌ Já existe uma coordenada cadastrada com o nome **${name}**.`);
            }

            // Tenta criar o warp no Minecraft via RCON
            const rconResult = await sendRconCommand(`setwarp ${name} ${x} ${y} ${z}`);

            coords.push({
                name: rawName,
                warpName: name,
                x,
                y,
                z,
                dimension: dim,
                authorId: interaction.user.id,
                authorTag: interaction.user.tag,
                createdAt: new Date().toISOString()
            });

            saveCoords(coords);

            await interaction.editReply(`✅ Coordenada **${rawName}** (\`/warp ${name}\`) adicionada com sucesso! ${!rconResult.success ? `\n⚠️ (Aviso Minecraft: ${rconResult.error})` : ''}`);
            return initOrUpdateCoordsPanel(interaction.client);
        }

        // Modal: Teleportar
        if (customId === 'modal_tp_coord') {
            await interaction.deferReply({ ephemeral: true });

            const warpSearch = interaction.fields.getTextInputValue('input_warp').toLowerCase().trim();
            const player = interaction.fields.getTextInputValue('input_nick').trim();

            const coords = loadCoords();
            const coord = coords.find(c => (c.warpName || c.name).toLowerCase() === warpSearch);

            if (!coord) {
                return interaction.editReply(`❌ Coordenada/Warp **${warpSearch}** não encontrada.`);
            }

            const rconResult = await sendRconCommand(`warp ${coord.warpName || coord.name} ${player}`);

            if (rconResult.success) {
                return interaction.editReply(`✅ **${player}** foi teleportado para o warp **${coord.name}**!`);
            } else {
                return interaction.editReply(`❌ Erro ao teleportar: \`${rconResult.error}\`. Verifique se o jogador está conectado no Minecraft.`);
            }
        }

        // Modal: Deletar Coordenada
        if (customId === 'modal_del_coord') {
            await interaction.deferReply({ ephemeral: true });

            const warpSearch = interaction.fields.getTextInputValue('input_warp_del').toLowerCase().trim();
            let coords = loadCoords();
            const coordIndex = coords.findIndex(c => (c.warpName || c.name).toLowerCase() === warpSearch);

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

            const rconResult = await sendRconCommand(`deletewarp ${targetCoord.warpName || targetCoord.name}`);

            await interaction.editReply(`🗑️ Coordenada **${targetCoord.name}** removida com sucesso!`);
            return initOrUpdateCoordsPanel(interaction.client);
        }
    }
});

// ================= 8. PROTEÇÃO ANTI-CRASH GLOBAL =================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Anti-Crash] Rejeição não tratada:', reason);
});

process.on('uncaughtException', (error, origin) => {
    console.error('⚠️️ [Anti-Crash] Exceção não capturada:', error);
});

// ================= 9. INICIALIZAÇÃO DO BOT =================
client.login(CONFIG.DISCORD_TOKEN);
