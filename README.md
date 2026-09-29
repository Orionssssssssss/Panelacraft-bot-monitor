# 🎮 panela Craft - Discord Monitor v2.0

Bot de alta performance para monitorização em tempo real do servidor Minecraft **panela Craft** (`Panelacraft.astral.ovh:25941`) diretamente no Discord.

## ✨ Funcionalidades
- 🟢 **Monitorização em Tempo Real:** Atualizações automáticas a cada 15 segundos.
- 🎨 **Embed Personalizado:** Design com barra de progresso visual, IP formatado para cópia e nome **panela Craft**.
- ⚡ **Sistema Duplo de Consulta:** Socket direto + Fallback via API REST (MCSrvStat).
- 🔄 **Auto-Edit:** Encontra e edita a mensagem anterior do bot no canal sem criar spam.
- 🚀 **Pronto para Discloud:** Já inclui o ficheiro `discloud.config` e suporte completo a variáveis de ambiente.

## 🚀 Como Hospedar na Discloud
1. Edite o ficheiro `.env` com o seu `DISCORD_TOKEN` e `STATUS_CHANNEL_ID`.
2. O `MC_HOST` e `MC_PORT` já vêm preenchidos como `Panelacraft.astral.ovh` e `25941`.
3. Compacte todos os ficheiros da raiz do projeto num ficheiro `.zip` (ou use este ficheiro `.zip` fornecido).
4. Aceda ao site da [Discloud](https://discloudbot.com/) ou utilize o comando da Discloud no Discord (`.upload`).
5. Selecione o ficheiro `.zip` e faça o upload!

## ⚙️ Ficheiro `discloud.config`
```ini
NAME=panela Craft
TYPE=bot
MAIN=index.js
RAM=100
AUTORESTART=true
VERSION=recommended
```
