require('dotenv').config();
const http = require('http');
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

// ==========================================
// CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE
// ==========================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
// Configure com o endereço e a porta BEDROCK exibidos no painel da RazeHost.
const MC_HOST = process.env.MC_HOST || '';
const MC_PORT = parseInt(process.env.MC_PORT || '19132', 10);
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const COORDS_CHANNEL_ID = process.env.COORDS_CHANNEL_ID;
const UPDATE_SECONDS = parseInt(process.env.UPDATE_SECONDS || '15', 10);
const PORT = process.env.PORT || 8080;
const IGNORED_PLAYERS = (process.env.IGNORED_PLAYERS || '')
  .split(',')
  .map(p => p.trim().toLowerCase())
  .filter(Boolean);

const COORDS_FILE = './coords.json';

// Inicialização do cliente do Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let statusMessage = null;

// ==========================================
// SISTEMA DE COORDENADAS & RCON
// ==========================================

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

async function sendRconCommand(command) {
    // Não presume que a hospedagem Bedrock ofereça RCON ou usa uma porta inventada.
    if (!process.env.RCON_HOST || !process.env.RCON_PORT || !process.env.RCON_PASSWORD) {
        return { success: false, error: 'RCON não configurado. A RazeHost precisa oferecer RCON compatível para executar warps/teleportes.' };
    }
    try {
        const rcon = await Rcon.connect({
            host: process.env.RCON_HOST,
            port: parseInt(process.env.RCON_PORT, 10),
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

async function initOrUpdateCoordsPanel(client) {
    try {
        if (!COORDS_CHANNEL_ID) return;
        const channel = await client.channels.fetch(COORDS_CHANNEL_ID);
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
                description += `**${index + 1}.${c.name}**\n`;
                description += `➔ \`X: ${c.x} | Y: ${c.y} | Z: ${c.z}\` (${c.dimension})\n`;
                description += `└ Criado por: <@${c.authorId}>\n\n`;
            });
            embed.setDescription(description);
            embed.setFooter({ text: `Total de locais: ${coords.length} | Clique nos botões abaixo para interagir` });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('btn_add_coord').setLabel('Adicionar Coordenada').setStyle(ButtonStyle.Success).setEmoji('➕'),
            new ButtonBuilder().setCustomId('btn_tp_coord').setLabel('Teleportar').setStyle(ButtonStyle.Primary).setEmoji('🌀'),
            new ButtonBuilder().setCustomId('btn_del_coord').setLabel('Deletar Coordenada').setStyle(ButtonStyle.Danger).setEmoji('🗑️️'),
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

// ==========================================
// SISTEMA DE MONITORIZAÇÃO DE STATUS
// ==========================================

function createProgressBar(current, max, size = 10) {
  if (!max || max <= 0) return '░░░░░░░░░░';
  const percentage = Math.min(Math.max(current / max, 0), 1);
  const progress = Math.round(size * percentage);
  const emptyProgress = size - progress;
  return '🟩'.repeat(progress) + '⬜'.repeat(emptyProgress);
}

// Consulta direta pelo protocolo Bedrock (UDP).
// Mantém a biblioteca já utilizada no projeto, sem exigir nova dependência.
async function fetchMinecraftStatus() {
  if (!MC_HOST) {
    console.error('❌ MC_HOST não configurado. Informe o endereço Bedrock da RazeHost no .env.');
    return { online: false };
  }

  const startedAt = Date.now();

  try {
    const result = await util.statusBedrock(MC_HOST, MC_PORT, { enableSRV: true });
    return {
      online: true,
      playersOnline: Number(result.players?.online ?? 0),
      maxPlayers: Number(result.players?.max ?? 0),
      // A consulta UDP Bedrock não garante uma lista de nomes.
      playerList: [],
      version: result.version?.name || 'Bedrock',
      ping: Date.now() - startedAt,
      motd: result.motd?.clean || result.motd?.raw || 'panela Craft',
      source: 'direct'
    };
  } catch (primaryError) {
    console.warn('⚠️ Consulta UDP Bedrock falhou; tentando consulta externa:', primaryError.message);

    // Fallback específico para Bedrock. A API externa pode manter cache por até 5 minutos.
    try {
      const address = encodeURIComponent(`${MC_HOST}:${MC_PORT}`);
      const response = await fetch(`https://api.mcsrvstat.us/bedrock/3/${address}`, {
        headers: { 'User-Agent': 'PanelaCraft-Discord-Monitor/1.0' },
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error(`API respondeu HTTP ${response.status}`);
      const data = await response.json();

      if (data.online) {
        const rawList = Array.isArray(data.players?.list) ? data.players.list : [];
        const validPlayers = rawList
          .map(player => typeof player === 'string' ? player : player?.name)
          .filter(name => typeof name === 'string' && name.trim())
          .filter(name => !IGNORED_PLAYERS.includes(name.toLowerCase()));

        return {
          online: true,
          playersOnline: Number(data.players?.online ?? validPlayers.length),
          maxPlayers: Number(data.players?.max ?? 20),
          playerList: validPlayers,
          version: data.version || 'Bedrock',
          ping: null,
          motd: data.motd?.clean || data.motd?.raw || 'panela Craft',
          source: 'api'
        };
      }
    } catch (fallbackError) {
      console.error('❌ Consulta Bedrock direta e alternativa falharam:', fallbackError.message);
    }
    return { online: false };
  }
}

// Busca nomes somente quando alguém clica no botão do Discord.
async function fetchBedrockPlayerList() {
  if (!MC_HOST) return [];
  const address = encodeURIComponent(`${MC_HOST}:${MC_PORT}`);
  const response = await fetch(`https://api.mcsrvstat.us/bedrock/3/${address}`, {
    headers: { 'User-Agent': 'PanelaCraft-Discord-Monitor/1.0' },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`API respondeu HTTP ${response.status}`);
  const data = await response.json();
  if (!data.online || !Array.isArray(data.players?.list)) return [];
  return data.players.list
    .map(player => typeof player === 'string' ? player : player?.name)
    .filter(name => typeof name === 'string' && name.trim())
    .filter(name => !IGNORED_PLAYERS.includes(name.toLowerCase()));
}

function buildStatusEmbed(data) {
  const fullAddress = `${MC_HOST}:${MC_PORT}`;

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
  const pingEmoji = data.ping == null ? '⚪' : data.ping < 100 ? '🟢' : data.ping < 200 ? '🟡' : '🔴';
  const pingText = data.ping == null ? 'Indisponível (consulta alternativa)' : `${data.ping}ms`;

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
        value: `${pingEmoji} \`${pingText}\``,
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
  const btn = new ButtonBuilder()
    .setCustomId('btn_ver_jogadores')
    .setLabel('Ver quem está online')
    .setEmoji('👥')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(btn);
}

async function updateStatus() {
  try {
    if (!STATUS_CHANNEL_ID) return;
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel) {
      console.error(`❌ Canal de status com ID ${STATUS_CHANNEL_ID} não encontrado!`);
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
    const botMsg = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0 && m.embeds[0].title?.includes('Status do Servidor'));

    if (botMsg) {
      statusMessage = await botMsg.edit({ embeds: [embed], components: [row] });
    } else {
      statusMessage = await channel.send({ embeds: [embed], components: [row] });
    }
  } catch (error) {
    console.error('⚠️ Erro ao atualizar o painel de status:', error.message);
  }
}

// ==========================================
// EVENTOS DO DISCORD
// ==========================================

client.once('ready', () => {
    console.log(`🤖 Bot conectado com sucesso como: ${client.user.tag}`);
    if (!MC_HOST) {
        console.error('❌ Configure MC_HOST no .env com o endereço Bedrock da RazeHost.');
    } else {
        console.log(`📍 Monitorizando servidor Bedrock: ${MC_HOST}:${MC_PORT}/UDP`);
    }

    // Iniciar monitorização de status
    updateStatus();
    setInterval(updateStatus, UPDATE_SECONDS * 1000);

    // Iniciar painel de coordenadas
    initOrUpdateCoordsPanel(client);
});

client.on('interactionCreate', async interaction => {
    try {
        // --- BOTÕES ---
        if (interaction.isButton()) {
            const { customId } = interaction;

            // Botão: Ver Jogadores Online
            if (customId === 'btn_ver_jogadores') {
                await interaction.deferReply({ ephemeral: true });
                const status = await fetchMinecraftStatus();

                if (!status.online) {
                    return await interaction.editReply({ content: '🔴 **O servidor panela Craft está offline no momento.**' });
                }

                let players = status.playerList || [];

                // O status Bedrock informa a contagem; a lista nominal depende da API externa.
                if (players.length === 0 && status.playersOnline > 0) {
                    try {
                        players = await fetchBedrockPlayerList();
                    } catch (error) {
                        console.warn('Não foi possível obter a lista de jogadores:', error.message);
                    }
                }

                let responseText = `📊 **Jogadores Online no panela Craft (${status.playersOnline}/${status.maxPlayers}):**\n\n`;
                if (players.length > 0) {
                    responseText += players.map(name => `• \`${name}\``).join('\n');
                } else if (status.playersOnline > 0) {
                    responseText += '*O servidor informa a quantidade de jogadores, mas não disponibilizou os nomes nesta consulta.*';
                } else {
                    responseText += '*Nenhum jogador conectado no momento.*';
                }

                return await interaction.editReply({ content: responseText });
            }

            // Botão: Adicionar Coordenada
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

            // Botão: Teleportar
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

            // Botão: Deletar Coordenada
            if (customId === 'btn_del_coord') {
                const modal = new ModalBuilder()
                    .setCustomId('modal_del_coord')
                    .setTitle('Deletar Coordenada');

                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('input_warp_del').setLabel('Nome do Local a Deletar').setStyle(TextInputStyle.Short).setRequired(true))
                );

                return interaction.showModal(modal);
            }

            // Botão: Atualizar Coordenadas
            if (customId === 'btn_refresh_coord') {
                await interaction.deferUpdate();
                return initOrUpdateCoordsPanel(interaction.client);
            }
        }

        // --- MODAIS ---
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

// ==========================================
// SERVIDOR WEB HTTP (KEEP-ALIVE)
// ==========================================
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot panela Craft está ativo e operacional!');
}).listen(PORT, () => {
  console.log(`🌐 Servidor Web HTTP ativo na porta ${PORT}`);
});

// Conectar o bot ao Discord
client.login(DISCORD_TOKEN);
