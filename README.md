# YT Downloader Web (Docker)

Aplicação simples em Node.js para listar e baixar vídeos do YouTube (vídeo ou apenas áudio), suportando URL de vídeo único ou playlist. O download ocorre no servidor (container) e é entregue para o navegador, sem necessidade de login.

## Requisitos
- Docker e Docker Compose
- Uma chave da YouTube Data API v3

## Configuração
1. Crie um arquivo `.env` na raiz do projeto com:
   
   YT_API_KEY=SEU_TOKEN_AQUI
   PORT=3000

2. Suba a aplicação com Docker Compose:
   
   docker compose up --build

3. Acesse no navegador: http://localhost:3000

## Funcionalidades
- Análise de URL: detecta se é vídeo único ou playlist
- Lista os itens com título e thumbnail
- Download individual: vídeo (mp4) ou áudio (mp3)
- Download de todos: gera um ZIP com todos os itens no formato escolhido

## Endpoints (para referência)
- POST `/api/parse` { url }
- POST `/api/download-one` { url, mode: 'video'|'audio' }
- POST `/api/download-all` { items: [{id,title,thumbnail,url}], mode }
- GET `/api/health`

## Observações
- O container inclui ffmpeg e yt-dlp.
- Os arquivos são baixados para diretório temporário e limpos ao finalizar o envio.
- Respeite os Termos de Serviço do YouTube. Use apenas para conteúdo que você tem direito de baixar.
- Para maior compatibilidade com Windows, o vídeo é entregue em MP4 com áudio AAC (m4a) e o download de áudio usa m4a por padrão.

## Solução de problemas
- Se `/api/parse` retornar erro, confira se o `YT_API_KEY` está definido corretamente.
- Dependendo do tamanho da playlist, baixar todos pode levar bastante tempo.
- O nome final dos arquivos é determinado pelo título do YouTube, com merge em mp4 para vídeo e conversão para mp3 para áudio.
