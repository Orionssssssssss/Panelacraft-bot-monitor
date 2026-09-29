require('dotenv').config();
const http = require('http');
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle 
} = require('discord.js');
const util = require('minecraft-server-util');

// ==========================================
// CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE
// ==========================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const MC_HOST = process.env.MC_HOST || 'Panelacraft.astral.ovh';
const MC_PORT = parseInt(process.env.MC_PORT || '25941', 10);
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const UPDATE_SECONDS = parseInt(process.env.UPDATE_SECONDS || '15', 10);
const PORT = process.env.PORT || 8080;
const IGNORED_PLAYERS = (process.env.IGNORED_PLAYERS || '')
  .split(',')
  .map(p => p.trim().toLowerCase())
  .filter(Boolean);

// Validação de variáveis obrigatórias
if (!DISCORD_TOKEN) {
  console.error('❌ ERRO: DISCORD_TOKEN não foi definido!');
  process.exit(1);
}

if (!STATUS_CHANNEL_ID) {
  console.error('❌ ERRO: STATUS_CHANNEL_ID não foi definido!');
  process.exit(1);
}

// Inicialização do cliente do Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

let statusMessage = null;

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

// Gera a barra de progresso visual para os slots de jogadores
function createProgressBar(current, max, size = 10) {
  if (!max || max <= 0) return '░░░░░░░░░░';
  const percentage = Math.min(Math.max(current / max, 0), 1);
  const progress = Math.round(size * percentage);
  const emptyProgress = size - progress;
  return '🟩'.repeat(progress) + '⬜'.repeat(emptyProgress);
}

// Consulta o status do servidor Minecraft (Socket Direto + Fallback REST)
async function fetchMinecraftStatus() {
  // Tentativa 1: Socket direto via minecraft-server-util
  try {
    const result = await util.status(MC_HOST, MC_PORT, {
      timeout: 5000,
      enableSRV: true
    });

    const samplePlayers = result.players.sample || [];
    const validPlayers = samplePlayers
      .filter(player => !IGNORED_PLAYERS.includes(player.name.toLowerCase()))
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
      const response = await fetch(`https://api.mcsrvstat.us/3/${MC_HOST}:${MC_PORT}`);
      const data = await response.json();

      if (data.online) {
        const playerList = data.players?.list || [];
        const validPlayers = playerList.filter(name => 
          !IGNORED_PLAYERS.includes(name.toLowerCase())
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
      // Falha em ambas as tentativas
    }

    return { online: false };
  }
}

// Constrói o Embed principal de Status do Servidor
function buildStatusEmbed(data) {
  const fullAddress = `${MC_HOST}:${MC_PORT}`;

  if (!data.online) {
    return new EmbedBuilder()
      .setColor(0xE74C3C) // Vermelho
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
    .setColor(0x2ECC71) // Verde
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

// Cria a linha contendo o botão "Ver quem está online"
function buildActionRow() {
  const btn = new ButtonBuilder()
    .setCustomId('btn_ver_jogadores')
    .setLabel('Ver quem está online')
    .setEmoji('👥')
    .setStyle(ButtonStyle.Primary);

  return new ActionRowBuilder().addComponents(btn);
}

// Atualiza a mensagem do painel no canal do Discord
async function updateStatus() {
  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel) {
      console.error(`❌ Canal com ID ${STATUS_CHANNEL_ID} não encontrado!`);
      return;
    }

    const statusData = await fetchMinecraftStatus();
    const embed = buildStatusEmbed(statusData);
    const row = buildActionRow();

    // Reutiliza a mensagem salva em memória se existir
    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed], components: [row] });
      return;
    }

    // Caso o bot tenha reiniciado, procura a mensagem anterior no canal para não duplicar
    const messages = await channel.messages.fetch({ limit: 10 });
    const botMsg = messages.find(m => m.author.id === client.user.id);

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

// Listener para o clique no botão (Resposta Privada/Efêmera)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'btn_ver_jogadores') {
    try {
      // Adia a resposta em modo privado/efêmero (só quem clicou consegue ver)
      await interaction.deferReply({ ephemeral: true });

      const status = await fetchMinecraftStatus();

      if (!status.online) {
        return await interaction.editReply({
          content: '🔴 **O servidor panela Craft está offline no momento.**'
        });
      }

      const players = status.playerList || [];
      let responseText = `📊 **Jogadores Online no panela Craft (${status.playersOnline}/${status.maxPlayers}):**\n\n`;

      if (players.length > 0) {
        const playerListFormatted = players.map(name => `• \`${name}\``).join('\n');
        responseText += playerListFormatted;
      } else {
        responseText += '*Nenhum jogador conectado no momento.*';
      }

      await interaction.editReply({
        content: responseText
      });
    } catch (err) {
      console.error('Erro ao processar clique no botão:', err);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Ocorreu um erro ao carregar a lista de jogadores.' });
      }
    }
  }
});

// Evento disparado quando o bot se conecta
client.once('ready', () => {
  console.log(`✅ Bot conectado com sucesso como: ${client.user.tag}`);
  console.log(`📍 Monitorizando o servidor: ${MC_HOST}:${MC_PORT}`);

  // Atualização inicial
  updateStatus();

  // Loop de atualização a cada X segundos
  setInterval(updateStatus, UPDATE_SECONDS * 1000);
});

// ==========================================
// SERVIDOR WEB (KEEP-ALIVE PARA RENDER/KOYEB)
// ==========================================
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot panela Craft está ativo e operacional!');
}).listen(PORT, () => {
  console.log(`🌐 Servidor Web HTTP ativo na porta ${PORT}`);
});

// Conectar o bot ao Discord
client.login(DISCORD_TOKEN);
