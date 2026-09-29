const { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    EmbedBuilder 
} = require('discord.js');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');
const http = require('http');

// ================= 1. SERVIDOR WEBPAGE PARA REPLIT & UPTIMEROBOT =================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write('🤖 Bot de Coordenadas Minecraft rodando com sucesso no Replit!');
    res.end();
}).listen(PORT, () => {
    console.log(`🌐 Servidor Keep-Alive rodando na porta ${PORT}`);
});

// ================= 2. CONFIGURAÇÕES E VARIÁVEIS DE AMBIENTE =================
const CONFIG = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID || null,
    
    // Canal permitido para o comando /coordenadas
    ALLOWED_CHANNEL_ID: '1554309905736011817',

    // Conexão RCON com o Servidor Minecraft
    RCON_HOST: process.env.RCON_HOST || '127.0.0.1',
    RCON_PORT: parseInt(process.env.RCON_PORT || '25575', 10),
    RCON_PASSWORD: process.env.RCON_PASSWORD || ''
};

const COORDS_FILE = path.join(__dirname, 'coordenadas.json');

// ================= 3. FUNÇÕES AUXILIARES DE ARQUIVO =================
function loadCoords() {
    try {
        if (!fs.existsSync(COORDS_FILE)) {
            fs.writeFileSync(COORDS_FILE, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(COORDS_FILE, 'utf8');
        return JSON.parse(data);
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

// ================= 4. FUNÇÃO DE CONEXÃO RCON =================
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
        return { success: true, response };
    } catch (error) {
        if (rcon) {
            try { await rcon.end(); } catch (_) {}
        }
        console.error(`⚠️ [RCON Error] Comando "${command}" falhou:`, error.message);
        return { success: false, error: error.message };
    }
}

// ================= 5. CONFIGURAÇÃO DO BOT DISCORD =================
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Definição dos Slash Commands (/comandos)
const commands = [
    new SlashCommandBuilder()
        .setName('adicionar-coordenada')
        .setDescription('Salva uma nova coordenada/warp no bot e no servidor')
        .addStringOption(opt => opt.setName('nome').setDescription('Nome da coordenada/warp').setRequired(true))
        .addIntegerOption(opt => opt.setName('x').setDescription('Coordenada X').setRequired(true))
        .addIntegerOption(opt => opt.setName('y').setDescription('Coordenada Y').setRequired(true))
        .addIntegerOption(opt => opt.setName('z').setDescription('Coordenada Z').setRequired(true))
        .addStringOption(opt => opt.setName('dimensao').setDescription('Dimensão (Overworld, Nether, End)').setRequired(false)),

    new SlashCommandBuilder()
        .setName('coordenadas')
        .setDescription('Lista todas as coordenadas salvas'),

    new SlashCommandBuilder()
        .setName('teleportar')
        .setDescription('Teleporta um jogador para um warp salvo no servidor')
        .addStringOption(opt => opt.setName('nome').setDescription('Nome do warp').setRequired(true))
        .addStringOption(opt => opt.setName('nick').setDescription('Seu Nick exato no Minecraft').setRequired(true)),

    new SlashCommandBuilder()
        .setName('deletar-coordenada')
        .setDescription('Exclui uma coordenada (Restrito a Administradores ou ao Criador)')
        .addStringOption(opt => opt.setName('nome').setDescription('Nome da coordenada a excluir').setRequired(true))
].map(cmd => cmd.toJSON());

// Registrar comandos no Discord
async function registerCommands() {
    if (!CONFIG.DISCORD_TOKEN || !CONFIG.CLIENT_ID) {
        console.error('❌ ERRO CRÍTICO: DISCORD_TOKEN ou CLIENT_ID não configurados nas variáveis de ambiente!');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD_TOKEN);
    try {
        console.log('🔄 Atualizando comandos Slash (/)...');
        if (CONFIG.GUILD_ID) {
            await rest.put(Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID), { body: commands });
            console.log('✅ Comandos salvos instantaneamente no Servidor (GUILD_ID)!');
        } else {
            await rest.put(Routes.applicationCommands(CONFIG.CLIENT_ID), { body: commands });
            console.log('✅ Comandos salvos Globalmente!');
        }
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
}

client.once('ready', () => {
    console.log(`🤖 Bot iniciado com sucesso como: ${client.user.tag}`);
    registerCommands();
});

// ================= 6. MANIPULADOR DE INTERAÇÕES (/COMANDOS) =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // --- COMANDO: /adicionar-coordenada ---
    if (commandName === 'adicionar-coordenada') {
        await interaction.deferReply();

        const name = interaction.options.getString('nome').toLowerCase().trim();
        const x = interaction.options.getInteger('x');
        const y = interaction.options.getInteger('y');
        const z = interaction.options.getInteger('z');
        const dim = interaction.options.getString('dimensao') || 'Overworld';

        let coords = loadCoords();
        if (coords.some(c => c.name.toLowerCase() === name)) {
            return interaction.editReply(`❌ Já existe uma coordenada cadastrada com o nome **${name}**.`);
        }

        const newCoord = {
            name,
            x,
            y,
            z,
            dimension: dim,
            authorId: interaction.user.id,
            authorTag: interaction.user.tag,
            createdAt: new Date().toISOString()
        };

        coords.push(newCoord);
        saveCoords(coords);

        // Tenta executar o /setwarp no servidor Minecraft
        const rconResult = await sendRconCommand(`setwarp ${name}`);

        const embed = new EmbedBuilder()
            .setTitle('📍 Coordenada Adicionada!')
            .setColor(0x2ECC71)
            .addFields(
                { name: '🔖 Nome', value: `\`${name}\``, inline: true },
                { name: '📍 Pos (X, Y, Z)', value: `\`${x}, ${y}, ${z}\``, inline: true },
                { name: '🌍 Dimensão', value: dim, inline: true },
                { name: '👤 Criador', value: `<@${interaction.user.id}>`, inline: false }
            )
            .setTimestamp();

        if (!rconResult.success) {
            embed.setFooter({ text: `Aviso: Salvo no Discord. Falha ao executar no Minecraft (${rconResult.error})` });
        } else {
            embed.setFooter({ text: 'Sincronizado com o plugin SimpleWarp no Minecraft!' });
        }

        return interaction.editReply({ embeds: [embed] });
    }

    // --- COMANDO: /coordenadas ---
    if (commandName === 'coordenadas') {
        // Restrição para funcionar apenas no canal especificado
        if (CONFIG.ALLOWED_CHANNEL_ID && interaction.channelId !== CONFIG.ALLOWED_CHANNEL_ID) {
            return interaction.reply({
                content: `❌ Este comando só pode ser utilizado no canal <#${CONFIG.ALLOWED_CHANNEL_ID}>.`,
                ephemeral: true
            });
        }

        const coords = loadCoords();

        if (coords.length === 0) {
            return interaction.reply({ content: '📂 Nenhuma coordenada cadastrada ainda.', ephemeral: true });
        }

        const listText = coords.map((c, i) => 
            `**${i + 1}. \`${c.name}\`** ➔ \`X: ${c.x} | Y: ${c.y} \vert{} Z:${c.z}\` (${c.dimension})\n└ Criado por: <@${c.authorId}>`
        ).join('\n\n');

        const embed = new EmbedBuilder()
            .setTitle('🗺️ Coordenadas e Warps Salvos')
            .setColor(0x3498DB)
            .setDescription(listText.length > 4000 ? listText.substring(0, 4000) + '...' : listText)
            .setFooter({ text: `Total de locais: ${coords.length}` });

        return interaction.reply({ embeds: [embed] });
    }

    // --- COMANDO: /teleportar ---
    if (commandName === 'teleportar') {
        await interaction.deferReply();

        const warpName = interaction.options.getString('nome').toLowerCase().trim();
        const player = interaction.options.getString('nick').trim();

        const coords = loadCoords();
        const coord = coords.find(c => c.name.toLowerCase() === warpName);

        if (!coord) {
            return interaction.editReply(`❌ Coordenada/Warp **${warpName}** não encontrada.`);
        }

        // Sintaxe oficial do SimpleWarp: /warp [warpName] [playerName]
        const rconResult = await sendRconCommand(`warp ${coord.name} ${player}`);

        if (rconResult.success) {
            return interaction.editReply(`✅ **${player}** foi teleportado para o warp **${coord.name}**!`);
        } else {
            return interaction.editReply(`❌ Erro RCON ao teleportar: \`${rconResult.error}\`. Verifique se o servidor está online e o jogador conectado.`);
        }
    }

    // --- COMANDO: /deletar-coordenada ---
    if (commandName === 'deletar-coordenada') {
        await interaction.deferReply();

        const warpName = interaction.options.getString('nome').toLowerCase().trim();
        let coords = loadCoords();
        const coordIndex = coords.findIndex(c => c.name.toLowerCase() === warpName);

        if (coordIndex === -1) {
            return interaction.editReply(`❌ A coordenada/warp **${warpName}** não foi encontrada.`);
        }

        const targetCoord = coords[coordIndex];

        // VERIFICAÇÃO DE PERMISSÃO RIGOROSA:
        // Administrador/Gerenciador de Servidor Discord OU Criador Original da Coordenada
        const isGuildMember = interaction.inGuild() && interaction.member;
        const isAdmin = isGuildMember && (
            interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
            interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
        );
        const isAuthor = targetCoord.authorId === interaction.user.id;

        if (!isAdmin && !isAuthor) {
            return interaction.editReply({
                content: '🚫 **Acesso Negado!** Você só pode excluir coordenadas se for **Administrador** ou se tiver sido o **Criador** desta coordenada.'
            });
        }

        // Excluir da lista local
        coords.splice(coordIndex, 1);
        saveCoords(coords);

        // Sintaxe oficial do SimpleWarp: /deletewarp [warpName]
        const rconResult = await sendRconCommand(`deletewarp ${targetCoord.name}`);

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Coordenada / Warp Removido')
            .setColor(0xE74C3C)
            .setDescription(`A coordenada **\`${targetCoord.name}\`** foi excluída.`)
            .addFields(
                { name: 'Excluído por', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Criador Original', value: `<@${targetCoord.authorId}>`, inline: true }
            );

        if (!rconResult.success) {
            embed.setFooter({ text: `Aviso: Removido no Discord. Não foi possível executar no Minecraft (${rconResult.error})` });
        } else {
            embed.setFooter({ text: 'Removido com sucesso no Discord e no Minecraft (/deletewarp).' });
        }

        return interaction.editReply({ embeds: [embed] });
    }
});

// ================= 7. PROTEÇÃO ANTI-CRASH GLOBAL =================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [Anti-Crash] Rejeição não tratada:', reason);
});

process.on('uncaughtException', (error, origin) => {
    console.error('⚠️️ [Anti-Crash] Exceção não capturada:', error);
});

// ================= 8. INICIALIZAÇÃO DO BOT =================
if (!CONFIG.DISCORD_TOKEN) {
    console.error('❌ Defina a variável DISCORD_TOKEN no Replit em "Secrets" antes de ligar!');
} else {
    client.login(CONFIG.DISCORD_TOKEN);
}
