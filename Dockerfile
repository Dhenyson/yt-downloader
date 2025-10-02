FROM node:20-alpine

RUN apk add --no-cache \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && npm install -g pm2 \
  && apk del curl \
  && rm -rf /var/cache/apk/*

RUN addgroup -g 1001 -S nodejs \
  && adduser -S nodejs -u 1001

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=nodejs:nodejs src ./src
COPY --chown=nodejs:nodejs public ./public

RUN mkdir -p /tmp/yt-downloads && chown -R nodejs:nodejs /tmp/yt-downloads

USER nodejs

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["pm2-runtime", "start", "src/server.js", "--name", "yt-downloader", "--max-memory-restart", "500M"]
