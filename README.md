# YT Downloader Web

Simple and secure Node.js application to list and download YouTube videos (video or audio only), supporting single video or playlist URLs. Downloads occur on the server (container) and are delivered to the browser, with no login required.

## 🔒 Security Features

- **Rate Limiting**: Protection against API abuse with configurable limits per endpoint
- **Input Validation**: Robust validation of all user inputs (URLs, parameters, etc.)
- **CORS Configuration**: Configurable CORS to restrict access by origin
- **HTTP Security Headers**: Using Helmet.js for enhanced security
- **Path Traversal Protection**: Advanced filename sanitization
- **Request Size Limits**: Protection against payload bombs
- **Error Handling**: Centralized error handling without exposing sensitive information

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
   ALLOWED_ORIGINS=*
   ```

   **Environment Variables:**
   - `YT_API_KEY`: YouTube Data API v3 key (required)
   - `PORT`: Server port (default: 3000)
   - `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins, or `*` for all (default: `*`)

3. Start the application with Docker Compose:
   ```bash
   docker compose up --build
   ```

4. Access in your browser: http://localhost:3000

## Features
- URL analysis: detects if it is a single video or playlist
- Lists items with title and thumbnail
- Individual download: video (mp4) or audio (m4a)
- Download all: generates a ZIP with all items in the chosen format
- Automatic validation of YouTube URLs
- Protection against malicious inputs

## Rate Limits

To prevent abuse, the following rate limits are enforced per IP:

| Endpoint | Limit | Window |
|----------|-------|--------|
| General | 100 requests | 15 minutes |
| `/api/parse` | 20 requests | 5 minutes |
| `/api/download-one` | 50 requests | 10 minutes |
| `/api/download-all` | 5 requests | 30 minutes |

When rate limit is exceeded, the API returns HTTP 429 with `RateLimit-*` headers indicating when to retry.

## API Endpoints

### `POST /api/parse`
Analyzes a YouTube URL and returns video/playlist information.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

**Response:**
```json
{
  "kind": "video",
  "items": [
    {
      "id": "VIDEO_ID",
      "title": "Video Title",
      "thumbnail": "https://...",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID"
    }
  ]
}
```

### `POST /api/download-one`
Downloads a single video or audio file.

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "mode": "video",
  "title": "Optional Title"
}
```

### `POST /api/download-all`
Downloads multiple items as a ZIP file.

**Request:**
```json
{
  "items": [
    {
      "id": "VIDEO_ID",
      "title": "Video Title",
      "url": "https://www.youtube.com/watch?v=VIDEO_ID"
    }
  ],
  "mode": "audio",
  "jobId": "unique-job-id"
}
```

### `GET /api/health`
Health check endpoint.

**Response:**
```json
{
  "ok": true,
  "ytApi": true,
  "timestamp": "2025-11-06T...",
  "uptime": 123.45
}
```

## Notes
- The container includes ffmpeg and yt-dlp.
- Files are downloaded to a temporary directory and cleaned up after delivery.
- Respect YouTube's Terms of Service. Use only for content you have the right to download.
- For better Windows compatibility, video is delivered in MP4 with AAC audio and audio downloads use m4a by default.
- PM2 automatically restarts the process in case of failure or excessive memory usage (>500MB).
- Playlists are limited to 1000 videos maximum.
- Batch downloads are limited to 100 items maximum.

## Troubleshooting
- If `/api/parse` returns an error, check if `YT_API_KEY` is set correctly.
- Depending on playlist size, downloading all may take a long time.
- The final file name is determined by the YouTube title, with merge to mp4 for video and conversion to mp3 for audio.
- Check logs: `docker logs yt-downloader`
- Healthcheck: `curl http://localhost:3000/api/health`

## License
This project is provided "as is", without warranties. Use at your own risk.
