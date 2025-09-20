FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 ca-certificates curl unzip \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --only=production

COPY src ./src
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
