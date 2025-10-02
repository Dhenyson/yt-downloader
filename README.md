# YT Downloader Web

Simple Node.js application to list and download YouTube videos (video or audio only), supporting single video or playlist URLs. Downloads occur on the server (container) and are delivered to the browser, with no login required.

### Run with Docker

```bash
docker run -d \
   --name yt-downloader \
   -p 3000:3000 \
   -e YT_API_KEY=your_api_key_here \
   --restart unless-stopped \
   dhenyson/yt-downloader:latest
```

## Local Development

### Requirements
- Docker and Docker Compose
- A YouTube Data API v3 key

### Setup
1. Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your key:
   ```
   YT_API_KEY=your_api_key_here
   PORT=3000
   ```

3. Start the application with Docker Compose:
   ```bash
   docker compose up --build
   ```

4. Access in your browser: http://localhost:3000

## Features
- URL analysis: detects if it is a single video or playlist
- Lists items with title and thumbnail
- Individual download: video (mp4) or audio (mp3)
- Download all: generates a ZIP with all items in the chosen format

## Notes
- The container includes ffmpeg and yt-dlp.
- Files are downloaded to a temporary directory and cleaned up after delivery.
- Respect YouTube's Terms of Service. Use only for content you have the right to download.
- For better Windows compatibility, video is delivered in MP4 with AAC audio (m4a) and audio downloads use m4a by default.
- PM2 automatically restarts the process in case of failure or excessive memory usage (>500MB).

## Troubleshooting
- If `/api/parse` returns an error, check if `YT_API_KEY` is set correctly.
- Depending on playlist size, downloading all may take a long time.
- The final file name is determined by the YouTube title, with merge to mp4 for video and conversion to mp3 for audio.
- Check logs: `docker logs yt-downloader`
- Healthcheck: `curl http://localhost:3000/api/health`

## License
This project is provided "as is", without warranties. Use at your own risk.
