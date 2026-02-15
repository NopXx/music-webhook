# Music Webhook API Documentation

Base URL: `http://localhost:3000` (default)

## 🎧 Scrobble & Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/webhook/scrobble` | Receives scrobble data (compatible with web-scrobbler). |
| `POST` | `/webhook` | Alias for scrobble endpoint. |
| `GET` | `/import/listenbrainz` | Renders the structured ListenBrainz import UI. |
| `POST` | `/api/import/listenbrainz` | Bulk import ListenBrainz history (JSON/JSONL). |

## 📊 Analytics & Data

| Method | Endpoint | Parameters | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/stats` | `range` (all-time, year, month, week, today), `offset` | Get overview stats, recent tracks, and top artists. |
| `GET` | `/api/tracks` | `page`, `limit`, `sortBy`, `order`, `search` | Get paginated track history. |
| `PATCH` | `/api/tracks` | Body: `{ id, loved }` | Toggle 'loved' status for a track. |
| `GET` | `/api/tracks/top-artists` | `range`, `limit` | Get top artists leaderboard. |
| `GET` | `/api/tracks/top-tracks` | `range`, `limit` | Get top tracks leaderboard. |
| `GET` | `/api/track` | `artist`, `title` | Get specific track analytics. |
| `GET` | `/api/albums` | `artist`, `album` | Get specific album analytics. |
| `GET` | `/api/artists/:name` | `limit` | Get artist profile and stats. |

## 🎵 Player (Now Playing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/nowplaying` | Get current playing track status. |
| `POST` | `/api/nowplaying/playing` | Manually set/refresh now playing status. |

## 🟢 Spotify Integration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/spotify/status` | Check if Spotify integration is configured. |
| `GET` | `/api/spotify/stats` | Get enrichment statistics (match rate, etc.). |
| `POST` | `/api/spotify/enrich` | Manually trigger enrichment for recent tracks. Params: `limit`, `force`. |
| `POST` | `/api/spotify/update-missing` | Update missing data for existing tracks. Params: `limit`, `missingOnly`. |
| `DELETE` | `/api/spotify/cache` | Clear Spotify search cache. |

## ⚙️ System & Maintenance

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check (returns 200 OK). |
| `GET` | `/api/duplicates` | Get duplicate track statistics. |
| `DELETE` | `/api/duplicates` | Remove duplicate scrobbles. |
| `DELETE` | `/api/tracks/range` | Delete tracks within a date range (ISO 8601). Params: `startDate`, `endDate`. |
