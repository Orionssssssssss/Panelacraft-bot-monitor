require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Events } = require('discord.js');
const util = require('minecraft-server-util');
const fetch = globalThis.fetch || require('node-fetch');
const express = require('express');

// ==========================================
// 1. CONFIGURAÇÕES & VARIÁVEIS DE AMBIENTE
// ==========================================
const TOKEN = process.env.DISCORD_TOKEN;
const MC_HOST = process.env.MC_HOST;
const MC_PORT = parseInt(process.env.MC_PORT) || 25565;
const CHANNEL_ID = process.env.STATUS_CHANNEL_ID;
const UPDATE_INTERVAL = (parseInt(process.env.UPDATE_SECONDS) || 15) * 1000;
const PORT = process.env.PORT || 8080;

// Lista de nicks do Minecraft que NÃO devem ser contados (em minúsculas)
const IGNORED_PLAYERS = (process.env.IGNORED_PLAYERS || '')
  .split(',')
  .map(n => n.trim().toLowerCase())
  .filter(Boolean);

if (!TOKEN || !MC_HOST || !CHANNEL_ID) {
  console.error('❌ [ERRO] Variáveis de ambiente obrigatórias não encontradas! Verifique o ficheiro .env ou as variáveis na Discloud.');
  process.exit(1);
}

// ==========================================
// 2. SERVIDOR WEB KEEP-ALIVE
// ==========================================
const app = express();
app.get('/', (req, res) => {
  res.send('🟢 Bot de Monitorização do panela Craft está ativo e a rodar!');
});

app.listen(PORT, () => {
  console.log(`🌐 Servidor Web de Keep-Alive a rodar na porta ${PORT}`);
}).on('error', (err) => {
  console.log('ℹ️ Servidor HTTP offline ou porta ocupada, continuando apenas com o bot Discord.');
});

// ==========================================
// 3. INICIALIZAÇÃO DO BOT DISCORD
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

let statusMessage = null; // Guarda a referência da mensagem para edição rápida

// ==========================================
// 4. FUNÇÃO DE CONSULTA AO MINECRAFT (PING + FALLBACK + BLACKLIST)
// ==========================================
async function fetchMinecraftStatus() {
  // Tentativa 1: Socket direto via minecraft-server-util
  try {
    const result = await util.status(MC_HOST, MC_PORT, {
      timeout: 5000,
      enableSRV: true
    });

    const samplePlayers = result.players.sample || [];
    const ignoredFound = samplePlayers.filter(player => 
      IGNORED_PLAYERS.includes(player.name.toLowerCase())
    ).length;

    const realOnline = Math.max(0, result.players.online - ignoredFound);

    return {
      online: true,
      playersOnline: realOnline,
      maxPlayers: result.players.max,
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
        const ignoredFound = playerList.filter(name => 
          IGNORED_PLAYERS.includes(name.toLowerCase())
        ).length;

        const rawOnline = data.players?.online || 0;
        const realOnline = Math.max(0, rawOnline - ignoredFound);

        return {
          online: true,
          playersOnline: realOnline,
          maxPlayers: data.players?.max || 20,
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

// ==========================================
// 5. GERADOR DE EMBEDS
// ==========================================
function createProgressBar(online, max) {
  const totalBlocks = 10;
  if (max <= 0) return '⬛'.repeat(totalBlocks);
  const percentage = Math.min(Math.max(Math.round((online / max) * totalBlocks), 0), totalBlocks);
  return '🟩'.repeat(percentage) + '⬛'.repeat(totalBlocks - percentage);
}

function buildStatusEmbed(data) {
  const fullAddress = MC_PORT === 25565 ? MC_HOST : `${MC_HOST}:${MC_PORT}`;

  if (data.online) {
    const progressBar = createProgressBar(data.playersOnline, data.maxPlayers);
    const pingEmoji = data.ping < 80 ? '🟢' : data.ping < 150 ? '🟡' : '🔴';

    return new EmbedBuilder()
      .setColor(0x2ECC71) // Verde Emerald
      .setTitle('🎮 Status do Servidor panela Craft')
      .setDescription('O servidor está atualmente **ONLINE** e pronto para jogar!')
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
  } else {
    return new EmbedBuilder()
      .setColor(0xE74C3C) // Vermelho Alizarin
      .setTitle('🎮 Status do Servidor panela Craft')
      .setDescription('⚠️ O servidor **panela Craft** está atualmente **OFFLINE** ou a arrancar.')
      .setThumbnail('https://cdn.icon-icons.com/icons2/2699/PNG/512/minecraft_logo_icon_168974.png')
      .addFields(
        {
          name: '🌐 IP do Servidor',
          value: `\`\`\`${fullAddress}\`\`\``,
          inline: false
        },
        {
          name: '📊 Estado',
          value: '🔴 **OFFLINE**',
          inline: true
        },
        {
          name: '💡 Como Ligar?',
          value: 'Acede ao painel do servidor para iniciar o **panela Craft**!',
          inline: true
        }
      )
      .setFooter({ text: 'panela Craft • Monitorização em Tempo Real' })
      .setTimestamp();
  }
}

// ==========================================
// 6. CICLO DE ATUALIZAÇÃO DO STATUS
// ==========================================
async function updateStatus() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error(`❌ [ERRO] Canal com ID ${CHANNEL_ID} não foi encontrado ou não é um canal de texto!`);
      return;
    }

    const statusData = await fetchMinecraftStatus();
    const embed = buildStatusEmbed(statusData);

    // 1. Atualizar Presença/Atividade do Bot
    if (statusData.online) {
      client.user.setPresence({
        activities: [{ name: `👥 ${statusData.playersOnline}/${statusData.maxPlayers} em ${MC_HOST}`, type: ActivityType.Watching }],
        status: 'online'
      });
    } else {
      client.user.setPresence({
        activities: [{ name: `🔴 panela Craft Offline`, type: ActivityType.Watching }],
        status: 'dnd'
      });
    }

    // 2. Enviar ou Editar a Mensagem no Canal
    if (!statusMessage) {
      const messages = await channel.messages.fetch({ limit: 10 });
      statusMessage = messages.find(m => m.author.id === client.user.id && m.embeds.length > 0);
    }

    if (statusMessage) {
      await statusMessage.edit({ embeds: [embed] });
    } else {
      statusMessage = await channel.send({ embeds: [embed] });
    }

  } catch (error) {
    console.error('⚠️ [AVISO] Falha durante o ciclo de atualização:', error.message);
  }
}

// ==========================================
// 7. EVENTOS DO CLIENTE DISCORD
// ==========================================
client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot conectado com sucesso como: ${c.user.tag}`);
  console.log(`📡 A monitorizar o servidor panela Craft: ${MC_HOST}:${MC_PORT}`);
  console.log(`⏱️ Intervalo de atualização: ${UPDATE_INTERVAL / 1000}s`);

  // Executa a primeira verificação imediatamente
  updateStatus();

  // Inicia o temporizador contínuo
  setInterval(updateStatus, UPDATE_INTERVAL);
});

// Autenticação
client.login(TOKEN);
